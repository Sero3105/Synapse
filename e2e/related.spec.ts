import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

test('related notes explain themselves, can be linked on request and dismissed', async () => {
  env = makeEnv({
    'Cells.md': '# Cells\n#biology\nPhotosynthesis chlorophyll mitochondria.\n',
    'Plants.md': '#biology\nChlorophyll and photosynthesis.\n',
    'Cooking.md': 'Tomatoes and basil.\n',
  })
  const { app, win } = await launch(env)
  await win.locator('.tree-item-self', { hasText: 'Cells' }).click()
  const related = win.getByTestId('related')
  await related.getByRole('button', { name: /Related notes/ }).click()
  const item = related.locator('.search-result', { hasText: 'Plants' })
  await expect(item).toContainText('Shared tags: #biology')
  await expect(related.locator('.search-result', { hasText: 'Cooking' })).toHaveCount(0)
  // nothing is written until the user asks for a link
  expect(fs.readFileSync(path.join(env.vault, 'Cells.md'), 'utf8')).toBe('# Cells\n#biology\nPhotosynthesis chlorophyll mitochondria.\n')
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await item.click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Insert link at cursor' }).click()
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'Cells.md'), 'utf8')).toContain('[[Plants]]')
  // now linked: no longer suggested
  await expect(related.locator('.search-result', { hasText: 'Plants' })).toHaveCount(0)
  await app.close()
})

test('dismissed suggestions stay dismissed after a restart', async () => {
  env = makeEnv({ 'A.md': '#x #y\n', 'B.md': '#x #y\n' })
  let { app, win } = await launch(env)
  await win.locator('.tree-item-self', { hasText: 'A' }).click()
  const related = win.getByTestId('related')
  await related.getByRole('button', { name: /Related notes/ }).click()
  await related.locator('.search-result', { hasText: 'B' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Dismiss suggestion' }).click()
  await expect(related.locator('.search-result')).toHaveCount(0)
  await win.waitForTimeout(800) // workspace save is debounced
  await app.close()
  ;({ app, win } = await launch(env))
  await win.locator('.tree-item-self', { hasText: 'A' }).click()
  await win.getByTestId('related').getByRole('button', { name: /Related notes/ }).click()
  await expect(win.getByTestId('related')).toContainText('No related notes found.')
  await app.close()
})

test('graph: filter, unlinked-only, empty state and reset', async () => {
  env = makeEnv({ 'proj/A.md': '[[B]]', 'B.md': 'b', 'Lonely.md': 'alone' })
  const { app, win } = await launch(env)
  await palette(win, 'open graph view')
  await expect(win.getByTestId('graph')).toBeVisible()
  await win.getByRole('button', { name: 'Graph settings' }).click()
  const filter = win.getByRole('textbox', { name: 'Filter graph' })
  await filter.fill('nothing-matches-this')
  await expect(win.getByText('No notes match these filters.')).toBeVisible()
  await filter.fill('path:proj')
  await expect(win.getByText('No notes match these filters.')).toHaveCount(0)
  await filter.fill('')
  await win.getByLabel('Only unlinked notes').check()
  await expect(win.getByText('No notes match these filters.')).toHaveCount(0)
  await win.locator('.graph-settings').getByRole('button', { name: 'Reset view' }).click()
  await expect(filter).toHaveValue('')
  await expect(win.getByLabel('Only unlinked notes')).not.toBeChecked()
  await app.close()
})
