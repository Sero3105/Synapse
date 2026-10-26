// Local version history: earlier contents of notes, kept in the app-data folder outside the vault.
// Pure Node (no electron import) so it is unit-testable with temp directories.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { atomicWrite } from './store'
import { VaultError } from './vault'

export interface Version { id: string; ts: number }

/** `<ms timestamp>-<content hash>`; also the only shape accepted from the renderer. */
const ID = /^(\d{13})-([0-9a-f]{12})$/
const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

/**
 * One folder per note (named by a hash of its vault path), holding one file per version
 * and `meta.json` with the note's current path (used to follow renames).
 */
export class NoteHistory {
  constructor(
    readonly dir: string,
    private opts = { keep: 50, interval: 10 * 60_000 },
  ) {}

  private noteDir(rel: string) {
    return path.join(this.dir, sha(rel).slice(0, 32))
  }

  /** Newest first. Leftover temp files from an interrupted write are ignored. */
  list(rel: string): Version[] {
    let names: string[]
    try {
      names = fs.readdirSync(this.noteDir(rel))
    } catch {
      return []
    }
    return names
      .filter((n) => n.endsWith('.md') && ID.test(n.slice(0, -3)))
      .map((n) => ({ id: n.slice(0, -3), ts: Number(n.slice(0, 13)) }))
      .sort((a, b) => b.ts - a.ts || (a.id < b.id ? 1 : -1))
  }

  read(rel: string, id: unknown): string {
    if (typeof id !== 'string' || !ID.test(id)) throw new VaultError('EINVAL', 'Invalid version')
    try {
      return fs.readFileSync(path.join(this.noteDir(rel), `${id}.md`), 'utf8')
    } catch {
      throw new VaultError('ENOENT', 'Version not found')
    }
  }

  /**
   * Keep `content` as a version of `rel`. Skipped when it equals the newest version, or when the
   * newest is younger than the interval (unless `force`), so autosave does not flood the history.
   */
  record(rel: string, content: string, force = false, now = Date.now()): boolean {
    const hash = sha(content).slice(0, 12)
    const [latest] = this.list(rel)
    if (latest && latest.id.endsWith(hash)) return false
    if (!force && latest && now - latest.ts < this.opts.interval) return false
    const dir = this.noteDir(rel)
    atomicWrite(path.join(dir, `${now}-${hash}.md`), content)
    atomicWrite(path.join(dir, 'meta.json'), JSON.stringify({ path: rel }))
    for (const old of this.list(rel).slice(this.opts.keep)) fs.rmSync(path.join(dir, `${old.id}.md`), { force: true })
    return true
  }

  /** Follow a rename of a file, or of a folder (every note below it). */
  move(from: string, to: string) {
    let dirs: string[]
    try {
      dirs = fs.readdirSync(this.dir)
    } catch {
      return
    }
    for (const d of dirs) {
      const src = path.join(this.dir, d)
      let p: unknown
      try {
        p = JSON.parse(fs.readFileSync(path.join(src, 'meta.json'), 'utf8')).path
      } catch {
        continue
      }
      if (typeof p !== 'string' || (p !== from && !p.startsWith(from + '/'))) continue
      const next = to + p.slice(from.length)
      const dest = this.noteDir(next)
      if (dest === src) continue
      fs.mkdirSync(dest, { recursive: true })
      // merge into history already kept under the new name (a note deleted earlier)
      for (const f of fs.readdirSync(src)) if (f !== 'meta.json' && !fs.existsSync(path.join(dest, f))) fs.renameSync(path.join(src, f), path.join(dest, f))
      atomicWrite(path.join(dest, 'meta.json'), JSON.stringify({ path: next }))
      fs.rmSync(src, { recursive: true, force: true })
    }
  }
}
