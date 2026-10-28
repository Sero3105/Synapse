// Central renderer state + actions. Components subscribe with useModel(selector).
import { useSyncExternalStore } from 'react'
import type { EditorView } from '@codemirror/view'
import { api, ApiError, Snapshot, FileEntry, setFileHost } from './api'
import type { UpdateInfo } from '../shared/update'
import { NoteIndex, rewriteLinks, buildLookup, uniqueName, INVALID_NAME, basename, noteTitle, headingRef } from '../shared/markdown'
import { isObj, Prefs, Layout, GraphSettings, SavedGraphView } from '../shared/settings'
import { LayoutNode, MAX_PANES, splitLeaf, removeLeaf, setSizes, leaves, toSaved, fromSaved } from '../shared/layout'
import { t, tn, Key, type LanguagePref } from '../shared/i18n'
import { TEMPLATE_FOLDER, DAILY_TEMPLATE, BUILTIN_TEMPLATES, isoDate, fillTemplate, dailyNotePath, adjacentDaily, dailyDate } from '../shared/templates'
import { merge3, assembleMerge, type MergePart } from '../shared/merge'

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
  /** kept at the left, shrunk to its icon, skipped by "close others" */
  pinned?: boolean
  /** VS Code-style preview: reused by the next file-tree click until kept (double-click, tab double-click or typing in it) */
  preview?: boolean
}
export interface Pane { id: string; tabs: Tab[]; active: string }
/** `layout` places the panes; `panes` holds them in creation order. */
export interface Workspace { panes: Pane[]; activePane: string; layout: LayoutNode }

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
  | { kind: 'templates'; mode: 'insert' | 'new' }
  | { kind: 'history'; path: string }
  | { kind: 'attachments' }
  | { kind: 'import'; folder: string }
  | { kind: 'merge'; path: string; parts: MergePart[]; mine: string; theirs: string }
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; okText?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; okText: string; danger?: boolean; resolve: (ok: boolean) => void }

/** A built-in template (`id`) or a note in the Templates folder (`path`). */
export interface Template { name: string; id?: (typeof BUILTIN_TEMPLATES)[number]; path?: string }

/** `checked` makes the item one choice of a dropdown (a tick marks the current one). */
export interface MenuItem { label: string; run?: () => void; danger?: boolean; separator?: boolean; disabled?: boolean; checked?: boolean }

export interface State {
  snap: Snapshot | null
  loading: boolean
  files: FileEntry[]
  indexVersion: number
  buffers: Record<string, Buffer>
  ws: Workspace
  modal: Modal | null
  menu: { x: number; y: number; items: MenuItem[]; minWidth?: number } | null
  notices: { id: number; text: string; error?: boolean }[]
  /** a newer release found on GitHub at launch; null once dismissed */
  update: UpdateInfo | null
  searchQuery: string
  expanded: Record<string, boolean>
  /** tab whose inline title should be focused (new note) */
  focusTitle: string | null
  /** bumped when a line jump is requested */
  navTick: number
  /** caret of the focused editor, for the status bar */
  cursor: { line: number; col: number } | null
  /** recently opened files in this vault, newest first */
  recent: string[]
  /** notes pinned to the start page (empty tab), per vault */
  pinned: string[]
  /** related-note suggestions the user dismissed, as "a\u0000b" pairs (sorted), per vault */
  dismissedRelated: string[]
}

let uid = 0
export const newId = () => `${Date.now().toString(36)}${(uid++).toString(36)}`
const emptyTab = (): Tab => ({ id: newId(), kind: 'empty', mode: 'source', back: [], fwd: [] })
const defaultWs = (): Workspace => {
  const t = emptyTab()
  const p = { id: newId(), tabs: [t], active: t.id }
  return { panes: [p], activePane: p.id, layout: p.id }
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
export const isMd = (p: string) => /\.md$/i.test(p)
/** Window width (px) under which the side docks float over the note; matches the CSS media query. */
export const NARROW = 720
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
    update: null,
    searchQuery: '',
    expanded: {},
    focusTitle: null,
    navTick: 0,
    cursor: null,
    recent: [],
    pinned: [],
    dismissedRelated: [],
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
    // shrinking the window under NARROW with both docks open would hide the note behind them
    window.addEventListener('resize', () => {
      const l = this.state.snap?.global.layout
      if (window.innerWidth <= NARROW && l?.leftOpen && l.rightOpen) this.setLayout({ rightOpen: false })
    })
    api.on('state', (s) => this.onSnapshot(s as Snapshot))
    api.on('fs:changed', (paths) => this.onFsChanged(paths as string[]))
    api.on('command', (id) => runCommandById(String(id)))
    api.on('app:flush', async () => api.flushed(await this.flushAll()))
    await this.onSnapshot(await api.state())
    api.checkUpdate().then((update) => update && this.set({ update }), () => {})
  }

  private async onSnapshot(s: Snapshot) {
    const changedVault = (s.vault?.id ?? null) !== this.vaultId || (s.vault && s.vault.path !== this.state.snap?.vault?.path)
    this.set({ snap: s })
    if (!changedVault) return
    if (this.vaultId) await this.flushAll()
    this.vaultId = s.vault?.id ?? null
    if (s.vault) setFileHost(s.vault.id)
    if (!s.vault) {
      this.set({ files: [], buffers: {}, ws: defaultWs(), loading: false, recent: [], pinned: [], dismissedRelated: [], cursor: null })
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
      this.set({ files, ws: restored.ws, expanded: restored.expanded, recent: restored.recent, pinned: restored.pinned, dismissedRelated: restored.dismissedRelated, indexVersion: this.state.indexVersion + 1, loading: false })
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
  private restoreWorkspace(raw: unknown, existing: Set<string>): { ws: Workspace; expanded: Record<string, boolean>; recent: string[]; pinned: string[]; dismissedRelated: string[] } {
    const paths = (k: string, max: number) => (isObj(raw) && Array.isArray(raw[k]) ? [...new Set((raw[k] as unknown[]).filter((p): p is string => typeof p === 'string' && existing.has(p)))].slice(0, max) : [])
    const recent = paths('recent', 20)
    const pinned = paths('pinned', 50)
    // pairs whose notes both still exist
    const dismissedRelated = isObj(raw) && Array.isArray(raw.dismissedRelated) ? raw.dismissedRelated.filter((k): k is string => typeof k === 'string' && k.split('\u0000').length === 2 && k.split('\u0000').every((p) => existing.has(p))).slice(-500) : []
    const fallback = { ws: defaultWs(), expanded: {}, recent, pinned, dismissedRelated }
    if (!isObj(raw) || !Array.isArray(raw.panes)) return fallback
    const panes: Pane[] = []
    const ids: (string | undefined)[] = [] // saved pane index -> restored pane id
    for (const p of raw.panes.slice(0, MAX_PANES)) {
      ids.push(undefined)
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
          pinned: t.pinned === true || undefined,
        })
      }
      if (!tabs.length) tabs.push(emptyTab())
      const activeIdx = typeof p.activeIndex === 'number' ? Math.min(Math.max(0, p.activeIndex), tabs.length - 1) : 0
      panes.push({ id: newId(), tabs, active: tabs[activeIdx].id })
      ids[ids.length - 1] = panes[panes.length - 1].id
    }
    if (!panes.length) return fallback
    const ai = typeof raw.activePaneIndex === 'number' ? Math.min(Math.max(0, raw.activePaneIndex), panes.length - 1) : 0
    // older files (and any layout that does not add up) put the panes in one row or column
    const sizes = Array.isArray(raw.paneSizes) && raw.paneSizes.length === panes.length && raw.paneSizes.every((n) => typeof n === 'number' && n > 0) ? (raw.paneSizes as number[]) : panes.map(() => 1)
    const layout = fromSaved(raw.layout, ids) ?? (panes.length === 1 ? panes[0].id : { dir: raw.direction === 'column' ? ('column' as const) : ('row' as const), children: panes.map((p) => p.id), sizes })
    const expanded: Record<string, boolean> = {}
    if (isObj(raw.expanded)) for (const [k, v] of Object.entries(raw.expanded)) if (v === true && existing.has(k)) expanded[k] = true
    return { ws: { panes, activePane: panes[ai].id, layout }, expanded, recent, pinned, dismissedRelated }
  }

  private persistWorkspace() {
    clearTimeout(this.wsTimer)
    this.wsTimer = window.setTimeout(() => this.saveWorkspaceNow(), 500)
  }

  private saveWorkspaceNow() {
    if (!this.vaultId) return Promise.resolve()
    const { ws, expanded, recent, pinned, dismissedRelated } = this.state
    const data = {
      layout: toSaved(ws.layout, new Map(ws.panes.map((p, i) => [p.id, i]))),
      activePaneIndex: ws.panes.findIndex((p) => p.id === ws.activePane),
      panes: ws.panes.map((p) => ({
        activeIndex: p.tabs.findIndex((t) => t.id === p.active),
        tabs: p.tabs.map(({ kind, path, mode, back, fwd, cursor, scroll, pinned }) => ({ kind, path, mode, back, fwd, cursor, scroll, pinned })),
      })),
      expanded,
      recent,
      pinned,
      dismissedRelated,
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
    this.notice(errorText(e), true)
  }

  prompt(title: string, value = '', okText = t('common.save')): Promise<string | null> {
    return new Promise((resolve) => this.set({ modal: { kind: 'prompt', title, value, okText, resolve } }))
  }

  confirm(title: string, message: string, okText = t('common.delete'), danger = true): Promise<boolean> {
    return new Promise((resolve) => this.set({ modal: { kind: 'confirm', title, message, okText, danger, resolve } }))
  }

  openMenu(e: { clientX: number; clientY: number; preventDefault(): void }, items: MenuItem[], minWidth?: number) {
    e.preventDefault()
    this.set({ menu: { x: e.clientX, y: e.clientY, items, minWidth } })
  }

  // ---------- settings ----------
  async setGlobal(patch: { language?: LanguagePref; prefs?: Partial<Prefs>; layout?: Partial<Layout>; hotkeys?: Record<string, string[] | null>; checkUpdates?: boolean }) {
    try {
      await api.updateGlobal(patch)
    } catch (e) {
      this.error(e)
    }
  }

  async setVault(patch: { overrides?: Record<string, unknown>; graph?: Partial<GraphSettings>; graphViews?: SavedGraphView[]; graphColors?: Record<string, string>; attachmentFolder?: string }) {
    try {
      await api.updateVault(patch)
    } catch (e) {
      this.error(e)
    }
  }

  /** Layout changes (sidebar sizes etc.) are applied locally at once and persisted globally. */
  setLayout(patch: Partial<Layout>) {
    // below NARROW both docks float over the note: opening one closes the other, or the note disappears
    if (window.innerWidth <= NARROW) {
      if (patch.leftOpen && patch.rightOpen === undefined) patch = { ...patch, rightOpen: false }
      else if (patch.rightOpen && patch.leftOpen === undefined) patch = { ...patch, leftOpen: false }
    }
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
    // pinned tabs always lead their pane, whatever opened or moved a tab
    const order = (p: Pane) => (p.tabs.some((t, i) => t.pinned && i > 0 && !p.tabs[i - 1].pinned) ? { ...p, tabs: [...p.tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)) } : p)
    ws = { ...ws, panes: ws.panes.map(order) }
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
    if (!tabs.length && ws.panes.length > 1) return this.closePane(paneId)
    if (!tabs.length) tabs.push(emptyTab())
    const active = pane.active === tabId ? tabs[Math.min(idx, tabs.length - 1)].id : pane.active
    this.setWs({ ...ws, panes: ws.panes.map((p) => (p.id === paneId ? { ...p, tabs, active } : p)) })
    const at = tabs.find((t) => t.id === active)
    if (at?.kind === 'note' && at.path) this.ensureBuffer(at.path)
  }

  closeOthers(paneId: string, tabId: string) {
    const pane = this.state.ws.panes.find((p) => p.id === paneId)
    for (const t of pane?.tabs ?? []) if (t.id !== tabId && !t.pinned) this.closeTab(paneId, t.id)
  }

  togglePinTab(tabId: string) {
    this.mapTabs((t) => (t.id === tabId ? { ...t, pinned: !t.pinned || undefined } : t))
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

  /** Remove an emptied pane; focus moves to the pane before it on screen. */
  private closePane(paneId: string) {
    const ws = this.state.ws
    const order = leaves(ws.layout)
    const layout = removeLeaf(ws.layout, paneId)
    if (!layout) return
    const panes = ws.panes.filter((p) => p.id !== paneId)
    const i = order.indexOf(paneId)
    const activePane = ws.activePane !== paneId ? ws.activePane : order[i - 1] ?? order[i + 1]
    this.setWs({ ...ws, panes, layout, activePane })
  }

  split(direction: 'row' | 'column', path?: string) {
    const ws = this.state.ws
    if (ws.panes.length >= MAX_PANES) return this.notice(t('notice.maxPanes', { n: MAX_PANES }))
    const src = this.activeTab
    const tab: Tab = path ? { ...emptyTab(), kind: 'note', path, mode: this.prefs.defaultViewMode } : { ...src, id: newId(), back: [...src.back], fwd: [...src.fwd] }
    const pane: Pane = { id: newId(), tabs: [tab], active: tab.id }
    // the new pane goes next to the active one, splitting only its space
    this.setWs({ ...ws, panes: [...ws.panes, pane], layout: splitLeaf(ws.layout, ws.activePane, pane.id, direction), activePane: pane.id })
    if (tab.path && tab.kind === 'note') this.ensureBuffer(tab.path)
  }

  /** Sizes of the split at `path` (child indexes from the root of the layout). */
  setPaneSizes(path: number[], sizes: number[]) {
    this.setWs({ ...this.state.ws, layout: setSizes(this.state.ws.layout, path, sizes) })
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
    let layout = ws.layout
    const empty = panes.find((p) => !p.tabs.length)
    if (empty) {
      panes = panes.filter((p) => p !== empty)
      layout = removeLeaf(layout, empty.id) ?? layout
    }
    this.setWs({ ...ws, panes, layout, activePane: toPane })
  }

  // ---------- opening & navigation ----------
  /**
   * Open a vault path. `where`: 'tab' (current tab), 'new' (new tab), 'split' (new pane).
   * `line` scrolls to and selects a line once the editor is ready.
   */
  async open(path: string, where: 'tab' | 'new' | 'split' = 'tab', opts: { line?: number; mode?: ViewMode; preview?: boolean } = {}) {
    if (!this.state.files.some((f) => f.path === path && f.type === 'file')) return this.notice(t('notice.fileNotFound', { path }), true)
    const kind: Tab['kind'] = isMd(path) ? 'note' : 'file'
    if (kind === 'note') this.ensureBuffer(path)
    if (where === 'split') return this.split('row', path)
    const mode = opts.mode ?? this.prefs.defaultViewMode
    if (where === 'tab' && opts.preview) return this.openPreview(path, kind, mode)
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
    this.set({ recent: [path, ...this.state.recent.filter((p) => p !== path)].slice(0, 20) })
    if (opts.line !== undefined) this.pendingLine = { tabId: this.activeTab.id, line: opts.line }
    this.set({ navTick: this.state.navTick + 1 })
  }

  /**
   * Preview open (file-tree single click): reuse this pane's preview tab if it has one, turn an
   * empty tab into the preview, or add a preview tab beside the current one. Never replaces a
   * kept tab. A file already open in this pane is only selected, never duplicated.
   */
  private openPreview(path: string, kind: Tab['kind'], mode: ViewMode) {
    const pane = this.activePane
    const same = pane.tabs.find((x) => x.path === path && x.kind === kind)
    if (same) {
      this.selectTab(pane.id, same.id)
    } else {
      const pv = pane.tabs.find((x) => x.preview)
      if (pv) {
        this.selectTab(pane.id, pv.id)
        const back = pv.path ? [...pv.back, pv.path].slice(-50) : pv.back
        this.updateTab(pv.id, { kind, path, mode, back, fwd: [], cursor: undefined, scroll: undefined })
      } else if (this.activeTab.kind === 'empty') {
        this.updateTab(this.activeTab.id, { kind, path, mode, preview: true })
      } else {
        this.newTab(pane.id, { ...emptyTab(), kind, path, mode, preview: true })
      }
    }
    this.set({ recent: [path, ...this.state.recent.filter((p) => p !== path)].slice(0, 20), navTick: this.state.navTick + 1 })
  }

  /** File-tree double click: open for good, or keep the preview tab already showing this file. */
  async openPermanent(path: string) {
    const pane = this.activePane
    const same = pane.tabs.find((x) => x.path === path)
    if (same) {
      this.selectTab(pane.id, same.id)
      this.keepTab(same.id)
      this.set({ recent: [path, ...this.state.recent.filter((p) => p !== path)].slice(0, 20), navTick: this.state.navTick + 1 })
      return
    }
    return this.open(path, 'new')
  }

  /** Keep a preview tab for good (VS Code: double-click, or it sticks once you type in it). */
  keepTab(tabId: string) {
    this.mapTabs((x) => (x.id === tabId && x.preview ? { ...x, preview: undefined } : x))
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

  /** Switch the graph between the whole vault and the open note's neighbourhood, showing it. */
  toggleLocalGraph() {
    const g = this.state.snap?.vault?.settings.graph
    if (!g) return
    this.setVault({ graph: { local: !g.local } })
    this.openGraph()
  }

  openGraph(where: 'tab' | 'new' = 'new') {
    const existing = this.state.ws.panes.flatMap((p) => p.tabs.map((t) => [p, t] as const)).find(([, t]) => t.kind === 'graph')
    if (existing) return this.selectTab(existing[0].id, existing[1].id)
    if (where === 'new' && this.activeTab.kind !== 'empty') this.newTab(undefined, { ...emptyTab(), kind: 'graph' })
    else this.updateTab(this.activeTab.id, { kind: 'graph', path: undefined })
  }

  /** Follow an internal link from `source`. Unresolved links create the note (reference behavior). */
  async followLink(target: string, source: string, newTab = false) {
    let [linkpath, sub = ''] = target.split('#')
    // [[Note^id]] is the block form of [[Note#^id]]; keep the ^ in `sub` for both
    if (!sub && linkpath.includes('^')) {
      const i = linkpath.indexOf('^')
      sub = linkpath.slice(i)
      linkpath = linkpath.slice(0, i)
    }
    // [[#Heading]] points into the note it is written in
    const resolved = linkpath ? this.index.resolve(linkpath, source) : source || null
    const where = newTab ? 'new' : 'tab'
    if (resolved) {
      let line: number | undefined
      if (sub && isMd(resolved)) {
        const meta = this.index.notes.get(resolved)?.meta
        if (sub.startsWith('^')) {
          const want = sub.slice(1).toLowerCase()
          line = meta?.blocks.find((b) => b.id.toLowerCase() === want)?.line
        } else {
          const want = headingRef(sub).toLowerCase()
          line = meta?.headings.find((x) => headingRef(x.text).toLowerCase() === want)?.line
        }
      }
      return this.open(resolved, where, { line })
    }
    if (!linkpath) return
    if (INVALID_NAME.test(basename(linkpath))) return this.notice(t('notice.cannotCreate'), true)
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

  // ---------- start page: recent & pinned ----------
  togglePin(path: string) {
    const pinned = this.state.pinned.includes(path) ? this.state.pinned.filter((p) => p !== path) : [...this.state.pinned, path]
    this.set({ pinned })
    this.persistWorkspace()
  }

  /** Forget a recent entry; the file itself is untouched. */
  forgetRecent(path: string) {
    this.set({ recent: this.state.recent.filter((p) => p !== path) })
    this.persistWorkspace()
  }

  /** Hide one related-note suggestion for this pair of notes (per vault, persisted). */
  dismissRelated(a: string, b: string) {
    const key = [a, b].sort().join('\u0000')
    if (this.state.dismissedRelated.includes(key)) return
    this.set({ dismissedRelated: [...this.state.dismissedRelated, key].slice(-500) })
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

  // ---------- vaults ----------
  async switchVault(action: () => Promise<unknown>) {
    const ok = await this.flushAll()
    if (!ok && !(await this.confirm(t('dialog.unsavedTitle'), t('dialog.unsavedBody'), t('common.switch')))) return
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

/** User-facing error text: known filesystem error codes are translated, anything else keeps its message. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `error.${e.code}` as Key
    const text = t(key)
    if (text !== key) return text
  }
  return e instanceof Error ? e.message : String(e)
}
