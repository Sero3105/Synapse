import { describe, it, expect } from 'vitest'
import { visibleNodes, neighbours } from '../src/shared/graph-filter'
import { NoteIndex, searchNotes } from '../src/shared/markdown'

const ids = ['a.md', 'b.md', 'c.md', 'lonely.md']
const edges: [number, number][] = [[0, 1], [1, 2]]
const deg = [1, 2, 1, 0]

describe('graph filter', () => {
  it('shows everything by default and hides orphans when asked', () => {
    expect(visibleNodes(ids, deg, { match: null, showOrphans: true, orphansOnly: false })).toEqual([true, true, true, true])
    expect(visibleNodes(ids, deg, { match: null, showOrphans: false, orphansOnly: false })).toEqual([true, true, true, false])
  })

  it('can show only unlinked notes, whatever the orphan setting', () => {
    expect(visibleNodes(ids, deg, { match: null, showOrphans: false, orphansOnly: true })).toEqual([false, false, false, true])
  })

  it('limits nodes to search matches, including folder and tag queries', () => {
    const ix = new NoteIndex()
    ix.setFiles(['proj/a.md', 'b.md'])
    ix.upsert('proj/a.md', '#work alpha')
    ix.upsert('b.md', 'beta')
    const m = (q: string) => new Set(searchNotes([...ix.notes.values()], q, Infinity).map((h) => h.path))
    const all = ['proj/a.md', 'b.md']
    expect(visibleNodes(all, [0, 0], { match: m('path:proj'), showOrphans: true, orphansOnly: false })).toEqual([true, false])
    expect(visibleNodes(all, [0, 0], { match: m('tag:work'), showOrphans: true, orphansOnly: false })).toEqual([true, false])
    expect(visibleNodes(all, [0, 0], { match: m('file:b'), showOrphans: true, orphansOnly: false })).toEqual([false, true])
  })

  it('an empty match hides every node (the view shows its empty state)', () => {
    expect(visibleNodes(ids, deg, { match: new Set(), showOrphans: true, orphansOnly: false }).some(Boolean)).toBe(false)
  })

  it('finds the direct neighbours of a selected node', () => {
    expect([...neighbours(edges, 1)].sort()).toEqual([0, 2])
    expect([...neighbours(edges, 3)]).toEqual([])
    expect([...neighbours(edges, -1)]).toEqual([])
  })

  it('filters a large graph quickly', () => {
    const n = 20000
    const big = Array.from({ length: n }, (_, i) => `n${i}.md`)
    const d = big.map((_, i) => i % 3)
    const t0 = performance.now()
    const v = visibleNodes(big, d, { match: new Set(big.slice(0, 100)), showOrphans: false, orphansOnly: false })
    expect(performance.now() - t0).toBeLessThan(50)
    expect(v.filter(Boolean).length).toBe(66)
  })
})
