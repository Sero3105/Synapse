import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

test('fold a heading section with its arrow, fold all and unfold all; the file never changes', async () => {
  const note = '# One\n\nfirst body\n\n## One.a\n\nnested body\n\n# Two\n\nsecond body\n'
  env = makeEnv({ 'Note.md': note })
  const { app, win } = await launch(env)
  await win.locator('.tree-item-self', { hasText: 'Note' }).click()
  const content = win.locator('.cm-content')
  await expect(content).toContainText('second body')

  // the arrow next to "# One" folds everything up to "# Two"
  await win.locator('.cm-fold-marker:visible').first().click()
  await expect(content).not.toContainText('first body')
  await expect(content).not.toContainText('nested body')
  await expect(content).toContainText('Two')
  await expect(content).toContainText('second body')
  await expect(win.locator('.cm-foldPlaceholder')).toHaveCount(1)
  // clicking the placeholder opens it again
  await win.locator('.cm-foldPlaceholder').click()
  await expect(content).toContainText('first body')

  await palette(win, 'fold all headings')
  await expect(content).not.toContainText('first body')
  await expect(content).not.toContainText('second body')
  await palette(win, 'unfold all headings')
  await expect(content).toContainText('nested body')
  await expect(content).toContainText('second body')

  // keyboard: ⌘⌥[ folds the section the cursor is in, ⌘⌥] opens it
  await win.locator('.cm-line', { hasText: 'Two' }).click()
  await win.keyboard.press('Meta+Alt+BracketLeft')
  await expect(content).not.toContainText('second body')
  await win.keyboard.press('Meta+Alt+BracketRight')
  await expect(content).toContainText('second body')

  await win.waitForTimeout(1000)
  expect(fs.readFileSync(path.join(env.vault, 'Note.md'), 'utf8')).toBe(note) // folding is display only
  await app.close()
})

test('frontmatter is one quiet block, never a heading; paragraphs get no fold arrow', async () => {
  env = makeEnv({ 'Note.md': '---\ntags: [a, b]\nautore: Sero\n---\n# Title\n\nA paragraph\non two lines.\n\n> a quote\n> two lines\n' })
  const { app, win } = await launch(env)
  await win.locator('.tree-item-self', { hasText: 'Note' }).click()
  await expect(win.locator('.cm-line.cm-frontmatter')).toHaveCount(4)
  await expect(win.locator('.cm-line', { hasText: 'autore: Sero' })).not.toHaveClass(/cm-header|HyperMD-header/)
  // arrows: the frontmatter and the heading only
  await expect(win.locator('.cm-fold-marker:visible')).toHaveCount(2)
  await app.close()
})
