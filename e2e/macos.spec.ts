// macOS integration: synapse:// links and quick capture. The menu bar icon and the system-wide
// hotkey are never installed in tests (they would land on this Mac); their logic is unit-tested.
import { test, expect, ElectronApplication } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, choose, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

/** What macOS sends when a synapse:// link is clicked anywhere. */
const openUrl = (app: ElectronApplication, url: string) => app.evaluate(({ app }, u) => app.emit('open-url', { preventDefault() {} }, u), url)
const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.md`
}

test('synapse://open shows a note, synapse://new creates one and never overwrites', async () => {
  env = makeEnv({ 'A note.md': 'a', 'Folder/Deep note.md': 'reached by a link' })
  const { app, win } = await launch(env)
  await openUrl(app, 'synapse://open?vault=vault&file=Folder/Deep%20note')
  await expect(win.locator('.cm-content')).toContainText('reached by a link')

  await openUrl(app, 'synapse://new?name=From%20a%20link&text=Hello%20from%20Mail')
  await expect(win.locator('.cm-content')).toContainText('Hello from Mail')
  expect(fs.readFileSync(path.join(env.vault, 'From a link.md'), 'utf8')).toBe('Hello from Mail')
  await openUrl(app, 'synapse://new?name=From%20a%20link&text=Second')
  await expect.poll(() => fs.existsSync(path.join(env.vault, 'From a link 1.md'))).toBe(true)
  expect(fs.readFileSync(path.join(env.vault, 'From a link.md'), 'utf8')).toBe('Hello from Mail')
  await expect(win.getByTestId('file-explorer')).toContainText('From a link 1')
  expect(app.windows()).toHaveLength(1)
  await app.close()
})

test('quick capture appends to today’s daily note, or to Inbox.md as set in Settings', async () => {
  env = makeEnv({ 'A note.md': 'a' })
  const { app, win } = await launch(env)

  const opened = app.waitForEvent('window')
  await openUrl(app, 'synapse://capture')
  const cap = await opened
  await expect(cap.getByTestId('capture')).toContainText('today’s daily note in Vault')
  await cap.getByRole('textbox').click()
  await cap.keyboard.type('An idea from another app')
  await cap.keyboard.press('Enter')
  await expect.poll(() => fs.existsSync(path.join(env.vault, today()))).toBe(true)
  expect(fs.readFileSync(path.join(env.vault, today()), 'utf8')).toBe('An idea from another app\n')
  await expect(cap.getByRole('textbox')).toHaveValue('')
  // the vault window sees the new note
  await expect(win.getByTestId('file-explorer')).toContainText(today().slice(0, -3))

  // Settings: send captures to Inbox.md instead
  await win.evaluate(() => (window as any).__synapse.set({ modal: { kind: 'settings', tab: 'general' } }))
  await expect(win.locator('[data-setting="capture"]')).toContainText('⌘⇧Space')
  await choose(win, 'Add captures to', 'Inbox.md')
  if (process.env.SYNAPSE_SHOT) {
    await win.locator('[data-setting="menuBarIcon"]').scrollIntoViewIfNeeded()
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => !w.webContents.getURL().endsWith('#capture'))!.capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(process.env.SYNAPSE_SHOT.replace(/\.png$/, '-settings.png'), Buffer.from(png, 'base64'))
  }
  await win.keyboard.press('Escape')
  await openUrl(app, 'synapse://capture')
  await expect(cap.getByTestId('capture')).toContainText('Inbox in Vault')
  await cap.getByRole('textbox').click()
  await cap.keyboard.type('Two lines')
  await cap.keyboard.press('Shift+Enter')
  await cap.keyboard.type('in the inbox')
  await cap.keyboard.press('Enter')
  await expect.poll(() => fs.existsSync(path.join(env.vault, 'Inbox.md'))).toBe(true)
  expect(fs.readFileSync(path.join(env.vault, 'Inbox.md'), 'utf8')).toBe('Two lines\nin the inbox\n')
  expect(fs.readFileSync(path.join(env.vault, today()), 'utf8')).toBe('An idea from another app\n')

  await expect(cap.getByRole('textbox')).toHaveValue('')

  if (process.env.SYNAPSE_SHOT) {
    await cap.keyboard.type('A thought for later')
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('#capture'))!.capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(process.env.SYNAPSE_SHOT, Buffer.from(png, 'base64'))
  }
  await app.close()
})
