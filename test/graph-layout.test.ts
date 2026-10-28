import { describe, it, expect } from 'vitest'
import { layoutStep, repulsion, BARNES_HUT_MIN, SimNode } from '../src/shared/graph-layout'

const random = (n: number, box = 400): SimNode[] => Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * box, y: (Math.random() - 0.5) * box, vx: 0, vy: 0 }))
const copy = (ns: SimNode[]) => ns.map((n) => ({ ...n }))

describe('graph layout', () => {
  it('Barnes–Hut repulsion stays close to the exact pairwise sum', () => {
    const base = random(2000) // all within the 500 px cutoff, as when the graph opens
    const exact = copy(base)
    const approx = copy(base)
    const all = base.map(() => true)
    repulsion(exact, all, 600, false)
    repulsion(approx, all, 600, true)
    let err = 0
    let mag = 0
    exact.forEach((e, i) => {
      err += Math.hypot(e.vx - approx[i].vx, e.vy - approx[i].vy)
      mag += Math.hypot(e.vx, e.vy)
    })
    expect(err / mag).toBeLessThan(0.05)
  })

  it('a settled Barnes–Hut layout has the size of the exact one', () => {
    const n = 1500
    const base = random(n)
    const edges: [number, number][] = Array.from({ length: n }, (_, i) => [i, (i * 7 + 1) % n])
    const settle = (bh: boolean) => {
      const ns = copy(base)
      const all = ns.map(() => true)
      for (let a = 1; a > 0.002; a = a * 0.985 - 0.0005) layoutStep(ns, edges, all, { linkDistance: 80, repel: 600 }, a, bh)
      const r = ns.map((p) => Math.hypot(p.x, p.y)).sort((x, y) => x - y)
      return r[n >> 1]
    }
    const exact = settle(false)
    expect(Math.abs(settle(true) - exact) / exact).toBeLessThan(0.1)
  })

  it('hidden nodes neither move others nor get pushed', () => {
    const ns = [{ x: 0, y: 0, vx: 0, vy: 0 }, { x: 1, y: 0, vx: 0, vy: 0 }, { x: 2, y: 0, vx: 0, vy: 0 }]
    for (const bh of [false, true]) {
      const c = copy(ns)
      repulsion(c, [true, false, true], 10, bh)
      expect(c[1]).toEqual(ns[1])
      expect(c[0].vx).toBeLessThan(0)
      expect(c[2].vx).toBeGreaterThan(0)
    }
  })

  it('a large vault settles into a finite, spread-out layout', () => {
    const n = BARNES_HUT_MIN * 3
    const nodes = random(n)
    const edges: [number, number][] = Array.from({ length: n }, (_, i) => [i, (i * 7 + 1) % n])
    const visible = nodes.map(() => true)
    for (let a = 1; a > 0.002; a = a * 0.985 - 0.0005) layoutStep(nodes, edges, visible, { linkDistance: 80, repel: 600 }, a)
    expect(nodes.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true)
    const spread = Math.max(...nodes.map((p) => Math.hypot(p.x, p.y)))
    expect(spread).toBeGreaterThan(400) // pushed apart from the 400 px start box
    expect(spread).toBeLessThan(20000) // gravity keeps it in view
  })

  it('one step on 5 000 notes fits in a frame budget', () => {
    const nodes = random(5000)
    const visible = nodes.map(() => true)
    layoutStep(nodes, [], visible, { linkDistance: 80, repel: 600 }, 1) // warm up
    const t0 = performance.now()
    layoutStep(nodes, [], visible, { linkDistance: 80, repel: 600 }, 1)
    expect(performance.now() - t0).toBeLessThan(40) // the pairwise sum took ~60 ms here
  })
})
