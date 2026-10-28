import { describe, it, expect } from 'vitest'
import { sortEntries, type SortableEntry } from '../src/shared/file-sort'

const e = (name: string, type: 'file' | 'folder', mtime = 0, created = 0): SortableEntry => ({ name, type, mtime, created })

describe('sortEntries', () => {
  it('by name: folders first, natural numeric order, case-insensitive', () => {
    const out = sortEntries([e('note10.md', 'file'), e('Zoo', 'folder'), e('note2.md', 'file'), e('apple.md', 'file')], 'name')
    expect(out.map((x) => x.name)).toEqual(['Zoo', 'apple.md', 'note2.md', 'note10.md'])
  })
  it('by modified: newest first, folders still first, name breaks ties', () => {
    const out = sortEntries([e('old.md', 'file', 100), e('FolderB', 'folder', 10), e('new.md', 'file', 300), e('mid.md', 'file', 200), e('FolderA', 'folder', 20), e('also200.md', 'file', 200)], 'modified')
    expect(out.map((x) => x.name)).toEqual(['FolderA', 'FolderB', 'new.md', 'also200.md', 'mid.md', 'old.md'])
  })
  it('by created: newest first, unknown times (0) last', () => {
    const out = sortEntries([e('a.md', 'file', 0, 100), e('b.md', 'file', 0, 0), e('c.md', 'file', 0, 500)], 'created')
    expect(out.map((x) => x.name)).toEqual(['c.md', 'a.md', 'b.md'])
  })
  it('does not mutate the input', () => {
    const input = [e('b.md', 'file'), e('a.md', 'file')]
    sortEntries(input, 'name')
    expect(input.map((x) => x.name)).toEqual(['b.md', 'a.md'])
  })
})
