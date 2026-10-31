import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

test('link to a heading: suggest the note headings, then open the note at that heading', async () => {
  const filler = Array.from({ length: 120 }, (_, i) => `line ${i}`).join('\n\n')
  env = makeEnv({
    'A.md': '',
    // frontmatter shifts reading-view lines; the heading text has a character links cannot carry
    'Long.md': `---\ntags: x\n---\n# Intro\n\n${filler}\n\n## Results | final\n\nthe end\n`,
  })
  const { app, win } = await launch(env)
  await win.evaluate(() => (window as any).__synapse.open('A.md'))
  await win.locator('.cm-content').click()
  await win.keyboard.type('[[Long#res')
  const list = win.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('li').first()).toContainText('Results | final')
  await win.waitForTimeout(300) // CodeMirror ignores Enter in the first 75ms after the popup opens
  await win.keyboard.press('Enter')
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'A.md'), 'utf8')).toBe('[[Long#Results final]]')

  // [[#  lists the headings of the note itself; A has none, so the popup explains instead of vanishing
  await win.keyboard.type(' [[#')
  await expect(list.locator('li').first()).toContainText('No headings in A')
  await win.keyboard.press('Escape')

  // follow it from the reading view: Long opens scrolled to the heading
  await palette(win, 'toggle reading view')
  await win.getByTestId('reading').getByText('Long > Results final').click()
  const heading = win.getByTestId('reading').getByRole('heading', { name: 'Results | final' })
  await expect(heading).toBeInViewport()
  await expect(win.getByTestId('reading').getByRole('heading', { name: 'Intro' })).not.toBeInViewport()
  await app.close()
})
