// Filesystem access confined to one vault root. All renderer-supplied paths are
// vault-relative POSIX strings and are validated here before touching the disk.
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { atomicWrite, VAULT_CONFIG_DIR } from './store'

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

export class Vault {
  readonly root: string

  constructor(root: string, private trash: (abs: string) => Promise<void>) {
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
    if (norm.split('/')[0] === VAULT_CONFIG_DIR) throw new VaultError('EOUTSIDE', 'Configuration folder is not editable')
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
    const files = (await this.list()).filter((f) => f.type === 'file' && MARKDOWN_EXT.test(f.path))
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
  async write(rel: unknown, content: unknown, expectedMtime?: unknown): Promise<{ mtime: number }> {
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
    atomicWrite(abs, content)
    return { mtime: (await fsp.stat(abs)).mtimeMs }
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
