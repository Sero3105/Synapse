// Mandatory settings acceptance scenario + edge cases. "Restart" = new AppStore/VaultStore
// instances reading the same directories, exactly what a relaunch does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { AppStore, VaultStore, atomicWrite, placeWindow } from '../src/main/store'
import { openVault, snapshot, listVaults } from '../src/main/session'
import { DEFAULT_PREFS, normalizeGlobal, resolvePrefs, defaultGlobal, defaultVault } from '../src/shared/settings'

let tmp: string
let userData: string
let vaultA: string
let vaultB: string
const trash = async () => {}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-test-'))
  userData = path.join(tmp, 'userData')
  vaultA = path.join(tmp, 'Vault A')
  vaultB = path.join(tmp, 'Vault B')
  fs.mkdirSync(vaultA)
  fs.mkdirSync(vaultB)
  fs.writeFileSync(path.join(vaultA, 'a.md'), '# A')
})
afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('mandatory acceptance scenario', () => {
  it('keeps global prefs across restarts and vault switches; vault overrides stay with their vault', async () => {
    // 1-5: launch, open A, dark theme, font size, sidebar layout
    let app = new AppStore(userData)
    let open = await openVault(app, vaultA, trash)
    await app.updateGlobal({ prefs: { theme: 'dark', fontSize: 19 }, layout: { leftWidth: 333, rightOpen: false } })
    // 6-8: close + reopen
    app = new AppStore(userData)
    expect(app.getRegistry().lastOpen).toBe(open.id)
    open = await openVault(app, app.getRegistry().vaults[app.getRegistry().lastOpen!].path, trash)
    let s = snapshot(app, open)
    expect(s.prefs.theme).toBe('dark')
    expect(s.prefs.fontSize).toBe(19)
    expect(s.global.layout.leftWidth).toBe(333)
    expect(s.global.layout.rightOpen).toBe(false)
    // 9-10: open B, globals unchanged
    let b = await openVault(app, vaultB, trash)
    s = snapshot(app, b)
    expect(s.prefs.theme).toBe('dark')
    expect(s.prefs.fontSize).toBe(19)
    // 11: vault-specific setting in B
    await b.store.update({ overrides: { showLineNumber: true }, graph: { showOrphans: false } })
    // 12-13: back to A, A keeps its own (none) config
    let a = await openVault(app, vaultA, trash)
    s = snapshot(app, a)
    expect(s.prefs.showLineNumber).toBe(false)
    expect(s.vault!.settings.graph.showOrphans).toBe(true)
    // 14-15: B retains config
    b = await openVault(app, vaultB, trash)
    expect(snapshot(app, b).prefs.showLineNumber).toBe(true)
    expect(snapshot(app, b).vault!.settings.graph.showOrphans).toBe(false)
    // 16-18: change global while B open, applies to A
    await app.updateGlobal({ prefs: { accentColor: '#ff0000', theme: 'light' } })
    a = await openVault(app, vaultA, trash)
    expect(snapshot(app, a).prefs.accentColor).toBe('#ff0000')
    expect(snapshot(app, a).prefs.theme).toBe('light')
    expect(snapshot(app, a).prefs.fontSize).toBe(19) // unrelated pref preserved
    // 19-20: restart, everything restored
    app = new AppStore(userData)
    a = await openVault(app, vaultA, trash)
    b = await openVault(app, vaultB, trash)
    expect(snapshot(app, a).prefs).toMatchObject({ theme: 'light', fontSize: 19, accentColor: '#ff0000', showLineNumber: false })
    expect(snapshot(app, b).prefs).toMatchObject({ theme: 'light', fontSize: 19, accentColor: '#ff0000', showLineNumber: true })
    expect(snapshot(app, a).global.layout.leftWidth).toBe(333)
  })

  it('stores global settings outside every vault', async () => {
    const app = new AppStore(userData)
    await openVault(app, vaultA, trash)
    await app.updateGlobal({ prefs: { theme: 'dark' } })
    expect(fs.existsSync(path.join(userData, 'settings.json'))).toBe(true)
    const vaultFile = fs.readFileSync(path.join(vaultA, '.synapse', 'settings.json'), 'utf8')
    expect(vaultFile).not.toContain('"theme"')
  })
})

describe('edge cases', () => {
  it('startup without previous vault: no vault, defaults', () => {
    const app = new AppStore(userData)
    expect(app.getRegistry().lastOpen).toBeNull()
    const s = snapshot(app, null)
    expect(s.vault).toBeNull()
    expect(s.prefs).toEqual(DEFAULT_PREFS)
  })

  it('never-opened vault with no local settings gets global prefs and a stamped id', async () => {
    const app = new AppStore(userData)
    await app.updateGlobal({ prefs: { fontSize: 22 } })
    const v = await openVault(app, vaultB, trash)
    expect(snapshot(app, v).prefs.fontSize).toBe(22)
    expect(VaultStore.peekId(vaultB)).toBe(v.id)
    // existing notes untouched
    expect(fs.readdirSync(vaultB).sort()).toEqual(['.synapse'])
  })

  it('migrates an older vault schema, keeping a backup', async () => {
    fs.mkdirSync(path.join(vaultA, '.synapse'))
    const f = path.join(vaultA, '.synapse', 'settings.json')
    fs.writeFileSync(f, JSON.stringify({ version: 1, vaultId: 'abcdef0123456789', fontSize: 25, graphView: { showOrphans: false } }))
    const app = new AppStore(userData)
    const v = await openVault(app, vaultA, trash)
    expect(v.store.get().overrides.fontSize).toBe(25)
    expect(v.store.get().graph.showOrphans).toBe(false)
    expect(fs.existsSync(f + '.v1.bak')).toBe(true)
    expect(JSON.parse(fs.readFileSync(f, 'utf8')).version).toBe(2)
  })

  it('migrates an older global schema', () => {
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ darkMode: true, editorFontSize: 18, sidebarWidth: 300 }))
    const app = new AppStore(userData)
    expect(app.getGlobal().prefs.theme).toBe('dark')
    expect(app.getGlobal().prefs.fontSize).toBe(18)
    expect(app.getGlobal().layout.leftWidth).toBe(300)
    expect(fs.existsSync(path.join(userData, 'settings.json.v1.bak'))).toBe(true)
  })

  it('corrupted global settings: defaults used, original preserved', () => {
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(path.join(userData, 'settings.json'), '{ not json')
    const app = new AppStore(userData)
    expect(app.getGlobal()).toEqual(defaultGlobal())
    expect(fs.readdirSync(userData).some((f) => f.startsWith('settings.json.corrupt-'))).toBe(true)
  })

  it('corrupted vault settings: defaults used, backup kept', async () => {
    fs.mkdirSync(path.join(vaultA, '.synapse'))
    fs.writeFileSync(path.join(vaultA, '.synapse', 'settings.json'), '\u0000garbage')
    const app = new AppStore(userData)
    const v = await openVault(app, vaultA, trash)
    expect(v.store.get().overrides).toEqual({})
    expect(fs.readdirSync(path.join(vaultA, '.synapse')).some((f) => f.includes('.corrupt-'))).toBe(true)
  })

  it('invalid individual values fall back per key', () => {
    const g = normalizeGlobal({ version: 2, prefs: { theme: 'neon', fontSize: 999, spellcheck: false }, layout: { leftWidth: 'x' } })
    expect(g.prefs.theme).toBe('system')
    expect(g.prefs.fontSize).toBe(16)
    expect(g.prefs.spellcheck).toBe(false)
    expect(g.layout.leftWidth).toBe(260)
  })

  it('unavailable vault path errors and never creates the folder', async () => {
    const app = new AppStore(userData)
    const missing = path.join(tmp, 'gone')
    await expect(openVault(app, missing, trash)).rejects.toThrow(/not found/)
    expect(fs.existsSync(missing)).toBe(false)
  })

  it('missing last vault is listed as unavailable, not as empty', async () => {
    const app = new AppStore(userData)
    await openVault(app, vaultB, trash)
    fs.rmSync(vaultB, { recursive: true })
    const item = listVaults(new AppStore(userData)).find((v) => v.path === vaultB)
    expect(item?.available).toBe(false)
  })

  it('moved or renamed vault is recognized by its stamped id and keeps its overrides', async () => {
    const app = new AppStore(userData)
    const v = await openVault(app, vaultB, trash)
    await v.store.update({ overrides: { tabSize: 2 } })
    const moved = path.join(tmp, 'Renamed Vault')
    fs.renameSync(vaultB, moved)
    const v2 = await openVault(app, moved, trash)
    expect(v2.id).toBe(v.id)
    expect(Object.keys(app.getRegistry().vaults)).toHaveLength(1)
    expect(app.getRegistry().vaults[v.id].path).toBe(moved)
    expect(snapshot(app, v2).prefs.tabSize).toBe(2)
  })

  it('a copied vault (original still present) gets its own id', async () => {
    const app = new AppStore(userData)
    const v = await openVault(app, vaultB, trash)
    const copy = path.join(tmp, 'Copy')
    fs.cpSync(vaultB, copy, { recursive: true })
    const c = await openVault(app, copy, trash)
    expect(c.id).not.toBe(v.id)
    expect(VaultStore.peekId(copy)).toBe(c.id)
  })

  it('two vaults keep different overrides of the same key', async () => {
    const app = new AppStore(userData)
    const a = await openVault(app, vaultA, trash)
    await a.store.update({ overrides: { fontSize: 12 } })
    const b = await openVault(app, vaultB, trash)
    await b.store.update({ overrides: { fontSize: 30 } })
    const app2 = new AppStore(userData)
    expect(snapshot(app2, await openVault(app2, vaultA, trash)).prefs.fontSize).toBe(12)
    expect(snapshot(app2, await openVault(app2, vaultB, trash)).prefs.fontSize).toBe(30)
    expect(app2.getGlobal().prefs.fontSize).toBe(16)
  })

  it('removing a vault override falls back to the global value', async () => {
    const app = new AppStore(userData)
    const a = await openVault(app, vaultA, trash)
    await app.updateGlobal({ prefs: { fontSize: 20 } })
    await a.store.update({ overrides: { fontSize: 12 } })
    expect(snapshot(app, a).prefs.fontSize).toBe(12)
    await a.store.update({ overrides: { fontSize: null } })
    expect(snapshot(app, a).prefs.fontSize).toBe(20)
  })

  it('partial corePlugins override merges with global', () => {
    const g = defaultGlobal()
    g.prefs.corePlugins.graph = false
    const v = defaultVault('abcdef0123456789')
    v.overrides.corePlugins = { tags: false } as never
    const p = resolvePrefs(g, v)
    expect(p.corePlugins.graph).toBe(false)
    expect(p.corePlugins.tags).toBe(false)
    expect(p.corePlugins.search).toBe(true)
  })

  it('failed write keeps previous state on disk and in memory', async () => {
    const app = new AppStore(userData)
    await app.updateGlobal({ prefs: { fontSize: 18 } })
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
    })
    await expect(app.updateGlobal({ prefs: { fontSize: 30 } })).rejects.toThrow()
    spy.mockRestore()
    expect(app.getGlobal().prefs.fontSize).toBe(18)
    expect(new AppStore(userData).getGlobal().prefs.fontSize).toBe(18)
    expect(fs.readdirSync(userData).some((f) => f.endsWith('.tmp'))).toBe(false)
    // queue still usable after a failure
    await app.updateGlobal({ prefs: { fontSize: 21 } })
    expect(new AppStore(userData).getGlobal().prefs.fontSize).toBe(21)
  })

  it('global update while switching vaults is not lost', async () => {
    const app = new AppStore(userData)
    await openVault(app, vaultA, trash)
    await Promise.all([
      app.updateGlobal({ prefs: { theme: 'dark' } }),
      openVault(app, vaultB, trash),
      app.updateGlobal({ prefs: { fontSize: 17 } }),
    ])
    const re = new AppStore(userData)
    expect(re.getGlobal().prefs).toMatchObject({ theme: 'dark', fontSize: 17 })
    expect(re.getRegistry().vaults[re.getRegistry().lastOpen!].path).toBe(vaultB)
  })

  it('unknown keys in patches are ignored', async () => {
    const app = new AppStore(userData)
    await app.updateGlobal({ prefs: { evil: 1, theme: 'dark' }, __proto__: { x: 1 } } as never)
    expect(Object.keys(app.getGlobal().prefs)).not.toContain('evil')
  })

  it('removing a vault deletes its version history, and only that', async () => {
    const app = new AppStore(userData)
    const a = await app.touchVault(path.join(tmp, 'A'))
    const b = await app.touchVault(path.join(tmp, 'B'))
    for (const id of [a, b]) fs.mkdirSync(path.join(userData, 'history', id, 'x'), { recursive: true })
    await app.removeVault('..') // not a registered id: nothing is deleted
    await app.removeVault(a)
    expect(fs.existsSync(path.join(userData, 'history', a))).toBe(false)
    expect(fs.existsSync(path.join(userData, 'history', b, 'x'))).toBe(true)
  })

  it('remembers the vaults with a window; unknown and removed ids are dropped', async () => {
    const app = new AppStore(userData)
    const a = await app.touchVault(vaultA)
    const b = await app.touchVault(vaultB)
    await app.setOpenVaults([a, b, a, 'ffffffffffffffff'])
    expect(new AppStore(userData).getRegistry().open).toEqual([a, b])
    await app.removeVault(b)
    expect(new AppStore(userData).getRegistry().open).toEqual([a])
  })

  it('atomicWrite leaves no temp files', () => {
    const f = path.join(tmp, 'x.json')
    atomicWrite(f, '1')
    atomicWrite(f, '2')
    expect(fs.readFileSync(f, 'utf8')).toBe('2')
    expect(fs.readdirSync(tmp).filter((n) => n.includes('.tmp'))).toEqual([])
  })

  it('atomicWrite keeps the permissions and creation date of the file it replaces', async () => {
    const f = path.join(tmp, 'note.md')
    atomicWrite(f, '1')
    fs.chmodSync(f, 0o600)
    const born = fs.statSync(f).birthtimeMs
    await new Promise((r) => setTimeout(r, 50))
    atomicWrite(f, '2')
    const st = fs.statSync(f)
    expect(st.mode & 0o777).toBe(0o600)
    expect(st.mtimeMs).toBeGreaterThan(born)
    // APFS only: Linux (CI) cannot set a birthtime
    if (process.platform === 'darwin') expect(Math.abs(st.birthtimeMs - born)).toBeLessThan(1)
  })

  it.skipIf(process.platform !== 'darwin')('atomicWrite keeps Finder tags (extended attributes)', () => {
    const f = path.join(tmp, 'tagged.md')
    atomicWrite(f, '1')
    execFileSync('xattr', ['-w', 'com.apple.metadata:_kMDItemUserTags', 'tag-test', f])
    atomicWrite(f, '2')
    expect(fs.readFileSync(f, 'utf8')).toBe('2')
    expect(execFileSync('xattr', ['-p', 'com.apple.metadata:_kMDItemUserTags', f], { encoding: 'utf8' }).trim()).toBe('tag-test')
  })

  it('window state round-trips', () => {
    const app = new AppStore(userData)
    expect(app.getWindowState()).toBeNull()
    app.saveWindowState({ x: 10, y: 20, width: 900, height: 700, isMaximized: true })
    expect(new AppStore(userData).getWindowState()).toEqual({ x: 10, y: 20, width: 900, height: 700, isMaximized: true })
  })

  it('each vault keeps its own window size and place; others get the last one', () => {
    const app = new AppStore(userData)
    app.saveWindowState({ x: 0, y: 30, width: 800, height: 600, isMaximized: false }, 'aaaaaaaaaaaaaaaa')
    app.saveWindowState({ x: 900, y: 30, width: 700, height: 500, isMaximized: false }, 'bbbbbbbbbbbbbbbb')
    const again = new AppStore(userData)
    expect(again.getWindowState('aaaaaaaaaaaaaaaa')).toMatchObject({ x: 0, width: 800 })
    expect(again.getWindowState('bbbbbbbbbbbbbbbb')).toMatchObject({ x: 900, width: 700 })
    expect(again.getWindowState('cccccccccccccccc')).toMatchObject({ x: 900, width: 700 }) // never seen: the last window
    expect(again.getWindowState()).toMatchObject({ x: 900, width: 700 })
  })

  it('create vault refuses existing folder', async () => {
    const app = new AppStore(userData)
    await expect(openVault(app, vaultA, trash, { create: true })).rejects.toThrow(/exists/)
    const v = await openVault(app, path.join(tmp, 'New'), trash, { create: true })
    expect(fs.existsSync(v.vault.root)).toBe(true)
  })
})

describe('hotkeys', () => {
  it('custom hotkeys persist and null restores default', async () => {
    const app = new AppStore(userData)
    await app.updateGlobal({ hotkeys: { 'graph:open': ['Mod+Shift+G'], 'switcher:open': [] } })
    expect(new AppStore(userData).getGlobal().hotkeys).toEqual({ 'graph:open': ['Mod+Shift+G'], 'switcher:open': [] })
    await app.updateGlobal({ hotkeys: { 'graph:open': null } })
    expect(new AppStore(userData).getGlobal().hotkeys).toEqual({ 'switcher:open': [] })
  })
})

describe('layout schema', () => {
  it('drops the retired showRibbon key without losing other layout values', () => {
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 2, prefs: { theme: 'dark' }, layout: { showRibbon: false, leftWidth: 320 }, hotkeys: {} }))
    const g = new AppStore(userData).getGlobal()
    expect(g.layout).not.toHaveProperty('showRibbon')
    expect(g.layout.leftWidth).toBe(320)
    expect(g.prefs.theme).toBe('dark')
  })
})

describe('prototype keys', () => {
  it('ignores __proto__ and friends in stored hotkeys', () => {
    const g = normalizeGlobal(JSON.parse('{"version":2,"hotkeys":{"__proto__":["Mod+X"],"constructor":["Mod+Y"],"graph:open":["Mod+G"]}}'))
    expect(Object.keys(g.hotkeys)).toEqual(['graph:open'])
    expect(Object.getPrototypeOf(g.hotkeys)).toBe(Object.prototype)
  })
})

describe('vault store when the vault folder disappears', () => {
  it('does not recreate the folder to save settings or the workspace', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-gone-'))
    const root = path.join(tmp, 'v')
    fs.mkdirSync(root)
    const s = new VaultStore(root)
    fs.rmSync(root, { recursive: true })
    await expect(s.saveWorkspace({ panes: [] })).rejects.toMatchObject({ code: 'ENOVAULT' })
    await expect(s.update({ attachmentFolder: 'x' })).rejects.toMatchObject({ code: 'ENOVAULT' })
    expect(fs.existsSync(root)).toBe(false)
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})

describe('accent colour of the redesign', () => {
  it('moves the previous default accent to the new one, keeps any other choice', () => {
    expect(defaultGlobal().prefs.accentColor).toBe('#8b7cff')
    expect(normalizeGlobal({ version: 2, prefs: { accentColor: '#4cc9b0' } }).prefs.accentColor).toBe('#8b7cff')
    expect(normalizeGlobal({ version: 2, prefs: { accentColor: '#4CC9B0' } }).prefs.accentColor).toBe('#8b7cff')
    expect(normalizeGlobal({ version: 2, prefs: { accentColor: '#e06c75' } }).prefs.accentColor).toBe('#e06c75')
  })
})

describe('graph: local mode and saved views', () => {
  const view = (name: string, extra: Record<string, unknown> = {}) => ({ id: name.toLowerCase(), name, graph: { local: true, depth: 2 }, query: 'tag:#lavoro', orphansOnly: false, ...extra })

  it('defaults to the global graph with no views', () => {
    const v = defaultVault('abcdef0123456789')
    expect(v.graph.local).toBe(false)
    expect(v.graph.depth).toBe(1)
    expect(v.graphViews).toEqual([])
  })

  it('views persist per vault across restarts, with full graph options', async () => {
    const app = new AppStore(userData)
    const a = await openVault(app, vaultA, trash)
    await a.store.update({ graphViews: [view('Lavoro', { center: 'a.md' })] })
    await openVault(app, vaultB, trash) // another vault has its own (empty) list
    expect(new VaultStore(vaultB).get().graphViews).toEqual([])
    const back = new VaultStore(vaultA).get().graphViews
    expect(back).toHaveLength(1)
    expect(back[0]).toMatchObject({ name: 'Lavoro', query: 'tag:#lavoro', center: 'a.md' })
    // missing graph options take the defaults, so applying a view always sets every option
    expect(back[0].graph).toEqual({ showOrphans: true, showUnresolved: false, linkDistance: 80, repel: 600, local: true, depth: 2, colorBy: 'none' })
    // the views live in the vault's own settings file
    expect(JSON.parse(fs.readFileSync(path.join(vaultA, '.synapse', 'settings.json'), 'utf8')).graphViews[0].name).toBe('Lavoro')
  })

  it('drops invalid views and depths instead of the whole file', async () => {
    const s = new VaultStore(vaultA)
    await s.update({
      graph: { depth: 7, local: 'yes' },
      graphViews: [view('ok'), { id: 'x' }, { id: 'y', name: '   ' }, 'junk', view('bad graph', { graph: { depth: 9, repel: 1e9 } })],
    })
    const v = new VaultStore(vaultA).get()
    expect(v.graph.depth).toBe(1)
    expect(v.graph.local).toBe(false)
    expect(v.graphViews.map((x) => x.name)).toEqual(['ok', 'bad graph'])
    expect(v.graphViews[1].graph.depth).toBe(1)
    expect(v.graphViews[1].graph.repel).toBe(600)
  })

  it('a patch without views keeps them', async () => {
    const s = new VaultStore(vaultA)
    await s.update({ graphViews: [view('Keep')] })
    await s.update({ graph: { local: true } })
    expect(new VaultStore(vaultA).get().graphViews.map((x) => x.name)).toEqual(['Keep'])
  })
})

describe('placing a new window', () => {
  const screen = [{ x: 0, y: 25, width: 1440, height: 875 }]
  const saved = { x: 100, y: 60, width: 800, height: 600, isMaximized: false }
  it('uses the saved place when it is free and on screen', () => {
    expect(placeWindow(saved, screen, [])).toEqual(saved)
  })
  it('never covers a window exactly: moves down-right', () => {
    expect(placeWindow(saved, screen, [{ x: 100, y: 60, width: 800, height: 600 }])).toMatchObject({ x: 128, y: 88 })
    expect(placeWindow(saved, screen, [{ x: 100, y: 60, width: 800, height: 600 }, { x: 128, y: 88, width: 800, height: 600 }])).toMatchObject({ x: 156, y: 116 })
  })
  it('a place on a monitor that is gone is not used', () => {
    expect(placeWindow({ ...saved, x: 2500 }, screen, [])).toEqual({ width: 800, height: 600, isMaximized: false }) // centred by macOS
    expect(placeWindow({ ...saved, x: 2500 }, screen, [{ x: 300, y: 100, width: 800, height: 600 }])).toMatchObject({ x: 328, y: 128 })
  })
  it('the cascade wraps before leaving the screen', () => {
    const p = placeWindow({ ...saved, x: 1000, y: 500 }, screen, [{ x: 1000, y: 500, width: 800, height: 600 }])
    expect(p.x! + 400).toBeLessThanOrEqual(1440)
    expect(p.y! + 300).toBeLessThanOrEqual(900)
  })
  it('no saved place and no other window: macOS centres it', () => {
    expect(placeWindow(null, screen, [])).toEqual({ width: 1200, height: 800, isMaximized: false })
  })
})
