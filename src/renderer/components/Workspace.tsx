import { useEffect, useRef, useState, Fragment } from 'react'
import { X, Plus, ArrowLeft, ArrowRight, BookOpen, Pencil, MoreHorizontal, FileText, Waypoints, Image as ImageIcon, File as FileIcon } from 'lucide-react'
import { model, useModel, Pane, Tab, IMAGE_EXT, isMd } from '../model'
import { Editor } from './Editor'
import { Reading } from './Reading'
import { GraphView } from './Graph'
import { fileUrl, api } from '../api'
import { basename, noteTitle, INVALID_NAME } from '../../shared/markdown'
import { runCommand, hotkeysFor, formatHotkey } from '../commands'
import { t as tr } from '../../shared/i18n'

export function Workspace() {
  const ws = useModel((s) => s.ws)
  const ref = useRef<HTMLDivElement>(null)

  const startResize = (i: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    const el = ref.current!
    const rect = el.getBoundingClientRect()
    const total = ws.paneSizes.reduce((a, b) => a + b, 0)
    const horizontal = ws.direction === 'row'
    const startPos = horizontal ? e.clientX : e.clientY
    const extent = horizontal ? rect.width : rect.height
    const sizes = [...ws.paneSizes]
    const move = (ev: PointerEvent) => {
      const delta = (((horizontal ? ev.clientX : ev.clientY) - startPos) / extent) * total
      const a = sizes[i] + delta
      const b = sizes[i + 1] - delta
      const min = total * 0.1
      if (a < min || b < min) return
      const next = [...sizes]
      next[i] = a
      next[i + 1] = b
      model.setPaneSizes(next)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={`workspace-split dir-${ws.direction}`} ref={ref}>
      {ws.panes.map((p, i) => (
        <Fragment key={p.id}>
          {i > 0 && <div className="pane-resizer" onPointerDown={startResize(i - 1)} role="separator" aria-orientation={ws.direction === 'row' ? 'vertical' : 'horizontal'} />}
          <div className="pane-slot" style={{ flexGrow: ws.paneSizes[i] ?? 1 }}>
            <PaneView pane={p} active={p.id === ws.activePane} />
          </div>
        </Fragment>
      ))}
    </div>
  )
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
        <div className="tab-strip" role="tablist">
          {pane.tabs.map((t, i) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === tab.id}
              tabIndex={0}
              className={`tab${t.id === tab.id ? ' is-active' : ''}${dragOver === i ? ' drop-before' : ''}`}
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
                  { label: tr('tab.close'), run: () => model.closeTab(pane.id, t.id) },
                  { label: tr('tab.closeOthers'), run: () => model.closeOthers(pane.id, t.id) },
                  { separator: true, label: '' },
                  { label: tr('common.splitRight'), run: () => { model.selectTab(pane.id, t.id); model.split('row') } },
                  { label: tr('common.splitDown'), run: () => { model.selectTab(pane.id, t.id); model.split('column') } },
                  ...(t.path ? [{ separator: true, label: '' }, { label: tr('common.revealInFinder'), run: () => api.reveal(t.path!) }, { label: tr('common.copyPath'), run: () => navigator.clipboard.writeText(t.path!) }] : []),
                ])
              }
            >
              <span className="tab-icon"><TabIcon t={t} /></span>
              <span className="tab-title">{tabTitle(t)}</span>
              {dirty[i] && <span className="tab-dirty" aria-label={tr('tab.unsaved')} />}
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
        <button
          className="icon-btn"
          aria-label={tr('view.more')}
          onClick={(e) => {
            model.focusPane(paneId)
            model.openMenu(e, [
              { label: tr('common.renameEllipsis'), run: () => model.renamePrompt(path) },
              { label: tr('common.splitRight'), run: () => model.split('row') },
              { label: tr('common.splitDown'), run: () => model.split('column') },
              ...(isNote ? [{ label: tr('view.findInNote'), run: () => runCommand('editor:open-search') }] : []),
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
          <button className="btn mod-cta" onClick={() => model.resolveConflict(path, 'mine')}>
            {conflict === 'modified' ? tr('conflict.keepMine') : tr('conflict.restoreMine')}
          </button>
        </div>
      )}
      <div className="note-scroll">
        {prefs.showInlineTitle && <InlineTitle tab={tab} />}
        {tab.mode === 'source' ? <Editor tab={tab} paneId={paneId} /> : <Reading path={path} />}
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
      <button className="btn" onClick={() => api.reveal(path)}>{tr('common.revealInFinder')}</button>
    </div>
  )
}

function EmptyTab({ paneId, tabId }: { paneId: string; tabId: string }) {
  const recent = useModel((s) => s.recent)
  const graph = useModel((s) => s.snap!.prefs.corePlugins.graph)
  const actions = [
    { label: tr('common.newNote'), cmd: 'file-explorer:new-file', run: () => model.createNote({ where: 'tab' }) },
    { label: tr('empty.jump'), cmd: 'switcher:open', run: () => model.set({ modal: { kind: 'switcher' } }) },
    ...(graph ? [{ label: tr('empty.graph'), cmd: 'graph:open', run: () => model.openGraph('tab') }] : []),
    { label: tr('empty.closeTab'), cmd: 'workspace:close', run: () => model.closeTab(paneId, tabId) },
    { label: tr('empty.closeVault'), cmd: 'app:close-vault', run: () => model.switchVault(() => api.closeVault()) },
  ]
  return (
    <div className="empty-tab" data-testid="empty-tab">
      <div className="empty-tab-inner">
        <h1 className="empty-tab-title">{tr('empty.title')}</h1>
        <div className="empty-tab-actions">
          {actions.map((a) => (
            <button key={a.cmd} className="action-row" onClick={a.run}>
              <span>{a.label}</span>
              <kbd>{formatHotkey(hotkeysFor(a.cmd)[0] ?? '')}</kbd>
            </button>
          ))}
        </div>
        {recent.length > 0 && (
          <section className="empty-tab-recent" aria-label={tr('empty.recentLabel')}>
            <h2>{tr('empty.recent')}</h2>
            {recent.slice(0, 7).map((p) => (
              <button key={p} className="recent-row" onClick={(e) => model.open(p, e.metaKey ? 'new' : 'tab')}>
                <span className="recent-title">{isMd(p) ? noteTitle(p) : basename(p)}</span>
                {p.includes('/') && <span className="recent-path">{p.slice(0, p.lastIndexOf('/'))}</span>}
              </button>
            ))}
          </section>
        )}
      </div>
    </div>
  )
}
