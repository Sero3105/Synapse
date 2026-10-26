import { describe, it, expect } from 'vitest'
import { NoteIndex, uniqueName } from '../src/shared/markdown'
import { attachmentReport } from '../src/shared/attachments'

function index(notes: Record<string, string>, attachments: string[]) {
  const ix = new NoteIndex()
  ix.setFiles([...Object.keys(notes), ...attachments])
  for (const [p, c] of Object.entries(notes)) ix.upsert(p, c)
  return ix
}

describe('attachment report', () => {
  it('records references for embeds and links, including relative and nested paths', () => {
    const r = attachmentReport(
      index(
        {
          'a/Note.md': '![[pic.png]]\n[doc](../docs/My%20File.pdf)\n![x](./img/b.png)',
          'Other.md': 'line\n![[a/img/b.png]]',
        },
        ['a/pic.png', 'docs/My File.pdf', 'a/img/b.png'],
      ),
    )
    expect(r.unused).toEqual([])
    expect(r.missing).toEqual([])
    expect(r.refs.get('a/pic.png')).toEqual([{ source: 'a/Note.md', line: 0 }])
    expect(r.refs.get('docs/My File.pdf')).toEqual([{ source: 'a/Note.md', line: 1 }])
    expect(r.refs.get('a/img/b.png')).toEqual([
      { source: 'a/Note.md', line: 2 },
      { source: 'Other.md', line: 1 },
    ])
  })

  it('reports missing attachments with their source note and line', () => {
    const r = attachmentReport(index({ 'N.md': 'text\n![[gone.png]]\n[[Release v1.2]]\n[[Some note]]' }, []))
    expect(r.missing).toEqual([{ target: 'gone.png', source: 'N.md', line: 1, embed: true }])
  })

  it('keeps same-named files in different folders apart', () => {
    const r = attachmentReport(index({ 'x/N.md': '![[x/img.png]]' }, ['x/img.png', 'y/img.png']))
    expect(r.refs.has('x/img.png')).toBe(true)
    // y/img.png shares the basename that appears in the note text, so it is not flagged either
    expect(r.unused).toEqual([])
    const r2 = attachmentReport(index({ 'x/N.md': '![[x/img.png]]' }, ['x/img.png', 'y/other.png']))
    expect(r2.unused).toEqual([{ path: 'y/other.png' }])
  })

  it('handles spaces and Unicode (NFC and NFD) in file names', () => {
    const nfd = 'Café photo.png'.normalize('NFD')
    const r = attachmentReport(index({ 'N.md': '![[Café photo.png]]\n![](Ünïcode%20file.pdf)' }, [nfd, 'Ünïcode file.pdf', 'nötig.png']))
    expect(r.refs.has(nfd)).toBe(true)
    expect(r.refs.has('Ünïcode file.pdf')).toBe(true)
    expect(r.unused).toEqual([{ path: 'nötig.png' }])
  })

  it('does not flag attachments mentioned only in frontmatter, raw HTML or code', () => {
    const r = attachmentReport(
      index({ 'N.md': '---\ncover: covers/front.jpg\n---\n<img src="raw%20html.png">\n```\nlogo.svg\n```' }, ['covers/front.jpg', 'raw html.png', 'logo.svg', 'orphan.gif']),
    )
    expect(r.unused).toEqual([{ path: 'orphan.gif' }])
  })

  it('never resolves outside the vault: escaping links are only reported as missing', () => {
    const r = attachmentReport(index({ 'a/N.md': '![[../../secret.png]]\n![[../../etc/passwd]]\n[x](../../../etc/hosts.txt)' }, ['a/ok.png']))
    expect(r.missing.map((m) => m.target)).toEqual(['../../secret.png', '../../../etc/hosts.txt'])
    expect([...r.refs.keys()]).toEqual([])
    expect(r.unused).toEqual([{ path: 'a/ok.png' }])
  })

  it('works on an empty vault', () => {
    expect(attachmentReport(new NoteIndex())).toEqual({ missing: [], unused: [], refs: new Map() })
  })
})

describe('uniqueName for pasted attachments', () => {
  it('avoids existing names case-insensitively, with spaces and Unicode', () => {
    const existing = new Set(['att/Pasted image.png', 'att/Pasted image 1.png', 'att/Fötö.PNG'])
    expect(uniqueName(existing, 'att', 'Pasted image', '.png')).toBe('att/Pasted image 2.png')
    expect(uniqueName(existing, 'att', 'Fötö', '.png')).toBe('att/Fötö 1.png')
    expect(uniqueName(existing, '', 'Fötö', '.png')).toBe('Fötö.png')
  })

  it('finds names mentioned next to punctuation, and stays fast on large vaults', () => {
    const idx = new NoteIndex()
    const files = Array.from({ length: 2000 }, (_, i) => `photos/IMG ${i}.jpg`)
    idx.setFiles([...files, 'a.md', 'b.md', 'odd.tar gz'])
    idx.upsert('a.md', ('filler text with dots. and more.jpg words\n').repeat(20000) + 'see (IMG 7.jpg), "IMG 8.jpg"; IMG 9.jpg.\n')
    idx.upsert('b.md', 'cover: odd.tar gz\n')
    const t0 = performance.now()
    const unused = attachmentReport(idx).unused.map((u) => u.path)
    expect(performance.now() - t0).toBeLessThan(2000)
    for (const p of ['photos/IMG 7.jpg', 'photos/IMG 8.jpg', 'photos/IMG 9.jpg', 'odd.tar gz']) expect(unused).not.toContain(p)
    expect(unused).toContain('photos/IMG 10.jpg')
    expect(unused).toHaveLength(1997)
  })
})
