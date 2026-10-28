import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

test('a pinned tab moves left, shrinks, survives "close others" and a restart', async () => {
  env = makeEnv({ 'A.md': 'a', 'B.md': 'b', 'C.md': 'c' })
  let { app, win } = await launch(env)
  for (const p of ['A.md', 'B.md', 'C.md']) await win.evaluate((p) => (window as any).__synapse.open(p, 'new'), p)
  const tabs = win.locator('.tab')
  await win.locator('.tab[title="C.md"]').click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Pin' }).click()
  // pinned C is first, shown as an icon with its name for screen readers
  await expect(tabs.first()).toHaveClass(/is-pinned/)
  await expect(tabs.first()).toHaveAttribute('aria-label', 'C')
  await expect(tabs.first().locator('.tab-title')).toHaveCount(0)

  await win.locator('.tab[title="B.md"]').click()
  await palette(win, 'close all other tabs')
  await expect(tabs).toHaveCount(2) // pinned C and B; the empty start tab closed too
  await expect(tabs.nth(1)).toContainText('B')

  // the pin is part of the saved workspace
  const saved = () => {
    try {
      return fs.readFileSync(path.join(env.vault, '.synapse', 'workspace.json'), 'utf8')
    } catch {
      return '' // written 500 ms after the last change
    }
  }
  await expect.poll(saved).toContain('"pinned":true')
  await app.close()
  ;({ app, win } = await launch(env))
  await expect(win.locator('.tab').first()).toHaveClass(/is-pinned/)

  // unpin from the menu
  await win.locator('.tab').first().click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Unpin' }).click()
  await expect(win.locator('.tab.is-pinned')).toHaveCount(0)
  await app.close()
})
