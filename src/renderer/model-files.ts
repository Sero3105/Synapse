// Model: files and folders (create, rename or move with link updates, delete, attachments),
// the file tree's expanded folders, daily notes and templates.
import { api } from './api'
import { rewriteLinks, buildLookup, uniqueName, INVALID_NAME, basename, noteTitle } from '../shared/markdown'
import { t, tn } from '../shared/i18n'
import { TEMPLATE_FOLDER, DAILY_TEMPLATE, BUILTIN_TEMPLATES, isoDate, fillTemplate, dailyNotePath, adjacentDaily, dailyDate } from '../shared/templates'
import { WorkspaceModel } from './model-workspace'
import { Template, isMd, dirOf } from './model-types'

export abstract class FileModel extends WorkspaceModel {
  // ---------- file operations ----------
  /** Folder for new notes according to the newFileLocation preference. */
  newNoteFolder(): string {
    if (this.prefs.newFileLocation === 'current') {
      const f = this.activeFile
      if (f) return dirOf(f)
    }
    return ''
  }

  async createNote(opts: { folder?: string; path?: string; where?: 'tab' | 'new' | 'split'; content?: string } = {}) {
    const existing = new Set(this.state.files.map((f) => f.path))
    const path = opts.path ?? uniqueName(existing, opts.folder ?? this.newNoteFolder(), t('file.untitled'), '.md')
    try {
      const n = await api.create(path, opts.content ?? '')
      this.setBuffer(n.path, { content: n.content, saved: n.content, mtime: n.mtime })
      this.index.upsert(n.path, n.content)
      await this.refreshFiles()
      const parent = dirOf(n.path)
      if (parent) this.set({ expanded: { ...this.state.expanded, ...this.ancestors(parent) } })
      await this.open(n.path, opts.where ?? (this.activeTab.kind === 'empty' ? 'tab' : 'new'), { mode: 'source' })
      if (!opts.path) this.set({ focusTitle: this.activeTab.id })
      return n.path
    } catch (e) {
      this.error(e)
      return null
    }
  }

  /** Create a note file for a [[link]] being typed, without opening it or leaving the current note. */
  async createNoteFile(name: string): Promise<string | null> {
    const folder = this.newNoteFolder()
    const path = folder ? `${folder}/${name}.md` : `${name}.md`
    if (this.state.files.some((f) => f.path === path)) return path
    try {
      const n = await api.create(path, '')
      this.index.upsert(n.path, n.content)
      await this.refreshFiles()
      return n.path
    } catch (e) {
      this.error(e)
      return null
    }
  }

  private ancestors(folder: string) {
    const out: Record<string, boolean> = {}
    const parts = folder.split('/')
    for (let i = 1; i <= parts.length; i++) out[parts.slice(0, i).join('/')] = true
    return out
  }

  async createFolder(parent = '') {
    const name = await this.prompt(t('dialog.newFolder'), '', t('common.create'))
    if (!name) return
    if (INVALID_NAME.test(name) || name.startsWith('.')) return this.notice(t('notice.invalidFolder'), true)
    const path = parent ? `${parent}/${name}` : name
    try {
      await api.mkdir(path)
      await this.refreshFiles()
      this.set({ expanded: { ...this.state.expanded, ...this.ancestors(path) } })
    } catch (e) {
      this.error(e)
    }
  }

  async renamePrompt(path: string) {
    const isFolder = this.state.files.some((f) => f.path === path && f.type === 'folder')
    const name = basename(path)
    const shown = !isFolder && isMd(name) ? name.slice(0, -3) : name
    const next = await this.prompt(isFolder ? t('dialog.renameFolder') : t('dialog.renameFile'), shown, t('common.rename'))
    if (next === null || next === shown) return
    const full = !isFolder && isMd(name) ? `${next}.md` : next
    const dir = dirOf(path)
    await this.rename(path, dir ? `${dir}/${full}` : full)
  }

  /**
   * Rename/move a file or folder. Open tabs, buffers and history follow the move;
   * with updateLinksOnRename, links in other notes are rewritten.
   */
  async rename(from: string, to: string): Promise<boolean> {
    to = to.replace(/^\/+|\/+$/g, '')
    const name = basename(to)
    if (!name || INVALID_NAME.test(name.replace(/\.md$/i, '')) || name.startsWith('.')) {
      this.notice(t('common.invalidName'), true)
      return false
    }
    if (from === to) return true
    const isFolder = this.state.files.some((f) => f.path === from && f.type === 'folder')
    const moves = new Map<string, string>()
    for (const f of this.state.files) {
      if (f.type !== 'file') continue
      if (f.path === from) moves.set(f.path, to)
      else if (isFolder && f.path.startsWith(from + '/')) moves.set(f.path, to + f.path.slice(from.length))
    }
    for (const p of moves.keys()) await this.flush(p)
    const before = this.index.lookup
    try {
      await api.rename(from, to)
    } catch (e) {
      this.error(e)
      return false
    }
    // move buffers, index entries, tabs, history, expanded state
    const buffers = { ...this.state.buffers }
    for (const [a, b] of moves) {
      if (buffers[a]) {
        buffers[b] = buffers[a]
        delete buffers[a]
      }
      const n = this.index.notes.get(a)
      if (n) {
        this.index.remove(a)
        this.index.upsert(b, n.content)
      }
    }
    this.set({ buffers })
    const mv = (p?: string) => (p && moves.has(p) ? moves.get(p)! : p)
    this.mapTabs((t) => ({ ...t, path: mv(t.path), back: t.back.map((p) => mv(p)!), fwd: t.fwd.map((p) => mv(p)!) }))
    const mvPair = (k: string) => k.split('\u0000').map((p) => mv(p)!).sort().join('\u0000')
    this.set({ recent: this.state.recent.map((p) => mv(p)!), pinned: this.state.pinned.map((p) => mv(p)!), dismissedRelated: this.state.dismissedRelated.map(mvPair) })
    const views = this.state.snap?.vault?.settings.graphViews ?? []
    if (views.some((v) => v.center && moves.has(v.center))) this.setVault({ graphViews: views.map((v) => ({ ...v, center: mv(v.center) })) })
    if (isFolder) {
      const expanded: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(this.state.expanded)) expanded[k === from || k.startsWith(from + '/') ? to + k.slice(from.length) : k] = v
      this.set({ expanded })
    }
    await this.refreshFiles()
    if (this.prefs.updateLinksOnRename) await this.updateLinksAfterMove(moves, before)
    return true
  }

  private async updateLinksAfterMove(moves: Map<string, string>, before: Map<string, string[]>) {
    const after = buildLookup(this.index.files)
    // Pre-rename source paths so relative links resolve as they did before the move.
    const reverse = new Map([...moves].map(([a, b]) => [b, a]))
    let count = 0
    for (const n of [...this.index.notes.values()]) {
      const content = this.state.buffers[n.path]?.content ?? n.content
      const next = rewriteLinks(content, reverse.get(n.path) ?? n.path, moves, before, after)
      if (next === null) continue
      count++
      const b = this.state.buffers[n.path]
      if (b) {
        this.edit(n.path, next)
        await this.save(n.path)
      } else {
        try {
          const disk = await api.read(n.path)
          if (disk.content !== n.content) continue // changed externally meanwhile: don't touch
          await api.write(n.path, next, disk.mtime)
          this.index.upsert(n.path, next)
        } catch (e) {
          this.error(e)
        }
      }
    }
    if (count) this.notice(tn('notice.linksUpdated', count))
    this.set({ indexVersion: this.state.indexVersion + 1 })
  }

  async remove(path: string) {
    const isFolder = this.state.files.some((f) => f.path === path && f.type === 'folder')
    if (this.prefs.promptDelete) {
      const ok = await this.confirm(isFolder ? t('dialog.deleteFolder') : t('dialog.deleteFile'), t(isFolder ? 'dialog.deleteFolderBody' : 'dialog.deleteFileBody', { name: basename(path) }))
      if (!ok) return
    }
    const gone = (p?: string) => !!p && (p === path || p.startsWith(path + '/'))
    // finish pending saves first: a late autosave would otherwise recreate the file after it is trashed
    for (const p of Object.keys(this.state.buffers)) if (gone(p)) await this.flush(p)
    for (const p of Object.keys(this.state.buffers)) if (gone(p)) clearTimeout(this.saveTimers.get(p))
    try {
      await api.trash(path)
    } catch (e) {
      return this.error(e)
    }
    const buffers = Object.fromEntries(Object.entries(this.state.buffers).filter(([p]) => !gone(p)))
    this.set({ buffers })
    for (const pane of this.state.ws.panes) for (const t of pane.tabs) if (gone(t.path)) this.closeTab(pane.id, t.id)
    this.mapTabs((t) => ({ ...t, back: t.back.filter((p) => !gone(p)), fwd: t.fwd.filter((p) => !gone(p)) }))
    this.set({
      recent: this.state.recent.filter((p) => !gone(p)),
      pinned: this.state.pinned.filter((p) => !gone(p)),
      dismissedRelated: this.state.dismissedRelated.filter((k) => !k.split('\u0000').some(gone)),
    })
    await this.refreshFiles()
  }

  /** Save a pasted/dropped attachment into the attachment folder and return its vault path. */
  async saveAttachment(name: string, data: Uint8Array, notePath: string): Promise<string | null> {
    const setting = this.state.snap?.vault?.settings.attachmentFolder ?? ''
    const folder = setting === './' ? dirOf(notePath) : setting.replace(/^\/+|\/+$/g, '')
    const dot = name.lastIndexOf('.')
    const base = (dot > 0 ? name.slice(0, dot) : name).replace(INVALID_NAME, '-') || t('file.pastedImage')
    const ext = dot > 0 ? name.slice(dot) : ''
    const path = uniqueName(new Set(this.state.files.map((f) => f.path)), folder, base, ext)
    try {
      const saved = await api.createBinary(path, data)
      await this.refreshFiles()
      return saved
    } catch (e) {
      this.error(e)
      return null
    }
  }

  toggleExpanded(path: string, value?: boolean) {
    this.set({ expanded: { ...this.state.expanded, [path]: value ?? !this.state.expanded[path] } })
    this.persistWorkspace()
  }

  // ---------- daily notes & templates ----------
  private filePaths() {
    return this.state.files.filter((f) => f.type === 'file').map((f) => f.path)
  }

  /** Open the daily note for `date` (today by default), creating it only if no such note exists. */
  async openDailyNote(date = isoDate(new Date())) {
    await this.refreshFiles() // pick up notes created outside Synapse a moment ago
    const { path, exists } = dailyNotePath(this.filePaths(), date)
    if (exists) return this.open(path)
    const tpl = this.state.files.some((f) => f.path === DAILY_TEMPLATE) ? await this.templateText({ name: '', path: DAILY_TEMPLATE }) : ''
    await this.createNote({ path, content: tpl === null ? '' : fillTemplate(tpl, { title: date, now: new Date() }) })
  }

  /** Previous/next existing daily note, counted from the open daily note or else from today. */
  openAdjacentDaily(dir: 1 | -1) {
    const from = (this.activeFile && dailyDate(this.activeFile)) || isoDate(new Date())
    const p = adjacentDaily(this.filePaths(), from, dir)
    if (p) this.open(p)
    else this.notice(t(dir < 0 ? 'notice.noPrevDaily' : 'notice.noNextDaily'))
  }

  /** Notes in the Templates folder first, then the built-in ones. */
  templates(): Template[] {
    const own = this.filePaths()
      .filter((p) => p.startsWith(TEMPLATE_FOLDER + '/') && isMd(p))
      .sort()
      .map((path) => ({ name: noteTitle(path), path }))
    return [...own, ...BUILTIN_TEMPLATES.map((id) => ({ name: t(`template.${id}`), id }))]
  }

  private async templateText(tpl: Template): Promise<string | null> {
    if (tpl.id) return t(`template.${tpl.id}.body`)
    try {
      return this.state.buffers[tpl.path!]?.content ?? (await api.read(tpl.path!)).content
    } catch (e) {
      this.error(e)
      return null
    }
  }

  /** Insert at the cursor of the active editor, as one undoable edit; nothing is replaced. */
  async insertTemplate(tpl: Template) {
    const view = this.activeEditor
    const path = this.activeFile
    const text = await this.templateText(tpl)
    if (!view || !path || text === null || this.activeEditor !== view) return
    const at = view.state.selection.main.head
    const insert = fillTemplate(text, { title: noteTitle(path), now: new Date() })
    view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, scrollIntoView: true })
    view.focus()
  }

  /** Ask for a name and create a new note from the template. Never writes over an existing file. */
  async newNoteFromTemplate(tpl: Template) {
    const text = await this.templateText(tpl)
    if (text === null) return
    const name = await this.prompt(t('templates.noteName'), '', t('common.create'))
    if (!name) return
    if (INVALID_NAME.test(name) || name.startsWith('.')) return this.notice(t('common.invalidName'), true)
    const folder = this.newNoteFolder()
    const path = `${folder ? folder + '/' : ''}${name}.md`
    if (this.state.files.some((f) => f.path.toLowerCase() === path.toLowerCase())) return this.notice(t('error.EEXIST'), true)
    await this.createNote({ path, content: fillTemplate(text, { title: name, now: new Date() }) })
  }
}
