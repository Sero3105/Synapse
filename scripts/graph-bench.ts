// Graph layout cost at different vault sizes: `npm run bench:graph`.
// Node runs this TypeScript file directly (type stripping); the layout module has no other imports.
import { layoutStep, type SimNode } from '../src/shared/graph-layout.ts'

const settings = { linkDistance: 80, repel: 600 }

/** Lay out `n` notes (~1.5 links each) from the app's start box; ms of the first step and seconds to settle. */
function run(n: number, barnesHut: boolean) {
  const nodes: SimNode[] = Array.from({ length: n }, () => ({ x: (Math.random() - 0.5) * 400, y: (Math.random() - 0.5) * 400, vx: 0, vy: 0 }))
  const edges: [number, number][] = Array.from({ length: Math.round(n * 1.5) }, () => [Math.floor(Math.random() * n), Math.floor(Math.random() * n)])
  const visible = nodes.map(() => true)
  let first = 0
  const t0 = performance.now()
  for (let a = 1, i = 0; a > 0.002; a = Math.max(0, a * 0.985 - 0.0005), i++) {
    const s = performance.now()
    layoutStep(nodes, edges, visible, settings, a, barnesHut)
    if (i === 1) first = performance.now() - s // step 0 includes JIT warm-up
  }
  return { first, total: (performance.now() - t0) / 1000 }
}

console.log('notes   pairwise: ms/step  s to settle   Barnes–Hut: ms/step  s to settle')
for (const n of [500, 1000, 2000, 5000, 10000]) {
  const exact = n <= 5000 ? run(n, false) : null // 10k pairwise takes minutes
  const bh = run(n, true)
  const col = (r: { first: number; total: number } | null) => (r ? `${r.first.toFixed(1).padStart(14)}  ${r.total.toFixed(1).padStart(11)}` : '             –            –')
  console.log(`${String(n).padStart(5)}   ${col(exact)}   ${col(bh)}`)
}
