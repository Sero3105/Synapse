import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings2, RotateCcw, Crosshair, Pencil, Trash2, ChevronDown, X } from 'lucide-react'
import { model, useModel, isMd, newId } from '../model'
import { noteTitle, searchNotes, fuzzyScore } from '../../shared/markdown'
import { visibleNodes, neighbours, localNodes, colorGroups } from '../../shared/graph-filter'
import type { SavedGraphView, GraphSettings } from '../../shared/settings'
import { layoutStep } from '../../shared/graph-layout'
import { t, tn } from '../../shared/i18n'

/** Colour key of a node: its top-level folder, or the top level of its first tag; null keeps the default colour. */
function groupOf(id: string, by: GraphSettings['colorBy']): string | null {
  if (by === 'folder') return id.includes('/') && !id.startsWith('?') ? id.slice(0, id.indexOf('/')) : null
  if (by === 'tag') return model.index.notes.get(id)?.meta.tags[0]?.split('/')[0].toLowerCase() ?? null
  return null
}

interface Node { id: string; label: string; x: number; y: number; vx: number; vy: number; deg: number; unresolved: boolean; fixed?: boolean }

export function GraphView() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const indexVersion = useModel((s) => s.indexVersion)
  const settings = useModel((s) => s.snap!.vault!.settings.graph)
  const views = useModel((s) => s.snap!.vault!.settings.graphViews)
  // the note the local graph follows: the open one, or the last opened when the graph tab itself is active
  const followed = useModel((s) => {
    const f = model.activeFile
    return f && isMd(f) ? f : s.recent.find(isMd) ?? null
  })
  // a saved view can fix the centre on one note until the user lets it follow again
  const [pinnedCenter, setPinnedCenter] = useState<string | null>(null)
  const center = settings.local ? (pinnedCenter && model.index.notes.has(pinnedCenter) ? pinnedCenter : followed) : null
  const [panel, setPanel] = useState(false)
  const sim = useRef<{ nodes: Node[]; edges: [number, number][]; alpha: number; restart: () => void; resetView: () => void } | null>(null)
  // zoom and pan outlive the rebuild that runs on every index change (typing in another pane)
  const lastView = useRef({ x: 0, y: 0, k: 1 })
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [orphansOnly, setOrphansOnly] = useState(false)
  const [shown, setShown] = useState(-1) // notes drawn; -1 until the first frame
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(id)
  }, [query])
  // Filter and selection live in refs read by the draw loop, so changing them never rebuilds the simulation.
  const match = useMemo(() => (debounced.trim() ? new Set(searchNotes([...model.index.notes.values()], debounced, Infinity).map((h) => h.path)) : null), [debounced, indexVersion])
  const local = settings.local ? { center, depth: settings.depth } : null
  const filter = useRef({ match, orphansOnly, local })
  filter.current = useMemo(() => ({ match, orphansOnly, local }), [match, orphansOnly, settings.local, center, settings.depth])
  const customColors = useModel((s) => s.snap!.vault!.settings.graphColors)
  const groups = useMemo(() => colorGroups([...model.index.notes.keys()].map((p) => groupOf(p, settings.colorBy)), customColors), [indexVersion, settings.colorBy, customColors])
  // read by the draw loop: a new colour shows at once, without rebuilding the layout
  const groupsRef = useRef(groups)
  groupsRef.current = groups
  const [picker, setPicker] = useState(false)
  const selected = useRef<string | null>(null)
  const filtered = !!match || orphansOnly

  useEffect(() => {
    const cv = canvas.current!
    const ctx = cv.getContext('2d')!
    const prev = new Map(sim.current?.nodes.map((n) => [n.id, n]) ?? [])
    const { edges: rawEdges, unresolved } = model.index.graph()
    const nodes: Node[] = []
    const idx = new Map<string, number>()
    const add = (id: string, label: string, unres: boolean) => {
      if (idx.has(id)) return
      const p = prev.get(id)
      idx.set(id, nodes.length)
      nodes.push({ id, label, x: p?.x ?? (Math.random() - 0.5) * 400, y: p?.y ?? (Math.random() - 0.5) * 400, vx: 0, vy: 0, deg: 0, unresolved: unres })
    }
    for (const p of model.index.notes.keys()) add(p, noteTitle(p), false)
    const edges: [number, number][] = []
    for (const [a, b] of rawEdges) {
      if (!idx.has(b)) add(b, b.slice(b.lastIndexOf('/') + 1), false) // linked attachment
      edges.push([idx.get(a)!, idx.get(b)!])
    }
    if (settings.showUnresolved) {
      for (const [target, sources] of unresolved) {
        add('?' + target, target, true)
        for (const s of sources) edges.push([idx.get(s)!, idx.get('?' + target)!])
      }
    }
    for (const [a, b] of edges) {
      nodes[a].deg++
      nodes[b].deg++
    }
    const ids = nodes.map((n) => n.id)
    const keys = nodes.map((n) => groupOf(n.id, settings.colorBy))
    const degs = nodes.map((n) => n.deg)
    let shownFilter: typeof filter.current | null = null
    let visible: boolean[] = []
    let view = lastView.current
    // same nodes and links (an edit that touched no link): keep settling instead of shaking the graph again
    const same = prev.size === nodes.length && nodes.every((n) => prev.get(n.id)?.deg === n.deg)
    const state = { nodes, edges, alpha: !prev.size ? 1 : same ? sim.current!.alpha : 0.3, restart: () => (state.alpha = 1), resetView: () => (view = { x: 0, y: 0, k: 1 }) }
    sim.current = state

    let w = 0
    let h = 0
    let hover = -1
    let drag: { node: number; moved: boolean } | null = null
    let pan: { x: number; y: number; vx: number; vy: number } | null = null
    const dpr = window.devicePixelRatio || 1
    const ro = new ResizeObserver(() => {
      w = cv.clientWidth
      h = cv.clientHeight
      cv.width = w * dpr
      cv.height = h * dpr
    })
    ro.observe(cv)

    const css = getComputedStyle(document.body)
    const color = (v: string) => css.getPropertyValue(v).trim() || '#888'
    const toWorld = (sx: number, sy: number) => ({ x: (sx - w / 2 - view.x) / view.k, y: (sy - h / 2 - view.y) / view.k })
    const radius = (n: Node) => 3 + Math.sqrt(n.deg) * 1.6
    const hit = (sx: number, sy: number) => {
      const p = toWorld(sx, sy)
      let best = -1
      let bd = Infinity
      nodes.forEach((n, i) => {
        if (!visible[i]) return
        const d = (n.x - p.x) ** 2 + (n.y - p.y) ** 2
        const r = radius(n) + 4 / view.k
        if (d < r * r && d < bd) {
          bd = d
          best = i
        }
      })
      return best
    }

    const step = () => {
      layoutStep(nodes, edges, visible, settings, state.alpha)
      state.alpha = Math.max(0, state.alpha * 0.985 - 0.0005)
    }

    const active = model.activeFile
    let raf = 0
    const draw = () => {
      if (shownFilter !== filter.current) {
        const was = shownFilter?.local
        shownFilter = filter.current
        visible = visibleNodes(ids, degs, { ...shownFilter, showOrphans: settings.showOrphans })
        const loc = shownFilter.local
        if (loc) {
          const c = loc.center ? idx.get(loc.center) ?? -1 : -1
          visible = localNodes(edges, visible, c, loc.depth)
          // new centre or depth: move the centre to the middle and let its neighbourhood settle around it
          if (c >= 0 && (was?.center !== loc.center || was?.depth !== loc.depth)) {
            const { x, y } = nodes[c]
            for (const n of nodes) {
              n.x -= x
              n.y -= y
            }
            view = { x: 0, y: 0, k: 1 }
            state.alpha = Math.max(state.alpha, 0.6)
          }
        }
        setShown(visible.filter(Boolean).length)
      }
      if (state.alpha > 0.002) step()
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.translate(w / 2 + view.x, h / 2 + view.y)
      ctx.scale(view.k, view.k)
      // hover wins over the shift-click selection; both light up direct neighbours
      const sel = selected.current ? idx.get(selected.current) ?? -1 : -1
      const focusIdx = hover >= 0 ? hover : sel >= 0 && visible[sel] ? sel : -1
      const neighbors = neighbours(edges, focusIdx)
      const lineColor = color('--graph-line')
      const accent = color('--interactive-accent')
      for (const [a, b] of edges) {
        if (!visible[a] || !visible[b]) continue
        const lit = focusIdx >= 0 && (a === focusIdx || b === focusIdx)
        ctx.strokeStyle = lit ? accent : lineColor
        ctx.lineWidth = (lit ? 1.6 : 1) / view.k
        ctx.globalAlpha = focusIdx >= 0 && !lit ? 0.25 : lit ? 0.9 : 1
        ctx.beginPath()
        ctx.moveTo(nodes[a].x, nodes[a].y)
        ctx.lineTo(nodes[b].x, nodes[b].y)
        ctx.stroke()
      }
      const nodeColor = color('--graph-node')
      const unresColor = color('--graph-node-unresolved')
      const text = color('--text-muted')
      const ink = color('--ink')
      const page = color('--ground')
      ctx.font = `500 ${11.5 / view.k}px ${css.getPropertyValue('--font-interface').trim() || 'sans-serif'}`
      ctx.textAlign = 'center'
      ctx.lineJoin = 'round'
      nodes.forEach((n, i) => {
        if (!visible[i]) return
        const focus = i === focusIdx || n.id === (shownFilter?.local?.center ?? active)
        const dim = focusIdx >= 0 && !focus && !neighbors.has(i)
        ctx.globalAlpha = dim ? 0.25 : 1
        ctx.fillStyle = focus ? accent : n.unresolved ? unresColor : (keys[i] && groupsRef.current.color.get(keys[i]!)) || nodeColor
        // a soft accent halo on the focused note only; a ring in the page colour separates every node from its links
        if (focus) {
          ctx.shadowColor = accent
          ctx.shadowBlur = 14
        }
        ctx.beginPath()
        ctx.arc(n.x, n.y, radius(n), 0, Math.PI * 2)
        ctx.fill()
        ctx.shadowBlur = 0
        ctx.strokeStyle = page
        ctx.lineWidth = 2 / view.k
        ctx.stroke()
        if (i === sel) {
          // ring marks the selected note
          ctx.strokeStyle = accent
          ctx.lineWidth = 1.5 / view.k
          ctx.beginPath()
          ctx.arc(n.x, n.y, radius(n) + 3 / view.k, 0, Math.PI * 2)
          ctx.stroke()
        }
        if (view.k > 0.7 || focus || neighbors.has(i)) {
          const label = !focus && n.label.length > 32 ? n.label.slice(0, 30) + '…' : n.label
          const y = n.y + radius(n) + 13 / view.k
          // outline in the page colour keeps labels readable where they cross links
          ctx.strokeStyle = page
          ctx.lineWidth = 3 / view.k
          ctx.strokeText(label, n.x, y)
          ctx.fillStyle = focus ? ink : text
          ctx.fillText(label, n.x, y)
        }
      })
      ctx.globalAlpha = 1
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)

    const pos = (e: MouseEvent | WheelEvent) => {
      const r = cv.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const onDown = (e: PointerEvent) => {
      const p = pos(e)
      const i = hit(p.x, p.y)
      cv.setPointerCapture(e.pointerId)
      if (i >= 0) {
        drag = { node: i, moved: false }
        nodes[i].fixed = true
      } else pan = { x: p.x, y: p.y, vx: view.x, vy: view.y }
    }
    const onMove = (e: PointerEvent) => {
      const p = pos(e)
      if (drag) {
        const wp = toWorld(p.x, p.y)
        nodes[drag.node].x = wp.x
        nodes[drag.node].y = wp.y
        drag.moved = true
        state.alpha = Math.max(state.alpha, 0.3)
      } else if (pan) {
        view = { ...view, x: pan.vx + p.x - pan.x, y: pan.vy + p.y - pan.y }
      } else {
        hover = hit(p.x, p.y)
        cv.style.cursor = hover >= 0 ? 'pointer' : 'default'
      }
    }
    const onUp = (e: PointerEvent) => {
      if (drag) {
        const n = nodes[drag.node]
        n.fixed = false
        if (!drag.moved && e.shiftKey) selected.current = selected.current === n.id ? null : n.id
        else if (!drag.moved && !n.unresolved) model.open(n.id, e.metaKey || e.ctrlKey ? 'new' : 'tab')
        else if (!drag.moved && n.unresolved) model.followLink(n.label, '', e.metaKey || e.ctrlKey)
      }
      drag = null
      pan = null
    }
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const p = pos(e)
      const k = Math.min(4, Math.max(0.1, view.k * Math.exp(-e.deltaY * 0.0015)))
      const wx = (p.x - w / 2 - view.x) / view.k
      const wy = (p.y - h / 2 - view.y) / view.k
      view = { k, x: p.x - w / 2 - wx * k, y: p.y - h / 2 - wy * k }
    }
    cv.addEventListener('pointerdown', onDown)
    cv.addEventListener('pointermove', onMove)
    cv.addEventListener('pointerup', onUp)
    cv.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      lastView.current = view
      cancelAnimationFrame(raf)
      ro.disconnect()
      cv.removeEventListener('pointerdown', onDown)
      cv.removeEventListener('pointermove', onMove)
      cv.removeEventListener('pointerup', onUp)
      cv.removeEventListener('wheel', onWheel)
    }
  }, [indexVersion, settings])

  const set = (patch: Partial<typeof settings>) => model.setVault({ graph: patch })
  const reset = () => {
    setQuery('')
    setDebounced('')
    setOrphansOnly(false)
    setPinnedCenter(null)
    selected.current = null
    sim.current?.resetView()
  }
  // the colour picker fires while dragging: save once it settles
  const colorTimer = useRef(0)
  const pickColor = (key: string, color: string | null) => {
    clearTimeout(colorTimer.current)
    colorTimer.current = window.setTimeout(() => {
      const next = { ...model.state.snap!.vault!.settings.graphColors }
      if (color) next[key] = color
      else delete next[key]
      model.setVault({ graphColors: next })
    }, color ? 200 : 0)
  }
  const setLocal = (on: boolean) => {
    setPinnedCenter(null)
    set({ local: on })
  }

  // ---------- saved views (vault settings) ----------
  const saveViews = (list: SavedGraphView[]) => model.setVault({ graphViews: list })
  const saveView = async () => {
    const name = (await model.prompt(t('graph.viewName')))?.trim()
    if (!name) return
    const v: SavedGraphView = { id: newId(), name, graph: { ...settings }, query, orphansOnly, ...(center ? { center } : {}) }
    // saving under an existing name updates that view
    const i = views.findIndex((x) => x.name.toLowerCase() === name.toLowerCase())
    saveViews(i >= 0 ? views.map((x, j) => (j === i ? { ...v, id: x.id } : x)) : [...views, v])
  }
  const applyView = (v: SavedGraphView) => {
    model.setVault({ graph: v.graph })
    setQuery(v.query)
    setDebounced(v.query)
    setOrphansOnly(v.orphansOnly)
    setPinnedCenter(v.center ?? null)
    selected.current = null
  }
  const renameView = async (v: SavedGraphView) => {
    const name = (await model.prompt(t('graph.renameView', { name: v.name }), v.name))?.trim()
    if (name && name !== v.name) saveViews(views.map((x) => (x.id === v.id ? { ...x, name } : x)))
  }
  const deleteView = async (v: SavedGraphView) => {
    if (await model.confirm(t('graph.deleteView', { name: v.name }), t('graph.deleteViewBody', { name: v.name }))) saveViews(views.filter((x) => x.id !== v.id))
  }
  return (
    <div className="graph-view" data-testid="graph" onKeyDown={(e) => e.key === 'Escape' && (selected.current = null)}>
      <canvas ref={canvas} className="graph-canvas" tabIndex={0} aria-label={t('graph.label')} />
      {settings.local && (
        <div className="graph-localbar" role="group" aria-label={t('graph.local')}>
          <span className="graph-localbar-label">{t('graph.localOf')}</span>
          <button className="select" data-testid="graph-center" aria-haspopup="dialog" aria-expanded={picker} aria-label={`${t('graph.chooseCenter')}: ${center ? noteTitle(center) : ''}`} onClick={() => setPicker(!picker)}>
            <span className="select-value">{center ? noteTitle(center) : t('graph.chooseCenter')}</span>
            <ChevronDown size={13} strokeWidth={2} aria-hidden />
          </button>
          <div className="segmented" role="radiogroup" aria-label={t('graph.depth')} title={t('graph.depth')}>
            {[1, 2].map((d) => (
              <button key={d} role="radio" aria-checked={settings.depth === d} className={`segment${settings.depth === d ? ' is-active' : ''}`} onClick={() => set({ depth: d })}>
                {d}
              </button>
            ))}
          </div>
          <button className="icon-btn" aria-label={t('graph.backToGlobal')} title={t('graph.backToGlobal')} onClick={() => setLocal(false)}>
            <X size={14} />
          </button>
          {picker && (
            <NotePicker
              pinned={!!pinnedCenter}
              close={() => setPicker(false)}
              pick={(p) => {
                setPinnedCenter(p)
                setPicker(false)
              }}
            />
          )}
        </div>
      )}
      {settings.local && !center ? (
        <div className="graph-empty" role="status">
          <span>{t('graph.noCenter')}</span>
          <button className="btn" onClick={() => setPicker(true)}>{t('graph.chooseCenter')}</button>
        </div>
      ) : filtered && shown === 0 && (
        <div className="graph-empty" role="status">
          <span>{t('graph.noMatch')}</span>
          <button className="btn" onClick={reset}>{t('graph.reset')}</button>
        </div>
      )}
      <div className="graph-corner">
        {settings.colorBy !== 'none' && groups.legend.length > 0 && (
          <ul className="graph-legend" aria-label={t('graph.legend')} data-testid="graph-legend">
            {groups.legend.map((l) => (
              <li key={l.key}>
                <label className="graph-legend-swatch" title={t('graph.pickColor', { name: l.key })}>
                  <span className="graph-legend-dot" style={{ background: l.color }} />
                  {/* keyed by colour: the picker starts from the colour shown, and follows a reset */}
                  <input key={l.color} type="color" defaultValue={l.color} aria-label={t('graph.pickColor', { name: l.key })} onChange={(e) => pickColor(l.key, e.target.value)} />
                </label>
                <span className="graph-legend-name">{l.key}</span>
                {l.custom && (
                  <button className="graph-legend-reset" aria-label={t('graph.resetColor', { name: l.key })} title={t('graph.resetColor', { name: l.key })} onClick={() => pickColor(l.key, null)}>
                    <X size={11} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {shown >= 0 && (
          <div className="graph-count" role="status" data-testid="graph-count">
            {tn('graph.count', shown)}
          </div>
        )}
      </div>
      <div className="graph-controls">
        <button className={`icon-btn${settings.local ? ' is-active' : ''}`} aria-pressed={settings.local} aria-label={t('graph.local')} title={t('graph.local')} onClick={() => setLocal(!settings.local)}>
          <Crosshair size={16} />
        </button>
        <button className="icon-btn" aria-label={t('graph.restart')} title={t('graph.restart')} onClick={() => sim.current?.restart()}>
          <RotateCcw size={16} />
        </button>
        <button className={`icon-btn${panel || filtered ? ' is-active' : ''}`} aria-label={t('graph.settings')} aria-expanded={panel} onClick={() => setPanel(!panel)}>
          <Settings2 size={16} />
        </button>
      </div>
      {panel && (
        <div className="graph-settings">
          <div className="graph-settings-title">{t('graph.settings')} <span className="scope-pill">{t('graph.thisVault')}</span></div>
          <div className="segmented" role="radiogroup" aria-label={t('graph.mode')}>
            {[false, true].map((on) => (
              <button key={String(on)} role="radio" aria-checked={settings.local === on} className={`segment${settings.local === on ? ' is-active' : ''}`} onClick={() => setLocal(on)}>
                {t(on ? 'graph.local' : 'graph.global')}
              </button>
            ))}
          </div>
          <input
            className="text-input"
            placeholder={t('graph.filter')}
            aria-label={t('graph.filterLabel')}
            title={t('graph.filterHelp')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && query && (e.stopPropagation(), setQuery(''))}
          />
          <label className="check-row">
            <input type="checkbox" checked={orphansOnly} onChange={(e) => setOrphansOnly(e.target.checked)} /> {t('graph.orphansOnly')}
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.showOrphans} onChange={(e) => set({ showOrphans: e.target.checked })} /> {t('graph.orphans')}
          </label>
          <label className="check-row">
            <input type="checkbox" checked={settings.showUnresolved} onChange={(e) => set({ showUnresolved: e.target.checked })} /> {t('graph.unresolved')}
          </label>
          <div className="slider-row">
            {t('graph.colorBy')}
            <div className="segmented" role="radiogroup" aria-label={t('graph.colorBy')}>
              {(['none', 'folder', 'tag'] as const).map((c) => (
                <button key={c} role="radio" aria-checked={settings.colorBy === c} className={`segment${settings.colorBy === c ? ' is-active' : ''}`} onClick={() => set({ colorBy: c })}>
                  {t(c === 'none' ? 'graph.colorNone' : c === 'folder' ? 'graph.colorFolder' : 'graph.colorTag')}
                </button>
              ))}
            </div>
          </div>
          <label className="slider-row">
            {t('graph.distance')}
            <input type="range" min={20} max={400} value={settings.linkDistance} style={{ '--fill': `${((settings.linkDistance - 20) / 380) * 100}%` } as React.CSSProperties} onChange={(e) => set({ linkDistance: Number(e.target.value) })} />
          </label>
          <label className="slider-row">
            {t('graph.repel')}
            <input type="range" min={50} max={3000} value={settings.repel} style={{ '--fill': `${((settings.repel - 50) / 2950) * 100}%` } as React.CSSProperties} onChange={(e) => set({ repel: Number(e.target.value) })} />
          </label>
          <div className="graph-views" role="group" aria-label={t('graph.views')}>
            <div className="graph-views-title">{t('graph.views')}</div>
            {!views.length && <p className="graph-hint">{t('graph.noViews')}</p>}
            {views.map((v) => (
              <div key={v.id} className="graph-view-row">
                <button className="graph-view-name" title={t('graph.applyView')} onClick={() => applyView(v)}>
                  {v.name}
                </button>
                <button className="icon-btn" aria-label={t('graph.renameView', { name: v.name })} title={t('graph.renameView', { name: v.name })} onClick={() => renameView(v)}>
                  <Pencil size={14} />
                </button>
                <button className="icon-btn" aria-label={t('graph.deleteView', { name: v.name })} title={t('graph.deleteView', { name: v.name })} onClick={() => deleteView(v)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button className="btn" onClick={saveView}>{t('graph.saveView')}</button>
          </div>
          <p className="graph-hint">{t('graph.selectHint')}</p>
          <button className="btn" onClick={reset}>{t('graph.reset')}</button>
        </div>
      )}
    </div>
  )
}

/** Search box over the vault's notes, to centre the local graph on one of them. */
function NotePicker({ pick, close, pinned }: { pick: (path: string | null) => void; close: () => void; pinned: boolean }) {
  const [query, setQuery] = useState('')
  const [sel, setSel] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const recent = useModel((s) => s.recent)
  const results = useMemo(() => {
    const notes = [...model.index.notes.keys()]
    if (!query.trim()) {
      // recently opened first, then the rest by name
      const first = recent.filter((p) => model.index.notes.has(p))
      return [...first, ...notes.filter((p) => !first.includes(p)).sort((a, b) => a.localeCompare(b))].slice(0, 50)
    }
    return notes
      .map((p) => ({ p, s: fuzzyScore(query, p) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map((x) => x.p)
  }, [query, recent])
  // "follow the open note" comes first when the centre is fixed
  const items: (string | null)[] = pinned ? [null, ...results] : results
  useEffect(() => {
    const onDown = (e: MouseEvent) => !(e.target as HTMLElement).closest('.graph-picker, .graph-localbar') && close()
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [close])
  useEffect(() => setSel(0), [query])
  return (
    <div className="graph-picker" ref={ref} role="dialog" aria-label={t('graph.chooseCenter')}>
      <input
        className="text-input"
        autoFocus
        placeholder={t('graph.searchNote')}
        aria-label={t('graph.searchNote')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setSel(Math.min(sel + 1, items.length - 1)))
          else if (e.key === 'ArrowUp') (e.preventDefault(), setSel(Math.max(sel - 1, 0)))
          else if (e.key === 'Enter' && items[sel] !== undefined) pick(items[sel])
          else if (e.key === 'Escape') (e.stopPropagation(), close())
        }}
      />
      <div className="graph-picker-list" role="listbox" aria-label={t('graph.chooseCenter')}>
        {items.map((p, i) => (
          <div key={p ?? ''} role="option" aria-selected={i === sel} className={`graph-picker-item${i === sel ? ' is-selected' : ''}`} onMouseEnter={() => setSel(i)} onClick={() => pick(p)}>
            {p === null ? (
              <span className="graph-picker-follow">{t('graph.followActive')}</span>
            ) : (
              <>
                <span className="graph-picker-title">{noteTitle(p)}</span>
                {p.includes('/') && <span className="graph-picker-folder">{p.slice(0, p.lastIndexOf('/'))}</span>}
              </>
            )}
          </div>
        ))}
        {!items.length && <div className="graph-picker-empty">{t('search.noResults')}</div>}
      </div>
    </div>
  )
}
