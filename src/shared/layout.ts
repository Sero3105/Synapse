// Split layout of the workspace as a tree: a leaf is a pane id, a split lays its children out in a
// row or a column. Pure functions, so restoring and editing the layout can be tested on their own.

export type Dir = 'row' | 'column'
export interface Split { dir: Dir; children: LayoutNode[]; sizes: number[] }
export type LayoutNode = string | Split

export const MAX_PANES = 8
const MAX_DEPTH = 8

export const leaves = (n: LayoutNode): string[] => (typeof n === 'string' ? [n] : n.children.flatMap(leaves))

/**
 * Merge a split into its parent when both go the same way, and drop splits left with one child, so the
 * tree stays the simplest one for what is on screen (and one drag moves one border).
 */
export function normalize(n: LayoutNode): LayoutNode {
  if (typeof n === 'string') return n
  const children: LayoutNode[] = []
  const sizes: number[] = []
  n.children.forEach((c0, i) => {
    const c = normalize(c0)
    if (typeof c !== 'string' && c.dir === n.dir) {
      const total = c.sizes.reduce((a, b) => a + b, 0)
      c.children.forEach((cc, j) => {
        children.push(cc)
        sizes.push((n.sizes[i] * c.sizes[j]) / total)
      })
    } else {
      children.push(c)
      sizes.push(n.sizes[i])
    }
  })
  return children.length === 1 ? children[0] : { dir: n.dir, children, sizes }
}

/** Put pane `id` next to pane `target` (after it), sharing the target's space. */
export function splitLeaf(n: LayoutNode, target: string, id: string, dir: Dir): LayoutNode {
  const walk = (m: LayoutNode): LayoutNode => {
    if (m === target) return { dir, children: [target, id], sizes: [1, 1] }
    if (typeof m === 'string') return m
    return { ...m, children: m.children.map(walk) }
  }
  return normalize(walk(n))
}

/** The layout without pane `id`; its space goes to its neighbours. Null when nothing is left. */
export function removeLeaf(n: LayoutNode, id: string): LayoutNode | null {
  if (n === id) return null
  if (typeof n === 'string') return n
  const children: LayoutNode[] = []
  const sizes: number[] = []
  n.children.forEach((c, i) => {
    const r = removeLeaf(c, id)
    if (r !== null) {
      children.push(r)
      sizes.push(n.sizes[i])
    }
  })
  return children.length ? normalize({ dir: n.dir, children, sizes }) : null
}

/** New sizes for the split reached by child indexes `path` from the root. */
export function setSizes(n: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (typeof n === 'string') return n
  if (!path.length) return sizes.length === n.sizes.length ? { ...n, sizes } : n
  const [i, ...rest] = path
  return { ...n, children: n.children.map((c, j) => (j === i ? setSizes(c, rest, sizes) : c)) }
}

export interface Rect { x: number; y: number; w: number; h: number }
/** A draggable border: between children `index` and `index + 1` of the split at `path`. */
export interface Bar { path: number[]; index: number; dir: Dir; split: Rect; at: number }

/** Where each pane and each border goes, as fractions of the workspace. */
export function layoutRects(n: LayoutNode): { panes: Map<string, Rect>; bars: Bar[] } {
  const panes = new Map<string, Rect>()
  const bars: Bar[] = []
  const walk = (m: LayoutNode, r: Rect, path: number[]) => {
    if (typeof m === 'string') return void panes.set(m, r)
    const total = m.sizes.reduce((a, b) => a + b, 0)
    let pos = 0
    m.children.forEach((c, i) => {
      const f = m.sizes[i] / total
      const child = m.dir === 'row' ? { x: r.x + pos * r.w, y: r.y, w: f * r.w, h: r.h } : { x: r.x, y: r.y + pos * r.h, w: r.w, h: f * r.h }
      pos += f
      if (i < m.children.length - 1) bars.push({ path, index: i, dir: m.dir, split: r, at: pos })
      walk(c, child, [...path, i])
    })
  }
  walk(n, { x: 0, y: 0, w: 1, h: 1 }, [])
  return { panes, bars }
}

/** The saved form: leaves are indexes into the saved list of panes. */
export function toSaved(n: LayoutNode, index: Map<string, number>): unknown {
  return typeof n === 'string' ? index.get(n) : { dir: n.dir, children: n.children.map((c) => toSaved(c, index)), sizes: n.sizes }
}

/**
 * Read a saved layout. `ids[i]` is the restored pane for saved pane i (undefined if that pane was
 * dropped: its leaf goes away). Null when the layout is not usable: missing, malformed, or not
 * placing every restored pane exactly once; the caller then lays the panes out in a row.
 */
export function fromSaved(raw: unknown, ids: (string | undefined)[]): LayoutNode | null {
  const seen = new Set<string>()
  const read = (x: unknown, depth: number): LayoutNode | null | 'drop' => {
    if (typeof x === 'number') {
      if (!Number.isInteger(x) || x < 0 || x >= ids.length) return null
      const id = ids[x]
      if (id === undefined) return 'drop'
      if (seen.has(id)) return null
      seen.add(id)
      return id
    }
    if (depth > MAX_DEPTH || typeof x !== 'object' || x === null) return null
    const s = x as Record<string, unknown>
    if ((s.dir !== 'row' && s.dir !== 'column') || !Array.isArray(s.children) || !Array.isArray(s.sizes)) return null
    if (s.children.length < 2 || s.children.length > MAX_PANES || s.sizes.length !== s.children.length) return null
    if (!s.sizes.every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0)) return null
    const children: LayoutNode[] = []
    const sizes: number[] = []
    for (let i = 0; i < s.children.length; i++) {
      const c = read(s.children[i], depth + 1)
      if (c === null) return null
      if (c === 'drop') continue
      children.push(c)
      sizes.push(s.sizes[i] as number)
    }
    return children.length ? { dir: s.dir, children, sizes } : 'drop'
  }
  const r = read(raw, 0)
  if (r === null || r === 'drop') return null
  const restored = ids.filter((id): id is string => id !== undefined)
  return restored.every((id) => seen.has(id)) ? normalize(r) : null
}
