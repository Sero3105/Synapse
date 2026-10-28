import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const open = async (win: any, file: string) => {
  await win.evaluate((f: string) => (window as any).__synapse.open(f), file)
  await win.locator('.cm-content').click()
}

test('[[ in a vault with only the open note still suggests that note', async () => {
  env = makeEnv({ 'Solo.md': '# Solo\n\n' })
  const { app, win } = await launch(env)
  await open(win, 'Solo.md')
  await win.keyboard.type('Link [[')
  const list = win.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('li').first()).toContainText('Solo')
  await win.keyboard.press('Enter')
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'Solo.md'), 'utf8')).toContain('[[Solo]]')
  await app.close()
})

test('[[ with no match offers to create the note, without leaving the current one', async () => {
  env = makeEnv({ 'Solo.md': '# Solo\n\n', 'Ideas.md': '# Ideas\n' })
  const { app, win } = await launch(env)
  await open(win, 'Solo.md')
  await win.keyboard.type('Link [[Zzz')
  const list = win.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('li').first()).toContainText('Create note')
  await expect(list.locator('li').first()).toContainText('Zzz')
  await win.keyboard.press('Enter')
  await expect.poll(() => fs.existsSync(path.join(env.vault, 'Zzz.md'))).toBe(true)
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'Solo.md'), 'utf8')).toContain('[[Zzz]]')
  await expect(win.locator('.tab.is-active')).toContainText('Solo')
  await app.close()
})

test('[[ finds accented note names typed without accents', async () => {
  env = makeEnv({ 'Solo.md': '# Solo\n\n', 'Résumé.md': '# Résumé\n' })
  const { app, win } = await launch(env)
  await open(win, 'Solo.md')
  await win.keyboard.type('Link [[resume')
  const list = win.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('li').first()).toContainText('Résumé')
  await win.keyboard.press('Enter')
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'Solo.md'), 'utf8')).toContain('[[Résumé]]')
  await app.close()
})

test('[[ typed as Option+[ (Italian layout) still inserts and suggests', async () => {
  env = makeEnv({ 'Solo.md': '# Solo\n\n', 'Ideas.md': '# Ideas\n' })
  const { app, win } = await launch(env)
  await open(win, 'Solo.md')
  await win.keyboard.press('Alt+[')
  await win.keyboard.press('Alt+[')
  await win.keyboard.type('Ide')
  const list = win.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('li').first()).toContainText('Ideas')
  await win.waitForTimeout(300) // CodeMirror ignores Enter in the first 75ms after the popup opens
  await win.keyboard.press('Enter')
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'Solo.md'), 'utf8')).toContain('[[Ideas]]')
  await app.close()
})

test('[[ inserted without key events (paste, IME, programmatic) still opens suggestions', async () => {
  env = makeEnv({ 'Solo.md': '# Solo\n\n', 'Successioni.md': '# Successioni\n' })
  const { app, win } = await launch(env)
  await open(win, 'Solo.md')
  // dispatch straight into the editor document: no typing, so CodeMirror's typing trigger never fires
  await win.evaluate(() => {
    const m = (window as any).__synapse
    const view = [...m.editors.values()][0] as any
    view.dispatch(view.state.replaceSelection('[[succ'))
  })
  const list = win.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('li').first()).toContainText('Successioni')
  await app.close()
})

test('[[# in a note without headings explains, instead of showing nothing', async () => {
  env = makeEnv({ 'Solo.md': '# Solo\n\nplain text, no section headings below the title\n' , 'Plain.md': 'no headings at all\n' })
  const { app, win } = await launch(env)
  await open(win, 'Plain.md')
  await win.keyboard.type('Link [[#')
  const list = win.locator('.cm-tooltip-autocomplete')
  await expect(list.locator('li').first()).toContainText('No headings in Plain')
  await win.keyboard.press('Escape')
  await app.close()
})
