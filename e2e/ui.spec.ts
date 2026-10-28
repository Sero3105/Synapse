// Interface details of the Future Minimal pass: palette recents, search syntax guide, settings focus.
import { test, expect } from '@playwright/test'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.beforeEach(() => {
  env = makeEnv({ 'Note.md': '# Note\n\nmemory\n' })
})
test.afterEach(() => cleanup(env))

test('palette lists recently used commands first, once, and only with an empty query', async () => {
  const { app, win } = await launch(env)
  await win.keyboard.press('Meta+P')
  await expect(win.locator('.suggestion-section')).toHaveCount(0) // nothing used yet
  await win.keyboard.press('Escape')

  await palette(win, 'toggle line numbers')
  await palette(win, 'toggle readable line length')
  await palette(win, 'toggle line numbers') // run again: moves back to the top, no duplicate
  await win.keyboard.press('Meta+P')
  const list = win.locator('.prompt-results')
  await expect(list.locator('.suggestion-section')).toHaveText(['Recent', 'All commands'])
  const titles = await list.locator('.suggestion-title').allTextContents()
  expect(titles.slice(0, 2)).toEqual(['Toggle line numbers', 'Toggle readable line length'])
  expect(titles.filter((x) => x === 'Toggle line numbers')).toHaveLength(1)
  // Enter on the first item runs the most recent command
  await expect(list.locator('.suggestion-item').first()).toHaveClass(/is-selected/)
  // typing shows plain ranked results, without sections
  await win.keyboard.type('readable')
  await expect(list.locator('.suggestion-section')).toHaveCount(0)
  await expect(list.locator('.suggestion-title').first()).toHaveText('Toggle readable line length')
  await win.keyboard.press('Escape')
  await app.close()
})

test('the search syntax guide shows only while the field is empty', async () => {
  const { app, win } = await launch(env)
  await win.keyboard.press('Meta+Shift+F')
  const guide = win.locator('.search-hint')
  await expect(guide).toBeVisible()
  await expect(guide.locator('code')).toHaveText(['memory recall', '"spaced repetition"', '-draft', 'tag:#project', 'path:Research', 'file:roadmap'])
  await win.keyboard.type('memory')
  await expect(guide).toHaveCount(0)
  await expect(win.getByTestId('search-results')).toContainText('Note')
  await win.keyboard.press('Meta+A')
  await win.keyboard.press('Backspace')
  await expect(guide).toBeVisible()
  await app.close()
})

test('settings opened from the keyboard draw no focus ring around the dialog, controls keep theirs', async () => {
  const { app, win } = await launch(env)
  for (const theme of ['light', 'dark']) {
    await win.evaluate((t) => (window as any).__synapse.setGlobal({ prefs: { theme: t } }), theme)
    await win.keyboard.press('Meta+Comma')
    const dialog = win.locator('.settings-modal')
    await expect(dialog).toBeVisible()
    expect(await dialog.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none')
    await win.keyboard.press('Tab')
    const ring = await win.evaluate(() => getComputedStyle(document.activeElement!).outlineStyle)
    expect(ring).not.toBe('none')
    await win.keyboard.press('Escape')
  }
  await app.close()
})

test('in a narrow window only one side dock is open at a time', async () => {
  const { app, win } = await launch(env)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 700))
  const layout = () => win.evaluate(() => { const l = (window as any).__synapse.state.snap.global.layout; return [l.leftOpen, l.rightOpen] })
  await expect.poll(layout).toEqual([true, false]) // shrinking closed the right one
  await win.evaluate(() => (window as any).__synapse.setLayout({ rightOpen: true }))
  expect(await layout()).toEqual([false, true])
  await win.evaluate(() => (window as any).__synapse.setLayout({ leftOpen: true }))
  expect(await layout()).toEqual([true, false])
  await app.close()
})
