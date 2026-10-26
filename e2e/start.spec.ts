import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.beforeEach(() => {
  env = makeEnv({ 'Alpha.md': '# Alpha\n', 'Beta.md': '# Beta\n', 'sub/Gamma.md': '# Gamma\n' })
})
test.afterEach(() => cleanup(env))

const start = (win: import('@playwright/test').Page) => win.getByTestId('empty-tab')
const section = (win: import('@playwright/test').Page, name: string) => start(win).getByRole('region', { name, exact: true })

test('start page: recent, pinned and modified notes, persisted per vault', async () => {
  let { app, win } = await launch(env)
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  for (const p of ['Alpha.md', 'sub/Gamma.md', 'Beta.md']) await win.evaluate((x) => (window as any).__synapse.open(x), p)
  // pin Gamma from the file tree
  await win.locator('.tree-item-self', { hasText: 'sub' }).click()
  await win.locator('.tree-item-self', { hasText: 'Gamma' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Pin to start page' }).click()
  await win.keyboard.press('Meta+T')
  await expect(section(win, 'Pinned').locator('.recent-row')).toContainText(['Gamma'])
  // newest first, without the pinned note repeated
  await expect(section(win, 'Recent').locator('.recent-title')).toHaveText(['Beta', 'Alpha'])
  // removing from recent keeps the file
  await section(win, 'Recent').getByText('Alpha').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Remove from recent' }).click()
  await expect(section(win, 'Recent').locator('.recent-title')).toHaveText(['Beta'])
  expect(fs.existsSync(path.join(env.vault, 'Alpha.md'))).toBe(true)
  await expect(section(win, 'Recently modified').locator('.recent-title')).toContainText(['Alpha'])
  await app.close()

  // a pinned note deleted while Synapse is closed simply disappears
  fs.rmSync(path.join(env.vault, 'sub', 'Gamma.md'))
  ;({ app, win } = await launch(env))
  await win.keyboard.press('Meta+T')
  await expect(start(win)).toBeVisible()
  await expect(section(win, 'Pinned')).toHaveCount(0)
  await expect(section(win, 'Recent').locator('.recent-title')).toHaveText(['Beta'])
  await app.close()
})
