import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Vault } from '../src/main/vault'

let tmp: string
let root: string
let vault: Vault
const trashed: string[] = []

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-vault-')))
  root = path.join(tmp, 'vault')
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(root, 'note.md'), 'hello')
  fs.writeFileSync(path.join(tmp, 'secret.txt'), 'secret')
  trashed.length = 0
  vault = new Vault(root, async (abs) => {
    trashed.push(abs)
    fs.rmSync(abs, { recursive: true })
  })
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('vault boundary', () => {
  it.each(['../secret.txt', '/etc/passwd', 'sub/../../secret.txt', '..', '.synapse/settings.json', './.synapse/x', '..\\secret.txt'])('rejects %s as outside', async (p) => {
    await expect(vault.read(p)).rejects.toMatchObject({ code: 'EOUTSIDE' })
  })

  it.each(['', '.', 'a\0b', 5])('rejects invalid %s', async (p) => {
    await expect(vault.read(p as string)).rejects.toMatchObject({ code: 'EINVAL' })
  })

  it('normalizes harmless relative segments', () => {
    expect(vault.resolve('./sub/../note.md')).toBe(path.join(root, 'note.md'))
  })

  it('rejects symlink escapes', async () => {
    fs.symlinkSync(tmp, path.join(root, 'link'))
    await expect(vault.read('link/secret.txt')).rejects.toThrow(/symlink/)
    await expect(vault.write('link/new.md', 'x')).rejects.toThrow(/symlink/)
    expect(fs.existsSync(path.join(tmp, 'new.md'))).toBe(false)
  })

  it('does not list symlinks or hidden folders', async () => {
    fs.symlinkSync(tmp, path.join(root, 'link'))
    fs.mkdirSync(path.join(root, '.obsidian'))
    fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), '{}')
    const list = (await vault.list()).map((f) => f.path).sort()
    expect(list).toEqual(['note.md', 'sub'])
  })
})

describe('file operations', () => {
  it('create never overwrites', async () => {
    await expect(vault.create('note.md', 'x')).rejects.toThrow(/exists/)
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('hello')
  })

  it('handles unicode names and content', async () => {
    await vault.create('sub/Café 日本語 ✓.md', 'Ünïcödé – 你好 🚀')
    const n = await vault.read('sub/Café 日本語 ✓.md')
    expect(n.content).toBe('Ünïcödé – 你好 🚀')
  })

  it('write detects external modification', async () => {
    const n = await vault.read('note.md')
    await new Promise((r) => setTimeout(r, 20))
    fs.writeFileSync(path.join(root, 'note.md'), 'changed outside')
    await expect(vault.write('note.md', 'mine', n.mtime)).rejects.toThrow(/outside/)
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('changed outside')
    // a forced write (no expected mtime) succeeds
    await vault.write('note.md', 'mine')
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('mine')
  })

  it('write after external delete is refused', async () => {
    const n = await vault.read('note.md')
    fs.rmSync(path.join(root, 'note.md'))
    await expect(vault.write('note.md', 'x', n.mtime)).rejects.toThrow(/deleted/)
  })

  it('rename refuses to overwrite and moves folders', async () => {
    await vault.create('other.md', 'o')
    await expect(vault.rename('note.md', 'other.md')).rejects.toThrow(/exists/)
    await vault.rename('note.md', 'sub/deep/note.md')
    expect(fs.existsSync(path.join(root, 'sub/deep/note.md'))).toBe(true)
    await expect(vault.rename('sub', 'sub/deep/x')).rejects.toThrow(/itself/)
    await vault.rename('sub', 'moved')
    expect(fs.readFileSync(path.join(root, 'moved/deep/note.md'), 'utf8')).toBe('hello')
  })

  it('case-only rename works', async () => {
    await vault.rename('note.md', 'Note.md')
    expect(fs.readdirSync(root)).toContain('Note.md')
  })

  it('remove goes through trash', async () => {
    await vault.remove('note.md')
    expect(trashed).toEqual([path.join(root, 'note.md')])
  })

  it('readAllMarkdown returns only markdown', async () => {
    fs.writeFileSync(path.join(root, 'img.png'), 'x')
    const all = await vault.readAllMarkdown()
    expect(all.map((n) => n.path)).toEqual(['note.md'])
  })

  it('mkdir refuses existing', async () => {
    await expect(vault.mkdir('sub')).rejects.toThrow(/exists/)
    await vault.mkdir('new/folder')
    expect(fs.statSync(path.join(root, 'new/folder')).isDirectory()).toBe(true)
  })
})

describe('security audit regressions', () => {
  it.each(['.SYNAPSE/settings.json', '.Synapse/workspace.json', '.git/hooks/pre-commit', 'sub/.git/config', '.obsidian/app.json', 'notes/.hidden.md'])('refuses hidden path %s', async (p) => {
    await expect(vault.write(p, 'x')).rejects.toMatchObject({ code: 'EOUTSIDE' })
    await expect(vault.create(p, 'x')).rejects.toMatchObject({ code: 'EOUTSIDE' })
    await expect(vault.read(p)).rejects.toMatchObject({ code: 'EOUTSIDE' })
    expect(fs.existsSync(path.join(root, p))).toBe(false)
  })

  it('keeps file permissions when saving', async () => {
    fs.chmodSync(path.join(root, 'note.md'), 0o600)
    await vault.write('note.md', 'private', fs.statSync(path.join(root, 'note.md')).mtimeMs)
    expect(fs.statSync(path.join(root, 'note.md')).mode & 0o777).toBe(0o600)
  })

  it('never recreates a vault folder that was moved or deleted', async () => {
    fs.renameSync(root, root + '-moved')
    await expect(vault.write('note.md', 'x')).rejects.toMatchObject({ code: 'ENOVAULT' })
    await expect(vault.create('new.md', 'x')).rejects.toMatchObject({ code: 'ENOVAULT' })
    // a listing must not look like "every note was deleted"
    await expect(vault.list()).rejects.toMatchObject({ code: 'ENOVAULT' })
    expect(fs.existsSync(root)).toBe(false)
    fs.renameSync(root + '-moved', root)
  })
})

describe('large files', () => {
  it('leaves notes over the size limit out of the index but keeps them openable', async () => {
    fs.writeFileSync(path.join(root, 'huge.md'), 'x'.repeat(10 * 1024 * 1024 + 1))
    const indexed = (await vault.readAllMarkdown()).map((n) => n.path)
    expect(indexed).toContain('note.md')
    expect(indexed).not.toContain('huge.md')
    expect((await vault.read('huge.md')).content.length).toBe(10 * 1024 * 1024 + 1)
  })
})

describe('save interrupted by a crash', () => {
  it('keeps the original intact and leaves the new text in a visible .tmp file, never removed automatically', async () => {
    // a crash between fsync and rename: the rename never happens and nothing cleans up
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('crash') })
    const rm = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {})
    await expect(vault.write('note.md', 'newer text', fs.statSync(path.join(root, 'note.md')).mtimeMs)).rejects.toThrow('crash')
    rename.mockRestore()
    rm.mockRestore()
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('hello')
    const tmp = (await vault.list()).map((f) => f.path).filter((p) => p.endsWith('.tmp'))
    expect(tmp).toHaveLength(1)
    expect(tmp[0]).toMatch(/^note\.md\.\d+\.\d+\.tmp$/)
    expect(fs.readFileSync(path.join(root, tmp[0]), 'utf8')).toBe('newer text') // recoverable
    expect((await vault.readAllMarkdown()).map((n) => n.path)).toEqual(['note.md']) // not indexed as a note
    await vault.write('note.md', 'after restart', fs.statSync(path.join(root, 'note.md')).mtimeMs)
    expect(fs.existsSync(path.join(root, tmp[0]))).toBe(true)
  })
})
