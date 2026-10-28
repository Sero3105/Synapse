import { test, expect } from '@playwright/test'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

test('preview tabs: single click reuses, double click keeps, typing keeps', async () => {
  env = makeEnv({ 'A.md': '# A\n', 'B.md': '# B\n', 'C.md': '# C\n' })
  const { app, win } = await launch(env)
  const tree = (name: string) => win.locator('.tree-item-self', { hasText: name })
  const tabs = win.locator('.tab')
  const active = win.locator('.tab.is-active')

  // single click: one preview tab, reused by the next single click
  await tree('A').click()
  await expect(active).toContainText('A')
  await expect(active).toHaveClass(/is-preview/)
  await tree('B').click()
  await expect(tabs).toHaveCount(1)
  await expect(active).toContainText('B')
  await expect(active).toHaveClass(/is-preview/)

  // double click on the file keeps its tab; the next single click opens a new preview beside it
  await tree('C').click()
  await tree('C').dblclick()
  await expect(active).toContainText('C')
  await expect(active).not.toHaveClass(/is-preview/)
  await tree('A').click()
  await expect(tabs).toHaveCount(2)
  await expect(active).toContainText('A')
  await expect(active).toHaveClass(/is-preview/)

  // typing in a preview tab keeps it
  await win.locator('.cm-content').click()
  await win.keyboard.type('typed')
  await expect(active).not.toHaveClass(/is-preview/)

  // double click on a preview tab itself keeps it too
  await tree('B').click()
  await expect(active).toContainText('B')
  await expect(active).toHaveClass(/is-preview/)
  await active.dblclick()
  await expect(active).not.toHaveClass(/is-preview/)
  await app.close()
})
