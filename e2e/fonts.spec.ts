// Font picker: a real system font pre-seeded into the app-data fonts folder stands in for the
// native file dialog, which Playwright cannot drive. Store-level import is covered by unit tests.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, choose, type Env } from './helpers'

const REAL_FONT = ['/System/Library/Fonts/Supplemental/Georgia.ttf', '/System/Library/Fonts/Supplemental/Verdana.ttf'].find((p) => fs.existsSync(p))

let env: Env
test.afterEach(async () => cleanup(env))

test('font picker: search, select, persistence across restart, removal', async () => {
  test.skip(!REAL_FONT, 'no real system font available to seed')
  env = makeEnv({ 'Note.md': '# Note\n\nSome text.\n' })
  const family = path.basename(REAL_FONT!) === 'Georgia.ttf' ? 'Georgia' : 'Verdana'
  fs.mkdirSync(path.join(env.userData, 'fonts'), { recursive: true })
  fs.copyFileSync(REAL_FONT!, path.join(env.userData, 'fonts', path.basename(REAL_FONT!)))

  let { app, win } = await launch(env)
  const openPicker = async () => {
    await win.keyboard.press('Meta+Comma')
    await win.getByRole('button', { name: 'Appearance', exact: true }).click()
    const setting = win.locator('[data-setting="textFont"]')
    await setting.getByRole('button', { name: 'Choose font' }).click()
    return setting
  }

  // light theme: picker renders and previews load
  let setting = await openPicker()
  await choose(win, 'Base color scheme', 'Light')
  await expect(win.locator('body')).toHaveClass(/theme-light/)
  await expect(setting.locator('.font-picker')).toBeVisible()
  await expect(setting.getByText('Your fonts')).toBeVisible()
  await expect(setting.locator('.font-row-sample').first()).toBeVisible()

  // search filters, empty state shows
  await setting.getByLabel('Search fonts…').fill('zzzz-no-match')
  await expect(setting.getByText('No fonts match')).toBeVisible()
  await setting.getByLabel('Search fonts…').fill(family)
  await expect(setting.locator('.font-row', { hasText: family }).first()).toBeVisible()

  // select the seeded font: preference persists with a plain family name
  await setting.locator('.font-row-main', { hasText: family }).click()
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(env.userData, 'settings.json'), 'utf8')).prefs?.textFont).toBe(family)
  await win.keyboard.press('Escape')
  await app.close()

  // restart: the stored font is still offered without any vault involvement
  ;({ app, win } = await launch(env))
  setting = await openPicker()
  await expect(setting.getByText('Your fonts')).toBeVisible()
  await expect(setting.locator('.font-row', { hasText: family }).first()).toBeVisible()

  // removal asks first, then the row is gone; the original system font file is untouched
  await setting.getByRole('button', { name: `Remove ${family}` }).click()
  await win.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(setting.locator('.font-row', { hasText: family })).toHaveCount(0)
  expect(fs.existsSync(REAL_FONT!)).toBe(true)
  expect(fs.readdirSync(path.join(env.userData, 'fonts'))).toEqual([])
  await app.close()
})
