// Model: note buffers and saving. Autosave, conflicts with changes made outside Synapse
// (keep mine / keep disk / three-way merge), file-system events and version restore.
import { api, ApiError, NoteData } from './api'
import { noteTitle } from '../shared/markdown'
import { t } from '../shared/i18n'
import { merge3, assembleMerge, type MergePart } from '../shared/merge'
import { ModelBase } from './model-base'
import { Buffer, isMd, errorText } from './model-types'

export abstract class BufferModel extends ModelBase {
  protected saveTimers = new Map<string, number>()

  /** Closing tabs belongs to the workspace layer. */
  protected abstract closeTabsFor(path: string): void

  async ensureBuffer(path: string) {
    if (this.state.buffers[path]) return
    try {
      const n = await api.read(path)
      if (this.state.buffers[path]) return
      this.setBuffer(path, { content: n.content, saved: n.content, mtime: n.mtime })
    } catch (e) {
      this.error(e)
    }
  }

  protected setBuffer(path: string, b: Buffer | null) {
    const buffers = { ...this.state.buffers }
    if (b) buffers[path] = b
    else delete buffers[path]
    this.set({ buffers })
  }

  edit(path: string, content: string) {
    const b = this.state.buffers[path]
    if (!b || b.content === content) return
    // typing in a preview tab keeps it, like VS Code
    if (this.state.ws.panes.some((p) => p.tabs.some((x) => x.preview && x.path === path))) {
      this.mapTabs((x) => (x.preview && x.path === path ? { ...x, preview: undefined } : x))
    }
    this.setBuffer(path, { ...b, content })
    this.index.upsert(path, content)
    this.bumpIndex()
    clearTimeout(this.saveTimers.get(path))
    this.saveTimers.set(path, window.setTimeout(() => this.save(path), 800))
  }

  private indexTimer = 0
  private bumpIndex() {
    clearTimeout(this.indexTimer)
    this.indexTimer = window.setTimeout(() => this.set({ indexVersion: this.state.indexVersion + 1 }), 250)
  }

  isDirty(path: string) {
    const b = this.state.buffers[path]
    return !!b && b.content !== b.saved
  }

  /** Save a buffer. Refuses to clobber external modifications (conflict banner instead). */
  async save(path: string, force = false): Promise<boolean> {
    clearTimeout(this.saveTimers.get(path))
    const b = this.state.buffers[path]
    if (!b) return true
    if (!force && (b.conflict || b.content === b.saved)) return !b.conflict
    const content = b.content
    this.inflight.set(path, content)
    try {
      const r = await api.write(path, content, force ? undefined : b.mtime)
      const cur = this.state.buffers[path]
      if (cur) this.setBuffer(path, { ...cur, saved: content, mtime: r.mtime, conflict: undefined })
      return true
    } catch (e) {
      const cur = this.state.buffers[path]
      if (e instanceof ApiError && (e.code === 'ECONFLICT' || e.code === 'ENOENT') && cur) {
        this.setBuffer(path, { ...cur, conflict: e.code === 'ECONFLICT' ? 'modified' : 'deleted' })
        this.notice(`${noteTitle(path)}: ${errorText(e)}`, true)
      } else this.error(e)
      return false
    } finally {
      if (this.inflight.get(path) === content) this.inflight.delete(path)
    }
  }

  /** Content currently being written per path: watcher events for it are our own writes. */
  private inflight = new Map<string, string>()

  flush(path: string) {
    if (this.isDirty(path)) return this.save(path)
    return Promise.resolve(true)
  }

  async flushAll(): Promise<boolean> {
    const results = await Promise.all(Object.keys(this.state.buffers).map((p) => this.flush(p)))
    clearTimeout(this.wsTimer)
    await this.saveWorkspaceNow()
    return results.every(Boolean) && Object.values(this.state.buffers).every((b) => !b.conflict)
  }

  async resolveConflict(path: string, keep: 'mine' | 'disk') {
    const b = this.state.buffers[path]
    if (!b) return
    if (keep === 'mine') {
      if (b.conflict === 'deleted') {
        try {
          await api.create(path, b.content)
          const n = await api.read(path)
          this.setBuffer(path, { content: b.content, saved: b.content, mtime: n.mtime })
          await this.refreshFiles()
        } catch (e) {
          this.error(e)
        }
      } else await this.save(path, true)
      return
    }
    if (b.conflict === 'deleted') {
      this.setBuffer(path, null)
      this.closeTabsFor(path)
      return
    }
    try {
      const n = await api.read(path)
      this.setBuffer(path, { content: n.content, saved: n.content, mtime: n.mtime })
      this.index.upsert(path, n.content)
      this.bumpIndex()
    } catch (e) {
      this.error(e)
    }
  }

  /**
   * Three-way merge of a 'modified' conflict: `saved` is the common base, the buffer
   * is mine, the file on disk is theirs. Clean merges save at once; conflicting
   * regions open the merge modal, one choice each.
   */
  async mergeConflict(path: string) {
    const b = this.state.buffers[path]
    if (!b || b.conflict !== 'modified') return
    let theirs: string
    try {
      theirs = (await api.read(path)).content
    } catch (e) {
      return this.error(e)
    }
    const { parts, conflicts } = merge3(b.saved, b.content, theirs)
    if (!conflicts) return this.applyMerge(path, parts, [], b.content, theirs)
    this.set({ modal: { kind: 'merge', path, parts, mine: b.content, theirs } })
  }

  /** Write the merged text and save it. Aborts if the buffer or the file changed since the merge was computed. */
  async applyMerge(path: string, parts: MergePart[], choices: ('mine' | 'theirs')[], expectedMine: string, expectedTheirs: string) {
    const b = this.state.buffers[path]
    if (!b) return
    const changed = () => {
      this.set({ modal: null })
      this.notice(t('conflict.mergeChanged'), true)
    }
    if (b.content !== expectedMine) return changed()
    try {
      const n = await api.read(path) // fresh mtime: save() still refuses if the file races us
      // a newer disk version was not part of this merge: writing would silently drop it
      if (n.content !== expectedTheirs) return changed()
      // saved becomes the disk text just read, so save() writes whenever the merge differs from it
      this.setBuffer(path, { ...b, saved: n.content, mtime: n.mtime, conflict: undefined })
      this.edit(path, assembleMerge(parts, choices))
      if (await this.save(path)) this.notice(t('conflict.merged'))
    } catch (e) {
      this.error(e)
    }
    if (this.state.modal?.kind === 'merge' && this.state.modal.path === path) this.set({ modal: null })
  }

  // ---------- external changes ----------
  private fsTimer = 0
  private fsPending = new Set<string>()
  protected async onFsChanged(paths: string[]) {
    for (const p of paths) this.fsPending.add(p)
    clearTimeout(this.fsTimer)
    this.fsTimer = window.setTimeout(async () => {
      const changed = [...this.fsPending]
      this.fsPending.clear()
      const read = new Map<string, NoteData | null>()
      for (const p of changed) if (isMd(p)) read.set(p, await api.read(p).catch(() => null))
      // an edit of a listed note (every autosave) only moves its mtime; only new, gone or non-note paths need the whole vault listed again
      const listed = new Set(this.state.files.map((f) => f.path))
      if (changed.some((p) => !listed.has(p) || !read.get(p))) await this.refreshFiles()
      else this.set({ files: this.state.files.map((f) => (read.has(f.path) ? { ...f, mtime: read.get(f.path)!.mtime } : f)) })
      const existing = new Set(this.state.files.map((f) => f.path))
      for (const p of changed) {
        if (!isMd(p)) continue
        if (!existing.has(p)) {
          this.index.remove(p)
          const b = this.state.buffers[p]
          if (b && b.content !== b.saved) this.setBuffer(p, { ...b, conflict: 'deleted' })
          else if (b) {
            this.setBuffer(p, null)
            this.closeTabsFor(p)
          }
          continue
        }
        const n = read.get(p)
        if (!n) continue // raced with deletion
        const b = this.state.buffers[p]
        if (this.inflight.get(p) === n.content) continue
        if (b && n.content !== b.saved && n.mtime !== b.mtime) {
          if (b.content === b.saved) this.setBuffer(p, { content: n.content, saved: n.content, mtime: n.mtime })
          else if (n.content !== b.content) this.setBuffer(p, { ...b, conflict: 'modified' })
        } else if (b && b.mtime !== n.mtime && n.content === b.saved) {
          this.setBuffer(p, { ...b, mtime: n.mtime })
        }
        this.index.upsert(p, this.state.buffers[p]?.content ?? n.content)
      }
      this.set({ indexVersion: this.state.indexVersion + 1 })
    }, 100)
  }

  async refreshFiles() {
    try {
      const files = await api.list()
      this.index.setFiles(files.filter((f) => f.type === 'file').map((f) => f.path))
      const live = new Set(files.map((f) => f.path))
      for (const p of [...this.index.notes.keys()]) if (!live.has(p)) this.index.remove(p)
      this.set({ files, indexVersion: this.state.indexVersion + 1 })
    } catch (e) {
      this.error(e)
    }
  }

  // ---------- version history ----------
  /** Replace a note with an earlier version after saving pending edits; refuses if the note changed on disk. */
  async restoreVersion(path: string, id: string) {
    await this.ensureBuffer(path)
    if (!this.state.buffers[path]) return // read error already shown
    if (this.state.buffers[path].conflict) return this.notice(`${noteTitle(path)}: ${t('error.ECONFLICT')}`, true)
    // a failed save shows its own error
    if (!(await this.flush(path)) || !this.state.buffers[path] || this.state.buffers[path].conflict) return
    const before = this.state.buffers[path].content
    try {
      const n = await api.restoreVersion(path, id, this.state.buffers[path].mtime)
      const cur = this.state.buffers[path]
      if (!cur) return
      // text typed while the restore ran is kept: the conflict banner lets the user choose
      if (cur.content !== before) return this.setBuffer(path, { ...cur, saved: n.content, mtime: n.mtime, conflict: 'modified' })
      this.setBuffer(path, { ...cur, content: n.content, saved: n.content, mtime: n.mtime, conflict: undefined })
      this.index.upsert(path, n.content)
      this.bumpIndex()
      this.notice(t('history.restored'))
    } catch (e) {
      this.error(e)
    }
  }
}
