// Model: panes and tabs, opening files, back/forward, the graph tab and following links.
import { INVALID_NAME, basename, headingRef } from '../shared/markdown'
import { MAX_PANES, splitLeaf, removeLeaf, setSizes, leaves } from '../shared/layout'
import { t } from '../shared/i18n'
import { BufferModel } from './model-buffers'
import { Tab, Pane, ViewMode, newId, emptyTab, isMd } from './model-types'

/** "Note#Heading" -> ["Note", "Heading"]; [[Note^id]] is the block form of [[Note#^id]], so the ^ stays in the second part for both. */
function splitLink(target: string): [string, string] {
  const [linkpath, sub = ''] = target.split('#')
  const i = linkpath.indexOf('^')
  return !sub && i >= 0 ? [linkpath.slice(0, i), linkpath.slice(i)] : [linkpath, sub]
}

export abstract class WorkspaceModel extends BufferModel {
  private closedTabs: { paneId: string; tab: Tab }[] = []

  /** Creating notes belongs to the files layer; following an unresolved link uses it. */
  abstract createNote(opts?: { folder?: string; path?: string; where?: 'tab' | 'new' | 'split'; content?: string }): Promise<string | null>

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
        // a note replacing a note keeps the tab's view, unless the caller asked for one
        this.updateTab(t.id, { kind, path, mode: opts.mode ?? (t.kind === 'note' && kind === 'note' ? t.mode : mode), back, fwd: [], cursor: undefined, scroll: undefined })
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

  /** Where an internal link written in `source` points: the file and, for `#Heading` or `^block`, its line. Null if unresolved. */
  linkTarget(target: string, source: string): { path: string; line?: number } | null {
    const [linkpath, sub] = splitLink(target)
    // [[#Heading]] points into the note it is written in
    const resolved = linkpath ? this.index.resolve(linkpath, source) : source || null
    if (!resolved) return null
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
    return { path: resolved, line }
  }

  /** Follow an internal link from `source`. Unresolved links create the note (reference behavior). */
  async followLink(target: string, source: string, newTab = false) {
    const where = newTab ? 'new' : 'tab'
    const hit = this.linkTarget(target, source)
    if (hit) return this.open(hit.path, where, { line: hit.line })
    const [linkpath] = splitLink(target)
    if (!linkpath) return
    if (INVALID_NAME.test(basename(linkpath))) return this.notice(t('notice.cannotCreate'), true)
    const path = linkpath.endsWith('.md') ? linkpath : `${linkpath}.md`
    await this.createNote({ path, where })
  }

  protected closeTabsFor(path: string) {
    for (const p of this.state.ws.panes) for (const t of p.tabs) if (t.path === path) this.closeTab(p.id, t.id)
  }
}
