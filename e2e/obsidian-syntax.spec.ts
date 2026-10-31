// Obsidian syntax in the reading view: callouts, %%comments%%, footnotes.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const NOTE = `# Obsidian syntax

> [!warning] Mind the step
> A callout body with **bold** text.

> [!tip]- Folded tip
> Shown only when opened.

Visible %%hidden comment%% text.[^1]

%%
A block comment
%%

${'Filler paragraph.\n\n'.repeat(30)}
[^1]: The footnote.
`

test('callouts, comments and footnotes render in the reading view', async () => {
  env = makeEnv({ 'Syntax.md': NOTE })
  const { app, win } = await launch(env)
  await win.evaluate(() => (window as any).__synapse.open('Syntax.md', 'tab', { mode: 'preview' }))
  const reading = win.getByTestId('reading')
  await expect(reading.locator('.callout[data-callout="warning"] .callout-title')).toHaveText('Mind the step')
  await expect(reading.locator('.callout[data-callout="warning"]')).toContainText('A callout body with bold text.')
  // folded: body hidden until the title is clicked
  await expect(reading.getByText('Shown only when opened.')).toBeHidden()
  await reading.getByText('Folded tip').click()
  await expect(reading.getByText('Shown only when opened.')).toBeVisible()
  // comments stay in the file only
  await expect(reading).toContainText('Visible  text.')
  await expect(reading).not.toContainText('hidden comment')
  await expect(reading).not.toContainText('A block comment')
  expect(fs.readFileSync(path.join(env.vault, 'Syntax.md'), 'utf8')).toContain('%%hidden comment%%')
  // a footnote reference scrolls to its note
  await expect(reading.locator('.footnotes')).toContainText('The footnote.')
  await reading.locator('.footnote-ref a').click()
  await expect(reading.locator('.footnotes li').first()).toBeInViewport()

  if (process.env.SYNAPSE_SHOT) {
    await win.evaluate(() => document.querySelectorAll('*').forEach((e) => (e.scrollTop = 0)))
    await win.waitForTimeout(200)
    const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'))
    fs.writeFileSync(process.env.SYNAPSE_SHOT, Buffer.from(png, 'base64'))
  }
  await app.close()
})
