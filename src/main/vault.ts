// Filesystem access confined to one vault root. All renderer-supplied paths are
// vault-relative POSIX strings and are validated here before touching the disk.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { atomicWrite } from './store'
import type { NoteHistory } from './history'

export interface FileEntry { path: string; type: 'file' | 'folder'; mtime: number; size: number }
export interface NoteData { path: string; content: string; mtime: number }

export class VaultError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

/** Hidden from the explorer and never indexed. */
const isHiddenName = (name: string) => name.startsWith('.') || name === 'node_modules'

export const MARKDOWN_EXT = /\.md$/i
/** Notes larger than this are not loaded into the link/search index. */
export const MAX_INDEXED = 10 * 1024 * 1024

export class Vault {
  readonly root: string

  /** Hash of what Synapse last wrote per file: a different disk content means an external edit. */
  private written = new Map<string, string>()

  constructor(root: string, private trash: (abs: string) => Promise<void>, private history?: NoteHistory) {
    // realpath so symlinked vault roots still pass containment checks
    this.root = fs.realpathSync(root)
  }

  /** Resolve a vault-relative path to an absolute one, refusing anything outside the vault. */
  resolve(rel: unknown, { allowRoot = false } = {}): string {
    if (typeof rel !== 'string' || rel.length > 1024 || rel.includes('\0')) throw new VaultError('EINVAL', 'Invalid path')
    let norm = path.posix.normalize(rel.replace(/\\/g, '/')).replace(/\/$/, '')
    if (norm === '.') norm = ''
    if (path.posix.isAbsolute(norm) || norm === '..' || norm.startsWith('../')) throw new VaultError('EOUTSIDE', 'Path is outside the vault')
    if (!norm && !allowRoot) throw new VaultError('EINVAL', 'Empty path')
    // Hidden files and folders (.synapse in any letter case, .git, .obsidian, …) are never listed,
    // so nothing legitimate reaches them; refusing them keeps hooks and config out of reach.
    if (norm.split('/').some((s) => s.startsWith('.'))) throw new VaultError('EOUTSIDE', 'Hidden files and folders are not accessible')
    if (!vaultExists(this.root)) throw new VaultError('ENOVAULT', 'The vault folder is no longer available')
    const abs = path.join(this.root, norm)
    // Follow symlinks of the nearest existing ancestor: it must still be inside the vault.
    let probe = abs
    while (!fs.existsSync(probe)) probe = path.dirname(probe)
    const real = fs.realpathSync(probe)
    if (real !== this.root && !real.startsWith(this.root + path.sep)) throw new VaultError('EOUTSIDE', 'Path escapes the vault via a symlink')
    return abs
  }

  rel(abs: string) {
    return path.relative(this.root, abs).split(path.sep).join('/')
  }

  /** Recursive listing. Symlinks are not traversed (avoids cycles and escapes). */
  async list(): Promise<FileEntry[]> {
    if (!vaultExists(this.root)) throw new VaultError('ENOVAULT', 'The vault folder is no longer available')
    const out: FileEntry[] = []
    const walk = async (dir: string) => {
      let ents: fs.Dirent[]
      try {
        ents = await fsp.readdir(dir, { withFileTypes: true })
      } catch (e) {
        console.warn('cannot read', dir, (e as Error).message)
        return
      }
      for (const e of ents) {
        if (isHiddenName(e.name) || e.isSymbolicLink()) continue
        const abs = path.join(dir, e.name)
        if (e.isDirectory()) {
          out.push({ path: this.rel(abs), type: 'folder', mtime: 0, size: 0 })
          await walk(abs)
        } else if (e.isFile()) {
          try {
            const st = await fsp.stat(abs)
            out.push({ path: this.rel(abs), type: 'file', mtime: st.mtimeMs, size: st.size })
          } catch { /* vanished between readdir and stat */ }
        }
      }
    }
    await walk(this.root)
    return out
  }

  async read(rel: unknown): Promise<NoteData> {
    const abs = this.resolve(rel)
    const [content, st] = await Promise.all([fsp.readFile(abs, 'utf8'), fsp.stat(abs)])
    return { path: this.rel(abs), content, mtime: st.mtimeMs }
  }

  /** Every markdown note, for the in-memory link/search index. */
  async readAllMarkdown(): Promise<NoteData[]> {
    // a huge .md (a log, a dump) would stall indexing and search; it can still be opened on its own
    const files = (await this.list()).filter((f) => f.type === 'file' && MARKDOWN_EXT.test(f.path) && f.size <= MAX_INDEXED)
    const out: NoteData[] = []
    // shortcut: loads all note text into memory; fine for tens of thousands of notes, switch to an on-disk index beyond that.
    for (let i = 0; i < files.length; i += 64) {
      const batch = await Promise.all(files.slice(i, i + 64).map((f) => this.read(f.path).catch(() => null)))
      for (const n of batch) if (n) out.push(n)
    }
    return out
  }

  /**
   * Save a note. If `expectedMtime` is given and the file changed on disk since it was
   * loaded (and differs from what we'd write), refuse with ECONFLICT instead of clobbering.
   */
  async write(rel: unknown, content: unknown, expectedMtime?: unknown, forceSnapshot = false): Promise<{ mtime: number }> {
    if (typeof content !== 'string') throw new VaultError('EINVAL', 'Invalid content')
    const abs = this.resolve(rel)
    if (typeof expectedMtime === 'number') {
      try {
        const st = await fsp.stat(abs)
        if (Math.abs(st.mtimeMs - expectedMtime) > 1) {
          const disk = await fsp.readFile(abs, 'utf8')
          if (disk !== content) throw new VaultError('ECONFLICT', 'File was modified outside Synapse')
        }
      } catch (e) {
        if (e instanceof VaultError) throw e
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw new VaultError('ENOENT', 'File was deleted outside Synapse')
        throw e
      }
    }
    // A forced write ("keep mine" after a conflict) replaces someone else's text: always keep it.
    this.snapshot(abs, content, forceSnapshot || typeof expectedMtime !== 'number')
    atomicWrite(abs, content)
    this.written.set(abs, hash(content))
    return { mtime: (await fsp.stat(abs)).mtimeMs }
  }

  /** Keep the text about to be overwritten in the version history. Never blocks the save. */
  private snapshot(abs: string, next: string, force: boolean) {
    if (!this.history) return
    try {
      const prev = fs.readFileSync(abs, 'utf8')
      if (prev === next) return
      // text Synapse did not write this session (external edit, or first save) bypasses the throttle
      this.history.record(this.rel(abs), prev, force || this.written.get(abs) !== hash(prev))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('version snapshot failed', e)
    }
  }

  versions(rel: unknown) {
    return this.history?.list(this.rel(this.resolve(rel))) ?? []
  }

  version(rel: unknown, id: unknown): string {
    if (!this.history) throw new VaultError('ENOENT', 'Version not found')
    return this.history.read(this.rel(this.resolve(rel)), id)
  }

  /** Put an earlier version back. The current text is kept as a version first; changes on disk since `expectedMtime` win. */
  async restore(rel: unknown, id: unknown, expectedMtime: unknown): Promise<NoteData> {
    if (typeof expectedMtime !== 'number') throw new VaultError('EINVAL', 'Invalid modification time')
    const content = this.version(rel, id)
    const { mtime } = await this.write(rel, content, expectedMtime, true)
    return { path: this.rel(this.resolve(rel)), content, mtime }
  }

  /** Create a new file; never overwrites. */
  async create(rel: unknown, content: unknown = ''): Promise<NoteData> {
    if (typeof content !== 'string') throw new VaultError('EINVAL', 'Invalid content')
    const abs = this.resolve(rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    try {
      await fsp.writeFile(abs, content, { flag: 'wx' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new VaultError('EEXIST', 'A file with that name already exists')
      throw e
    }
    return this.read(this.rel(abs))
  }

  async createBinary(rel: unknown, data: unknown) {
    if (!(data instanceof Uint8Array)) throw new VaultError('EINVAL', 'Invalid data')
    const abs = this.resolve(rel)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    try {
      await fsp.writeFile(abs, data, { flag: 'wx' })
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new VaultError('EEXIST', 'A file with that name already exists')
      throw e
    }
    return this.rel(abs)
  }

  async mkdir(rel: unknown) {
    const abs = this.resolve(rel)
    if (fs.existsSync(abs)) throw new VaultError('EEXIST', 'A folder with that name already exists')
    await fsp.mkdir(abs, { recursive: true })
  }

  /** Rename/move a file or folder; refuses to overwrite an existing destination. */
  async rename(from: unknown, to: unknown) {
    const a = this.resolve(from)
    const b = this.resolve(to)
    if (a === b) return
    // Case-only rename on a case-insensitive FS: existsSync(b) is true but it's the same file.
    const caseOnly = a.toLowerCase() === b.toLowerCase()
    if (!caseOnly && fs.existsSync(b)) throw new VaultError('EEXIST', 'Destination already exists')
    if (b.startsWith(a + path.sep)) throw new VaultError('EINVAL', 'Cannot move a folder into itself')
    await fsp.mkdir(path.dirname(b), { recursive: true })
    await fsp.rename(a, b)
    try {
      this.history?.move(this.rel(a), this.rel(b))
    } catch (e) {
      console.error('version history not moved', e)
    }
  }

  /** Move to the system trash (recoverable), never unlink. */
  async remove(rel: unknown) {
    const abs = this.resolve(rel)
    if (!fs.existsSync(abs)) throw new VaultError('ENOENT', 'File not found')
    await this.trash(abs)
  }

  exists(rel: unknown) {
    try {
      return fs.existsSync(this.resolve(rel))
    } catch {
      return false
    }
  }
}

/** False once the vault folder was moved or deleted: then nothing may be written (it would recreate it). */
export const vaultExists = (root: string) => {
  try {
    return fs.statSync(root).isDirectory()
  } catch {
    return false
  }
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/** Error shape that survives IPC. */
export function toIpcError(e: unknown) {
  if (e instanceof VaultError) return { code: e.code, message: e.message }
  const err = e as NodeJS.ErrnoException
  const map: Record<string, string> = {
    EACCES: 'Permission denied',
    EPERM: 'Operation not permitted',
    ENOENT: 'File or folder not found',
    ENOSPC: 'Disk is full',
    EROFS: 'Read-only file system',
  }
  return { code: err?.code ?? 'EUNKNOWN', message: map[err?.code ?? ''] ?? err?.message ?? String(e) }
}
