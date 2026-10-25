import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NoteHistory } from '../src/main/history'
import { Vault } from '../src/main/vault'
import { AppStore } from '../src/main/store'
import { openVault } from '../src/main/session'

let tmp: string
let root: string
let histDir: string
let history: NoteHistory
let vault: Vault

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-history-')))
  root = path.join(tmp, 'vault')
  histDir = path.join(tmp, 'app', 'history', 'v1')
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
  fs.writeFileSync(path.join(root, 'note.md'), 'original')
  history = new NoteHistory(histDir, { keep: 3, interval: 60_000 })
  vault = new Vault(root, async () => {}, history)
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

const mtime = (p: string) => fs.statSync(path.join(root, p)).mtimeMs
const versionTexts = (p: string) => history.list(p).map((v) => history.read(p, v.id))

describe('NoteHistory', () => {
  it('skips a duplicate of the newest version and throttles unless forced', () => {
    expect(history.record('a.md', 'one', false, 1_000_000_000_000)).toBe(true)
    expect(history.record('a.md', 'one', true, 1_000_000_100_000)).toBe(false) // same content
    expect(history.record('a.md', 'two', false, 1_000_000_010_000)).toBe(false) // too soon
    expect(history.record('a.md', 'two', true, 1_000_000_010_000)).toBe(true)
    expect(history.record('a.md', 'three', false, 1_000_000_080_000)).toBe(true)
    expect(versionTexts('a.md')).toEqual(['three', 'two', 'one'])
  })

  it('keeps only the newest versions', () => {
    for (let i = 0; i < 6; i++) history.record('a.md', `v${i}`, true, 1_000_000_000_000 + i)
    expect(versionTexts('a.md')).toEqual(['v5', 'v4', 'v3'])
  })

  it('ignores temp files left by an interrupted write', () => {
    history.record('a.md', 'one', true, 1_000_000_000_000)
    const dir = path.join(histDir, fs.readdirSync(histDir)[0])
    fs.writeFileSync(path.join(dir, '1000000000001-abcdefabcdef.md.123.456.tmp'), 'half')
    expect(versionTexts('a.md')).toEqual(['one'])
  })

  it('refuses malformed version ids', () => {
    history.record('a.md', 'one', true)
    for (const id of ['../../../etc/passwd', '1-2', '', 5, 'meta']) expect(() => history.read('a.md', id)).toThrow(/Invalid version/)
    expect(() => history.read('a.md', '1000000000000-000000000000')).toThrow(/not found/)
  })

  it('follows renames of files and folders, merging with history already there', () => {
    history.record('f/a.md', 'a', true, 1_000_000_000_000)
    history.record('f/b.md', 'b', true, 1_000_000_000_000)
    history.record('g/a.md', 'old', true, 1_000_000_000_001)
    history.move('f', 'g')
    expect(history.list('f/a.md')).toEqual([])
    expect(versionTexts('g/a.md')).toEqual(['old', 'a'])
    expect(versionTexts('g/b.md')).toEqual(['b'])
    history.move('g/b.md', 'c.md')
    expect(versionTexts('c.md')).toEqual(['b'])
  })
})

describe('vault writes keep versions', () => {
  it('stores the previous text before overwriting, outside the vault', async () => {
    await vault.write('note.md', 'edited', mtime('note.md'))
    expect(versionTexts('note.md')).toEqual(['original'])
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('edited')
    expect(histDir.startsWith(root)).toBe(false)
    expect((await vault.list()).map((f) => f.path).sort()).toEqual(['note.md', 'sub'])
  })

  it('does not snapshot every autosave', async () => {
    for (const s of ['a', 'ab', 'abc']) await vault.write('note.md', s, mtime('note.md'))
    expect(versionTexts('note.md')).toEqual(['original'])
  })

  it('always keeps text changed outside Synapse before overwriting it', async () => {
    await vault.write('note.md', 'mine', mtime('note.md'))
    fs.writeFileSync(path.join(root, 'note.md'), 'external edit')
    await vault.write('note.md', 'mine again', mtime('note.md'))
    expect(versionTexts('note.md')).toEqual(['external edit', 'original'])
  })

  it('keeps an external edit made while Synapse was closed', async () => {
    await vault.write('note.md', 'mine', mtime('note.md'))
    fs.writeFileSync(path.join(root, 'note.md'), 'edited in another app')
    const restarted = new Vault(root, async () => {}, history)
    await restarted.write('note.md', 'mine again', mtime('note.md'))
    expect(versionTexts('note.md')).toEqual(['edited in another app', 'original'])
  })

  it('a forced write ("keep mine" after a conflict) keeps the disk text', async () => {
    await vault.write('note.md', 'mine', mtime('note.md'))
    await vault.write('note.md', 'forced')
    expect(versionTexts('note.md')[0]).toBe('mine')
  })

  it('a broken history folder never blocks saving', async () => {
    fs.mkdirSync(path.dirname(histDir), { recursive: true })
    fs.writeFileSync(histDir, 'not a folder')
    await vault.write('note.md', 'saved anyway', mtime('note.md'))
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('saved anyway')
  })

  it('restores a version and keeps the replaced text as a version', async () => {
    await vault.write('note.md', 'later', mtime('note.md'))
    const [v] = vault.versions('note.md')
    const r = await vault.restore('note.md', v.id, mtime('note.md'))
    expect(r.content).toBe('original')
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('original')
    expect(versionTexts('note.md')).toEqual(['later', 'original'])
  })

  it('restore refuses when the note changed on disk meanwhile', async () => {
    await vault.write('note.md', 'later', mtime('note.md'))
    const stale = mtime('note.md')
    const [v] = vault.versions('note.md')
    fs.writeFileSync(path.join(root, 'note.md'), 'newer external text')
    fs.utimesSync(path.join(root, 'note.md'), new Date(), new Date(stale + 5000))
    await expect(vault.restore('note.md', v.id, stale)).rejects.toMatchObject({ code: 'ECONFLICT' })
    expect(fs.readFileSync(path.join(root, 'note.md'), 'utf8')).toBe('newer external text')
    await expect(vault.restore('note.md', v.id, undefined)).rejects.toMatchObject({ code: 'EINVAL' })
  })

  it('history follows a rename and stays confined to vault paths', async () => {
    await vault.write('note.md', 'edited', mtime('note.md'))
    await vault.rename('note.md', 'sub/moved.md')
    expect(vault.versions('sub/moved.md')).toHaveLength(1)
    expect(vault.versions('note.md')).toEqual([])
    expect(() => vault.versions('../outside.md')).toThrow(/outside/)
  })
})

describe('history storage location', () => {
  it('a vault id planted in the vault folder cannot move history outside the history folder', async () => {
    const appDir = path.join(tmp, 'app')
    fs.mkdirSync(path.join(root, '.synapse'), { recursive: true })
    fs.writeFileSync(path.join(root, '.synapse', 'settings.json'), JSON.stringify({ version: 2, vaultId: '../../../escaped' }))
    const open = await openVault(new AppStore(appDir), root, async () => {})
    expect(open.id).toMatch(/^[a-z0-9]{8,64}$/)
    await open.vault.write('note.md', 'edited', mtime('note.md'))
    expect(fs.existsSync(path.join(tmp, 'escaped'))).toBe(false)
    expect(fs.readdirSync(path.join(appDir, 'history'))).toEqual([open.id])
  })

  it('separate vaults keep separate histories', async () => {
    const app = new AppStore(path.join(tmp, 'app'))
    const other = path.join(tmp, 'other')
    fs.mkdirSync(other)
    fs.writeFileSync(path.join(other, 'note.md'), 'other original')
    const a = await openVault(app, root, async () => {})
    const b = await openVault(app, other, async () => {})
    await a.vault.write('note.md', 'a edited', mtime('note.md'))
    await b.vault.write('note.md', 'b edited', fs.statSync(path.join(other, 'note.md')).mtimeMs)
    expect(a.vault.versions('note.md').map((v) => a.vault.version('note.md', v.id))).toEqual(['original'])
    expect(b.vault.versions('note.md').map((v) => b.vault.version('note.md', v.id))).toEqual(['other original'])
  })
})
