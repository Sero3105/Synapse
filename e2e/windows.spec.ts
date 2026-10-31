// Two vaults side by side in two windows.
import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')
const imageLoaded = (win: Page) => win.locator('[data-testid="reading"] img').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)

test('a second vault opens in its own window; each window works on its own files', async () => {
  env = makeEnv({ 'A note.md': 'in A\n\n![[a.png]]\n', 'a.png': PNG })
  const vaultB = path.join(env.tmp, 'Vault B')
  fs.mkdirSync(vaultB)
  fs.writeFileSync(path.join(vaultB, 'B note.md'), 'in B\n\n![[b.png]]\n')
  fs.writeFileSync(path.join(vaultB, 'b.png'), PNG)
  const reg = path.join(env.userData, 'vaults.json')
  const r = JSON.parse(fs.readFileSync(reg, 'utf8'))
  r.vaults.bbbbbbbbbbbbbbbb = { path: vaultB, ts: 0 }
  fs.writeFileSync(reg, JSON.stringify(r))

  const { app, win } = await launch(env)
  await palette(win, 'open another vault')
  const opened = app.waitForEvent('window')
  await win.locator('.vault-row', { hasText: 'Vault B' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Open in new window' }).click()
  const winB = await opened
  await winB.getByTestId('file-explorer').waitFor()
  await expect(winB.getByTestId('file-explorer')).toContainText('B note')
  await expect(winB.getByTestId('file-explorer')).not.toContainText('A note')
  await win.keyboard.press('Escape')
  await expect(win.getByTestId('file-explorer')).toContainText('A note') // the first window keeps its vault

  // each window shows images from its own vault
  for (const [w, note] of [[win, 'A note.md'], [winB, 'B note.md']] as const) {
    await w.evaluate((p) => (window as any).__synapse.open(p, 'tab', { mode: 'preview' }), note)
    await expect.poll(() => imageLoaded(w)).toBe(true)
  }

  // editing in B saves into vault B only
  await winB.evaluate(() => (window as any).__synapse.open('B note.md', 'tab', { mode: 'source' }))
  await winB.locator('.cm-content').click()
  await winB.keyboard.press('Meta+ArrowDown')
  await winB.keyboard.type('edited in B')
  await expect.poll(() => fs.readFileSync(path.join(vaultB, 'B note.md'), 'utf8')).toContain('edited in B')
  expect(fs.readFileSync(path.join(env.vault, 'A note.md'), 'utf8')).toBe('in A\n\n![[a.png]]\n')
  // a change on disk reaches only the window of that vault
  fs.writeFileSync(path.join(env.vault, 'New in A.md'), 'x')
  await expect(win.getByTestId('file-explorer')).toContainText('New in A')
  await winB.waitForTimeout(500)
  await expect(winB.getByTestId('file-explorer')).not.toContainText('New in A')

  // the same vault never opens twice: asking for A in window B leaves B as it is
  await winB.getByRole('button', { name: 'Switch vault' }).click()
  await winB.getByRole('menuitem', { name: 'Vault', exact: true }).click()
  await expect(winB.getByText('This vault is already open in another window.')).toBeVisible()
  await expect(winB.getByTestId('file-explorer')).toContainText('B note')
  expect(app.windows()).toHaveLength(2)

  // closing window B leaves window A working
  await winB.close()
  await expect.poll(() => app.windows().length).toBe(1)
  await win.evaluate(() => (window as any).__synapse.open('A note.md', 'tab', { mode: 'source' }))
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type(' still fine')
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'A note.md'), 'utf8')).toContain('still fine')
  await app.close()
})

test('New window opens the starter screen without touching the current vault', async () => {
  env = makeEnv({ 'A note.md': 'a' })
  const { app, win } = await launch(env)
  const opened = app.waitForEvent('window')
  await palette(win, 'new window')
  const w2 = await opened
  await expect(w2.getByTestId('vault-manager')).toBeVisible()
  await expect(win.getByTestId('file-explorer')).toContainText('A note')
  await app.close()
})

test("a vault's window comes back where it was; a new window never covers another exactly", async () => {
  env = makeEnv({ 'A note.md': 'a' })
  const vaultB = path.join(env.tmp, 'Vault B')
  fs.mkdirSync(vaultB)
  fs.writeFileSync(path.join(vaultB, 'B note.md'), 'b')
  const reg = path.join(env.userData, 'vaults.json')
  const r = JSON.parse(fs.readFileSync(reg, 'utf8'))
  r.vaults.bbbbbbbbbbbbbbbb = { path: vaultB, ts: 0 }
  fs.writeFileSync(reg, JSON.stringify(r))
  const { app, win } = await launch(env)
  const bounds = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => ({ title: w.getTitle(), ...w.getNormalBounds() })))
  const openB = async () => {
    const opened = app.waitForEvent('window')
    await win.evaluate(() => (window as any).synapse.invoke('window:new', 'bbbbbbbbbbbbbbbb'))
    const w = await opened
    await w.getByTestId('file-explorer').waitFor()
    return w
  }

  let winB = await openB()
  let all = await bounds()
  const a = all.find((w) => w.title.startsWith('Vault -'))!
  const b = all.find((w) => w.title.startsWith('Vault B'))!
  expect(a.title).toBe('Vault - Synapse') // each window is named after its vault (Window menu, Mission Control)
  expect(b.title).toBe('Vault B - Synapse')
  expect(Math.abs(a.x - b.x) + Math.abs(a.y - b.y)).toBeGreaterThan(20) // not stacked exactly on A

  // move and resize B, close it, open it again: same place and size
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith('Vault B'))!.setBounds({ x: 220, y: 140, width: 900, height: 640 }))
  await winB.waitForTimeout(700) // the save is debounced
  await winB.close()
  await expect.poll(() => app.windows().length).toBe(1)
  winB = await openB()
  all = await bounds()
  expect(all.find((w) => w.title.startsWith('Vault B'))).toMatchObject({ x: 220, y: 140, width: 900, height: 640 })
  await app.close()
})
