import { useEffect, useMemo, useRef, useState } from 'react'
import { Settings2, RotateCcw } from 'lucide-react'
import { model, useModel } from '../model'
import { noteTitle, searchNotes } from '../../shared/markdown'
import { visibleNodes, neighbours } from '../../shared/graph-filter'
import { t } from '../../shared/i18n'

interface Node { id: string; label: string; x: number; y: number; vx: number; vy: number; deg: number; unresolved: boolean; fixed?: boolean }

export function GraphView() {
  const canvas = useRef<HTMLCanvasElement>(null)
  const indexVersion = useModel((s) => s.indexVersion)
  const settings = useModel((s) => s.snap!.vault!.settings.graph)
  const [panel, setPanel] = useState(false)
  const sim = useRef<{ nodes: Node[]; edges: [number, number][]; alpha: number; restart: () => void; resetView: () => void } | null>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [orphansOnly, setOrphansOnly] = useState(false)
  const [empty, setEmpty] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setDebounced(query), 150)
    return () => clearTimeout(id)
  }, [query])
  // Filter and selection live in refs read by the draw loop, so changing them never rebuilds the simulation.
  const match = useMemo(() => (debounced.trim() ? new Set(searchNotes([...model.index.notes.values()], debounced, Infinity).map((h) => h.path)) : null), [debounced, indexVersion])
  const filter = useRef({ match, orphansOnly })
  filter.current = useMemo(() => ({ match, orphansOnly }), [match, orphansOnly])
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
    const degs = nodes.map((n) => n.deg)
    let shownFilter: typeof filter.current | null = null
    let visible: boolean[] = []
    let anyVisible: boolean | null = null
    let view = { x: 0, y: 0, k: 1 }
    const state = { nodes, edges, alpha: prev.size ? 0.3 : 1, restart: () => (state.alpha = 1), resetView: () => (view = { x: 0, y: 0, k: 1 }) }
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

    // shortcut: O(n²) repulsion; fine up to ~2k notes, switch to Barnes-Hut for larger vaults.
    const step = () => {
      const { linkDistance, repel } = settings
      const a = state.alpha
      for (let i = 0; i < nodes.length; i++) {
        if (!visible[i]) continue
        const n = nodes[i]
        for (let j = i + 1; j < nodes.length; j++) {
          if (!visible[j]) continue
          const m = nodes[j]
          let dx = n.x - m.x
          let dy = n.y - m.y
          let d2 = dx * dx + dy * dy
          if (d2 < 0.01) {
            dx = Math.random() - 0.5
            dy = Math.random() - 0.5
            d2 = 0.25
          }
          if (d2 > 250000) continue
          const f = (repel * a) / d2
          n.vx += dx * f
          n.vy += dy * f
          m.vx -= dx * f
          m.vy -= dy * f
        }
        // gravity keeps orphans and separate clusters in view
        n.vx -= n.x * 0.02 * a
        n.vy -= n.y * 0.02 * a
      }
      for (const [i, j] of edges) {
        const n = nodes[i]
        const m = nodes[j]
        const dx = m.x - n.x
        const dy = m.y - n.y
        const d = Math.sqrt(dx * dx + dy * dy) || 1
        const f = ((d - linkDistance) / d) * 0.05 * a
        n.vx += dx * f
        n.vy += dy * f
        m.vx -= dx * f
        m.vy -= dy * f
      }
      for (const n of nodes) {
        if (n.fixed) {
          n.vx = n.vy = 0
          continue
        }
        n.vx *= 0.6
        n.vy *= 0.6
        n.x += Math.max(-30, Math.min(30, n.vx))
        n.y += Math.max(-30, Math.min(30, n.vy))
      }
      state.alpha = Math.max(0, state.alpha * 0.985 - 0.0005)
    }

    const active = model.activeFile
    let raf = 0
    const draw = () => {
      if (shownFilter !== filter.current) {
        shownFilter = filter.current
        visible = visibleNodes(ids, degs, { ...shownFilter, showOrphans: settings.showOrphans })
        const any = visible.some(Boolean)
        if (any !== anyVisible) setEmpty(!(anyVisible = any))
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
        const focus = i === focusIdx || n.id === active
        const dim = focusIdx >= 0 && !focus && !neighbors.has(i)
        ctx.globalAlpha = dim ? 0.25 : 1
        ctx.fillStyle = focus ? accent : n.unresolved ? unresColor : nodeColor
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
    selected.current = null
    sim.current?.resetView()
  }
  return (
    <div className="graph-view" data-testid="graph" onKeyDown={(e) => e.key === 'Escape' && (selected.current = null)}>
      <canvas ref={canvas} className="graph-canvas" tabIndex={0} aria-label={t('graph.label')} />
      {filtered && empty && (
        <div className="graph-empty" role="status">
          <span>{t('graph.noMatch')}</span>
          <button className="btn" onClick={reset}>{t('graph.reset')}</button>
        </div>
      )}
      <div className="graph-controls">
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
          <label className="slider-row">
            {t('graph.distance')}
            <input type="range" min={20} max={400} value={settings.linkDistance} style={{ '--fill': `${((settings.linkDistance - 20) / 380) * 100}%` } as React.CSSProperties} onChange={(e) => set({ linkDistance: Number(e.target.value) })} />
          </label>
          <label className="slider-row">
            {t('graph.repel')}
            <input type="range" min={50} max={3000} value={settings.repel} style={{ '--fill': `${((settings.repel - 50) / 2950) * 100}%` } as React.CSSProperties} onChange={(e) => set({ repel: Number(e.target.value) })} />
          </label>
          <p className="graph-hint">{t('graph.selectHint')}</p>
          <button className="btn" onClick={reset}>{t('graph.reset')}</button>
        </div>
      )}
    </div>
  )
}
