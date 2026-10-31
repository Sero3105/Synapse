// Central renderer state + actions. Components subscribe with useModel(selector).
// The model is split by topic, each layer extending the one before:
//   model-types      types and helpers
//   model-base       state, notices, settings, workspace primitives
//   model-buffers    buffers, saving, conflicts, external changes
//   model-workspace  panes, tabs, opening, navigation, links
//   model-files      files and folders, daily notes, templates
//   model.ts         boot, workspace restore, start page, vault switching
import { useSyncExternalStore } from 'react'
import { api, Snapshot, setFileHost } from './api'
import { NoteIndex } from '../shared/markdown'
import { isObj } from '../shared/settings'
import { t } from '../shared/i18n'
import { MAX_PANES, fromSaved } from '../shared/layout'
import { FileModel } from './model-files'
import { State, Workspace, Pane, Tab, newId, emptyTab, defaultWs, NARROW } from './model-types'

export * from './model-types'

class Model extends FileModel {
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
    api.on('open-file', () => this.openPendingFile())
    await this.onSnapshot(await api.state())
    // hourly: the Mac app stays open for weeks; main asks GitHub at most once a day
    const checkUpdate = () => api.checkUpdate().then((update) => update && this.set({ update }), () => {})
    checkUpdate()
    setInterval(checkUpdate, 60 * 60_000)
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
      this.openPendingFile()
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

  /** A note opened from Finder: main keeps it until this window's vault has loaded. */
  private async openPendingFile() {
    if (this.state.loading || !this.vaultId) return
    const p = await api.takePendingFile().catch(() => null)
    if (!p) return
    // a note just created by a synapse:// link or the menu bar may not be listed yet
    if (!this.state.files.some((f) => f.path === p)) await this.refreshFiles()
    await this.open(p, 'tab').catch((e) => this.error(e))
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
