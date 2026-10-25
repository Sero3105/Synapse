import { Fragment, useEffect, useMemo, useState } from 'react'
import { PanelLeft, PanelRight } from 'lucide-react'
import { model, useModel } from './model'
import { Workspace } from './components/Workspace'
import { Navigator, ContextPanel } from './components/Sidebars'
import { Modals, ContextMenu, Notices, VaultManager } from './components/Modals'
import { runCommand } from './commands'
import { loadCustomFonts } from './fonts'
import { wordCount } from '../shared/markdown'
import type { Prefs, Layout } from '../shared/settings'
import { t, tn, setLanguage, resolveLanguage } from '../shared/i18n'

const SANS = `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`
const SERIF = `ui-serif, "New York", "Iowan Old Style", Charter, Georgia, serif`
const MONO = `ui-monospace, "SF Mono", Menlo, monospace` // taste-skill-ignore: code blocks only
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
    s.setProperty('--font-ui', SANS)
    s.setProperty('--font-text', quoteFont(p.textFont) + SERIF)
    s.setProperty('--font-mono', quoteFont(p.monoFont) + MONO) // taste-skill-ignore: code blocks only
  }, [prefs, systemDark])
}

export function App() {
  const snap = useModel((s) => s.snap)
  const loading = useModel((s) => s.loading)
  useApplyPrefs(snap?.prefs)
  // Resolve before rendering children so every t() call below uses the new language.
  const lang = resolveLanguage(snap?.global.language, navigator.languages)
  setLanguage(lang)
  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])
  // fonts the user added in Settings → Appearance, so notes can use them right away
  useEffect(() => {
    loadCustomFonts().catch((e) => console.warn('custom fonts', e))
  }, [])

  if (!snap) return <div className="app-loading" />
  // keyed by language: a language switch re-renders every string at once
  if (!snap.vault)
    return (
      <div className="starter" key={lang}>
        <div className="titlebar-drag" />
        <VaultManager />
        <Modals />
        <ContextMenu />
        <Notices />
      </div>
    )
  return (
    <Fragment key={lang}>
      <Shell loading={loading} />
      <Modals />
      <ContextMenu />
      <Notices />
    </Fragment>
  )
}

function Shell({ loading }: { loading: boolean }) {
  const layout = useModel((s) => s.snap!.global.layout)
  const vaultId = useModel((s) => s.snap!.vault!.id)
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
      last = Math.round(Math.min(800, Math.max(200, initial + d)))
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

  const keyResize = (side: 'left' | 'right') => (e: React.KeyboardEvent) => {
    const key = side === 'left' ? 'leftWidth' : 'rightWidth'
    const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
    if (!step) return
    e.preventDefault()
    model.setLayout({ [key]: Math.min(800, Math.max(200, layout[key] + (side === 'left' ? step : -step))) })
  }

  return (
    <div
      className={`shell${L.leftOpen ? '' : ' left-collapsed'}${L.rightOpen ? '' : ' right-collapsed'}`}
      style={{ '--left-w': `${L.leftWidth}px`, '--right-w': `${L.rightWidth}px` } as React.CSSProperties}
      key={vaultId}
    >
      <div className="titlebar-controls left">
        <button className="icon-btn" aria-label={t('shell.toggleLeft')} aria-pressed={L.leftOpen} title={t('shell.toggleLeftTitle')} onClick={() => runCommand('app:toggle-left-sidebar')}>
          <PanelLeft size={16} strokeWidth={1.75} />
        </button>
      </div>
      <div className="titlebar-controls right">
        <button className="icon-btn" aria-label={t('shell.toggleRight')} aria-pressed={L.rightOpen} title={t('shell.toggleRightTitle')} onClick={() => runCommand('app:toggle-right-sidebar')}>
          <PanelRight size={16} strokeWidth={1.75} />
        </button>
      </div>

      <aside className={`dock dock-left${L.leftOpen ? ' is-open' : ''}`} inert={!L.leftOpen} aria-label={t('shell.navigator')}>
        <div className="dock-inner">
          <Navigator />
        </div>
      </aside>
      {L.leftOpen && <div className="dock-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('shell.resizeNavigator')} aria-valuenow={L.leftWidth} onPointerDown={resize('left')} onKeyDown={keyResize('left')} />}

      <main className="workspace">
        <div className="workspace-body">{loading ? <div className="view-loading">{t('shell.openingVault')}</div> : <Workspace />}</div>
        <StatusBar />
      </main>

      {L.rightOpen && <div className="dock-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t('shell.resizeContext')} aria-valuenow={L.rightWidth} onPointerDown={resize('right')} onKeyDown={keyResize('right')} />}
      <aside className={`dock dock-right${L.rightOpen ? ' is-open' : ''}`} inert={!L.rightOpen} aria-label={t('shell.noteContext')}>
        <div className="dock-inner">
          <ContextPanel />
        </div>
      </aside>
    </div>
  )
}

function StatusBar() {
  useModel((s) => s.ws)
  const tab = model.activeTab
  const path = tab.kind === 'note' ? tab.path ?? null : null
  const content = useModel((s) => (path ? s.buffers[path]?.content : undefined))
  const state = useModel((s) => {
    const b = path ? s.buffers[path] : undefined
    if (!b) return 'none'
    if (b.conflict) return 'conflict'
    return b.content !== b.saved ? 'unsaved' : 'saved'
  })
  const cursor = useModel((s) => s.cursor)
  const plugins = useModel((s) => s.snap!.prefs.corePlugins)
  const counts = useMemo(() => (content !== undefined ? wordCount(content) : null), [content])
  if (!path) return <footer className="status-bar" aria-hidden />
  return (
    <footer className="status-bar" data-testid="status-bar">
      <span className="status-item">{tab.mode === 'source' ? t('status.editing') : t('status.reading')}</span>
      {tab.mode === 'source' && cursor && (
        <span className="status-item tabular">
          {t('status.position', { line: cursor.line, col: cursor.col })}
        </span>
      )}
      <span className="status-spacer" />
      {plugins.wordCount && counts && (
        <span className="status-item tabular">
          {tn('count.words', counts.words)} · {tn('count.chars', counts.chars)}
        </span>
      )}
      <span className={`status-item save-state is-${state}`} data-testid="save-state">
        {state === 'unsaved' ? t('status.unsaved') : state === 'conflict' ? t('status.conflict') : t('status.saved')}
      </span>
    </footer>
  )
}
