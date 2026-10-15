import { describe, it, expect } from 'vitest'
import { parseNote, resolveLink, buildLookup, NoteIndex, rewriteLinks, uniqueName, fuzzyScore, searchNotes, wordCount } from '../src/shared/markdown'

describe('parseNote', () => {
  it('extracts wiki, embed and markdown links with alias and subpath', () => {
    const m = parseNote('See [[Note A]] and [[b/Note B#Head|alias]] ![[img.png]] [x](Note%20C.md) [web](https://x.y)')
    expect(m.links.map((l) => [l.target, l.subpath, l.alias, l.embed, l.kind])).toEqual([
      ['Note A', '', '', false, 'wiki'],
      ['b/Note B', 'Head', 'alias', false, 'wiki'],
      ['img.png', '', '', true, 'wiki'],
      ['Note C.md', '', 'x', false, 'md'],
    ])
  })

  it('ignores links and tags in code', () => {
    const m = parseNote('```\n[[no]] #no\n```\n`[[no2]]` [[yes]] #yes')
    expect(m.links.map((l) => l.target)).toEqual(['yes'])
    expect(m.tags).toEqual(['#yes'])
  })

  it('extracts tags (nested, unicode, frontmatter) but not headings or numbers', () => {
    const m = parseNote('---\ntags: [project, "draft"]\n---\n# Title\nText #área/sub #123 #ok-1')
    expect(m.tags.sort()).toEqual(['#draft', '#ok-1', '#project', '#área/sub'].sort())
    expect(m.headings).toEqual([{ level: 1, text: 'Title', line: 3 }])
  })

  it('frontmatter list tags', () => {
    expect(parseNote('---\ntags:\n  - a\n  - b\n---\nx').tags).toEqual(['#a', '#b'])
  })
})

describe('resolveLink', () => {
  const files = ['Note.md', 'a/Note.md', 'a/b/Deep.md', 'b/Deep.md', 'img.png', 'Café.md']
  const lookup = buildLookup(files)
  it('unique basename, case-insensitive', () => {
    expect(resolveLink('café', 'x.md', lookup)).toBe('Café.md')
    expect(resolveLink('IMG.png', 'x.md', lookup)).toBe('img.png')
  })
  it('exact path wins', () => {
    expect(resolveLink('a/Note', 'x.md', lookup)).toBe('a/Note.md')
    expect(resolveLink('Note', 'x.md', lookup)).toBe('Note.md')
  })
  it('prefers files under the source folder for ambiguous names', () => {
    expect(resolveLink('Deep', 'a/b/src.md', lookup)).toBe('a/b/Deep.md')
    expect(resolveLink('Deep', 'b/src.md', lookup)).toBe('b/Deep.md')
  })
  it('relative paths', () => {
    expect(resolveLink('../Note', 'a/b/src.md', lookup)).toBe('a/Note.md')
    expect(resolveLink('./Deep', 'b/src.md', lookup)).toBe('b/Deep.md')
  })
  it('unresolved', () => {
    expect(resolveLink('Missing', 'x.md', lookup)).toBeNull()
  })
})

describe('NoteIndex', () => {
  const idx = new NoteIndex()
  idx.setFiles(['A.md', 'B.md', 'C.md'])
  idx.upsert('A.md', 'Links [[B]] and [[B]] and [[Nope]] #t1')
  idx.upsert('B.md', 'Back to [[a]]')
  idx.upsert('C.md', 'Mentions B without a link. #T1')

  it('backlinks', () => {
    expect(idx.backlinks('B.md').map((b) => [b.source, b.links.length])).toEqual([['A.md', 2]])
  })
  it('graph edges are unique and unresolved tracked', () => {
    const g = idx.graph()
    expect(g.edges).toEqual([['A.md', 'B.md'], ['B.md', 'A.md']])
    expect([...g.unresolved.keys()]).toEqual(['nope'])
  })
  it('unlinked mentions', () => {
    const i2 = new NoteIndex()
    i2.setFiles(['Topic.md', 'x.md', 'y.md', 'z.md'])
    i2.upsert('x.md', 'About the topic here.')
    i2.upsert('y.md', 'Linked [[Topic]] topic')
    i2.upsert('z.md', 'Topical is not a mention')
    expect(i2.unlinkedMentions('Topic.md').map((m) => m.source)).toEqual(['x.md'])
  })
  it('tags case-insensitive counts', () => {
    expect([...idx.tags()]).toEqual([['#t1', 2]])
  })
  it('search: AND, phrase, negation, tag, path', () => {
    expect(idx.search('links nope').map((h) => h.path)).toEqual(['A.md'])
    expect(idx.search('"without a link"').map((h) => h.path)).toEqual(['C.md'])
    expect(idx.search('tag:#t1 -mentions').map((h) => h.path)).toEqual(['A.md'])
    expect(idx.search('file:b').map((h) => h.path)).toEqual(['B.md'])
    const hit = idx.search('back')[0]
    expect(hit.matches[0]).toMatchObject({ line: 0, ranges: [[0, 4]] })
  })
})

describe('rewriteLinks', () => {
  it('updates wiki and markdown links pointing to a renamed note, keeping alias/subpath', () => {
    const before = buildLookup(['Old.md', 'x.md'])
    const after = buildLookup(['folder/New name.md', 'x.md'])
    const out = rewriteLinks('[[Old]] [[old#H|al]] ![[Old]] [t](Old.md) [[Other]]', 'x.md', new Map([['Old.md', 'folder/New name.md']]), before, after)
    expect(out).toBe('[[New name]] [[New name#H|al]] ![[New name]] [t](folder/New%20name.md) [[Other]]')
  })
  it('returns null when unchanged', () => {
    const l = buildLookup(['a.md'])
    expect(rewriteLinks('[[a]]', 'x.md', new Map([['b.md', 'c.md']]), l, l)).toBeNull()
  })
  it('uses a path when the new basename is ambiguous', () => {
    const before = buildLookup(['Old.md', 'z/Dup.md'])
    const after = buildLookup(['y/Dup.md', 'z/Dup.md'])
    expect(rewriteLinks('[[Old]]', 'x.md', new Map([['Old.md', 'y/Dup.md']]), before, after)).toBe('[[y/Dup]]')
  })
})

describe('helpers', () => {
  it('uniqueName', () => {
    expect(uniqueName(new Set(['Untitled.md', 'untitled 1.md']), '', 'Untitled', '.md')).toBe('Untitled 2.md')
    expect(uniqueName(new Set(), 'f', 'Untitled', '.md')).toBe('f/Untitled.md')
  })
  it('fuzzyScore', () => {
    expect(fuzzyScore('nte', 'note')).toBeGreaterThan(0)
    expect(fuzzyScore('xyz', 'note')).toBe(-1)
    expect(fuzzyScore('note', 'note')).toBeGreaterThan(fuzzyScore('note', 'n-o-t-e'))
  })
  it('wordCount handles unicode', () => {
    expect(wordCount('héllo wörld, 你好 it’s').words).toBe(4)
  })
  it('search scales', () => {
    const notes = Array.from({ length: 5000 }, (_, i) => ({ path: `n${i}.md`, content: `note ${i} lorem ipsum dolor `.repeat(20), meta: { links: [], tags: [], headings: [] } }))
    const t = performance.now()
    expect(searchNotes(notes, 'ipsum 4999', 10).length).toBeGreaterThan(0)
    expect(performance.now() - t).toBeLessThan(500)
  })
})
