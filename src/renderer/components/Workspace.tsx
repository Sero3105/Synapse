import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Plus, ExternalLink, ArrowLeft, ArrowRight, BookOpen, Pencil, MoreHorizontal, FileText, Waypoints, Image as ImageIcon, File as FileIcon, FilePlus, CalendarDays, Search, Pin, Clock, PenLine } from 'lucide-react'
import { model, useModel, Pane, Tab, IMAGE_EXT, isMd } from '../model'
import { Editor } from './Editor'
import { Reading } from './Reading'
import { GraphView } from './Graph'
import { fileUrl, api } from '../api'
import { basename, noteTitle, INVALID_NAME } from '../../shared/markdown'
import { runCommand, hotkeysFor, formatHotkey } from '../commands'
import { t as tr, tn } from '../../shared/i18n'
import { startLists } from '../../shared/start'
import { layoutRects, Bar, LayoutNode, Split } from '../../shared/layout'

export function Workspace() {
  const ws = useModel((s) => s.ws)
  const ref = useRef<HTMLDivElement>(null)
  const { panes, bars } = useMemo(() => layoutRects(ws.layout), [ws.layout])

  const startResize = (bar: Bar) => (e: React.PointerEvent) => {
    e.preventDefault()
    const box = ref.current!.getBoundingClientRect()
    const row = bar.dir === 'row'
    // the split's own length on screen; its sizes are relative, so they scale with it
    const extent = row ? box.width * bar.split.w : box.height * bar.split.h
    const startPos = row ? e.clientX : e.clientY
    const sizes = splitAt(ws.layout, bar.path).sizes
    const total = sizes.reduce((a, b) => a + b, 0)
    const move = (ev: PointerEvent) => {
      const delta = (((row ? ev.clientX : ev.clientY) - startPos) / extent) * total
      const a = sizes[bar.index] + delta
      const b = sizes[bar.index + 1] - delta
      const min = total * 0.1
      if (a < min || b < min) return
      const next = [...sizes]
      next[bar.index] = a
      next[bar.index + 1] = b
      model.setPaneSizes(bar.path, next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  // Panes stay one flat list placed from the layout tree: changing the tree never remounts a pane,
  // so editors keep their undo history and scroll position.
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6
  const edge = (start: number, len: number) => ({ from: `calc(${start * 100}% + ${near(start, 0) ? 0 : GAP / 2}px)`, to: `calc(${(1 - start - len) * 100}% + ${near(start + len, 1) ? 0 : GAP / 2}px)` })
  return (
    <div className="workspace-split" ref={ref}>
      {ws.panes.map((p) => {
        const r = panes.get(p.id)
        if (!r) return null
        const h = edge(r.x, r.w)
        const v = edge(r.y, r.h)
        const cls = `pane-slot${near(r.y, 0) && near(r.x, 0) ? ' is-top-left' : ''}${near(r.y, 0) && near(r.x + r.w, 1) ? ' is-top-right' : ''}`
        return (
          <div key={p.id} className={cls} style={{ left: h.from, right: h.to, top: v.from, bottom: v.to }}>
            <PaneView pane={p} active={p.id === ws.activePane} />
          </div>
        )
      })}
      {bars.map((b) => {
        const row = b.dir === 'row'
        const at = row ? b.split.x + b.at * b.split.w : b.split.y + b.at * b.split.h
        const style = row
          ? { left: `calc(${at * 100}% - ${GAP / 2}px)`, width: GAP, top: `${b.split.y * 100}%`, height: `${b.split.h * 100}%` }
          : { top: `calc(${at * 100}% - ${GAP / 2}px)`, height: GAP, left: `${b.split.x * 100}%`, width: `${b.split.w * 100}%` }
        return <div key={`${b.path.join('.')}:${b.index}`} className={`pane-resizer dir-${b.dir}`} style={style} onPointerDown={startResize(b)} role="separator" aria-orientation={row ? 'vertical' : 'horizontal'} />
      })}
    </div>
  )
}

const GAP = 6 // px between panes, the width of a border

function splitAt(n: LayoutNode, path: number[]): Split {
  let m = n
  for (const i of path) m = (m as Split).children[i]
  return m as Split
}

function tabTitle(t: Tab) {
  if (t.kind === 'graph') return tr('tab.graph')
  if (t.kind === 'empty' || !t.path) return tr('tab.new')
  return t.kind === 'note' ? noteTitle(t.path) : basename(t.path)
}

function TabIcon({ t }: { t: Tab }) {
  if (t.kind === 'graph') return <Waypoints size={14} />
  if (t.kind === 'file') return t.path && IMAGE_EXT.test(t.path) ? <ImageIcon size={14} /> : <FileIcon size={14} />
  return <FileText size={14} />
}

function PaneView({ pane, active }: { pane: Pane; active: boolean }) {
  const tab = pane.tabs.find((t) => t.id === pane.active) ?? pane.tabs[0]
  // selector returns a string so useSyncExternalStore gets a stable snapshot
  const dirty = useModel((s) => pane.tabs.map((t) => (t.path && s.buffers[t.path] && s.buffers[t.path].content !== s.buffers[t.path].saved ? 1 : 0)).join('')).split('').map((c) => c === '1')
  const [dragOver, setDragOver] = useState<number | null>(null)
  const strip = useRef<HTMLDivElement>(null)
  // with more tabs than fit, the strip scrolls: keep the active one in view
  useEffect(() => {
    strip.current?.querySelector('.tab.is-active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [tab.id, pane.tabs.length])

  const onDrop = (e: React.DragEvent, index: number) => {
    const data = e.dataTransfer.getData('application/x-synapse-tab')
    const file = e.dataTransfer.getData('application/x-synapse-path')
    setDragOver(null)
    if (data) {
      const { paneId, tabId } = JSON.parse(data)
      model.moveTab(paneId, tabId, pane.id, index)
    } else if (file) {
      model.focusPane(pane.id)
      model.open(file, 'new')
    }
  }

  return (
    <div className={`pane${active ? ' is-active' : ''}`} onMouseDown={() => model.focusPane(pane.id)} data-testid="pane">
      <div className="tab-header" onDragOver={(e) => { e.preventDefault(); setDragOver(pane.tabs.length) }} onDragLeave={() => setDragOver(null)} onDrop={(e) => onDrop(e, pane.tabs.length)}>
        <div className="tab-strip" role="tablist" ref={strip}>
          {pane.tabs.map((t, i) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === tab.id}
              tabIndex={0}
              className={`tab${t.id === tab.id ? ' is-active' : ''}${t.pinned ? ' is-pinned' : ''}${dragOver === i ? ' drop-before' : ''}`}
              aria-label={t.pinned ? tabTitle(t) : undefined}
              title={t.path ?? tabTitle(t)}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-synapse-tab', JSON.stringify({ paneId: pane.id, tabId: t.id }))
                e.dataTransfer.effectAllowed = 'move'
              }}
              onDragOver={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setDragOver(i)
              }}
              onDrop={(e) => {
                e.stopPropagation()
                onDrop(e, i)
              }}
              onClick={() => model.selectTab(pane.id, t.id)}
              onKeyDown={(e) => e.key === 'Enter' && model.selectTab(pane.id, t.id)}
              onAuxClick={(e) => e.button === 1 && model.closeTab(pane.id, t.id)}
              onContextMenu={(e) =>
                model.openMenu(e, [
                  { label: tr(t.pinned ? 'tab.unpin' : 'tab.pin'), run: () => model.togglePinTab(t.id) },
                  { label: tr('tab.close'), run: () => model.closeTab(pane.id, t.id) },
                  { label: tr('tab.closeOthers'), run: () => model.closeOthers(pane.id, t.id) },
                  { separator: true, label: '' },
                  { label: tr('common.splitRight'), run: () => { model.selectTab(pane.id, t.id); model.split('row') } },
                  { label: tr('common.splitDown'), run: () => { model.selectTab(pane.id, t.id); model.split('column') } },
                  ...(t.path ? [{ separator: true, label: '' }, { label: tr('common.revealInFinder'), run: () => api.reveal(t.path!) }, { label: tr('common.copyPath'), run: () => navigator.clipboard.writeText(t.path!) }] : []),
                  ...(t.kind === 'note' && t.path ? [{ label: tr('history.open'), run: () => model.set({ modal: { kind: 'history', path: t.path! } }) }] : []),
                ])
              }
            >
              <span className="tab-icon"><TabIcon t={t} /></span>
              {!t.pinned && <span className="tab-title">{tabTitle(t)}</span>}
              {dirty[i] && <span className="tab-dirty" aria-label={tr('tab.unsaved')} />}
              {!t.pinned && (
                <button
                  className="tab-close"
                  aria-label={tr('tab.closeNamed', { name: tabTitle(t) })}
                  onClick={(e) => {
                    e.stopPropagation()
                    model.closeTab(pane.id, t.id)
                  }}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
          <button className="tab-new icon-btn" aria-label={tr('tab.new')} onClick={() => model.newTab(pane.id)}>
            <Plus size={16} />
          </button>
        </div>
      </div>
      <div className="pane-content">
        <TabContent key={tab.id + (tab.path ?? '') + tab.kind} tab={tab} paneId={pane.id} />
      </div>
    </div>
  )
}

function TabContent({ tab, paneId }: { tab: Tab; paneId: string }) {
  if (tab.kind === 'graph') return <GraphView />
  if (tab.kind === 'empty') return <EmptyTab paneId={paneId} tabId={tab.id} />
  return (
    <div className="view">
      <ViewHeader tab={tab} paneId={paneId} />
      {tab.kind === 'note' ? <NoteBody tab={tab} paneId={paneId} /> : <FileBody path={tab.path!} />}
    </div>
  )
}

function ViewHeader({ tab, paneId }: { tab: Tab; paneId: string }) {
  const path = tab.path!
  const parts = path.split('/')
  const isNote = tab.kind === 'note'
  return (
    <div className="view-header">
      <div className="view-header-nav">
        <button className="icon-btn" aria-label={tr('view.back')} disabled={!tab.back.length} onClick={() => model.goBack(tab.id)}>
          <ArrowLeft size={16} />
        </button>
        <button className="icon-btn" aria-label={tr('view.forward')} disabled={!tab.fwd.length} onClick={() => model.goForward(tab.id)}>
          <ArrowRight size={16} />
        </button>
      </div>
      <div className="view-header-title" title={path}>
        {parts.slice(0, -1).map((p, i) => (
          <span key={i} className="crumb">
            {p}
            <span className="crumb-sep">/</span>
          </span>
        ))}
        <span className="crumb-title">{isNote ? noteTitle(path) : basename(path)}</span>
      </div>
      <div className="view-actions">
        {isNote && (
          <button
            className="icon-btn"
            aria-label={tab.mode === 'source' ? tr('view.toReading') : tr('view.toEditing')}
            title={tab.mode === 'source' ? tr('view.readingHint') : tr('view.editingHint')}
            onClick={() => model.updateTab(tab.id, { mode: tab.mode === 'source' ? 'preview' : 'source' })}
          >
            {tab.mode === 'source' ? <BookOpen size={16} /> : <Pencil size={16} />}
          </button>
        )}
        {tab.kind === 'file' && tab.path && /\.pdf$/i.test(tab.path) && (
          <button className="icon-btn" aria-label={tr('view.openPdf')} title={tr('view.openPdf')} onClick={() => api.openFile(tab.path!).catch((e) => model.error(e))}>
            <ExternalLink size={16} />
          </button>
        )}
        <button
          className="icon-btn"
          aria-label={tr('view.more')}
          onClick={(e) => {
            model.focusPane(paneId)
            model.openMenu(e, [
              { label: tr('common.renameEllipsis'), run: () => model.renamePrompt(path) },
              { label: tr('common.splitRight'), run: () => model.split('row') },
              { label: tr('common.splitDown'), run: () => model.split('column') },
              ...(isNote ? [{ label: tr('view.findInNote'), run: () => runCommand('editor:open-search') }, { label: tr('history.open'), run: () => model.set({ modal: { kind: 'history', path } }) }] : []),
              { label: tr('common.revealInFinder'), run: () => api.reveal(path) },
              { label: tr('common.copyPath'), run: () => navigator.clipboard.writeText(path) },
              { separator: true, label: '' },
              { label: tr('view.deleteFile'), danger: true, run: () => model.remove(path) },
            ])
          }}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>
    </div>
  )
}

function NoteBody({ tab, paneId }: { tab: Tab; paneId: string }) {
  const path = tab.path!
  const conflict = useModel((s) => s.buffers[path]?.conflict)
  const prefs = useModel((s) => s.snap!.prefs)
  return (
    <div className={`note-body${prefs.readableLineLength ? ' readable' : ''}`}>
      {conflict && (
        <div className="conflict-banner" role="alert">
          <span>{conflict === 'modified' ? tr('conflict.modified') : tr('conflict.deleted')}</span>
          <button className="btn" onClick={() => model.resolveConflict(path, 'disk')}>
            {conflict === 'modified' ? tr('conflict.loadDisk') : tr('conflict.discard')}
          </button>
          <button className="btn" onClick={() => model.resolveConflict(path, 'mine')}>
            {conflict === 'modified' ? tr('conflict.keepMine') : tr('conflict.restoreMine')}
          </button>
          {conflict === 'modified' && (
            <button className="btn mod-cta" onClick={() => model.mergeConflict(path)}>
              {tr('conflict.merge')}
            </button>
          )}
        </div>
      )}
      <div className="note-scroll">
        {prefs.showInlineTitle && <InlineTitle tab={tab} />}
        {tab.mode === 'source' ? <Editor tab={tab} paneId={paneId} /> : <Reading path={path} tabId={tab.id} />}
      </div>
    </div>
  )
}

/** Editable title above the note; Enter/blur renames the file (reference "inline title"). */
function InlineTitle({ tab }: { tab: Tab }) {
  const path = tab.path!
  const [value, setValue] = useState(noteTitle(path))
  const focus = useModel((s) => s.focusTitle === tab.id)
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setValue(noteTitle(path)), [path])
  useEffect(() => {
    if (focus && ref.current) {
      ref.current.focus()
      ref.current.select()
      model.set({ focusTitle: null })
    }
  }, [focus])
  const commit = async () => {
    const v = value.trim()
    if (!v || v === noteTitle(path)) return setValue(noteTitle(path))
    if (INVALID_NAME.test(v) || v.startsWith('.')) {
      model.notice(tr('common.invalidName'), true)
      return setValue(noteTitle(path))
    }
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : ''
    if (!(await model.rename(path, `${dir}${v}.md`))) setValue(noteTitle(path))
  }
  return (
    <textarea
      ref={ref}
      className="inline-title"
      aria-label={tr('view.noteTitle')}
      rows={1}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value.replace(/\n/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLTextAreaElement).blur()
          requestAnimationFrame(() => model.editors.get(tab.id)?.focus())
        }
        if (e.key === 'Escape') {
          setValue(noteTitle(path))
          requestAnimationFrame(() => (e.target as HTMLTextAreaElement).blur())
        }
      }}
    />
  )
}

function FileBody({ path }: { path: string }) {
  // Chromium's own PDF viewer (pages, zoom, search, print) inside the tab
  if (/\.pdf$/i.test(path))
    return (
      <div className="pdf-view">
        <iframe className="pdf-frame" src={fileUrl(path)} title={basename(path)} data-testid="pdf-frame" />
      </div>
    )
  if (IMAGE_EXT.test(path))
    return (
      <div className="file-view">
        <img src={fileUrl(path)} alt={basename(path)} />
      </div>
    )
  return (
    <div className="empty-state">
      <div className="empty-title">{basename(path)}</div>
      <div className="empty-sub">{tr('view.unsupported')}</div>
      <div className="row">
        <button className="btn" onClick={() => api.reveal(path)}>{tr('common.revealInFinder')}</button>
      </div>
    </div>
  )
}

function EmptyTab({ paneId, tabId }: { paneId: string; tabId: string }) {
  const recent = useModel((s) => s.recent)
  const pinned = useModel((s) => s.pinned)
  const files = useModel((s) => s.files)
  const vaultName = useModel((s) => s.snap?.vault?.name ?? '')
  const graph = useModel((s) => s.snap!.prefs.corePlugins.graph)
  const lists = useMemo(() => startLists(files, recent, pinned), [files, recent, pinned])
  const noteCount = useMemo(() => files.filter((f) => f.type === 'file' && isMd(f.path)).length, [files])
  const ICON = { size: 17, strokeWidth: 1.75 } as const
  const primary = [
    { label: tr('common.newNote'), cmd: 'file-explorer:new-file', icon: <FilePlus {...ICON} />, run: () => model.createNote({ where: 'tab' }) },
    { label: tr('empty.today'), cmd: 'daily-notes:open-today', icon: <CalendarDays {...ICON} />, run: () => model.openDailyNote() },
    { label: tr('empty.jump'), cmd: 'switcher:open', icon: <Search {...ICON} />, run: () => model.set({ modal: { kind: 'switcher' } }) },
    ...(graph ? [{ label: tr('empty.graph'), cmd: 'graph:open', icon: <Waypoints {...ICON} />, run: () => model.openGraph('tab') }] : []),
  ]
  const secondary = [
    { label: tr('empty.closeTab'), cmd: 'workspace:close', run: () => model.closeTab(paneId, tabId) },
    { label: tr('empty.closeVault'), cmd: 'app:close-vault', run: () => model.switchVault(() => api.closeVault()) },
  ]
  const hotkey = (cmd: string) => formatHotkey(hotkeysFor(cmd)[0] ?? '')
  const section = (title: string, icon: React.ReactNode, paths: string[], menu: (p: string) => { label: string; run: () => void }[]) =>
    paths.length > 0 && (
      <section className="empty-tab-recent" aria-label={title}>
        <h2>{icon}{title}</h2>
        {paths.map((p) => (
          <button key={p} className="recent-row" onClick={(e) => model.open(p, e.metaKey ? 'new' : 'tab')} onContextMenu={(e) => model.openMenu(e, [{ label: tr('files.openNewTab'), run: () => model.open(p, 'new') }, ...menu(p)])}>
            <FileText size={15} strokeWidth={1.75} className="recent-icon" />
            <span className="recent-title">{isMd(p) ? noteTitle(p) : basename(p)}</span>
            {p.includes('/') && <span className="recent-path">{p.slice(0, p.lastIndexOf('/'))}</span>}
          </button>
        ))}
      </section>
    )
  return (
    <div className="empty-tab" data-testid="empty-tab">
      <div className="empty-tab-inner">
        <header className="empty-tab-head">
          <h1 className="empty-tab-title">{vaultName || tr('empty.title')}</h1>
          <p className="empty-tab-sub">{tr('empty.title')} · {tn('count.notes', noteCount)}</p>
        </header>
        <div className="quick-grid">
          {primary.map((a) => (
            <button key={a.cmd} className="quick-card" onClick={a.run}>
              <span className="quick-icon">{a.icon}</span>
              <span className="quick-label">{a.label}</span>
              {hotkey(a.cmd) && <kbd>{hotkey(a.cmd)}</kbd>}
            </button>
          ))}
        </div>
        {section(tr('empty.pinned'), <Pin size={13} strokeWidth={2} />, lists.pinned, (p) => [{ label: tr('empty.unpin'), run: () => model.togglePin(p) }])}
        {section(tr('empty.recent'), <Clock size={13} strokeWidth={2} />, lists.recent, (p) => [{ label: tr('files.pin'), run: () => model.togglePin(p) }, { label: tr('empty.forget'), run: () => model.forgetRecent(p) }])}
        {section(tr('empty.modified'), <PenLine size={13} strokeWidth={2} />, lists.modified, (p) => [{ label: tr('files.pin'), run: () => model.togglePin(p) }])}
        <div className="empty-tab-links">
          {secondary.map((a) => (
            <button key={a.cmd} className="link-row" onClick={a.run}>
              {a.label}
              {hotkey(a.cmd) && <kbd>{hotkey(a.cmd)}</kbd>}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
