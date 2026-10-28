import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, session, shell, IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppStore, placeWindow } from './store'
import { openVault, OpenVault, snapshot, isDir } from './session'
import { toIpcError, VaultError } from './vault'
import { saveExport, saveVaultExport } from './export'
import { inspectFolder } from './migrate'
import { FontStore } from './fonts'
import { t, setLanguage, resolveLanguage } from '../shared/i18n'
import { RELEASES_API, updateFromRelease, UpdateInfo } from '../shared/update'
import { prepareUpdate } from './updater'

app.setName('Synapse')
// Tests point this at a temp dir; normal runs use ~/Library/Application Support/Synapse.
if (process.env.SYNAPSE_USER_DATA) app.setPath('userData', process.env.SYNAPSE_USER_DATA)

protocol.registerSchemesAsPrivileged([
  { scheme: 'synapse-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

let store: AppStore
let fonts: FontStore
let quitting = false

/** One per window: each window shows its own vault (or the starter screen). */
interface Ctx { win: BrowserWindow; current: OpenVault | null; watcher: fs.FSWatcher | null }
const windows = new Map<number, Ctx>() // by webContents id
const ctxFor = (wc: Electron.WebContents) => windows.get(wc.id)
const focusedCtx = () => {
  const w = BrowserWindow.getFocusedWindow()
  return (w && ctxFor(w.webContents)) ?? [...windows.values()][0]
}

const trash = (abs: string) => shell.trashItem(abs)

// One request per launch, only when the setting allows it. Failures (offline, rate limit) are silent.
let updateCheck: Promise<UpdateInfo | null> | null = null
function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!store.getGlobal().checkUpdates) return Promise.resolve(null)
  updateCheck ??= net
    .fetch(process.env.SYNAPSE_UPDATE_FEED || RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Synapse/${app.getVersion()}` },
      signal: AbortSignal.timeout(10_000),
    })
    .then((r) => (r.ok ? r.json() : null))
    .then((json) => updateFromRelease(json, app.getVersion(), process.arch))
    .catch(() => null)
  return updateCheck
}

function send(ctx: Ctx, channel: string, ...args: unknown[]) {
  if (!ctx.win.isDestroyed()) ctx.win.webContents.send(channel, ...args)
}

function pushSnapshot(ctx: Ctx) {
  send(ctx, 'state', snapshot(store, ctx.current))
}

function watch(ctx: Ctx, root: string) {
  ctx.watcher?.close()
  ctx.watcher = null
  let pending = new Set<string>()
  let timer: NodeJS.Timeout | null = null
  try {
    const watcher = (ctx.watcher = fs.watch(root, { recursive: true }, (_ev, file) => {
      if (!file) return
      const rel = file.toString().split(path.sep).join('/')
      if (rel.split('/').some((p) => p.startsWith('.'))) return
      pending.add(rel)
      timer ??= setTimeout(() => {
        send(ctx, 'fs:changed', [...pending])
        pending = new Set()
        timer = null
      }, 150)
    }))
    watcher.on('error', (e) => console.error('watcher', e))
  } catch (e) {
    console.error('cannot watch vault', e)
  }
}

/** The window that already shows the vault in `folder`, if any. */
function windowWithVault(folder: string, except?: Ctx): Ctx | undefined {
  let real: string
  try {
    real = fs.realpathSync(folder)
  } catch {
    return undefined // a vault being created is not open anywhere
  }
  return [...windows.values()].find((c) => c !== except && c.current && c.current.vault.root === real)
}

async function activate(ctx: Ctx, folder: string, create = false) {
  // two windows editing the same files would race each other's saves and workspace: show the other one instead
  const other = windowWithVault(folder, ctx)
  if (other) {
    other.win.show()
    other.win.focus()
    throw new VaultError('EWINDOW', 'Vault open in another window')
  }
  const next = await openVault(store, folder, trash, { create })
  ctx.current = next
  app.addRecentDocument(next.vault.root)
  watch(ctx, next.vault.root)
  ctx.win.setTitle(`${path.basename(next.vault.root)} - Synapse`)
  ctx.win.setRepresentedFilename(next.vault.root)
  pushSnapshot(ctx)
  return snapshot(store, ctx.current)
}

function requireVault(ctx: Ctx) {
  if (!ctx.current) throw new VaultError('ENOVAULT', 'No vault is open')
  return ctx.current
}

// ---------- IPC ----------
/**
 * Folders the user chose in a native dialog this session. The renderer may only open or
 * create vaults in these (or reopen registered vaults), so a compromised renderer cannot
 * turn an arbitrary path such as the home folder into a readable vault.
 */
const pickedFolders = new Set<string>()
function approvedFolder(p: unknown): string {
  if (typeof p !== 'string' || !path.isAbsolute(p)) throw new VaultError('EINVAL', 'Invalid folder')
  const abs = path.resolve(p)
  const registered = Object.values(store.getRegistry().vaults).some((v) => v.path === abs)
  if (!pickedFolders.has(abs) && !registered) throw new VaultError('EPERM', 'Choose the folder in the Open dialog')
  return abs
}

// Every handler validates its arguments; the renderer has no Node access.
type Handler = (ctx: Ctx, ...args: unknown[]) => unknown
const handlers: Record<string, Handler> = {
  'state:get': (ctx) => snapshot(store, ctx.current),
  'settings:global': async (_ctx, patch) => {
    await store.updateGlobal(patch)
    applyLanguage()
    for (const c of windows.values()) pushSnapshot(c) // global prefs apply to every window
  },
  'settings:vault': async (ctx, patch) => {
    await requireVault(ctx).store.update(patch)
    pushSnapshot(ctx)
  },
  'vault:open': (ctx, p) => activate(ctx, approvedFolder(p)),
  'vault:openId': (ctx, id) => {
    const v = store.getRegistry().vaults[String(id)]
    if (!v) throw new VaultError('ENOENT', 'Unknown vault')
    return activate(ctx, v.path)
  },
  'vault:create': (ctx, parent, name) => {
    if (typeof parent !== 'string' || typeof name !== 'string' || !/^[^/\\:\0]{1,120}$/.test(name.trim()) || name.trim().startsWith('.'))
      throw new VaultError('EINVAL', 'Invalid vault name')
    return activate(ctx, path.join(approvedFolder(parent), name.trim()), true)
  },
  'vault:remove': async (ctx, id) => {
    if ([...windows.values()].some((c) => c.current?.id === id)) throw new VaultError('EBUSY', 'Cannot remove the open vault')
    await store.removeVault(String(id))
    pushSnapshot(ctx)
  },
  'vault:close': async (ctx) => {
    ctx.current = null
    ctx.watcher?.close()
    ctx.watcher = null
    await store.clearLastOpen()
    ctx.win.setTitle('Synapse')
    pushSnapshot(ctx)
  },
  'vault:locate': async (ctx, id) => {
    // Relink a moved/renamed vault: user picks its new folder; keep the same id.
    const r = await dialog.showOpenDialog(ctx.win, { title: t('main.locate'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const reg = store.getRegistry()
    if (!reg.vaults[String(id)]) throw new VaultError('ENOENT', 'Unknown vault')
    await store.touchVault(r.filePaths[0], String(id))
    return activate(ctx, r.filePaths[0])
  },
  'dialog:folder': async (ctx, title) => {
    const r = await dialog.showOpenDialog(ctx.win, { title: String(title ?? t('main.chooseFolder')), properties: ['openDirectory', 'createDirectory'] })
    const picked = r.canceled ? null : r.filePaths[0] ?? null
    if (picked) pickedFolders.add(path.resolve(picked))
    return picked
  },
  'fs:list': (ctx) => requireVault(ctx).vault.list(),
  'fs:read': (ctx, p) => requireVault(ctx).vault.read(p),
  'fs:readAll': (ctx) => requireVault(ctx).vault.readAllMarkdown(),
  'fs:write': (ctx, p, content, mtime) => requireVault(ctx).vault.write(p, content, mtime),
  'fs:create': (ctx, p, content) => requireVault(ctx).vault.create(p, content),
  'fs:createBinary': (ctx, p, data) => requireVault(ctx).vault.createBinary(p, data),
  'fs:mkdir': (ctx, p) => requireVault(ctx).vault.mkdir(p),
  'fs:rename': (ctx, a, b) => requireVault(ctx).vault.rename(a, b),
  'fs:trash': (ctx, p) => requireVault(ctx).vault.remove(p),
  'fs:exists': (ctx, p) => requireVault(ctx).vault.exists(p),
  'fs:reveal': (ctx, p) => shell.showItemInFolder(requireVault(ctx).vault.resolve(p, { allowRoot: true })),
  // PDFs only: opening arbitrary vault files with their default app could launch executables
  'fs:openFile': async (ctx, p) => {
    // the real target must be a regular .pdf file: a symlink named x.pdf could point at an app
    const abs = fs.realpathSync(requireVault(ctx).vault.resolve(p))
    if (!/\.pdf$/i.test(abs) || !fs.statSync(abs).isFile()) throw new VaultError('EINVAL', 'Only PDF files can be opened')
    const err = await shell.openPath(abs)
    if (err) throw new VaultError('EUNKNOWN', err)
  },
  'vault:inspect': (_ctx, folder) => inspectFolder(approvedFolder(folder)),
  'export:save': (ctx, kind, title, body, dark) => saveExport(ctx.win, requireVault(ctx), kind, title, body, dark),
  'export:vault': (ctx, name, pages, dark) => saveVaultExport(ctx.win, requireVault(ctx), name, pages, dark),
  'fonts:list': () => fonts.list(),
  'fonts:data': (_ctx, id) => fonts.data(id),
  'fonts:add': async (ctx) => {
    const r = await dialog.showOpenDialog(ctx.win, {
      title: t('fonts.dialog'),
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Fonts', extensions: ['ttf', 'otf', 'woff', 'woff2'] }],
    })
    return r.canceled ? { added: [], rejected: [] } : fonts.add(r.filePaths)
  },
  'fonts:remove': (_ctx, id) => fonts.remove(id),
  'history:list': (ctx, p) => requireVault(ctx).vault.versions(p),
  'history:read': (ctx, p, id) => requireVault(ctx).vault.version(p, id),
  'history:restore': (ctx, p, id, mtime) => requireVault(ctx).vault.restore(p, id, mtime),
  'workspace:load': (ctx) => requireVault(ctx).store.readWorkspace(),
  'workspace:save': (ctx, ws) => requireVault(ctx).store.saveWorkspace(ws),
  'update:check': () => checkForUpdate(),
  // A new window, empty or with a registered vault; a vault already open elsewhere brings that window forward.
  'window:new': async (_ctx, id) => {
    const v = id === undefined ? null : store.getRegistry().vaults[String(id)]
    if (id !== undefined && !v) throw new VaultError('ENOENT', 'Unknown vault')
    const other = v && windowWithVault(v.path)
    if (other) return other.win.focus()
    const ctx = createWindow(null, v ? String(id) : undefined)
    if (v) await activate(ctx, v.path).catch((e) => console.error('could not open vault in new window', e))
  },
  // Uses the release found at launch, never a URL from the renderer.
  'update:install': async () => {
    const info = await checkForUpdate()
    if (!info || !app.isPackaged) throw new VaultError('EINVAL', t('update.none'))
    const swap = await prepareUpdate(info, path.resolve(process.execPath, '../../..'), app.getVersion(), (u) => net.fetch(u))
    swap()
    app.quit()
  },
  'shell:openExternal': (_ctx, url) => {
    const u = new URL(String(url))
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) throw new VaultError('EINVAL', 'Unsupported link')
    return shell.openExternal(u.toString())
  },
}

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (e: IpcMainInvokeEvent, ...args) => {
    // only the app's own windows may call in, and each acts on its own vault
    const ctx = ctxFor(e.sender)
    if (!ctx) return { error: { code: 'EPERM', message: 'Untrusted sender' } }
    try {
      return { ok: await fn(ctx, ...args) }
    } catch (err) {
      return { error: toIpcError(err) }
    }
  })
}

// ---------- window ----------
/** `vaultId`: the vault the window is for, so it comes back where that vault's window was. */
function createWindow(current: OpenVault | null = null, vaultId = current?.id): Ctx {
  const taken = [...windows.values()].map((c) => c.win.getNormalBounds())
  const place = placeWindow(store.getWindowState(vaultId), screen.getAllDisplays().map((d) => d.workArea), taken)
  const win = new BrowserWindow({
    width: place.width,
    height: place.height,
    x: place.x,
    y: place.y,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: current ? `${path.basename(current.vault.root)} - Synapse` : 'Synapse',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 13 },
    backgroundColor: '#0e1012',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
      plugins: true, // Chromium's PDF viewer, for PDF tabs
    },
  })
  const ctx: Ctx = { win, current, watcher: null }
  windows.set(win.webContents.id, ctx)
  if (current) {
    watch(ctx, current.vault.root)
    win.setRepresentedFilename(current.vault.root)
  }
  if (place.isMaximized) win.maximize()
  win.once('ready-to-show', () => win.show())
  // the title names the vault ("Vault - Synapse"): the page's own <title> must not replace it
  win.on('page-title-updated', (e) => e.preventDefault())

  // Never navigate the app window away or spawn arbitrary windows.
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  // Frames (the PDF tab) stay on vault files and the built-in viewer; a link inside a PDF opens in the browser.
  // The CSP lets web URLs reach this point on purpose: blocked there, a clicked link would only blank the tab.
  win.webContents.on('will-frame-navigate', (e) => {
    if (e.isMainFrame || /^(synapse-file|chrome-extension):/.test(e.url) || e.url === 'about:blank') return
    e.preventDefault()
    if (/^https?:/.test(e.url)) shell.openExternal(e.url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const saveBounds = () => {
    if (win.isDestroyed() || win.isMinimized() || win.isFullScreen()) return
    store.saveWindowState({ ...win.getNormalBounds(), isMaximized: win.isMaximized() }, ctx.current?.id)
  }
  win.on('resize', debounce(saveBounds, 400))
  win.on('move', debounce(saveBounds, 400))

  // Ask the renderer to save dirty notes + workspace before the window goes away.
  let flushed = false
  win.on('close', (e) => {
    if (flushed) return
    e.preventDefault()
    saveBounds()
    const done = (ok: boolean) => {
      clearTimeout(timer)
      ipcMain.removeListener('app:flushed', onFlushed)
      if (!ok) {
        const choice = dialog.showMessageBoxSync(win, {
          type: 'warning',
          buttons: [t('common.cancel'), t('main.quitAnyway')],
          defaultId: 0,
          message: t('main.unsavedTitle'),
          detail: t('main.unsavedDetail'),
        })
        if (choice === 0) {
          quitting = false
          return
        }
      }
      flushed = true
      win.close()
    }
    const timer = setTimeout(() => done(false), 8000)
    // every window answers on the same channel: listen for this one only
    const onFlushed = (ev: Electron.IpcMainEvent, ok: unknown) => ev.sender === win.webContents && done(ok === true)
    ipcMain.on('app:flushed', onFlushed)
    send(ctx, 'app:flush')
  })
  const id = win.webContents.id
  win.on('closed', () => {
    ctx.watcher?.close()
    windows.delete(id)
  })

  // The dev server URL is honoured only in unpackaged development builds, and only on localhost:
  // the window gets the filesystem bridge, so it must never load anything else.
  const dev = !app.isPackaged ? process.env.SYNAPSE_DEV_URL : undefined
  if (dev && /^http:\/\/localhost:\d+\/?$/.test(dev)) win.loadURL(dev)
  else win.loadFile(path.join(__dirname, '../renderer/index.html'))
  return ctx
}

function debounce(fn: () => void, ms: number) {
  let t: NodeJS.Timeout | undefined
  return () => {
    clearTimeout(t)
    t = setTimeout(fn, ms)
  }
}

/** Resolve the global language setting and rebuild the native menu in that language. */
function applyLanguage() {
  setLanguage(resolveLanguage(store.getGlobal().language, app.getPreferredSystemLanguages()))
  buildMenu()
}

function buildMenu() {
  const cmd = (id: string) => () => {
    const c = focusedCtx()
    if (c) send(c, 'command', id)
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'Synapse',
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { label: t('menu.settings'), accelerator: 'Cmd+,', click: cmd('app:open-settings') },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: t('menu.file'),
        submenu: [
          { label: t('menu.newNote'), click: cmd('file-explorer:new-file') },
          { label: t('menu.newFromTemplate'), click: cmd('templates:new-note') },
          { label: t('menu.dailyNote'), click: cmd('daily-notes:open-today') },
          { label: t('menu.newTab'), click: cmd('workspace:new-tab') },
          { label: t('menu.newWindow'), accelerator: 'Cmd+Shift+N', click: () => createWindow() },
          { type: 'separator' },
          { label: t('menu.openVault'), click: cmd('app:open-vault') },
          { label: t('menu.closeVault'), click: cmd('app:close-vault') },
          { type: 'separator' },
          { label: t('menu.closeTab'), click: cmd('workspace:close') },
        ],
      },
      { role: 'editMenu' },
      {
        label: t('menu.view'),
        submenu: [
          { label: t('menu.palette'), click: cmd('command-palette:open') },
          { label: t('menu.toggleLeft'), click: cmd('app:toggle-left-sidebar') },
          { label: t('menu.toggleRight'), click: cmd('app:toggle-right-sidebar') },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { role: 'toggleDevTools' },
        ],
      },
      { label: t('menu.window'), submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }] },
    ]),
  )
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', () => {
  const c = focusedCtx()
  if (c) {
    if (c.win.isMinimized()) c.win.restore()
    c.win.focus()
  }
})

app.whenReady().then(async () => {
  store = new AppStore(app.getPath('userData'))
  fonts = new FontStore(path.join(app.getPath('userData'), 'fonts'))
  // Deny web permission requests (notifications, geolocation, media, ...); the app needs none
  // except writing to the clipboard for "Copy path".
  const allowed = new Set(['clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowed.has(permission)))
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  // second guard behind will-frame-navigate: no web page ever loads in a frame of the app
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (d, cb) => cb({ cancel: d.resourceType === 'subFrame' }))
  // synapse-file://<vault id>/<path>: the id says which window's vault a file comes from
  protocol.handle('synapse-file', (req) => {
    try {
      const u = new URL(req.url)
      const open = [...windows.values()].find((c) => c.current?.id === u.hostname)?.current
      if (!open) throw new Error('no such vault')
      const rel = decodeURIComponent(u.pathname.replace(/^\//, ''))
      const abs = open.vault.resolve(rel)
      return net.fetch(pathToFileURL(abs).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
  applyLanguage()
  await boot()
  app.on('activate', () => {
    if (!windows.size) boot()
  })
})

/** Reopen the last vault only if it still exists; otherwise the starter screen lists it as unavailable. */
async function boot() {
  const reg = store.getRegistry()
  const last = reg.lastOpen ? reg.vaults[reg.lastOpen] : null
  let current: OpenVault | null = null
  if (last && isDir(last.path)) {
    try {
      current = await openVault(store, last.path, trash)
      app.addRecentDocument(current.vault.root)
    } catch (e) {
      console.error('could not reopen last vault', e)
    }
  }
  createWindow(current)
}

app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => {
  if (quitting || process.platform !== 'darwin') app.quit()
})
