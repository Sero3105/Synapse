// Persistence for global settings, the vault registry, window state and per-vault settings.
// Pure Node (no electron import) so it is unit-testable with temp directories.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  GlobalSettings, VaultSettings, normalizeGlobal, normalizeVault, applyGlobalPatch, applyVaultPatch,
  defaultGlobal, isObj, GLOBAL_SCHEMA_VERSION, VAULT_SCHEMA_VERSION, VAULT_ID,
} from '../shared/settings'

export const VAULT_CONFIG_DIR = '.synapse'

export const newId = () => crypto.randomBytes(8).toString('hex')

/** Write via temp file + fsync + rename so a crash never leaves a half-written file. */
export function atomicWrite(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  let old: fs.Stats | undefined
  try {
    old = fs.statSync(file)
  } catch { /* new file */ }
  const fd = fs.openSync(tmp, 'w')
  try {
    if (old) fs.fchmodSync(fd, old.mode & 0o7777) // keep the permissions of the file being replaced
    fs.writeSync(fd, data)
    fs.fsyncSync(fd)
    if (old) {
      // keep the creation date: on APFS an mtime older than the birthtime moves the birthtime back with it
      const now = new Date()
      fs.futimesSync(fd, now, old.birthtime)
      fs.futimesSync(fd, now, now)
    }
  } finally {
    fs.closeSync(fd)
  }
  try {
    fs.renameSync(tmp, file)
  } catch (e) {
    fs.rmSync(tmp, { force: true })
    throw e
  }
}

type ReadResult = { data: unknown; status: 'ok' | 'missing' | 'corrupt' }

/** Read JSON. A corrupt file is preserved as `<file>.corrupt-<ts>` before defaults are used. */
export function readJson(file: string): ReadResult {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { data: undefined, status: 'missing' }
    throw e
  }
  try {
    return { data: JSON.parse(text), status: 'ok' }
  } catch {
    try {
      fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`)
    } catch { /* backup is best effort; defaults still apply */ }
    return { data: undefined, status: 'corrupt' }
  }
}

/** Back up a settings file before a schema migration rewrites it. */
function backupBeforeMigration(file: string, raw: unknown, current: number) {
  const v = isObj(raw) && typeof raw.version === 'number' ? raw.version : 1
  if (v < current) {
    try {
      fs.copyFileSync(file, `${file}.v${v}.bak`)
    } catch { /* ignore */ }
  }
}

export interface VaultEntry { path: string; ts: number }
export interface Registry { vaults: Record<string, VaultEntry>; lastOpen: string | null }
export interface WindowState { x?: number; y?: number; width: number; height: number; isMaximized: boolean }

/**
 * Application-level store rooted at the OS app-data directory
 * (~/Library/Application Support/Synapse). Independent of any vault path.
 */
export class AppStore {
  readonly settingsFile: string
  readonly registryFile: string
  readonly windowFile: string
  private global: GlobalSettings
  private registry: Registry
  /** Serializes writes so concurrent updates cannot interleave. */
  private queue: Promise<unknown> = Promise.resolve()

  constructor(readonly dir: string) {
    this.settingsFile = path.join(dir, 'settings.json')
    this.registryFile = path.join(dir, 'vaults.json')
    this.windowFile = path.join(dir, 'window.json')
    const s = readJson(this.settingsFile)
    if (s.status === 'ok') backupBeforeMigration(this.settingsFile, s.data, GLOBAL_SCHEMA_VERSION)
    this.global = s.status === 'ok' ? normalizeGlobal(s.data) : defaultGlobal()
    const r = readJson(this.registryFile).data
    this.registry = { vaults: {}, lastOpen: null }
    if (isObj(r) && isObj(r.vaults)) {
      for (const [id, e] of Object.entries(r.vaults)) {
        if (isObj(e) && typeof e.path === 'string' && path.isAbsolute(e.path))
          this.registry.vaults[id] = { path: e.path, ts: typeof e.ts === 'number' ? e.ts : 0 }
      }
      if (typeof r.lastOpen === 'string' && this.registry.vaults[r.lastOpen]) this.registry.lastOpen = r.lastOpen
    }
  }

  private enqueue<T>(fn: () => T): Promise<T> {
    const p = this.queue.then(fn)
    this.queue = p.catch(() => undefined)
    return p
  }

  getGlobal(): GlobalSettings {
    return structuredClone(this.global)
  }

  /** Persist first, then commit in memory: a failed write leaves the previous state intact. */
  updateGlobal(patch: unknown): Promise<GlobalSettings> {
    return this.enqueue(() => {
      const next = applyGlobalPatch(this.global, patch)
      atomicWrite(this.settingsFile, JSON.stringify(next, null, 2))
      this.global = next
      return this.getGlobal()
    })
  }

  getRegistry(): Registry {
    return structuredClone(this.registry)
  }

  private saveRegistry(next: Registry) {
    atomicWrite(this.registryFile, JSON.stringify(next, null, 2))
    this.registry = next
  }

  /** Register (or touch) a vault path, reusing `id` if given. Returns the id. */
  touchVault(vaultPath: string, id?: string): Promise<string> {
    return this.enqueue(() => {
      const next = this.getRegistry()
      let vid = id && next.vaults[id] ? id : Object.keys(next.vaults).find((k) => next.vaults[k].path === vaultPath)
      vid ??= id ?? newId()
      next.vaults[vid] = { path: vaultPath, ts: Date.now() }
      next.lastOpen = vid
      this.saveRegistry(next)
      return vid
    })
  }

  removeVault(id: string): Promise<void> {
    return this.enqueue(() => {
      const next = this.getRegistry()
      delete next.vaults[id]
      if (next.lastOpen === id) next.lastOpen = null
      this.saveRegistry(next)
    })
  }

  clearLastOpen(): Promise<void> {
    return this.enqueue(() => {
      const next = this.getRegistry()
      next.lastOpen = null
      this.saveRegistry(next)
    })
  }

  /** The vault's own window size and place, else the last window's. The file keeps the last at the top level. */
  getWindowState(vaultId?: string): WindowState | null {
    const d = readJson(this.windowFile).data
    if (!isObj(d)) return null
    return (vaultId && isObj(d.vaults) && toWindowState(d.vaults[vaultId])) || toWindowState(d)
  }

  saveWindowState(s: WindowState, vaultId?: string) {
    try {
      const d = readJson(this.windowFile).data
      const vaults: Record<string, unknown> = isObj(d) && isObj(d.vaults) ? { ...d.vaults } : {}
      if (vaultId) {
        delete vaults[vaultId] // re-added last: the oldest entries are the ones dropped
        vaults[vaultId] = s
      }
      atomicWrite(this.windowFile, JSON.stringify({ ...s, vaults: Object.fromEntries(Object.entries(vaults).slice(-50)) }))
    } catch (e) {
      console.error('window state not saved', e)
    }
  }
}

function toWindowState(d: unknown): WindowState | null {
  if (!isObj(d) || typeof d.width !== 'number' || typeof d.height !== 'number') return null
  return {
    x: typeof d.x === 'number' ? d.x : undefined,
    y: typeof d.y === 'number' ? d.y : undefined,
    width: Math.max(400, d.width),
    height: Math.max(300, d.height),
    isMaximized: d.isMaximized === true,
  }
}

type Rect = { x: number; y: number; width: number; height: number }
const CASCADE = 28

/**
 * Where a new window goes. Saved bounds are kept if their top area is on a connected display (a
 * detached monitor would leave the window unreachable); a spot already taken by another window
 * moves down-right until free, wrapping back to the display's corner.
 */
export function placeWindow(saved: WindowState | null, workAreas: Rect[], taken: Rect[], fallback = { width: 1200, height: 800 }): WindowState {
  const width = saved?.width ?? fallback.width
  const height = saved?.height ?? fallback.height
  const onScreen = (x: number, y: number) => workAreas.some((a) => x + 100 > a.x && x + 100 < a.x + a.width && y >= a.y && y + 40 < a.y + a.height)
  let x = saved?.x
  let y = saved?.y
  if (x === undefined || y === undefined || !onScreen(x, y)) {
    if (!taken.length) return { width, height, isMaximized: saved?.isMaximized ?? false } // the OS centres it
    x = taken[taken.length - 1].x
    y = taken[taken.length - 1].y
  }
  const area = workAreas.find((a) => x! >= a.x && x! < a.x + a.width && y! >= a.y && y! < a.y + a.height) ?? workAreas[0]
  for (let i = 0; i < 50 && taken.some((r) => Math.abs(r.x - x!) < CASCADE / 2 && Math.abs(r.y - y!) < CASCADE / 2); i++) {
    x += CASCADE
    y += CASCADE
    if (area && (x + Math.min(width, 400) > area.x + area.width || y + Math.min(height, 300) > area.y + area.height)) {
      x = area.x + (i % 5) * CASCADE
      y = area.y
    }
  }
  return { x, y, width, height, isMaximized: saved?.isMaximized ?? false }
}

/** Per-vault settings in <vault>/.synapse/settings.json. */
export class VaultStore {
  readonly file: string
  readonly workspaceFile: string
  private settings: VaultSettings
  private queue: Promise<unknown> = Promise.resolve()
  readonly loadStatus: 'ok' | 'missing' | 'corrupt'
  private rawVersion = 0

  constructor(readonly root: string) {
    this.file = path.join(root, VAULT_CONFIG_DIR, 'settings.json')
    this.workspaceFile = path.join(root, VAULT_CONFIG_DIR, 'workspace.json')
    const r = readJson(this.file)
    this.loadStatus = r.status
    if (r.status === 'ok') backupBeforeMigration(this.file, r.data, VAULT_SCHEMA_VERSION)
    if (isObj(r.data) && typeof r.data.version === 'number') this.rawVersion = r.data.version
    this.settings = normalizeVault(r.data, newId())
  }

  /** The vault id stamped in the file, if the vault was opened by Synapse before. */
  static peekId(root: string): string | null {
    const d = readJson(path.join(root, VAULT_CONFIG_DIR, 'settings.json')).data
    return isObj(d) && typeof d.vaultId === 'string' && VAULT_ID.test(d.vaultId) ? d.vaultId : null
  }

  get(): VaultSettings {
    return structuredClone(this.settings)
  }

  /** Write the file if missing/outdated so the vault carries its id (moved-vault detection). */
  ensureStamped(id: string): Promise<void> {
    return this.enqueue(() => {
      if (this.loadStatus === 'ok' && this.settings.vaultId === id && this.rawVersion === VAULT_SCHEMA_VERSION) return
      const next = { ...this.settings, vaultId: id }
      atomicWrite(this.file, JSON.stringify(next, null, 2))
      this.settings = next
      this.rawVersion = VAULT_SCHEMA_VERSION
    })
  }

  update(patch: unknown): Promise<VaultSettings> {
    return this.enqueue(() => {
      this.requireRoot()
      const next = applyVaultPatch(this.settings, patch)
      atomicWrite(this.file, JSON.stringify(next, null, 2))
      this.settings = next
      return this.get()
    })
  }

  readWorkspace(): unknown {
    return readJson(this.workspaceFile).data ?? null
  }

  saveWorkspace(ws: unknown): Promise<void> {
    return this.enqueue(() => {
      this.requireRoot()
      atomicWrite(this.workspaceFile, JSON.stringify(ws))
    })
  }

  /** atomicWrite creates missing folders: without this check a moved vault would be recreated empty. */
  private requireRoot() {
    if (!fs.existsSync(this.root) || !fs.statSync(this.root).isDirectory())
      throw Object.assign(new Error('The vault folder is no longer available'), { code: 'ENOVAULT' })
  }

  private enqueue<T>(fn: () => T): Promise<T> {
    const p = this.queue.then(fn)
    this.queue = p.catch(() => undefined)
    return p
  }
}
