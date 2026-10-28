import { describe, it, expect } from 'vitest'
import { visibleNodes, neighbours, localNodes, colorGroups, extraColor } from '../src/shared/graph-filter'
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

  describe('local graph', () => {
    // 0 - 1 - 2 - 3, 4 alone; 5 linked to 1
    const e: [number, number][] = [[0, 1], [1, 2], [2, 3], [5, 1]]
    const all = [true, true, true, true, true, true]
    it('depth 1: the centre and its direct links, both directions', () => {
      expect(localNodes(e, all, 1, 1)).toEqual([true, true, true, false, false, true])
      expect(localNodes(e, all, 0, 1)).toEqual([true, true, false, false, false, false])
    })
    it('depth 2 adds the links of the linked notes', () => {
      expect(localNodes(e, all, 0, 2)).toEqual([true, true, true, false, false, true])
      expect(localNodes(e, all, 3, 2)).toEqual([false, true, true, true, false, false])
    })
    it('an unlinked centre shows alone, even when orphans are hidden', () => {
      expect(localNodes(e, [true, true, true, true, false, true], 4, 2)).toEqual([false, false, false, false, true, false])
    })
    it('does not walk through notes the filters hide', () => {
      expect(localNodes(e, [true, false, true, true, true, true], 0, 2)).toEqual([true, false, false, false, false, false])
    })
    it('no centre, no nodes', () => {
      expect(localNodes(e, all, -1, 2).some(Boolean)).toBe(false)
    })
  })
})

describe('graph colour groups', () => {
  it('every group gets a colour: the palette for the biggest, generated hues after it', () => {
    const { color, legend } = colorGroups(['work', 'work', 'home', null, 'misc', 'home', 'work'], {}, ['red', 'blue'])
    expect(legend.map((l) => [l.key, l.count])).toEqual([['work', 3], ['home', 2], ['misc', 1]])
    expect(color.get('work')).toBe('red')
    expect(color.get('home')).toBe('blue')
    expect(color.get('misc')).toMatch(/^#[0-9a-f]{6}$/) // past the palette, still coloured
  })
  it('a colour the user picked wins and is marked as theirs', () => {
    const { legend } = colorGroups(['a', 'b'], { b: '#123456' }, ['red', 'blue'])
    expect(legend).toEqual([{ key: 'a', color: 'red', count: 1, custom: false }, { key: 'b', color: '#123456', count: 1, custom: true }])
  })
  it('ties are ordered by name, so colours do not shuffle', () => {
    expect(colorGroups(['b', 'a'], {}, ['red', 'blue']).legend.map((l) => l.key)).toEqual(['a', 'b'])
  })
  it('generated colours are valid and distinct', () => {
    const many = Array.from({ length: 20 }, (_, i) => extraColor(i))
    expect(many.every((c) => /^#[0-9a-f]{6}$/.test(c))).toBe(true)
    expect(new Set(many).size).toBe(20)
  })
})
