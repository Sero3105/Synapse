// Force layout of the graph view, kept free of canvas code so it can be tested and measured.

export interface SimNode { x: number; y: number; vx: number; vy: number; fixed?: boolean }

/** Above this many visible nodes repulsion uses Barnes–Hut; below, the exact pairwise sum (unchanged behaviour). */
export const BARNES_HUT_MIN = 1000
const THETA2 = 0.81 // θ = 0.9: a cell narrower than 0.9× its distance acts as one body
const CUTOFF2 = 250000 // nodes farther than 500 px do not push each other

/** One simulation tick: repulsion between visible nodes, link springs, gravity, damping. Mutates `nodes`. */
export function layoutStep(nodes: SimNode[], edges: [number, number][], visible: boolean[], s: { linkDistance: number; repel: number }, a: number, barnesHut?: boolean) {
  const { linkDistance, repel } = s
  repulsion(nodes, visible, repel * a, barnesHut ?? visible.filter(Boolean).length > BARNES_HUT_MIN)
  for (let i = 0; i < nodes.length; i++) {
    if (!visible[i]) continue
    // gravity keeps orphans and separate clusters in view
    nodes[i].vx -= nodes[i].x * 0.02 * a
    nodes[i].vy -= nodes[i].y * 0.02 * a
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
}

/** Push visible nodes apart with strength `k` / distance. */
export function repulsion(nodes: SimNode[], visible: boolean[], k: number, barnesHut: boolean) {
  if (!barnesHut) {
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
        if (d2 > CUTOFF2) continue
        const f = k / d2
        n.vx += dx * f
        n.vy += dy * f
        m.vx -= dx * f
        m.vy -= dy * f
      }
    }
    return
  }
  const ids: number[] = []
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  nodes.forEach((n, i) => {
    if (!visible[i]) return
    ids.push(i)
    x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y)
  })
  if (!ids.length) return
  const root = build(nodes, ids, x0, y0, Math.max(x1 - x0, y1 - y0, 1), 0)
  const stack: Cell[] = []
  for (const i of ids) {
    const n = nodes[i]
    stack.push(root)
    while (stack.length) {
      const c = stack.pop()!
      const dx = n.x - c.cx
      const dy = n.y - c.cy
      const d2 = dx * dx + dy * dy
      if (c.kids && c.size * c.size < THETA2 * d2) {
        // a far cell acts as one body; its centre decides the 500 px cutoff for all of it, which makes
        // large layouts ~5% more compact than the exact sum (measured), at a fraction of the cost
        if (d2 > CUTOFF2) continue
        const f = (k * c.mass) / d2
        n.vx += dx * f
        n.vy += dy * f
      } else if (c.kids) {
        for (const kid of c.kids) if (kid) stack.push(kid)
      } else {
        for (const j of c.points!) {
          if (j === i) continue
          let ex = n.x - nodes[j].x
          let ey = n.y - nodes[j].y
          let e2 = ex * ex + ey * ey
          if (e2 < 0.01) {
            ex = Math.random() - 0.5
            ey = Math.random() - 0.5
            e2 = 0.25
          }
          if (e2 > CUTOFF2) continue
          const f = k / e2
          n.vx += ex * f
          n.vy += ey * f
        }
      }
    }
  }
}

interface Cell { size: number; mass: number; cx: number; cy: number; kids: (Cell | null)[] | null; points: number[] | null }

/** Quadtree over `ids` in the square (x0, y0, size); leaves hold one node, or several stacked on the same spot. */
function build(nodes: SimNode[], ids: number[], x0: number, y0: number, size: number, depth: number): Cell {
  let cx = 0
  let cy = 0
  for (const i of ids) {
    cx += nodes[i].x
    cy += nodes[i].y
  }
  const cell: Cell = { size, mass: ids.length, cx: cx / ids.length, cy: cy / ids.length, kids: null, points: null }
  if (ids.length === 1 || depth > 20) {
    cell.points = ids
    return cell
  }
  const h = size / 2
  const quads: number[][] = [[], [], [], []]
  for (const i of ids) quads[(nodes[i].x >= x0 + h ? 1 : 0) + (nodes[i].y >= y0 + h ? 2 : 0)].push(i)
  cell.kids = quads.map((q, k) => (q.length ? build(nodes, q, x0 + (k & 1 ? h : 0), y0 + (k & 2 ? h : 0), h, depth + 1) : null))
  return cell
}
