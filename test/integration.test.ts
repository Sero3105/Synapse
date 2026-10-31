import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Vault } from '../src/main/vault'
import { parseSynapseUrl, findVault, notePath, newNote, capture, toAccelerator, trayMenu, trayBitmap, INBOX } from '../src/main/integration'
import { normalizeGlobal, applyGlobalPatch, defaultGlobal } from '../src/shared/settings'

let tmp: string
let vault: Vault
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-integration-')))
  vault = new Vault(tmp, async () => {})
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('synapse:// links', () => {
  it('parses open, new and capture', () => {
    expect(parseSynapseUrl('synapse://open?vault=My%20Notes&file=Folder/A%20note')).toEqual({ action: 'open', vault: 'My Notes', file: 'Folder/A note' })
    expect(parseSynapseUrl('synapse://new?text=Hello%0Aworld&name=Idea')).toEqual({ action: 'new', vault: undefined, name: 'Idea', text: 'Hello\nworld' })
    expect(parseSynapseUrl('synapse://capture')).toEqual({ action: 'capture' })
    expect(parseSynapseUrl('synapse:///open?file=x')).toMatchObject({ action: 'open', file: 'x' })
  })

  it('ignores other schemes, unknown actions and garbage', () => {
    for (const u of ['https://open?file=x', 'synapse://delete?file=x', 'not a url', 'synapse://']) expect(parseSynapseUrl(u)).toBeNull()
  })

  it('caps the text a link can carry', () => {
    const u = parseSynapseUrl('synapse://new?text=' + 'a'.repeat(200_000))
    expect(u?.action === 'new' && u.text.length).toBe(100_000)
  })

  it('finds a vault by folder name (any case) or id', () => {
    const vaults = { abcdefgh12345678: { path: '/Users/me/My Notes' } }
    expect(findVault(vaults, 'my notes')).toBe('/Users/me/My Notes')
    expect(findVault(vaults, 'abcdefgh12345678')).toBe('/Users/me/My Notes')
    expect(findVault(vaults, 'Other')).toBeNull()
  })

  it('adds .md like a [[link]]', () => {
    expect(notePath('Folder/Note')).toBe('Folder/Note.md')
    expect(notePath('Note.md')).toBe('Note.md')
    expect(notePath('/Note')).toBe('Note.md')
  })

  it('new notes never overwrite and never leave the vault', async () => {
    fs.writeFileSync(path.join(tmp, 'Idea.md'), 'old')
    expect(await newNote(vault, 'Idea', 'new')).toBe('Idea 1.md')
    expect(fs.readFileSync(path.join(tmp, 'Idea.md'), 'utf8')).toBe('old')
    expect(fs.readFileSync(path.join(tmp, 'Idea 1.md'), 'utf8')).toBe('new')
    expect(await newNote(vault, 'Sub/Deep', 'x')).toBe('Sub/Deep.md')
    await expect(newNote(vault, '../escape', 'x')).rejects.toThrow()
    await expect(newNote(vault, '.hidden/x', 'x')).rejects.toThrow()
  })
})

describe('quick capture', () => {
  const now = new Date(2026, 9, 31, 9, 30)

  it('creates today’s daily note from the daily template, then appends to it', async () => {
    fs.mkdirSync(path.join(tmp, 'Templates'))
    fs.writeFileSync(path.join(tmp, 'Templates/Daily note.md'), '# {{title}}\n')
    fs.mkdirSync(path.join(tmp, 'Daily'))
    fs.writeFileSync(path.join(tmp, 'Daily/2026-10-30.md'), 'yesterday')
    expect(await capture(vault, 'daily', '  first idea ', now)).toBe('Daily/2026-10-31.md')
    expect(await capture(vault, 'daily', 'second', now)).toBe('Daily/2026-10-31.md')
    expect(fs.readFileSync(path.join(tmp, 'Daily/2026-10-31.md'), 'utf8')).toBe('# 2026-10-31\n\nfirst idea\n\nsecond\n')
  })

  it('appends to Inbox.md without touching what is there', async () => {
    expect(await capture(vault, 'inbox', 'one', now)).toBe(INBOX)
    fs.appendFileSync(path.join(tmp, INBOX), 'edited by hand  \n\n\n')
    await capture(vault, 'inbox', 'two', now)
    expect(fs.readFileSync(path.join(tmp, INBOX), 'utf8')).toBe('one\nedited by hand  \n\ntwo\n')
  })

  it('refuses empty text', async () => {
    await expect(capture(vault, 'inbox', '  \n ', now)).rejects.toThrow()
    expect(fs.existsSync(path.join(tmp, INBOX))).toBe(false)
  })

  it('stores a hotkey only with a modifier, and converts it for Electron', () => {
    const d = defaultGlobal()
    expect(d.capture).toEqual({ hotkey: 'Mod+Shift+Space', target: 'daily' })
    for (const bad of ['A', 'Space', 'Mod+Shift', 'Mod+', 42]) expect(applyGlobalPatch(d, { capture: { hotkey: bad } }).capture.hotkey).toBe('Mod+Shift+Space')
    expect(applyGlobalPatch(d, { capture: { hotkey: 'Ctrl+Alt+N', target: 'inbox' } }).capture).toEqual({ hotkey: 'Ctrl+Alt+N', target: 'inbox' })
    expect(applyGlobalPatch(d, { capture: { hotkey: '' } }).capture.hotkey).toBe('')
    expect(normalizeGlobal({ version: 2, capture: { target: 'elsewhere' }, menuBarIcon: 'yes' })).toMatchObject({ capture: { target: 'daily' }, menuBarIcon: true })
    expect(toAccelerator('Mod+Shift+Space')).toBe('Command+Shift+Space')
    expect(toAccelerator('Ctrl+Alt+ArrowUp')).toBe('Control+Alt+Up')
  })
})

describe('menu bar', () => {
  it('lists each vault with at most five recent notes, then the actions', () => {
    const opened: string[] = []
    const items = trayMenu(
      [
        { name: 'Work', recent: ['a.md', 'b/c.md', 'd.md', 'e.md', 'f.md', 'g.md'], open: (p) => opened.push(p) },
        { name: 'Home', recent: [], open: () => {} },
      ],
      { newNote: 'New Note', capture: 'Quick Capture', noRecent: 'No recent notes' },
      { capture: () => {}, captureAccel: 'Command+Shift+Space' },
    )
    expect(items.map((i) => i.label ?? '-')).toEqual(['Work', 'a', 'c', 'd', 'e', 'f', '-', 'Home', 'No recent notes', '-', 'New Note', 'Quick Capture'])
    items[2].click!()
    expect(opened).toEqual(['b/c.md'])
    expect(items.find((i) => i.label === 'New Note')!.enabled).toBe(false) // no vault to create it in
  })

  it('draws the icon as alpha only (a template image), opaque on the nodes', () => {
    const bmp = trayBitmap(36)
    expect(bmp.length).toBe(36 * 36 * 4)
    const alpha = (x: number, y: number) => bmp[(y * 36 + x) * 4 + 3]
    expect(alpha(21, 28)).toBe(255) // big node
    expect(alpha(0, 35)).toBe(0) // corner
    expect([...bmp].filter((_, i) => i % 4 !== 3).every((v) => v === 0)).toBe(true)
  })
})
