// Page preview: ⌘ + hover over an internal link shows the linked note in a floating card.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const B = `# First\n\nalpha\n\n${'Filler paragraph.\n\n'.repeat(25)}# Second\n\nbeta text under the second heading\n`

test('⌘ + hover previews a linked note in the reading view and in the editor', async () => {
  env = makeEnv({ 'A.md': 'Go to [[B#Second]] or [[Missing]].\n\nSecond line.\n', 'B.md': B })
  const { app, win } = await launch(env)
  const card = win.getByTestId('hover-preview')

  // reading view
  await win.evaluate(() => (window as any).__synapse.open('A.md', 'tab', { mode: 'preview' }))
  const link = win.getByTestId('reading').locator('a.internal-link', { hasText: 'B > Second' })
  await link.hover()
  await win.waitForTimeout(300)
  await expect(card).toHaveCount(0) // a plain hover shows nothing
  await win.keyboard.down('Meta') // pressing ⌘ while already over the link shows it
  await expect(card).toBeVisible()
  await expect(card.locator('.hover-preview-title')).toHaveText('B')
  await expect(card.getByText('beta text under the second heading')).toBeInViewport() // scrolled to #Second
  await win.getByTestId('reading').locator('a.internal-link', { hasText: 'Missing' }).hover()
  await expect(card).toHaveCount(0) // nothing to preview for a note that does not exist
  await win.keyboard.up('Meta')
  await win.mouse.move(5, 400)
  await expect(card).toHaveCount(0)

  // editor (Live Preview): the rendered link, hovered with ⌘ held
  await win.evaluate(() => (window as any).__synapse.open('A.md', 'tab', { mode: 'source' }))
  await win.locator('.cm-content').click({ position: { x: 5, y: 60 } }) // caret off the link line, so it renders
  await win.keyboard.down('Meta')
  await win.locator('.cm-lp-link', { hasText: 'B' }).first().hover()
  await expect(card).toBeVisible()
  await win.keyboard.up('Meta')
  // the pointer can travel onto the card and stay there
  await card.hover()
  await win.waitForTimeout(500)
  await expect(card).toBeVisible()

  if (process.env.SYNAPSE_SHOT) {
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(process.env.SYNAPSE_SHOT, Buffer.from(png, 'base64'))
  }

  // a click on the card opens the note
  await card.click()
  await expect(card).toHaveCount(0)
  await expect(win.locator('.cm-content')).toContainText('beta text under the second heading')
  await app.close()
})
