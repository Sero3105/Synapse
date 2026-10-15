// Central renderer state + actions. Components subscribe with useModel(selector).
import { useSyncExternalStore } from 'react'
import type { EditorView } from '@codemirror/view'
import { api, ApiError, Snapshot, FileEntry } from './api'
import { NoteIndex, rewriteLinks, buildLookup, uniqueName, INVALID_NAME, basename, noteTitle } from '../shared/markdown'
import { isObj, Prefs, Layout, GraphSettings } from '../shared/settings'

export type ViewMode = 'source' | 'preview'
export interface Tab {
  id: string
  kind: 'note' | 'file' | 'graph' | 'empty'
  path?: string
  mode: ViewMode
  back: string[]
  fwd: string[]
  /** restored on open */
  cursor?: number
  scroll?: number
}
export interface Pane { id: string; tabs: Tab[]; active: string }
export interface Workspace { panes: Pane[]; activePane: string; direction: 'row' | 'column'; paneSizes: number[] }

export interface Buffer {
  content: string
  saved: string
  mtime: number
  conflict?: 'modified' | 'deleted'
  saving?: boolean
}

export type Modal =
  | { kind: 'palette' }
  | { kind: 'switcher' }
  | { kind: 'settings'; tab?: string }
  | { kind: 'vaults' }
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; okText?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; okText: string; danger?: boolean; resolve: (ok: boolean) => void }

export interface MenuItem { label: string; run?: () => void; danger?: boolean; separator?: boolean; disabled?: boolean }

export interface State {
  snap: Snapshot | null
  loading: boolean
  files: FileEntry[]
  indexVersion: number
  buffers: Record<string, Buffer>
  ws: Workspace
  modal: Modal | null
  menu: { x: number; y: number; items: MenuItem[] } | null
  notices: { id: number; text: string; error?: boolean }[]
  searchQuery: string
  expanded: Record<string, boolean>
  /** tab whose inline title should be focused (new note) */
  focusTitle: string | null
  /** bumped when a line jump is requested */
  navTick: number
}

let uid = 0
export const newId = () => `${Date.now().toString(36)}${(uid++).toString(36)}`
const emptyTab = (): Tab => ({ id: newId(), kind: 'empty', mode: 'source', back: [], fwd: [] })
const defaultWs = (): Workspace => {
  const t = emptyTab()
  const p = { id: newId(), tabs: [t], active: t.id }
  return { panes: [p], activePane: p.id, direction: 'row', paneSizes: [1] }
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
export const isMd = (p: string) => /\.md$/i.test(p)
const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

class Model {
  state: State = {
    snap: null,
    loading: true,
    files: [],
    indexVersion: 0,
    buffers: {},
    ws: defaultWs(),
    modal: null,
    menu: null,
    notices: [],
    searchQuery: '',
    expanded: {},
    focusTitle: null,
    navTick: 0,
  }
  index = new NoteIndex()
  editors = new Map<string, EditorView>()
  private listeners = new Set<() => void>()
  private saveTimers = new Map<string, number>()
  private wsTimer = 0
  private closedTabs: { paneId: string; tab: Tab }[] = []
  private vaultId: string | null = null

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch }
    for (const l of this.listeners) l()
  }

  get prefs(): Prefs {
    return this.state.snap!.prefs
  }
  get layout(): Layout {
    return this.state.snap!.global.layout
  }

  // ---------- boot ----------
  async init() {
    api.on('state', (s) => this.onSnapshot(s as Snapshot))
    api.on('fs:changed', (paths) => this.onFsChanged(paths as string[]))
    api.on('command', (id) => runCommandById(String(id)))
    api.on('app:flush', async () => api.flushed(await this.flushAll()))
    await this.onSnapshot(await api.state())
  }

  private async onSnapshot(s: Snapshot) {
    const changedVault = (s.vault?.id ?? null) !== this.vaultId || (s.vault && s.vault.path !== this.state.snap?.vault?.path)
    this.set({ snap: s })
    if (!changedVault) return
    if (this.vaultId) await this.flushAll()
    this.vaultId = s.vault?.id ?? null
    if (!s.vault) {
      this.set({ files: [], buffers: {}, ws: defaultWs(), loading: false })
      return
    }
    await this.loadVault()
  }

  private async loadVault() {
    this.set({ loading: true, buffers: {}, modal: null, searchQuery: '' })
    this.index = new NoteIndex()
    this.editors.clear()
    try {
      const [files, notes, ws] = await Promise.all([api.list(), api.readAll(), api.loadWorkspace().catch(() => null)])
      this.index.setFiles(files.filter((f) => f.type === 'file').map((f) => f.path))
      for (const n of notes) this.index.upsert(n.path, n.content)
      const restored = this.restoreWorkspace(ws, new Set(files.map((f) => f.path)))
      this.set({ files, ws: restored.ws, expanded: restored.expanded, indexVersion: this.state.indexVersion + 1, loading: false })
      for (const p of this.state.ws.panes) {
        const t = p.tabs.find((x) => x.id === p.active)
        if (t?.path && t.kind === 'note') this.ensureBuffer(t.path)
      }
    } catch (e) {
      this.set({ loading: false })
      this.error(e)
    }
  }

  /** Validate persisted workspace JSON; drop tabs whose files no longer exist. */
  private restoreWorkspace(raw: unknown, existing: Set<string>): { ws: Workspace; expanded: Record<string, boolean> } {
    const fallback = { ws: defaultWs(), expanded: {} }
    if (!isObj(raw) || !Array.isArray(raw.panes)) return fallback
    const panes: Pane[] = []
    for (const p of raw.panes.slice(0, 8)) {
      if (!isObj(p) || !Array.isArray(p.tabs)) continue
      const tabs: Tab[] = []
      for (const t of p.tabs.slice(0, 50)) {
        if (!isObj(t)) continue
        const kind = (['note', 'file', 'graph', 'empty'] as const).find((k) => k === t.kind) ?? 'empty'
        const path = typeof t.path === 'string' && existing.has(t.path) ? t.path : undefined
        if ((kind === 'note' || kind === 'file') && !path) continue
        const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string' && existing.has(s)).slice(-50) : [])
        tabs.push({
          id: newId(),
          kind,
          path,
          mode: t.mode === 'preview' ? 'preview' : 'source',
          back: strs(t.back),
          fwd: strs(t.fwd),
          cursor: typeof t.cursor === 'number' ? t.cursor : undefined,
          scroll: typeof t.scroll === 'number' ? t.scroll : undefined,
        })
      }
      if (!tabs.length) tabs.push(emptyTab())
      const activeIdx = typeof p.activeIndex === 'number' ? Math.min(Math.max(0, p.activeIndex), tabs.length - 1) : 0
      panes.push({ id: newId(), tabs, active: tabs[activeIdx].id })
    }
    if (!panes.length) return fallback
    const ai = typeof raw.activePaneIndex === 'number' ? Math.min(Math.max(0, raw.activePaneIndex), panes.length - 1) : 0
    const sizes = Array.isArray(raw.paneSizes) && raw.paneSizes.length === panes.length && raw.paneSizes.every((n) => typeof n === 'number' && n > 0) ? (raw.paneSizes as number[]) : panes.map(() => 1)
    const expanded: Record<string, boolean> = {}
    if (isObj(raw.expanded)) for (const [k, v] of Object.entries(raw.expanded)) if (v === true && existing.has(k)) expanded[k] = true
    return { ws: { panes, activePane: panes[ai].id, direction: raw.direction === 'column' ? 'column' : 'row', paneSizes: sizes }, expanded }
  }

  private persistWorkspace() {
    clearTimeout(this.wsTimer)
    this.wsTimer = window.setTimeout(() => this.saveWorkspaceNow(), 500)
  }

  private saveWorkspaceNow() {
    if (!this.vaultId) return Promise.resolve()
    const { ws, expanded } = this.state
    const data = {
      direction: ws.direction,
      paneSizes: ws.paneSizes,
      activePaneIndex: ws.panes.findIndex((p) => p.id === ws.activePane),
      panes: ws.panes.map((p) => ({
        activeIndex: p.tabs.findIndex((t) => t.id === p.active),
        tabs: p.tabs.map(({ kind, path, mode, back, fwd, cursor, scroll }) => ({ kind, path, mode, back, fwd, cursor, scroll })),
      })),
      expanded,
    }
    return api.saveWorkspace(data).catch((e) => console.error('workspace save failed', e))
  }

  // ---------- notices / dialogs ----------
  notice(text: string, error = false) {
    const id = newId() as unknown as number
    this.set({ notices: [...this.state.notices, { id, text, error }] })
    setTimeout(() => this.set({ notices: this.state.notices.filter((n) => n.id !== id) }), error ? 7000 : 3500)
  }

  error(e: unknown) {
    console.error(e)
    this.notice(e instanceof Error ? e.message : String(e), true)
  }

  prompt(title: string, value = '', okText = 'Save'): Promise<string | null> {
    return new Promise((resolve) => this.set({ modal: { kind: 'prompt', title, value, okText, resolve } }))
  }

  confirm(title: string, message: string, okText = 'Delete', danger = true): Promise<boolean> {
    return new Promise((resolve) => this.set({ modal: { kind: 'confirm', title, message, okText, danger, resolve } }))
  }

  openMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[]) {
    e.preventDefault()
    this.set({ menu: { x: e.clientX, y: e.clientY, items } })
  }

  // ---------- settings ----------
  async setGlobal(patch: { prefs?: Partial<Prefs>; layout?: Partial<Layout>; hotkeys?: Record<string, string[] | null> }) {
    try {
      await api.updateGlobal(patch)
    } catch (e) {
      this.error(e)
    }
  }

  async setVault(patch: { overrides?: Record<string, unknown>; graph?: Partial<GraphSettings>; attachmentFolder?: string }) {
    try {
      await api.updateVault(patch)
    } catch (e) {
      this.error(e)
    }
  }

  /** Layout changes (sidebar sizes etc.) are applied locally at once and persisted globally. */
  setLayout(patch: Partial<Layout>) {
    const snap = this.state.snap!
    this.set({ snap: { ...snap, global: { ...snap.global, layout: { ...snap.global.layout, ...patch } } } })
    this.setGlobal({ layout: patch })
  }

  // ---------- workspace helpers ----------
  get activePane(): Pane {
    const { ws } = this.state
    return ws.panes.find((p) => p.id === ws.activePane) ?? ws.panes[0]
  }

  get activeTab(): Tab {
    const p = this.activePane
    return p.tabs.find((t) => t.id === p.active) ?? p.tabs[0]
  }

  get activeFile(): string | null {
    const t = this.activeTab
    return t.kind === 'note' || t.kind === 'file' ? t.path ?? null : null
  }

  get activeEditor(): EditorView | null {
    const t = this.activeTab
    return t.kind === 'note' && t.mode === 'source' ? this.editors.get(t.id) ?? null : null
  }

  private setWs(ws: Workspace) {
    this.set({ ws })
    this.persistWorkspace()
  }

  private mapTabs(fn: (t: Tab, p: Pane) => Tab) {
    const ws = this.state.ws
    this.setWs({ ...ws, panes: ws.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => fn(t, p)) })) })
  }

  updateTab(tabId: string, patch: Partial<Tab>, persist = true) {
    const ws = this.state.ws
    const next = { ...ws, panes: ws.panes.map((p) => ({ ...p, tabs: p.tabs.map((t) => (t.id === tabId ? { ...t, ...patch } : t)) })) }
    if (persist) this.setWs(next)
    else {
      // cursor/scroll: keep in state without re-rendering subscribers needlessly
      this.state = { ...this.state, ws: next }
      this.persistWorkspace()
    }
  }

  focusPane(paneId: string) {
    if (this.state.ws.activePane !== paneId) this.setWs({ ...this.state.ws, activePane: paneId })
  }

  selectTab(paneId: string, tabId: string) {
    const ws = this.state.ws
    this.setWs({ ...ws, activePane: paneId, panes: ws.panes.map((p) => (p.id === paneId ? { ...p, active: tabId } : p)) })
    const t = ws.panes.find((p) => p.id === paneId)?.tabs.find((x) => x.id === tabId)
    if (t?.kind === 'note' && t.path) this.ensureBuffer(t.path)
  }

  newTab(paneId = this.activePane.id, tab: Tab = emptyTab()) {
    const ws = this.state.ws
    this.setWs({
      ...ws,
      activePane: paneId,
      panes: ws.panes.map((p) => {
        if (p.id !== paneId) return p
        const i = p.tabs.findIndex((t) => t.id === p.active)
        const tabs = [...p.tabs]
        tabs.splice(i + 1, 0, tab)
        return { ...p, tabs, active: tab.id }
      }),
    })
    return tab
  }

  closeTab(paneId: string, tabId: string) {
    const ws = this.state.ws
    const pane = ws.panes.find((p) => p.id === paneId)
    if (!pane) return
    const idx = pane.tabs.findIndex((t) => t.id === tabId)
    const tab = pane.tabs[idx]
    if (!tab) return
    if (tab.path && isMd(tab.path)) this.flush(tab.path)
    this.closedTabs.push({ paneId, tab })
    this.editors.delete(tabId)
    const tabs = pane.tabs.filter((t) => t.id !== tabId)
    if (!tabs.length && ws.panes.length > 1) {
      const i = ws.panes.indexOf(pane)
      const panes = ws.panes.filter((p) => p !== pane)
      const paneSizes = ws.paneSizes.filter((_, j) => j !== i)
      this.setWs({ ...ws, panes, paneSizes, activePane: panes[Math.max(0, i - 1)].id })
      return
    }
    if (!tabs.length) tabs.push(emptyTab())
    const active = pane.active === tabId ? tabs[Math.min(idx, tabs.length - 1)].id : pane.active
    this.setWs({ ...ws, panes: ws.panes.map((p) => (p.id === paneId ? { ...p, tabs, active } : p)) })
    const at = tabs.find((t) => t.id === active)
    if (at?.kind === 'note' && at.path) this.ensureBuffer(at.path)
  }

  closeOthers(paneId: string, tabId: string) {
    const pane = this.state.ws.panes.find((p) => p.id === paneId)
    for (const t of pane?.tabs ?? []) if (t.id !== tabId) this.closeTab(paneId, t.id)
  }

  reopenClosed(): void {
    const last = this.closedTabs.pop()
    if (!last) return
    if (last.tab.path && !this.state.files.some((f) => f.path === last.tab.path)) return this.reopenClosed()
    const pane = this.state.ws.panes.find((p) => p.id === last.paneId) ?? this.activePane
    this.newTab(pane.id, { ...last.tab, id: newId() })
    if (last.tab.kind === 'note' && last.tab.path) this.ensureBuffer(last.tab.path)
  }

  cycleTab(delta: number) {
    const p = this.activePane
    const i = p.tabs.findIndex((t) => t.id === p.active)
    const next = p.tabs[(i + delta + p.tabs.length) % p.tabs.length]
    this.selectTab(p.id, next.id)
  }

  gotoTab(n: number) {
    const p = this.activePane
    const t = n < 0 ? p.tabs[p.tabs.length - 1] : p.tabs[n]
    if (t) this.selectTab(p.id, t.id)
  }

  split(direction: 'row' | 'column', path?: string) {
    const ws = this.state.ws
    if (ws.panes.length >= 4) return this.notice('Maximum of 4 panes')
    const src = this.activeTab
    const tab: Tab = path ? { ...emptyTab(), kind: 'note', path, mode: this.prefs.defaultViewMode } : { ...src, id: newId(), back: [...src.back], fwd: [...src.fwd] }
    const pane: Pane = { id: newId(), tabs: [tab], active: tab.id }
    const i = ws.panes.findIndex((p) => p.id === ws.activePane)
    const panes = [...ws.panes]
    panes.splice(i + 1, 0, pane)
    const paneSizes = [...ws.paneSizes]
    paneSizes.splice(i + 1, 0, ws.paneSizes[i] ?? 1)
    this.setWs({ ...ws, panes, paneSizes, activePane: pane.id, direction: ws.panes.length === 1 ? direction : ws.direction })
    if (tab.path && tab.kind === 'note') this.ensureBuffer(tab.path)
  }

  setPaneSizes(paneSizes: number[]) {
    this.setWs({ ...this.state.ws, paneSizes })
  }

  moveTab(fromPane: string, tabId: string, toPane: string, toIndex: number) {
    const ws = this.state.ws
    const src = ws.panes.find((p) => p.id === fromPane)
    const tab = src?.tabs.find((t) => t.id === tabId)
    if (!src || !tab) return
    let panes = ws.panes.map((p) => {
      let tabs = p.tabs
      if (p.id === fromPane) tabs = tabs.filter((t) => t.id !== tabId)
      if (p.id === toPane) {
        tabs = [...tabs]
        const at = p.id === fromPane && src.tabs.indexOf(tab) < toIndex ? toIndex - 1 : toIndex
        tabs.splice(Math.min(at, tabs.length), 0, tab)
      }
      const active = p.id === toPane ? tab.id : tabs.some((t) => t.id === p.active) ? p.active : tabs[0]?.id
      return { ...p, tabs, active }
    })
    let paneSizes = ws.paneSizes
    const emptyIdx = panes.findIndex((p) => !p.tabs.length)
    if (emptyIdx >= 0) {
      panes = panes.filter((_, i) => i !== emptyIdx)
      paneSizes = paneSizes.filter((_, i) => i !== emptyIdx)
    }
    this.setWs({ ...ws, panes, paneSizes, activePane: toPane })
  }

  // ---------- opening & navigation ----------
  /**
   * Open a vault path. `where`: 'tab' (current tab), 'new' (new tab), 'split' (new pane).
   * `line` scrolls to and selects a line once the editor is ready.
   */
  async open(path: string, where: 'tab' | 'new' | 'split' = 'tab', opts: { line?: number; mode?: ViewMode } = {}) {
    if (!this.state.files.some((f) => f.path === path && f.type === 'file')) return this.notice(`File not found: ${path}`, true)
    const kind: Tab['kind'] = isMd(path) ? 'note' : 'file'
    if (kind === 'note') this.ensureBuffer(path)
    if (where === 'split') return this.split('row', path)
    const mode = opts.mode ?? this.prefs.defaultViewMode
    if (where === 'new') {
      this.newTab(undefined, { ...emptyTab(), kind, path, mode })
    } else {
      const t = this.activeTab
      if (t.path === path && t.kind === kind) {
        if (opts.mode && opts.mode !== t.mode) this.updateTab(t.id, { mode: opts.mode })
      } else {
        const back = t.path ? [...t.back, t.path].slice(-50) : t.back
        this.updateTab(t.id, { kind, path, mode: t.kind === 'note' && kind === 'note' ? t.mode : mode, back, fwd: [], cursor: undefined, scroll: undefined })
      }
    }
    if (opts.line !== undefined) this.pendingLine = { tabId: this.activeTab.id, line: opts.line }
    this.set({ navTick: this.state.navTick + 1 })
  }

  pendingLine: { tabId: string; line: number } | null = null

  goBack(tabId = this.activeTab.id) {
    const t = this.findTab(tabId)
    if (!t || !t.back.length) return
    const prev = t.back[t.back.length - 1]
    this.updateTab(t.id, { path: prev, kind: isMd(prev) ? 'note' : 'file', back: t.back.slice(0, -1), fwd: t.path ? [t.path, ...t.fwd] : t.fwd, cursor: undefined, scroll: undefined })
    if (isMd(prev)) this.ensureBuffer(prev)
  }

  goForward(tabId = this.activeTab.id) {
    const t = this.findTab(tabId)
    if (!t || !t.fwd.length) return
    const next = t.fwd[0]
    this.updateTab(t.id, { path: next, kind: isMd(next) ? 'note' : 'file', fwd: t.fwd.slice(1), back: t.path ? [...t.back, t.path] : t.back, cursor: undefined, scroll: undefined })
    if (isMd(next)) this.ensureBuffer(next)
  }

  findTab(tabId: string) {
    for (const p of this.state.ws.panes) for (const t of p.tabs) if (t.id === tabId) return t
    return null
  }

  openGraph(where: 'tab' | 'new' = 'new') {
    const existing = this.state.ws.panes.flatMap((p) => p.tabs.map((t) => [p, t] as const)).find(([, t]) => t.kind === 'graph')
    if (existing) return this.selectTab(existing[0].id, existing[1].id)
    if (where === 'new' && this.activeTab.kind !== 'empty') this.newTab(undefined, { ...emptyTab(), kind: 'graph' })
    else this.updateTab(this.activeTab.id, { kind: 'graph', path: undefined })
  }

  /** Follow an internal link from `source`. Unresolved links create the note (reference behavior). */
  async followLink(target: string, source: string, newTab = false) {
    const [linkpath, sub = ''] = target.split('#')
    const resolved = this.index.resolve(linkpath, source)
    const where = newTab ? 'new' : 'tab'
    if (resolved) {
      let line: number | undefined
      if (sub && isMd(resolved)) {
        const h = this.index.notes.get(resolved)?.meta.headings.find((x) => x.text.toLowerCase() === sub.toLowerCase())
        line = h?.line
      }
      return this.open(resolved, where, { line })
    }
    if (!linkpath) return
    if (INVALID_NAME.test(basename(linkpath))) return this.notice('Cannot create a note with that name', true)
    const path = linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`
    await this.createNote({ path, where })
  }

  // ---------- buffers & saving ----------
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

  private setBuffer(path: string, b: Buffer | null) {
    const buffers = { ...this.state.buffers }
    if (b) buffers[path] = b
    else delete buffers[path]
    this.set({ buffers })
  }

  edit(path: string, content: string) {
    const b = this.state.buffers[path]
    if (!b || b.content === content) return
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
        this.notice(`${noteTitle(path)}: ${e.message}`, true)
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

  // ---------- external changes ----------
  private fsTimer = 0
  private async onFsChanged(paths: string[]) {
    clearTimeout(this.fsTimer)
    this.fsTimer = window.setTimeout(async () => {
      await this.refreshFiles()
      const existing = new Set(this.state.files.map((f) => f.path))
      for (const p of new Set(paths)) {
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
        try {
          const n = await api.read(p)
          const b = this.state.buffers[p]
          if (this.inflight.get(p) === n.content) continue
          if (b && n.content !== b.saved && n.mtime !== b.mtime) {
            if (b.content === b.saved) this.setBuffer(p, { content: n.content, saved: n.content, mtime: n.mtime })
            else if (n.content !== b.content) this.setBuffer(p, { ...b, conflict: 'modified' })
          } else if (b && b.mtime !== n.mtime && n.content === b.saved) {
            this.setBuffer(p, { ...b, mtime: n.mtime })
          }
          this.index.upsert(p, this.state.buffers[p]?.content ?? n.content)
        } catch { /* raced with deletion */ }
      }
      this.set({ indexVersion: this.state.indexVersion + 1 })
    }, 100)
  }

  async refreshFiles() {
    try {
      const files = await api.list()
      this.index.setFiles(files.filter((f) => f.type === 'file').map((f) => f.path))
      for (const p of [...this.index.notes.keys()]) if (!files.some((f) => f.path === p)) this.index.remove(p)
      this.set({ files, indexVersion: this.state.indexVersion + 1 })
    } catch (e) {
      this.error(e)
    }
  }

  private closeTabsFor(path: string) {
    for (const p of this.state.ws.panes) for (const t of p.tabs) if (t.path === path) this.closeTab(p.id, t.id)
  }

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
    const path = opts.path ?? uniqueName(existing, opts.folder ?? this.newNoteFolder(), 'Untitled', '.md')
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

  private ancestors(folder: string) {
    const out: Record<string, boolean> = {}
    const parts = folder.split('/')
    for (let i = 1; i <= parts.length; i++) out[parts.slice(0, i).join('/')] = true
    return out
  }

  async createFolder(parent = '') {
    const name = await this.prompt('New folder name', '', 'Create')
    if (!name) return
    if (INVALID_NAME.test(name) || name.startsWith('.')) return this.notice('Invalid folder name', true)
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
    const next = await this.prompt(isFolder ? 'Rename folder' : 'Rename file', shown, 'Rename')
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
      this.notice('Names cannot be empty, start with "." or contain \\ / : * ? " < > | # ^ [ ]', true)
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
    if (count) this.notice(`Updated links in ${count} note${count > 1 ? 's' : ''}`)
    this.set({ indexVersion: this.state.indexVersion + 1 })
  }

  async remove(path: string) {
    const isFolder = this.state.files.some((f) => f.path === path && f.type === 'folder')
    if (this.prefs.promptDelete) {
      const ok = await this.confirm(isFolder ? 'Delete folder' : 'Delete file', `Move "${basename(path)}"${isFolder ? ' and everything inside it' : ''} to the system trash?`)
      if (!ok) return
    }
    try {
      await api.trash(path)
    } catch (e) {
      return this.error(e)
    }
    const gone = (p?: string) => !!p && (p === path || p.startsWith(path + '/'))
    for (const p of Object.keys(this.state.buffers)) if (gone(p)) clearTimeout(this.saveTimers.get(p))
    const buffers = Object.fromEntries(Object.entries(this.state.buffers).filter(([p]) => !gone(p)))
    this.set({ buffers })
    for (const pane of this.state.ws.panes) for (const t of pane.tabs) if (gone(t.path)) this.closeTab(pane.id, t.id)
    this.mapTabs((t) => ({ ...t, back: t.back.filter((p) => !gone(p)), fwd: t.fwd.filter((p) => !gone(p)) }))
    await this.refreshFiles()
  }

  /** Save a pasted/dropped attachment into the attachment folder and return its vault path. */
  async saveAttachment(name: string, data: Uint8Array, notePath: string): Promise<string | null> {
    const setting = this.state.snap?.vault?.settings.attachmentFolder ?? ''
    const folder = setting === './' ? dirOf(notePath) : setting.replace(/^\/+|\/+$/g, '')
    const dot = name.lastIndexOf('.')
    const base = (dot > 0 ? name.slice(0, dot) : name).replace(INVALID_NAME, '-') || 'Pasted image'
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

  // ---------- vaults ----------
  async switchVault(action: () => Promise<unknown>) {
    const ok = await this.flushAll()
    if (!ok && !(await this.confirm('Unsaved changes', 'Some notes could not be saved. Switch vault anyway?', 'Switch'))) return
    try {
      await action()
    } catch (e) {
      this.error(e)
    }
  }

  toggleExpanded(path: string, value?: boolean) {
    this.set({ expanded: { ...this.state.expanded, [path]: value ?? !this.state.expanded[path] } })
    this.persistWorkspace()
  }
}

export const model = new Model()
;(window as unknown as { __synapse: Model }).__synapse = model // debugging / e2e inspection

export function useModel<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(model.subscribe, () => sel(model.state))
}

// Late-bound to avoid an import cycle with commands.ts
let runCommandById: (id: string) => void = () => {}
export function setCommandRunner(fn: (id: string) => void) {
  runCommandById = fn
}
