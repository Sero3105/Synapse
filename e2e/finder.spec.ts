// Notes opened from Finder, and every vault window coming back at launch.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const titles = (app: Awaited<ReturnType<typeof launch>>['app']) =>
  app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map((w) => w.getTitle()).sort())
const registry = () => JSON.parse(fs.readFileSync(path.join(env.userData, 'vaults.json'), 'utf8'))

function addVaultB() {
  const vaultB = path.join(env.tmp, 'Vault B')
  fs.mkdirSync(vaultB)
  fs.writeFileSync(path.join(vaultB, 'B note.md'), 'b')
  const r = registry()
  r.vaults.bbbbbbbbbbbbbbbb = { path: vaultB, ts: 0 }
  return r
}

test('a note opened from Finder shows in the window of its vault', async () => {
  env = makeEnv({ 'A note.md': 'a', 'sub/Deep note.md': 'hello from Finder' })
  const { app, win } = await launch(env)
  // what macOS sends for a double click, "Open With" or a drop on the Dock icon
  await app.evaluate(({ app }, f) => app.emit('open-file', { preventDefault() {} }, f), path.join(env.vault, 'sub/Deep note.md'))
  await expect(win.locator('.cm-content')).toContainText('hello from Finder')
  expect(app.windows()).toHaveLength(1)
  await app.close()
})

test('a note outside every vault opens its folder as a new vault, after asking', async () => {
  env = makeEnv({ 'A note.md': 'a' })
  const outside = path.join(env.tmp, 'Loose notes')
  fs.mkdirSync(outside)
  fs.writeFileSync(path.join(outside, 'Loose.md'), 'not in a vault yet')
  const { app } = await launch(env)
  // stand-in for the user choosing "Open Folder as Vault" in the native question
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as typeof dialog.showMessageBox
  })
  const opened = app.waitForEvent('window')
  await app.evaluate(({ app }, f) => app.emit('open-file', { preventDefault() {} }, f), path.join(outside, 'Loose.md'))
  const w = await opened
  await expect(w.locator('.cm-content')).toContainText('not in a vault yet')
  expect(await titles(app)).toEqual(['Loose notes - Synapse', 'Vault - Synapse'])
  await app.close()
})

test('every vault that had a window comes back at launch', async () => {
  env = makeEnv({ 'A note.md': 'a' })
  const r = addVaultB()
  r.open = ['aaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb']
  fs.writeFileSync(path.join(env.userData, 'vaults.json'), JSON.stringify(r))
  const { app } = await launch(env)
  await expect.poll(() => titles(app)).toEqual(['Vault - Synapse', 'Vault B - Synapse'])
  expect(registry().lastOpen).toBe('aaaaaaaaaaaaaaaa') // the last used vault stays the last used

  // closing a window (not quitting) forgets it for the next launch
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find((w) => w.getTitle().startsWith('Vault B'))!.close())
  await expect.poll(() => app.windows().length).toBe(1)
  await expect.poll(() => registry().open).toEqual(['aaaaaaaaaaaaaaaa'])
  await app.close()
})
