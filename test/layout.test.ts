import { describe, it, expect } from 'vitest'
import { splitLeaf, removeLeaf, setSizes, leaves, layoutRects, toSaved, fromSaved, normalize, LayoutNode } from '../src/shared/layout'

describe('split layout tree', () => {
  it('splitting a pane the other way nests: two notes side by side on the left, one on the right', () => {
    let l: LayoutNode = 'a'
    l = splitLeaf(l, 'a', 'b', 'row') // a | b
    l = splitLeaf(l, 'a', 'c', 'column') // (a / c) | b
    expect(l).toEqual({ dir: 'row', children: [{ dir: 'column', children: ['a', 'c'], sizes: [1, 1] }, 'b'], sizes: [1, 1] })
    expect(leaves(l)).toEqual(['a', 'c', 'b'])
  })

  it('splitting the same way adds a sibling that shares only the split pane\'s space', () => {
    const l = splitLeaf(splitLeaf('a', 'a', 'b', 'row'), 'a', 'c', 'row')
    expect(l).toEqual({ dir: 'row', children: ['a', 'c', 'b'], sizes: [0.5, 0.5, 1] })
  })

  it('closing a pane gives its space back and removes splits left with one pane', () => {
    const l = splitLeaf(splitLeaf('a', 'a', 'b', 'row'), 'a', 'c', 'column') // (a / c) | b
    expect(removeLeaf(l, 'c')).toEqual({ dir: 'row', children: ['a', 'b'], sizes: [1, 1] })
    expect(removeLeaf(l, 'b')).toEqual({ dir: 'column', children: ['a', 'c'], sizes: [1, 1] })
    expect(removeLeaf('a', 'a')).toBeNull()
  })

  it('a nested split merges into a parent going the same way', () => {
    // row[ a, column[ row[b, c] ] ] once the column has a single child
    expect(normalize({ dir: 'row', children: ['a', { dir: 'column', children: [{ dir: 'row', children: ['b', 'c'], sizes: [1, 3] }], sizes: [1] }], sizes: [2, 2] }))
      .toEqual({ dir: 'row', children: ['a', 'b', 'c'], sizes: [2, 0.5, 1.5] })
  })

  it('resizes only the split it is asked to', () => {
    const l = splitLeaf(splitLeaf('a', 'a', 'b', 'row'), 'a', 'c', 'column')
    expect(setSizes(l, [0], [3, 1])).toEqual({ dir: 'row', children: [{ dir: 'column', children: ['a', 'c'], sizes: [3, 1] }, 'b'], sizes: [1, 1] })
    expect(setSizes(l, [], [1, 2, 3])).toEqual(l) // wrong number of sizes: unchanged
  })

  it('places panes and borders as fractions of the workspace', () => {
    const l = splitLeaf(splitLeaf('a', 'a', 'b', 'row'), 'a', 'c', 'column')
    const { panes, bars } = layoutRects(l)
    expect(panes.get('a')).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 })
    expect(panes.get('c')).toEqual({ x: 0, y: 0.5, w: 0.5, h: 0.5 })
    expect(panes.get('b')).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 })
    expect(bars).toEqual([
      { path: [], index: 0, dir: 'row', split: { x: 0, y: 0, w: 1, h: 1 }, at: 0.5 },
      { path: [0], index: 0, dir: 'column', split: { x: 0, y: 0, w: 0.5, h: 1 }, at: 0.5 },
    ])
  })
})

describe('saved layout', () => {
  const l = splitLeaf(splitLeaf('a', 'a', 'b', 'row'), 'a', 'c', 'column')
  const saved = toSaved(l, new Map([['a', 0], ['b', 1], ['c', 2]]))

  it('round-trips through pane indexes', () => {
    expect(saved).toEqual({ dir: 'row', children: [{ dir: 'column', children: [0, 2], sizes: [1, 1] }, 1], sizes: [1, 1] })
    expect(fromSaved(JSON.parse(JSON.stringify(saved)), ['A', 'B', 'C'])).toEqual({ dir: 'row', children: [{ dir: 'column', children: ['A', 'C'], sizes: [1, 1] }, 'B'], sizes: [1, 1] })
  })

  it('a pane that could not be restored drops out of the layout', () => {
    expect(fromSaved(saved, ['A', 'B', undefined])).toEqual({ dir: 'row', children: ['A', 'B'], sizes: [1, 1] })
  })

  it('anything unusable gives null, so the caller falls back to a row', () => {
    for (const bad of [
      undefined, null, 'x', 7, -1, 0.5, // not a layout, or an index out of range
      { dir: 'diagonal', children: [0, 1, 2], sizes: [1, 1, 1] },
      { dir: 'row', children: [0, 1, 2], sizes: [1, 1] }, // sizes do not match
      { dir: 'row', children: [0, 1, 2], sizes: [1, -1, 1] },
      { dir: 'row', children: [0, 0, 1, 2], sizes: [1, 1, 1, 1] }, // a pane twice
      { dir: 'row', children: [0, 1], sizes: [1, 1] }, // pane 2 missing
      { dir: 'row', children: [0], sizes: [1] },
    ]) expect(fromSaved(bad, ['A', 'B', 'C'])).toBeNull()
    // deeply nested input is refused, not followed
    let deep: unknown = 0
    for (let i = 0; i < 50; i++) deep = { dir: 'row', children: [deep, 1], sizes: [1, 1] }
    expect(fromSaved(deep, ['A', 'B'])).toBeNull()
  })
})
