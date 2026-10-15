// Mandatory settings acceptance scenario + edge cases. "Restart" = new AppStore/VaultStore
// instances reading the same directories, exactly what a relaunch does.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AppStore, VaultStore, atomicWrite } from '../src/main/store'
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

  it('atomicWrite leaves no temp files', () => {
    const f = path.join(tmp, 'x.json')
    atomicWrite(f, '1')
    atomicWrite(f, '2')
    expect(fs.readFileSync(f, 'utf8')).toBe('2')
    expect(fs.readdirSync(tmp).filter((n) => n.includes('.tmp'))).toEqual([])
  })

  it('window state round-trips', () => {
    const app = new AppStore(userData)
    expect(app.getWindowState()).toBeNull()
    app.saveWindowState({ x: 10, y: 20, width: 900, height: 700, isMaximized: true })
    expect(new AppStore(userData).getWindowState()).toEqual({ x: 10, y: 20, width: 900, height: 700, isMaximized: true })
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
