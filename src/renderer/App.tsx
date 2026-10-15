import { useEffect, useMemo, useState } from 'react'
import { PanelLeft, PanelRight, FileSearch, Waypoints, Terminal, FilePlus, Settings, ChevronsUpDown } from 'lucide-react'
import { model, useModel } from './model'
import { api } from './api'
import { Workspace } from './components/Workspace'
import { LeftSidebar, RightSidebar } from './components/Sidebars'
import { Modals, ContextMenu, Notices, VaultManager } from './components/Modals'
import { runCommand } from './commands'
import { wordCount } from '../shared/markdown'
import type { Prefs, Layout } from '../shared/settings'

const SYSTEM_FONT = `-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", "Helvetica Neue", sans-serif`
const MONO_FONT = `ui-monospace, "SF Mono", Menlo, Monaco, monospace`
const quoteFont = (f: string) => (f.trim() ? `"${f.trim().replace(/["\\;{}]/g, '')}", ` : '')

/** Theme + typography from effective prefs -> CSS custom properties on <body>. */
function useApplyPrefs(prefs: Prefs | undefined) {
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setSystemDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  useEffect(() => {
    const p = prefs
    const dark = !p || p.theme === 'dark' || (p.theme === 'system' && systemDark)
    document.body.classList.toggle('theme-dark', dark)
    document.body.classList.toggle('theme-light', !dark)
    if (!p) return
    const s = document.body.style
    s.setProperty('--accent', p.accentColor)
    s.setProperty('--font-text-size', `${p.fontSize}px`)
    s.setProperty('--font-ui-size', `${p.interfaceFontSize}px`)
    s.setProperty('--font-text', quoteFont(p.textFont) + SYSTEM_FONT)
    s.setProperty('--font-monospace', quoteFont(p.monoFont) + MONO_FONT)
  }, [prefs, systemDark])
}

export function App() {
  const snap = useModel((s) => s.snap)
  const loading = useModel((s) => s.loading)
  useApplyPrefs(snap?.prefs)

  if (!snap) return <div className="app-loading" />
  if (!snap.vault)
    return (
      <div className="starter">
        <div className="titlebar-drag" />
        <VaultManager />
        <Modals />
        <ContextMenu />
        <Notices />
      </div>
    )
  return (
    <>
      <Shell loading={loading} />
      <Modals />
      <ContextMenu />
      <Notices />
    </>
  )
}

function Shell({ loading }: { loading: boolean }) {
  const layout = useModel((s) => s.snap!.global.layout)
  const plugins = useModel((s) => s.snap!.prefs.corePlugins)
  const [live, setLive] = useState<Partial<Layout>>({})
  const L = { ...layout, ...live }

  /** Drag a sidebar edge: update locally while dragging, persist once on release. */
  const resize = (side: 'left' | 'right') => (e: React.PointerEvent) => {
    e.preventDefault()
    const start = e.clientX
    const key = side === 'left' ? 'leftWidth' : 'rightWidth'
    const initial = layout[key]
    let last = initial
    document.body.classList.add('is-resizing')
    const move = (ev: PointerEvent) => {
      const d = side === 'left' ? ev.clientX - start : start - ev.clientX
      last = Math.round(Math.min(800, Math.max(160, initial + d)))
      setLive({ [key]: last })
    }
    const up = () => {
      document.body.classList.remove('is-resizing')
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      model.setLayout({ [key]: last })
      setLive({})
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const ribbonW = L.showRibbon ? 44 : 0
  return (
    <div className={`app-container${L.leftOpen ? '' : ' left-collapsed'}${L.rightOpen ? '' : ' right-collapsed'}`} style={{ '--ribbon-width': `${ribbonW}px` } as React.CSSProperties}>
      <div className="titlebar-controls left">
        <button className="icon-btn" aria-label="Toggle left sidebar" aria-pressed={L.leftOpen} onClick={() => runCommand('app:toggle-left-sidebar')}>
          <PanelLeft size={18} />
        </button>
      </div>
      <div className="titlebar-controls right">
        <button className="icon-btn" aria-label="Toggle right sidebar" aria-pressed={L.rightOpen} onClick={() => runCommand('app:toggle-right-sidebar')}>
          <PanelRight size={18} />
        </button>
      </div>
      {L.showRibbon && (
        <div className="ribbon" role="toolbar" aria-label="Ribbon" aria-orientation="vertical">
          <div className="ribbon-top">
            <button className="icon-btn" aria-label="Open quick switcher" title="Open quick switcher" onClick={() => runCommand('switcher:open')}>
              <FileSearch size={18} />
            </button>
            {plugins.graph && (
              <button className="icon-btn" aria-label="Open graph view" title="Open graph view" onClick={() => runCommand('graph:open')}>
                <Waypoints size={18} />
              </button>
            )}
            <button className="icon-btn" aria-label="Create new note" title="Create new note" onClick={() => runCommand('file-explorer:new-file')}>
              <FilePlus size={18} />
            </button>
            <button className="icon-btn" aria-label="Open command palette" title="Open command palette" onClick={() => runCommand('command-palette:open')}>
              <Terminal size={18} />
            </button>
          </div>
        </div>
      )}
      {L.leftOpen && (
        <>
          <div className="side-dock left" style={{ width: L.leftWidth }}>
            <LeftSidebar />
            <VaultSwitcher />
          </div>
          <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize left sidebar" onPointerDown={resize('left')} />
        </>
      )}
      <main className="workspace">{loading ? <div className="view-loading">Loading vault…</div> : <Workspace />}</main>
      {L.rightOpen && (
        <>
          <div className="sidebar-resizer" role="separator" aria-orientation="vertical" aria-label="Resize right sidebar" onPointerDown={resize('right')} />
          <div className="side-dock right" style={{ width: L.rightWidth }}>
            <RightSidebar />
          </div>
        </>
      )}
      <StatusBar />
    </div>
  )
}

function VaultSwitcher() {
  const snap = useModel((s) => s.snap!)
  const others = snap.vaults.filter((v) => v.id !== snap.vault!.id && v.available)
  return (
    <div className="vault-profile">
      <button
        className="vault-switcher"
        aria-label="Switch vault"
        onClick={(e) =>
          model.openMenu(e, [
            ...others.slice(0, 8).map((v) => ({ label: v.name, run: () => model.switchVault(() => api.openVaultId(v.id)) })),
            ...(others.length ? [{ separator: true, label: '' }] : []),
            { label: 'Manage vaults…', run: () => model.set({ modal: { kind: 'vaults' } }) },
          ])
        }
      >
        <ChevronsUpDown size={14} />
        <span className="vault-name">{snap.vault!.name}</span>
      </button>
      <button className="icon-btn" aria-label="Settings" title="Settings (⌘,)" onClick={() => runCommand('app:open-settings')}>
        <Settings size={16} />
      </button>
    </div>
  )
}

function StatusBar() {
  const path = useModel(() => (model.activeTab.kind === 'note' ? model.activeTab.path ?? null : null))
  const content = useModel((s) => (path ? s.buffers[path]?.content : undefined))
  const dirty = useModel((s) => (path ? !!s.buffers[path] && s.buffers[path].content !== s.buffers[path].saved : false))
  const indexVersion = useModel((s) => s.indexVersion)
  const plugins = useModel((s) => s.snap!.prefs.corePlugins)
  const counts = useMemo(() => (content !== undefined ? wordCount(content) : null), [content])
  const backlinks = useMemo(() => (path && plugins.backlinks ? model.index.backlinks(path).length : 0), [path, indexVersion, plugins.backlinks])
  if (!path) return null
  return (
    <div className="status-bar" data-testid="status-bar">
      {plugins.backlinks && (
        <button className="status-bar-item" onClick={() => runCommand('backlink:open')}>
          {backlinks} backlink{backlinks === 1 ? '' : 's'}
        </button>
      )}
      {plugins.wordCount && counts && (
        <span className="status-bar-item">
          {counts.words.toLocaleString()} word{counts.words === 1 ? '' : 's'} {counts.chars.toLocaleString()} character{counts.chars === 1 ? '' : 's'}
        </span>
      )}
      <span className="status-bar-item" data-testid="save-state">{dirty ? 'Unsaved' : 'Saved'}</span>
    </div>
  )
}
