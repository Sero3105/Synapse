import { describe, it, expect } from 'vitest'
import { startLists } from '../src/shared/start'

const f = (path: string, mtime = 0) => ({ path, type: 'file', mtime })

describe('start page lists', () => {
  it('keeps order, removes duplicates across lists and drops missing notes', () => {
    const files = [f('a.md', 1), f('b.md', 5), f('c.md', 9), f('d.md', 3), f('img.png', 99), { path: 'dir', type: 'folder', mtime: 50 }]
    const r = startLists(files, ['c.md', 'gone.md', 'a.md', 'c.md'], ['b.md', 'deleted.md'])
    expect(r.pinned).toEqual(['b.md'])
    expect(r.recent).toEqual(['c.md', 'a.md'])
    expect(r.modified).toEqual(['d.md']) // notes only, newest first, not already listed
  })

  it('caps the lists', () => {
    const files = Array.from({ length: 30 }, (_, i) => f(`n${i}.md`, i))
    const r = startLists(files, files.map((x) => x.path), [], 7)
    expect(r.recent).toHaveLength(7)
    expect(r.recent).toEqual(['n0.md', 'n1.md', 'n2.md', 'n3.md', 'n4.md', 'n5.md', 'n6.md'])
    expect(r.modified).toEqual(['n29.md', 'n28.md', 'n27.md', 'n26.md', 'n25.md'])
  })

  it('templates never count as recently modified notes', () => {
    const r = startLists([{ path: 'Templates/Book.md', type: 'file', mtime: 9 }, { path: 'Note.md', type: 'file', mtime: 1 }], [], [])
    expect(r.modified).toEqual(['Note.md'])
  })
})
