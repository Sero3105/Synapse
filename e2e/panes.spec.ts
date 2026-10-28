// Nested split panes: layout, editing across splits, borders, restore.
import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const box = async (win: Page, title: string) => (await win.locator('.pane-slot', { has: win.locator('.tab.is-active', { hasText: title }) }).boundingBox())!
const savedLayout = (env: Env) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(env.vault, '.synapse', 'workspace.json'), 'utf8')).layout
  } catch {
    return undefined // written 500 ms after the last change
  }
}

test('two notes stacked on the left and one on the right; editing survives the splits; it all comes back after a restart', async () => {
  env = makeEnv({ 'A.md': 'aaa\n', 'B.md': 'bbb\n', 'C.md': 'ccc\n' })
  let { app, win } = await launch(env)
  await win.evaluate(() => (window as any).__synapse.open('A.md'))
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type('typed')

  // right: B; then split A downwards: C
  await palette(win, 'split right')
  await win.evaluate(() => (window as any).__synapse.open('B.md'))
  await win.locator('.pane-slot', { has: win.locator('.tab.is-active', { hasText: 'A' }) }).locator('.tab.is-active').click()
  await palette(win, 'split down')
  await win.evaluate(() => (window as any).__synapse.open('C.md'))
  await expect(win.locator('.pane-slot')).toHaveCount(3)

  const a = await box(win, 'A')
  const b = await box(win, 'B')
  const c = await box(win, 'C')
  expect(Math.abs(a.x - c.x)).toBeLessThan(2) // A above C, same column
  expect(c.y).toBeGreaterThan(a.y + a.height - 2)
  expect(b.x).toBeGreaterThan(a.x + a.width - 2) // B on the right, full height
  expect(Math.abs(b.height - (c.y + c.height - a.y))).toBeLessThan(2)

  // A's editor was never rebuilt: undo still removes what was typed before the splits
  const paneA = win.locator('.pane-slot', { has: win.locator('.tab.is-active', { hasText: 'A' }) })
  await expect(paneA.locator('.cm-content')).toContainText('typed')
  await paneA.locator('.cm-content').click()
  await win.keyboard.press('Meta+Z')
  await expect(paneA.locator('.cm-content')).not.toContainText('typed')

  // the border between A and C moves only those two
  const bar = win.locator('.pane-resizer.dir-column')
  const bb = (await bar.boundingBox())!
  await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2)
  await win.mouse.down()
  await win.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2 - 80, { steps: 5 })
  await win.mouse.up()
  const a2 = await box(win, 'A')
  expect(a2.height).toBeLessThan(a.height - 40)
  expect((await box(win, 'B')).height).toBeCloseTo(b.height, 0)

  await expect.poll(() => savedLayout(env)).toMatchObject({ dir: 'row', children: [{ dir: 'column' }, expect.any(Number)] })
  await app.close()
  ;({ app, win } = await launch(env))
  await expect(win.locator('.pane-slot')).toHaveCount(3)
  const a3 = await box(win, 'A')
  expect(a3.height).toBeCloseTo(a2.height, 0)
  expect((await box(win, 'C')).x).toBeCloseTo(a3.x, 0)
  expect((await box(win, 'B')).x).toBeGreaterThan(a3.x + a3.width - 2)

  // closing C gives its space back to A; closing B leaves A alone
  await win.locator('.pane-slot', { has: win.locator('.tab.is-active', { hasText: 'C' }) }).getByRole('button', { name: 'Close C' }).click()
  await expect(win.locator('.pane-slot')).toHaveCount(2)
  expect((await box(win, 'A')).height).toBeCloseTo(b.height, 0)
  await win.locator('.pane-slot', { has: win.locator('.tab.is-active', { hasText: 'B' }) }).getByRole('button', { name: 'Close B' }).click()
  await expect(win.locator('.pane-slot')).toHaveCount(1)
  await expect.poll(() => savedLayout(env)).toBe(0)
  await app.close()
})

test('a workspace saved by an earlier version (flat panes) still opens as it was', async () => {
  env = makeEnv({ 'A.md': 'a', 'B.md': 'b' })
  fs.mkdirSync(path.join(env.vault, '.synapse'), { recursive: true })
  const tab = (p: string) => ({ kind: 'note', path: p, mode: 'source', back: [], fwd: [] })
  fs.writeFileSync(path.join(env.vault, '.synapse', 'workspace.json'), JSON.stringify({
    direction: 'column', paneSizes: [3, 1], activePaneIndex: 1,
    panes: [{ activeIndex: 0, tabs: [tab('A.md')] }, { activeIndex: 0, tabs: [tab('B.md')] }],
  }))
  const { app, win } = await launch(env)
  await expect(win.locator('.pane-slot')).toHaveCount(2)
  const a = await box(win, 'A')
  const b = await box(win, 'B')
  expect(b.y).toBeGreaterThan(a.y) // column: B below A
  expect(a.height / b.height).toBeGreaterThan(2.5) // sizes 3 : 1 kept
  await app.close()
})

test('a damaged layout never loses the tabs: panes fall back to a row', async () => {
  env = makeEnv({ 'A.md': 'a', 'B.md': 'b' })
  fs.mkdirSync(path.join(env.vault, '.synapse'), { recursive: true })
  const tab = (p: string) => ({ kind: 'note', path: p, mode: 'source', back: [], fwd: [] })
  fs.writeFileSync(path.join(env.vault, '.synapse', 'workspace.json'), JSON.stringify({
    layout: { dir: 'row', children: [0, 0], sizes: [1, 1] }, // pane 0 twice, pane 1 missing
    panes: [{ activeIndex: 0, tabs: [tab('A.md')] }, { activeIndex: 0, tabs: [tab('B.md')] }],
  }))
  const { app, win } = await launch(env)
  await expect(win.locator('.pane-slot')).toHaveCount(2)
  const a = await box(win, 'A')
  expect((await box(win, 'B')).x).toBeGreaterThan(a.x + a.width - 2)
  await app.close()
})
