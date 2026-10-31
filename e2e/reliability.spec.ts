// Saving when the vault folder is moved, deleted or recreated while Synapse is open (temp vaults only).
import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const typeAtEnd = async (win: Page, text: string) => {
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type(text)
}
const status = (win: Page) => win.evaluate(() => {
  const b = (window as any).__synapse.state.buffers['Note.md']
  return b ? { dirty: b.content !== b.saved, conflict: b.conflict ?? null } : null
})

test('a vault moved while open is never recreated, and saving resumes when it comes back', async () => {
  env = makeEnv({ 'Note.md': 'start\n' })
  const { app, win } = await launch(env)
  const note = path.join(env.vault, 'Note.md')
  await win.locator('.tree-item-self', { hasText: 'Note' }).click()
  await typeAtEnd(win, 'one')
  await expect.poll(() => fs.readFileSync(note, 'utf8')).toBe('start\none')

  const moved = env.vault + ' moved'
  fs.renameSync(env.vault, moved)
  await typeAtEnd(win, ' two')
  await expect(win.locator('.notice.is-error').first()).toContainText('not available')
  await win.waitForTimeout(1500) // several autosave and workspace-save attempts
  expect(fs.existsSync(env.vault)).toBe(false) // not recreated by note, settings or workspace saves
  expect(fs.readFileSync(path.join(moved, 'Note.md'), 'utf8')).toBe('start\none') // untouched
  expect(await status(win)).toEqual({ dirty: true, conflict: null }) // the typed text is kept
  await expect(win.locator('.cm-content')).toContainText('one two')

  fs.renameSync(moved, env.vault)
  await typeAtEnd(win, ' three')
  await expect.poll(() => fs.readFileSync(note, 'utf8')).toBe('start\none two three')
  expect(await status(win)).toEqual({ dirty: false, conflict: null })
  await app.close()
})

test('a vault deleted and recreated empty does not get the old note written back silently', async () => {
  env = makeEnv({ 'Note.md': 'start\n' })
  const { app, win } = await launch(env)
  await win.locator('.tree-item-self', { hasText: 'Note' }).click()
  await typeAtEnd(win, 'one')
  await expect.poll(() => fs.readFileSync(path.join(env.vault, 'Note.md'), 'utf8')).toBe('start\none')

  fs.rmSync(env.vault, { recursive: true })
  fs.mkdirSync(env.vault)
  await typeAtEnd(win, ' two')
  await expect.poll(() => status(win)).toEqual({ dirty: true, conflict: 'deleted' })
  expect(fs.readdirSync(env.vault)).toEqual([]) // nothing written into the new folder
  await expect(win.locator('.cm-content')).toContainText('one two') // the text is still in the editor
  // quitting now asks "quit anyway?" in a native dialog (unsaved text is protected): end the process instead
  const exited = new Promise((r) => app.process().once('exit', r))
  app.process().kill('SIGKILL') // SIGTERM would become a normal quit, waiting on the "quit anyway?" dialog
  await exited
})

test('autosave does not list the whole vault again; external changes still do', async () => {
  env = makeEnv({ 'Note.md': 'start\n', 'Other.md': 'other\n' })
  const { app, win } = await launch(env)
  const note = path.join(env.vault, 'Note.md')
  await win.locator('.tree-item-self', { hasText: 'Note' }).click()
  await win.evaluate(() => {
    const m = (window as any).__synapse
    const list = m.refreshFiles.bind(m)
    m.lists = 0
    m.refreshFiles = () => (m.lists++, list())
  })
  const lists = () => win.evaluate(() => (window as any).__synapse.lists)
  const mtime = (p: string) => win.evaluate((p) => (window as any).__synapse.state.files.find((f: any) => f.path === p)?.mtime, p)

  await typeAtEnd(win, 'one')
  await expect.poll(() => fs.readFileSync(note, 'utf8')).toBe('start\none')
  await expect.poll(() => mtime('Note.md')).toBe(fs.statSync(note).mtimeMs) // the explorer still sorts by the new date
  await win.waitForTimeout(500) // the watcher has reported the save, temp file included
  expect(await lists()).toBe(0)

  fs.writeFileSync(path.join(env.vault, 'New.md'), 'new\n') // a new file changes the tree
  await expect(win.getByTestId('file-explorer')).toContainText('New')
  fs.writeFileSync(path.join(env.vault, 'Other.md'), 'edited outside\n') // an external edit is still picked up
  await expect.poll(() => win.evaluate(() => (window as any).__synapse.index.notes.get('Other.md')?.content)).toBe('edited outside\n')
  fs.rmSync(path.join(env.vault, 'Other.md'))
  await expect(win.getByTestId('file-explorer')).not.toContainText('Other')
  expect(await lists()).toBeGreaterThan(0)
  await app.close()
})
