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
