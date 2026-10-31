import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, net, protocol, screen, session, shell, Tray, IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { AppStore, placeWindow } from './store'
import { openVault, OpenVault, snapshot, isDir } from './session'
import { toIpcError, VaultError, MARKDOWN_EXT } from './vault'
import { saveExport, saveVaultExport } from './export'
import { inspectFolder } from './migrate'
import { FontStore } from './fonts'
import { t, setLanguage, resolveLanguage } from '../shared/i18n'
import { RELEASES_API, updateFromRelease, UpdateInfo } from '../shared/update'
import { prepareUpdate } from './updater'
import { parseSynapseUrl, findVault, notePath, newNote, capture, toAccelerator, trayMenu, trayBitmap } from './integration'
import { isObj, resolvePrefs } from '../shared/settings'

app.setName('Synapse')
// Tests point this at a temp dir; normal runs use ~/Library/Application Support/Synapse.
if (process.env.SYNAPSE_USER_DATA) app.setPath('userData', process.env.SYNAPSE_USER_DATA)
// Tests set this: windows are never shown and the app never takes focus or a Dock icon, so a run does not interrupt work on this Mac.
const hidden = !!process.env.SYNAPSE_HIDDEN

protocol.registerSchemesAsPrivileged([
  { scheme: 'synapse-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

let store: AppStore
let fonts: FontStore
let quitting = false

/**
 * One per window: each window shows its own vault (or the starter screen). `pendingFile`: a note
 * opened from Finder, handed to the renderer once its vault has loaded.
 */
interface Ctx { win: BrowserWindow; current: OpenVault | null; watcher: fs.FSWatcher | null; pendingFile?: string }
const windows = new Map<number, Ctx>() // by webContents id
const ctxFor = (wc: Electron.WebContents) => windows.get(wc.id)
const focusedCtx = () => {
  const w = BrowserWindow.getFocusedWindow()
  return (w && ctxFor(w.webContents)) ?? [...windows.values()][0]
}

const trash = (abs: string) => shell.trashItem(abs)

// At most one request a day, shared by every window, only when the setting allows it. Failures (offline,
// rate limit) are silent and forgotten, so the next ask tries again.
let updateCheck: { at: number; result: Promise<UpdateInfo | null> } | null = null
function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!store.getGlobal().checkUpdates) return Promise.resolve(null)
  if (!updateCheck || Date.now() - updateCheck.at > 24 * 60 * 60_000) {
    const result = net
      .fetch(process.env.SYNAPSE_UPDATE_FEED || RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Synapse/${app.getVersion()}` },
        signal: AbortSignal.timeout(10_000),
      })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((json) => updateFromRelease(json, app.getVersion(), process.arch))
    const entry = (updateCheck = { at: Date.now(), result })
    result.catch(() => {
      if (updateCheck === entry) updateCheck = null
    })
  }
  return updateCheck.result.catch(() => null)
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
        // a save's temp file (atomicWrite: <file>.<pid>.<ms>.tmp) is gone again by now; one left by a crash still exists and is reported
        const paths = [...pending].filter((p) => !/\.\d+\.\d+\.tmp$/.test(p) || fs.existsSync(path.join(root, p)))
        if (paths.length) send(ctx, 'fs:changed', paths)
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
    if (!hidden) other.win.show()
    if (!hidden) other.win.focus()
    throw new VaultError('EWINDOW', 'Vault open in another window')
  }
  const next = await openVault(store, folder, trash, { create })
  ctx.current = next
  rememberOpenVaults()
  app.addRecentDocument(next.vault.root)
  watch(ctx, next.vault.root)
  ctx.win.setTitle(`${path.basename(next.vault.root)} - Synapse`)
  ctx.win.setRepresentedFilename(next.vault.root)
  pushSnapshot(ctx)
  return snapshot(store, ctx.current)
}

/** Saved so the next launch reopens every vault that had a window. Not while quitting: closing the windows would empty it. */
function rememberOpenVaults() {
  if (quitting) return
  store.setOpenVaults([...windows.values()].flatMap((c) => (c.current ? [c.current.id] : []))).catch((e) => console.error('open vaults not saved', e))
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
    registerCapture()
    updateTray()
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
    rememberOpenVaults()
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
  'file:takePending': (ctx) => {
    const p = ctx.pendingFile ?? null
    ctx.pendingFile = undefined
    return p
  },
  'workspace:load': (ctx) => requireVault(ctx).store.readWorkspace(),
  'workspace:save': (ctx, ws) => requireVault(ctx).store.saveWorkspace(ws),
  'update:check': () => checkForUpdate(),
  // A new window, empty or with a registered vault; a vault already open elsewhere brings that window forward.
  'window:new': async (_ctx, id) => {
    const v = id === undefined ? null : store.getRegistry().vaults[String(id)]
    if (id !== undefined && !v) throw new VaultError('ENOENT', 'Unknown vault')
    const other = v && windowWithVault(v.path)
    if (other) return hidden || other.win.focus()
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
  if (place.isMaximized && !hidden) win.maximize()
  win.once('ready-to-show', () => hidden || win.show())
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
  win.on('focus', () => (lastFocused = ctx))
  win.on('closed', () => {
    ctx.watcher?.close()
    windows.delete(id)
    if (lastFocused === ctx) lastFocused = null
    rememberOpenVaults()
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

// ---------- notes and links opened from outside ----------
// Finder (double click, Open With, drop on the Dock icon) sends open-file; a launch from the command line
// passes paths; synapse:// links (Mail, Calendar, Shortcuts, Raycast, a browser) send open-url.
const beforeBoot: (() => void)[] = []
let booted = false
let opening: Promise<unknown> = Promise.resolve()
/** One at a time: two notes of the same vault must not each open a window for it. */
const serially = (fn: () => Promise<unknown>) => {
  opening = opening.then(fn).catch((e) => console.error(e))
}
const openNote = (file: string) => serially(() => openNoteFile(file))
const openLink = (url: string) => serially(() => handleUrl(url))
const noteArgs = (argv: string[], cwd: string) => argv.slice(1).filter((a) => !a.startsWith('-') && MARKDOWN_EXT.test(a)).map((a) => path.resolve(cwd, a))

app.on('open-file', (e, file) => {
  e.preventDefault()
  if (booted) openNote(file)
  else beforeBoot.push(() => openNote(file))
})
app.on('open-url', (e, url) => {
  e.preventDefault()
  if (booted) openLink(url)
  else beforeBoot.push(() => openLink(url))
})

/** The window showing the vault at `folder`, else that vault opened in an empty or a new window; brought forward. */
async function vaultWindow(folder: string): Promise<Ctx> {
  let ctx = windowWithVault(folder)
  if (!ctx) {
    ctx = [...windows.values()].find((c) => !c.current) ?? createWindow()
    await activate(ctx, folder)
  }
  if (!hidden) {
    if (ctx.win.isMinimized()) ctx.win.restore()
    ctx.win.show()
    ctx.win.focus()
  }
  return ctx
}

/** Open a vault-relative path in the window; main keeps it until the renderer's vault has loaded. */
function reveal(ctx: Ctx, rel: string) {
  ctx.pendingFile = rel
  send(ctx, 'open-file')
}

/** Where links without a vault, quick capture and the menu bar's New note go: the vault used last. */
let lastFocused: Ctx | null = null
function targetVaultPath(): string | null {
  const c = lastFocused?.current ? lastFocused : [...windows.values()].find((x) => x.current)
  if (c?.current) return c.current.vault.root
  const reg = store.getRegistry()
  const v = reg.lastOpen ? reg.vaults[reg.lastOpen] : null
  return v && isDir(v.path) ? v.path : null
}

/** synapse://open, synapse://new and synapse://capture (see integration.ts). */
async function handleUrl(raw: string) {
  const u = parseSynapseUrl(raw)
  if (!u) return
  if (u.action === 'capture') return showCapture()
  const folder = u.vault ? findVault(store.getRegistry().vaults, u.vault) : targetVaultPath()
  if (!folder || !isDir(folder)) return dialog.showErrorBox(t('main.urlNoVault', { name: u.vault ?? '' }), raw)
  try {
    const ctx = await vaultWindow(folder)
    if (u.action === 'open') {
      if (u.file) reveal(ctx, notePath(u.file))
    } else reveal(ctx, await newNote(ctx.current!.vault, u.name ?? t('file.untitled'), u.text))
  } catch (e) {
    console.error('synapse link failed', e)
    dialog.showErrorBox(t('main.urlFailed'), toIpcError(e).message)
  }
}

// ---------- quick capture ----------
let captureWin: BrowserWindow | null = null
let captureKey = ''

/** The small capture window (same renderer bundle, #capture), created once and then only shown and hidden. */
function showCapture() {
  if (!captureWin || captureWin.isDestroyed()) {
    const win = (captureWin = new BrowserWindow({
      width: 560,
      height: 150,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      // a panel takes the keyboard without bringing the other Synapse windows forward, also over full-screen apps
      type: 'panel',
      backgroundColor: '#0e1012',
      webPreferences: { preload: path.join(__dirname, '../preload/preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: true },
    }))
    win.webContents.on('will-navigate', (e) => e.preventDefault())
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.on('blur', () => win.hide())
    const dev = !app.isPackaged ? process.env.SYNAPSE_DEV_URL : undefined
    if (dev && /^http:\/\/localhost:\d+\/?$/.test(dev)) win.loadURL(dev + '#capture')
    else win.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'capture' })
  }
  const win = captureWin
  const g = store.getGlobal()
  const prefs = resolvePrefs(g, null)
  const folder = targetVaultPath()
  const info = {
    dark: prefs.theme === 'dark' || (prefs.theme === 'system' && nativeTheme.shouldUseDarkColors),
    accent: prefs.accentColor,
    language: resolveLanguage(g.language, app.getPreferredSystemLanguages()),
    target: g.capture.target,
    vault: folder ? path.basename(folder) : null,
  }
  const tell = () => win.webContents.send('capture:show', info)
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', tell)
  else tell()
  if (!hidden) {
    win.center()
    win.show()
    win.focus()
  }
}

/** Only the capture window may call these; it has no vault of its own. */
const captureHandlers: Record<string, (...args: unknown[]) => unknown> = {
  'capture:save': async (text) => {
    const folder = targetVaultPath()
    if (!folder) throw new VaultError('ENOVAULT', t('capture.noVault'))
    // the open window's vault when there is one, so its own watcher and history see the write
    const open = windowWithVault(folder)?.current ?? (await openVault(store, folder, trash))
    const saved = await capture(open.vault, store.getGlobal().capture.target, String(text ?? ''))
    captureWin?.hide()
    return saved
  },
  'capture:hide': () => captureWin?.hide(),
}
for (const [channel, fn] of Object.entries(captureHandlers)) {
  ipcMain.handle(channel, async (e, ...args) => {
    if (!captureWin || captureWin.isDestroyed() || e.sender !== captureWin.webContents) return { error: { code: 'EPERM', message: 'Untrusted sender' } }
    try {
      return { ok: await fn(...args) }
    } catch (err) {
      return { error: toIpcError(err) }
    }
  })
}

/** (Re)register the system-wide capture hotkey from the settings. Never in tests: it would take the keys from this Mac. */
function registerCapture() {
  const hk = hidden ? '' : store.getGlobal().capture.hotkey
  if (hk === captureKey) return
  if (captureKey) globalShortcut.unregister(toAccelerator(captureKey))
  captureKey = ''
  if (!hk) return
  try {
    if (globalShortcut.register(toAccelerator(hk), showCapture)) captureKey = hk
    else console.warn('quick capture hotkey is taken by another app', hk)
  } catch (e) {
    console.warn('invalid quick capture hotkey', hk, e)
  }
}

// ---------- menu bar icon ----------
let tray: Tray | null = null

/** Show or remove the menu bar icon to match the setting. Never in tests: it would appear in this Mac's menu bar. */
function updateTray() {
  if (!store.getGlobal().menuBarIcon || hidden) {
    tray?.destroy()
    tray = null
    return
  }
  if (tray) return
  const icon = nativeImage.createFromBitmap(trayBitmap(36), { width: 36, height: 36, scaleFactor: 2 })
  icon.setTemplateImage(true)
  tray = new Tray(icon)
  tray.setToolTip('Synapse')
  // built on each click, so the recent notes are current
  const pop = () => tray?.popUpContextMenu(Menu.buildFromTemplate(trayItems()))
  tray.on('click', pop)
  tray.on('right-click', pop)
}

function trayItems() {
  const recentOf = (o: OpenVault) => {
    const ws = o.store.readWorkspace()
    return isObj(ws) && Array.isArray(ws.recent) ? ws.recent.filter((p): p is string => typeof p === 'string') : []
  }
  const vaults = [...windows.values()].flatMap((c) => {
    const o = c.current
    return o ? [{ name: path.basename(o.vault.root), recent: recentOf(o), open: (p: string) => serially(async () => reveal(await vaultWindow(o.vault.root), p)) }] : []
  })
  const newNoteHere = () =>
    serially(async () => {
      const folder = targetVaultPath()
      if (!folder) return
      const ctx = await vaultWindow(folder)
      reveal(ctx, await newNote(ctx.current!.vault, t('file.untitled'), ''))
    })
  const hk = store.getGlobal().capture.hotkey
  return trayMenu(
    vaults,
    { newNote: t('tray.newNote'), capture: t('tray.capture'), noRecent: t('tray.noRecent') },
    { newNote: targetVaultPath() ? newNoteHere : undefined, capture: showCapture, captureAccel: hk ? toAccelerator(hk) : undefined },
  )
}

/** Show the note in the window of the vault holding it; a note outside every vault offers to open its folder as one. */
async function openNoteFile(file: string) {
  let abs: string
  try {
    abs = fs.realpathSync(file)
    if (!MARKDOWN_EXT.test(abs) || !fs.statSync(abs).isFile()) return
  } catch {
    return
  }
  try {
    const real = (p: string) => {
      try {
        return fs.realpathSync(p)
      } catch {
        return null
      }
    }
    // the innermost registered vault, for a vault inside another one
    let folder = Object.values(store.getRegistry().vaults)
      .map((v) => ({ path: v.path, root: real(v.path) }))
      .filter((v) => v.root && abs.startsWith(v.root + path.sep))
      .sort((a, b) => b.root!.length - a.root!.length)[0]?.path
    if (!folder) {
      const dir = path.dirname(abs)
      const r = await dialog.showMessageBox({
        type: 'question',
        buttons: [t('main.openFolder'), t('common.cancel')],
        defaultId: 0,
        cancelId: 1,
        message: t('main.openFileTitle', { name: path.basename(abs) }),
        detail: t('main.openFileDetail', { folder: dir }),
      })
      if (r.response !== 0) return
      folder = dir
    }
    reveal(await vaultWindow(folder), path.relative(real(folder)!, abs).split(path.sep).join('/'))
  } catch (e) {
    console.error('could not open note', e)
    dialog.showErrorBox(t('main.openFileFailed', { name: path.basename(abs) }), toIpcError(e).message)
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
app.on('second-instance', (_e, argv, cwd) => {
  const files = noteArgs(argv, cwd)
  if (files.length) return files.forEach(openNote)
  const c = focusedCtx()
  if (c) {
    if (c.win.isMinimized()) c.win.restore()
    c.win.focus()
  }
})

app.whenReady().then(async () => {
  if (hidden) app.setActivationPolicy('accessory')
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
  booted = true
  for (const run of beforeBoot) run()
  for (const f of noteArgs(process.argv, process.cwd())) openNote(f)
  // in development the default handler would be the bare Electron binary; the packaged app is registered by its Info.plist
  if (app.isPackaged && !hidden) app.setAsDefaultProtocolClient('synapse')
  registerCapture()
  updateTray()
  app.on('activate', () => {
    if (!windows.size) boot()
  })
})

/**
 * Reopen every vault that had a window at quit (else the last one), each in its own window, if the
 * folder still exists; with none, the starter screen lists them (a missing one as unavailable).
 */
async function boot() {
  const reg = store.getRegistry()
  const ids = reg.open.length ? reg.open : reg.lastOpen ? [reg.lastOpen] : []
  // the last used vault opens last, so its window ends up in front and stays the last used
  ids.sort((a, b) => Number(a === reg.lastOpen) - Number(b === reg.lastOpen))
  let opened = 0
  for (const id of ids) {
    const v = reg.vaults[id]
    if (!isDir(v.path)) continue
    try {
      const current = await openVault(store, v.path, trash)
      app.addRecentDocument(current.vault.root)
      createWindow(current)
      opened++
    } catch (e) {
      console.error('could not reopen vault', e)
    }
  }
  if (!opened) createWindow(null)
}

app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('before-quit', () => {
  quitting = true
})
app.on('window-all-closed', () => {
  if (quitting || process.platform !== 'darwin') app.quit()
})
