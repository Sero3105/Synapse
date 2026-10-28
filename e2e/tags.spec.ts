import { test, expect } from '@playwright/test'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

test('nested tags show as a tree; a parent opens a search that includes its children', async () => {
  env = makeEnv({ 'Web.md': '#progetto/web\n', 'App.md': '#progetto/app\n', 'Other.md': '#altro\n' })
  const { app, win } = await launch(env)
  await palette(win, 'tags: show tags')
  const panel = win.locator('.tags-panel')
  await expect(panel.locator('.tag-row')).toHaveText(['#progetto2', '#altro1'])
  await panel.getByRole('button', { name: '#progetto' }).click()
  await expect(panel.locator('.tag-row')).toHaveText(['#progetto2', 'app1', 'web1', '#altro1'])
  await panel.getByRole('button', { name: '#progetto' }).click()
  await expect(panel.locator('.tag-row')).toHaveCount(2)
  await panel.locator('.tag-row', { hasText: '#progetto' }).click()
  await expect(win.locator('#search-input')).toHaveValue('tag:#progetto')
  await expect(win.getByTestId('search-results')).toContainText('Web')
  await expect(win.getByTestId('search-results')).toContainText('App')
  await expect(win.getByTestId('search-results')).not.toContainText('Other')
  await app.close()
})
