import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppStore } from './store'
import { openVault, OpenVault, snapshot, isDir } from './session'
import { toIpcError, VaultError } from './vault'

app.setName('Synapse')
// Tests point this at a temp dir; normal runs use ~/Library/Application Support/Synapse.
if (process.env.SYNAPSE_USER_DATA) app.setPath('userData', process.env.SYNAPSE_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: 'synapse-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

let store: AppStore
let win: BrowserWindow | null = null
let current: OpenVault | null = null
let watcher: fs.FSWatcher | null = null
let quitting = false

const trash = (abs: string) => shell.trashItem(abs)

function send(channel: string, ...args: unknown[]) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function pushSnapshot() {
  send('state', snapshot(store, current))
}

function watch(root: string) {
  watcher?.close()
  watcher = null
  let pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  try {
    watcher = fs.watch(root, { recursive: true }, (_ev, file) => {
      if (!file) return
      const rel = file.toString().split(path.sep).join('/')
      if (rel.split('/').some((p) => p.startsWith('.'))) return
      pending.add(rel)
      timer ??= setTimeout(() => {
        send('fs:changed', [...pending])
        pending = new Set()
        timer = null
      }, 150)
    })
    watcher.on('error', (e) => console.error('watcher', e))
  } catch (e) {
    console.error('cannot watch vault', e)
  }
}

async function activate(folder: string, create = false) {
  const next = await openVault(store, folder, trash, { create })
  current = next
  app.addRecentDocument(next.vault.root)
  watch(next.vault.root)
  win?.setTitle(`${path.basename(next.vault.root)} - Synapse`)
  win?.setRepresentedFilename(next.vault.root)
  pushSnapshot()
  return snapshot(store, current)
}

function requireVault() {
  if (!current) throw new VaultError('ENOVAULT', 'No vault is open')
  return current
}

// ---------- IPC ----------
// Every handler validates its arguments; the renderer has no Node access.
type Handler = (...args: unknown[]) => unknown
const handlers: Record<string, Handler> = {
  'state:get': () => snapshot(store, current),
  'settings:global': async (patch) => {
    await store.updateGlobal(patch)
    pushSnapshot()
  },
  'settings:vault': async (patch) => {
    await requireVault().store.update(patch)
    pushSnapshot()
  },
  'vault:open': (p) => activate(String(p)),
  'vault:openId': (id) => {
    const v = store.getRegistry().vaults[String(id)]
    if (!v) throw new VaultError('ENOENT', 'Unknown vault')
    return activate(v.path)
  },
  'vault:create': (parent, name) => {
    if (typeof parent !== 'string' || typeof name !== 'string' || !/^[^/\\:\0]{1,120}$/.test(name.trim()) || name.trim().startsWith('.'))
      throw new VaultError('EINVAL', 'Invalid vault name')
    return activate(path.join(parent, name.trim()), true)
  },
  'vault:remove': async (id) => {
    if (current?.id === id) throw new VaultError('EBUSY', 'Cannot remove the open vault')
    await store.removeVault(String(id))
    pushSnapshot()
  },
  'vault:close': async () => {
    current = null
    watcher?.close()
    watcher = null
    await store.clearLastOpen()
    win?.setTitle('Synapse')
    pushSnapshot()
  },
  'vault:locate': async (id) => {
    // Relink a moved/renamed vault: user picks its new folder; keep the same id.
    const r = await dialog.showOpenDialog(win!, { title: 'Locate vault folder', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const reg = store.getRegistry()
    if (!reg.vaults[String(id)]) throw new VaultError('ENOENT', 'Unknown vault')
    await store.touchVault(r.filePaths[0], String(id))
    return activate(r.filePaths[0])
  },
  'dialog:folder': async (title) => {
    const r = await dialog.showOpenDialog(win!, { title: String(title ?? 'Choose folder'), properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0] ?? null
  },
  'fs:list': () => requireVault().vault.list(),
  'fs:read': (p) => requireVault().vault.read(p),
  'fs:readAll': () => requireVault().vault.readAllMarkdown(),
  'fs:write': (p, content, mtime) => requireVault().vault.write(p, content, mtime),
  'fs:create': (p, content) => requireVault().vault.create(p, content),
  'fs:createBinary': (p, data) => requireVault().vault.createBinary(p, data),
  'fs:mkdir': (p) => requireVault().vault.mkdir(p),
  'fs:rename': (a, b) => requireVault().vault.rename(a, b),
  'fs:trash': (p) => requireVault().vault.remove(p),
  'fs:exists': (p) => requireVault().vault.exists(p),
  'fs:reveal': (p) => shell.showItemInFolder(requireVault().vault.resolve(p, { allowRoot: true })),
  'workspace:load': () => requireVault().store.readWorkspace(),
  'workspace:save': (ws) => requireVault().store.saveWorkspace(ws),
  'shell:openExternal': (url) => {
    const u = new URL(String(url))
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) throw new VaultError('EINVAL', 'Unsupported link')
    return shell.openExternal(u.toString())
  },
}

function trustedSender(e: IpcMainInvokeEvent) {
  return win !== null && e.sender === win.webContents
}

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!trustedSender(e)) return { error: { code: 'EPERM', message: 'Untrusted sender' } }
    try {
      return { ok: await fn(...args) }
    } catch (err) {
      return { error: toIpcError(err) }
    }
  })
}

// ---------- window ----------
function createWindow() {
  const ws = store.getWindowState()
  win = new BrowserWindow({
    width: ws?.width ?? 1200,
    height: ws?.height ?? 800,
    x: ws?.x,
    y: ws?.y,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: current ? `${path.basename(current.vault.root)} - Synapse` : 'Synapse',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  })
  if (ws?.isMaximized) win.maximize()
  win.once('ready-to-show', () => win?.show())

  // Never navigate the app window away or spawn arbitrary windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    store.saveWindowState({ ...win.getNormalBounds(), isMaximized: win.isMaximized() })
  }
  win.on('resize', debounce(saveBounds, 400))
  win.on('move', debounce(saveBounds, 400))

  // Ask the renderer to save dirty notes + workspace before the window goes away.
  let flushed = false
  win.on('close', (e) => {
    if (flushed || !win) return
    e.preventDefault()
    saveBounds()
    const done = (ok: boolean) => {
      clearTimeout(timer)
      ipcMain.removeAllListeners('app:flushed')
      if (!ok) {
        const choice = dialog.showMessageBoxSync(win!, {
          type: 'warning',
          buttons: ['Cancel', 'Quit Anyway'],
          defaultId: 0,
          message: 'Some changes could not be saved.',
          detail: 'Quitting now will lose them.',
        })
        if (choice === 0) {
          quitting = false
          return
        }
      }
      flushed = true
      win?.close()
    }
    const timer = setTimeout(() => done(false), 8000)
    ipcMain.once('app:flushed', (_ev, ok) => done(ok === true))
    send('app:flush')
  })
  win.on('closed', () => {
    win = null
    watcher?.close()
    watcher = null
    current = null
  })

  const dev = process.env.SYNAPSE_DEV_URL
  if (dev) win.loadURL(dev)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

function debounce(fn: () => void, ms: number) {
  let t: NodeJS.Timeout | undefined
  return () => {
    clearTimeout(t)
    t = setTimeout(fn, ms)
  }
}

function buildMenu() {
  const cmd = (id: string) => () => send('command', id)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Synapse',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: 'Settings…', accelerator: 'Cmd+,', click: cmd('app:open-settings') },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'File',
        submenu: [
          { label: 'New Note', click: cmd('file-explorer:new-file') },
          { label: 'New Tab', click: cmd('workspace:new-tab') },
          { type: 'separator' },
          { label: 'Open Vault…', click: cmd('app:open-vault') },
          { type: 'separator' },
          { label: 'Close Tab', click: cmd('workspace:close') },
        ],
      },
      { role: 'editMenu' },
      {
        label: 'View',
        submenu: [
          { label: 'Command Palette', click: cmd('command-palette:open') },
          { label: 'Toggle Left Sidebar', click: cmd('app:toggle-left-sidebar') },
          { label: 'Toggle Right Sidebar', click: cmd('app:toggle-right-sidebar') },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' },
        ],
      },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    ]),
  )
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  store = new AppStore(app.getPath('userData'))
  protocol.handle('synapse-file', (req) => {
    try {
      const rel = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
      const abs = requireVault().vault.resolve(rel)
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  buildMenu()
  await boot()
  app.on('activate', () => {
    if (!win) boot()
  })
})

/** Reopen the last vault only if it still exists; otherwise the starter screen lists it as unavailable. */
async function boot() {
  const reg = store.getRegistry()
  const last = reg.lastOpen ? reg.vaults[reg.lastOpen] : null
  if (last && isDir(last.path)) {
    try {
      await activate(last.path)
    } catch (e) {
      console.error('could not reopen last vault', e)
    }
  }
  createWindow()
}

app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => {
  if (quitting || process.platform !== 'darwin') app.quit()
})
