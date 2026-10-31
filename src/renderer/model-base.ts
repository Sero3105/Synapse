// Model core: state and subscriptions, notices and dialogs, settings, and the workspace
// primitives every other layer builds on (active pane/tab, tab updates, persisting the workspace).
import type { EditorView } from '@codemirror/view'
import { api } from './api'
import { NoteIndex } from '../shared/markdown'
import type { Prefs, Layout, GraphSettings, SavedGraphView, CaptureSettings } from '../shared/settings'
import { toSaved } from '../shared/layout'
import { t, type LanguagePref } from '../shared/i18n'
import { State, Pane, Tab, Workspace, MenuItem, newId, defaultWs, NARROW, errorText } from './model-types'

export abstract class ModelBase {
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
  protected wsTimer = 0
  protected vaultId: string | null = null

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
  async setGlobal(patch: { language?: LanguagePref; prefs?: Partial<Prefs>; layout?: Partial<Layout>; hotkeys?: Record<string, string[] | null>; checkUpdates?: boolean; capture?: Partial<CaptureSettings>; menuBarIcon?: boolean }) {
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

  // ---------- workspace ----------
  protected persistWorkspace() {
    clearTimeout(this.wsTimer)
    this.wsTimer = window.setTimeout(() => this.saveWorkspaceNow(), 500)
  }

  protected saveWorkspaceNow() {
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

  protected setWs(ws: Workspace) {
    // pinned tabs always lead their pane, whatever opened or moved a tab
    const order = (p: Pane) => (p.tabs.some((t, i) => t.pinned && i > 0 && !p.tabs[i - 1].pinned) ? { ...p, tabs: [...p.tabs].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned)) } : p)
    ws = { ...ws, panes: ws.panes.map(order) }
    this.set({ ws })
    this.persistWorkspace()
  }

  protected mapTabs(fn: (t: Tab, p: Pane) => Tab) {
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
}
