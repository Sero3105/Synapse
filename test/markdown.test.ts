import { describe, it, expect } from 'vitest'
import { parseNote, resolveLink, buildLookup, NoteIndex, rewriteLinks, uniqueName, fuzzyScore, searchNotes, wordCount, parseQuery, SEARCH_SYNTAX, headingRef, headingId, relativeHref, linkMentionLine } from '../src/shared/markdown'
import { DICTIONARIES } from '../src/shared/i18n'

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

describe('block ids', () => {
  it('extracts trailing ^id from paragraphs, list items and headings, not from code', () => {
    const m = parseNote('A quoted paragraph. ^quote-1\n\n- an item ^item_2\n\n## Results ^res\n\n```\nnot a block ^nope\n```\n\nNo marker here ^\nTrailing caret^no-space')
    expect(m.blocks).toEqual([
      { id: 'quote-1', line: 0 },
      { id: 'item_2', line: 2 },
      { id: 'res', line: 4 },
    ])
  })
  it('parses [[Note^id]] and [[Note#^id]] to the same block subpath', () => {
    const m = parseNote('[[Other^quote-1]] and [[Other#^quote-1|alias]] and [[Other#Heading]]')
    expect(m.links.map((l) => [l.target, l.subpath])).toEqual([
      ['Other', '^quote-1'],
      ['Other', '^quote-1'],
      ['Other', 'Heading'],
    ])
  })
  it('keeps the block when a rename rewrites the link', () => {
    const before = buildLookup(['Old.md', 'x.md'])
    const after = buildLookup(['New.md', 'x.md'])
    expect(rewriteLinks('[[Old^quote-1]]', 'x.md', new Map([['Old.md', 'New.md']]), before, after)).toBe('[[New#^quote-1]]')
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
  it('linkMentionLine wraps the first plain mention of the line', () => {
    const raw = 'As decided in the Riunione di marzo, see Riunione di marzo notes.'
    expect(linkMentionLine(`x\n${raw}`, 1, raw, 'Riunione di marzo', 'Riunione di marzo')).toBe('x\nAs decided in the [[Riunione di marzo]], see Riunione di marzo notes.')
  })
  it('linkMentionLine keeps the written text as alias when case or link text differs', () => {
    const raw = 'as decided in the riunione di marzo.'
    expect(linkMentionLine(raw, 0, raw, 'Riunione di marzo', 'Riunione di marzo')).toBe('as decided in the [[Riunione di marzo|riunione di marzo]].')
    const dup = 'see Topic here'
    expect(linkMentionLine(dup, 0, dup, 'Topic', 'sub/Topic')).toBe('see [[sub/Topic|Topic]] here')
  })
  it('linkMentionLine skips mentions already inside links and stale lines', () => {
    const raw = 'Linked [[Topic]] and plain Topic here'
    expect(linkMentionLine(raw, 0, raw, 'Topic', 'Topic')).toBe('Linked [[Topic]] and plain [[Topic]] here')
    expect(linkMentionLine('Topic changed', 0, 'Topic here', 'Topic', 'Topic')).toBeNull()
    expect(linkMentionLine('Topical only', 0, 'Topical only', 'Topic', 'Topic')).toBeNull()
  })
  it('tags case-insensitive counts', () => {
    expect(idx.tagTree()).toEqual([{ name: 't1', tag: '#t1', count: 2, children: [] }])
  })
  it('nested tags form a tree; a parent counts each note once', () => {
    const i = new NoteIndex()
    i.upsert('a.md', '#progetto/web #progetto/app')
    i.upsert('b.md', '#Progetto/web/front')
    i.upsert('c.md', '#progetto #altro')
    const [p, altro] = i.tagTree()
    expect(altro).toEqual({ name: 'altro', tag: '#altro', count: 1, children: [] })
    expect(p.tag).toBe('#progetto')
    expect(p.count).toBe(3) // a, b, c; a has two children but counts once
    expect(p.children.map((c) => [c.name, c.count])).toEqual([['web', 2], ['app', 1]])
    expect(p.children[0].children).toEqual([{ name: 'front', tag: '#progetto/web/front', count: 1, children: [] }])
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
  it('fuzzyScore ignores accents and case, so resume finds Résumé', () => {
    expect(fuzzyScore('resume', 'Résumé.md')).toBeGreaterThan(0)
    expect(fuzzyScore('RESUME', 'résumé.md')).toBeGreaterThan(0)
    expect(fuzzyScore('', 'anything.md')).toBe(0)
  })
  it('wordCount handles unicode', () => {
    expect(wordCount('héllo wörld, 你好 it’s').words).toBe(4)
  })
  it('search scales', () => {
    const notes = Array.from({ length: 5000 }, (_, i) => ({ path: `n${i}.md`, content: `note ${i} lorem ipsum dolor `.repeat(20), meta: { links: [], tags: [], headings: [], blocks: [] } }))
    const t = performance.now()
    expect(searchNotes(notes, 'ipsum 4999', 10).length).toBeGreaterThan(0)
    expect(performance.now() - t).toBeLessThan(500)
  })
})

describe('search syntax guide', () => {
  it('every example shown under the empty search field is real syntax', () => {
    const kinds = SEARCH_SYNTAX.map(({ example }) => parseQuery(example).map((t) => `${t.neg ? '-' : ''}${t.kind}:${t.value}`))
    expect(kinds).toEqual([
      ['text:memory', 'text:recall'],
      ['text:spaced repetition'],
      ['-text:draft'],
      ['tag:#project'],
      ['path:research'],
      ['file:roadmap'],
    ])
    for (const { hint } of SEARCH_SYNTAX) for (const dict of Object.values(DICTIONARIES)) expect(dict[hint]).toBeTruthy()
  })

  it('the examples behave as described', () => {
    const idx = new NoteIndex()
    idx.upsert('Research/Spaced repetition.md', 'memory and recall #project/sub')
    idx.upsert('Projects/Synapse roadmap.md', 'memory only, draft')
    const hits = (q: string) => idx.search(q).map((h) => h.path).sort()
    expect(hits('memory recall')).toEqual(['Research/Spaced repetition.md'])
    expect(hits('memory -draft')).toEqual(['Research/Spaced repetition.md'])
    expect(hits('tag:#project')).toEqual(['Research/Spaced repetition.md']) // nested tag included
    expect(hits('path:Research')).toEqual(['Research/Spaced repetition.md'])
    expect(hits('file:roadmap')).toEqual(['Projects/Synapse roadmap.md'])
    expect(hits('"spaced repetition"')).toEqual(['Research/Spaced repetition.md']) // title counts as text
  })
})

describe('headingRef', () => {
  it('turns characters that break a link into single spaces', () => {
    expect(headingRef('Results | final')).toBe('Results final')
    expect(headingRef('a#b^c [d]')).toBe('a b c d')
    expect(headingRef('Conclusioni')).toBe('Conclusioni')
  })
})

describe('static site links', () => {
  it('relativeHref walks up and down folders and encodes each part', () => {
    expect(relativeHref('A.html', 'B.html')).toBe('B.html')
    expect(relativeHref('a/A.html', 'a/B.html')).toBe('B.html')
    expect(relativeHref('a/b/A.html', 'B.html')).toBe('../../B.html')
    expect(relativeHref('A.html', 'x y/Caffè #1.html')).toBe('x%20y/Caff%C3%A8%20%231.html')
    expect(relativeHref('a/b/A.html', 'a/c/C.html')).toBe('../c/C.html')
    expect(relativeHref('a/A.html', 'a.html')).toBe('../a.html')
  })
  it('headingId matches whatever spelling the link uses', () => {
    expect(headingId('Results | Final')).toBe(headingId('results final'))
    expect(headingId('Conclusioni')).toBe('conclusioni')
  })
})
