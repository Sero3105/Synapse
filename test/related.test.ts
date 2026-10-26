import { describe, it, expect } from 'vitest'
import { NoteIndex, noteTerms } from '../src/shared/markdown'
import { relatedNotes, pairKey } from '../src/shared/related'

function index(notes: Record<string, string>) {
  const ix = new NoteIndex()
  ix.setFiles(Object.keys(notes))
  for (const [p, c] of Object.entries(notes)) ix.upsert(p, c)
  return ix
}
const paths = (ix: NoteIndex, p: string, opts = {}) => relatedNotes(ix, p, opts).map((r) => r.path)

describe('noteTerms', () => {
  it('counts prose words, skipping code, URLs, frontmatter, stopwords and short words', () => {
    const t = noteTerms('---\ntags: [secret]\n---\nPhotosynthesis needs light. Photosynthesis!\n```\nconstant variable\n```\nSee https://example.com/zebra and `inline`. That is a cat.')
    expect(t.get('photosynthesis')).toBe(2)
    expect(t.get('light')).toBe(1)
    for (const w of ['secret', 'constant', 'zebra', 'inline', 'that', 'cat']) expect(t.has(w), w).toBe(false)
  })
})

describe('relatedNotes', () => {
  const notes = {
    'A.md': '# Cells\n#biology #exam\nPhotosynthesis chlorophyll mitochondria. See [[Hub]].',
    'B.md': '#biology #exam\nChlorophyll and photosynthesis again.',
    'C.md': 'Mitochondria chlorophyll photosynthesis in plants.',
    'D.md': 'Links to [[Hub]] only.',
    'Hub.md': 'hub',
    'Linked.md': '#biology #exam\nphotosynthesis chlorophyll [[A]]',
    'Far.md': 'Unrelated cooking recipe with tomatoes.',
    'img.png': '',
  }

  it('ranks by explainable signals and gives the reasons', () => {
    const ix = index(notes)
    const r = relatedNotes(ix, 'A.md')
    expect(r.map((x) => x.path)).toEqual(['B.md', 'C.md', 'D.md'])
    expect(r[0].tags).toEqual(['#biology', '#exam'])
    expect(r[0].terms).toEqual(expect.arrayContaining(['photosynthesis', 'chlorophyll']))
    expect(r[2].via).toEqual(['Hub.md'])
    for (const x of r) expect(x.score).toBeGreaterThanOrEqual(2)
  })

  it('never suggests the note itself, directly linked notes, unrelated notes or attachments', () => {
    const p = paths(index(notes), 'A.md')
    for (const x of ['A.md', 'Hub.md', 'Linked.md', 'Far.md', 'img.png']) expect(p).not.toContain(x)
    expect(new Set(p).size).toBe(p.length)
  })

  it('leaves out dismissed pairs, in either direction', () => {
    const ix = index(notes)
    expect(paths(ix, 'A.md', { dismissed: new Set([pairKey('B.md', 'A.md')]) })).not.toContain('B.md')
    expect(paths(ix, 'B.md', { dismissed: new Set([pairKey('B.md', 'A.md')]) })).not.toContain('A.md')
  })

  it('handles empty and unknown notes', () => {
    const ix = index({ 'Empty.md': '', 'Other.md': 'words here' })
    expect(relatedNotes(ix, 'Empty.md')).toEqual([])
    expect(relatedNotes(ix, 'Missing.md')).toEqual([])
  })

  it('follows edits and deletions', () => {
    const ix = index(notes)
    ix.upsert('B.md', 'nothing in common now')
    ix.remove('C.md')
    const p = paths(ix, 'A.md')
    expect(p).not.toContain('B.md')
    expect(p).not.toContain('C.md')
    ix.upsert('A.md', notes['A.md'] + '\n[[D]]') // linking D removes it from suggestions
    expect(paths(ix, 'A.md')).not.toContain('D.md')
  })

  it('keeps document frequencies in step with edits', () => {
    const ix = index({ 'x.md': 'zebra zebra', 'y.md': 'zebra' })
    expect(ix.df.get('zebra')).toBe(2)
    ix.upsert('x.md', 'horse')
    ix.remove('y.md')
    expect(ix.df.has('zebra')).toBe(false)
    expect(ix.df.get('horse')).toBe(1)
  })

  it('stays fast on a large vault', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + Math.floor(i / 26))}`)
    const big: Record<string, string> = {}
    for (let i = 0; i < 5000; i++) {
      const w = Array.from({ length: 60 }, (_, j) => words[(i * 7 + j * 13) % words.length]).join(' ')
      big[`n${i}.md`] = `#t${i % 50}\n${w}\n[[n${(i + 1) % 5000}]] [[n${(i * 3) % 5000}]]`
    }
    const ix = index(big)
    const t0 = performance.now()
    const r = relatedNotes(ix, 'n42.md')
    expect(performance.now() - t0).toBeLessThan(1500)
    expect(r.length).toBe(10)
    expect(r.map((x) => x.path)).not.toContain('n42.md')
  })
})
