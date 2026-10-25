import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { analyzeNotes, inspectFolder } from '../src/main/migrate'

let tmp: string
afterEach(() => tmp && fs.rmSync(tmp, { recursive: true, force: true }))

function folder(files: Record<string, string>) {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-import-')))
  const root = path.join(tmp, 'Notes')
  fs.mkdirSync(root)
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true })
    fs.writeFileSync(path.join(root, p), c)
  }
  return root
}

/** Every path and its bytes, hidden folders included. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name)
      if (e.isDirectory()) walk(abs)
      else out[path.relative(dir, abs)] = fs.readFileSync(abs).toString('base64')
    }
  }
  walk(dir)
  return out
}

describe('analyzeNotes', () => {
  it('reports broken links, missing attachments and duplicate names in nested folders', () => {
    const files = ['a/Note.md', 'b/Note.md', 'b/c/Über café.md', 'img/ok.png']
    const notes = [
      { path: 'a/Note.md', content: '[[Über café]] [[Nowhere]] ![[ok.png]] ![[gone.png]] [doc](../missing%20file.pdf)' },
      { path: 'b/Note.md', content: '[[Nowhere]] [[Nowhere]]' },
      { path: 'b/c/Über café.md', content: 'fine [[Note]]' },
    ]
    const r = analyzeNotes(files, notes, 4)
    expect(r).toMatchObject({ notes: 3, attachments: 1, folders: 4, unresolvedCount: 2, missingCount: 2 })
    expect(r.unresolved.map((l) => l.source).sort()).toEqual(['a/Note.md', 'b/Note.md'])
    expect(r.missing.map((l) => l.target).sort()).toEqual(['../missing file.pdf', 'gone.png'])
    expect(r.duplicates).toEqual([{ name: 'Note', paths: ['a/Note.md', 'b/Note.md'] }])
    expect(r.syntax).toEqual([])
  })

  it('flags syntax from other apps that renders as plain text', () => {
    const r = analyzeNotes(['x.md', 'y.md'], [
      { path: 'x.md', content: '```dataview\nLIST\n```\nA line ^abc123\n%% hidden %%' },
      { path: 'y.md', content: '> [!warning] Careful\n[[x#^abc123]]' },
    ])
    expect(Object.fromEntries(r.syntax.map((s) => [s.kind, s.examples]))).toEqual({ dataview: ['x.md'], blockRef: ['x.md', 'y.md'], comment: ['x.md'], callout: ['y.md'] })
  })

  it('caps example lists but keeps totals', () => {
    const notes = Array.from({ length: 80 }, (_, i) => ({ path: `n${i}.md`, content: `[[missing ${i}]]` }))
    const r = analyzeNotes(notes.map((n) => n.path), notes)
    expect(r.unresolved).toHaveLength(50)
    expect(r.unresolvedCount).toBe(80)
  })
})

describe('inspectFolder', () => {
  it('reads without changing anything and creates no .synapse folder', async () => {
    const root = folder({ 'Ä/note one.md': '[[two]] ![[pic 1.png]]', 'two.md': '# Two', 'pic 1.png': 'png', '.obsidian/app.json': '{}' })
    const before = snapshot(root)
    const r = await inspectFolder(root)
    expect(r).toMatchObject({ notes: 2, attachments: 1, folders: 1, unresolvedCount: 0, missingCount: 0, obsidian: true, known: false })
    expect(snapshot(root)).toEqual(before)
    expect(fs.existsSync(path.join(root, '.synapse'))).toBe(false)
  })

  it('recognises a folder Synapse opened before', async () => {
    const root = folder({ 'a.md': 'x', '.synapse/settings.json': '{}' })
    expect((await inspectFolder(root)).known).toBe(true)
  })

  it('does not follow symlinks out of the folder', async () => {
    const root = folder({ 'a.md': 'x' })
    fs.mkdirSync(path.join(tmp, 'outside'))
    fs.writeFileSync(path.join(tmp, 'outside', 'secret.md'), 'secret')
    fs.symlinkSync(path.join(tmp, 'outside'), path.join(root, 'link'))
    expect((await inspectFolder(root)).notes).toBe(1)
  })
})
