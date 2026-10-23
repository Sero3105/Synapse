// A tiny force layout (repulsion, springs, centering), deterministic so the build and the
// browser start from the same picture.
export interface GraphNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** Pinned while dragged. */
  fixed?: boolean
}

export interface Graph {
  nodes: GraphNode[]
  edges: [number, number][]
}

export function buildGraph(links: readonly (readonly [string, string])[], width: number, height: number): Graph {
  const ids = [...new Set(links.flat())]
  const index = new Map(ids.map((id, i) => [id, i]))
  const nodes = ids.map((id, i) => {
    const a = (i / ids.length) * Math.PI * 2
    return { id, x: width / 2 + Math.cos(a) * width * 0.3, y: height / 2 + Math.sin(a) * height * 0.3, vx: 0, vy: 0 }
  })
  const seen = new Set<string>()
  const edges: [number, number][] = []
  for (const [a, b] of links) {
    const key = [a, b].sort().join('→')
    if (seen.has(key)) continue
    seen.add(key)
    edges.push([index.get(a)!, index.get(b)!])
  }
  return { nodes, edges }
}

export function tick(g: Graph, width: number, height: number, strength = 1) {
  const { nodes, edges } = g
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!
      let dx = a.x - b.x
      let dy = a.y - b.y
      const d2 = Math.max(dx * dx + dy * dy, 100)
      const f = (5200 / d2) * strength
      const d = Math.sqrt(d2)
      dx /= d
      dy /= d
      a.vx += dx * f
      a.vy += dy * f
      b.vx -= dx * f
      b.vy -= dy * f
    }
  }
  for (const [i, j] of edges) {
    const a = nodes[i]!
    const b = nodes[j]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const d = Math.sqrt(dx * dx + dy * dy) || 1
    const f = (d - 110) * 0.02 * strength
    a.vx += (dx / d) * f
    a.vy += (dy / d) * f
    b.vx -= (dx / d) * f
    b.vy -= (dy / d) * f
  }
  for (const n of nodes) {
    n.vx += (width / 2 - n.x) * 0.004 * strength
    n.vy += (height / 2 - n.y) * 0.006 * strength
    if (n.fixed) {
      n.vx = n.vy = 0
      continue
    }
    n.vx *= 0.82
    n.vy *= 0.82
    n.x = Math.min(width - 40, Math.max(40, n.x + n.vx))
    n.y = Math.min(height - 24, Math.max(24, n.y + n.vy))
  }
}

export function settle(g: Graph, width: number, height: number, steps = 400) {
  for (let i = 0; i < steps; i++) tick(g, width, height)
  return g
}
