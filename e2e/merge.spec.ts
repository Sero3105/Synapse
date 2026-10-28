// Merging a note edited in Synapse and outside it at the same time: the real flow in the running app.
import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const BASE = 'title\nalpha\nbeta\ngamma\ndelta\nend\n'
const buffer = (win: Page) => win.evaluate(() => {
  const b = (window as any).__synapse.state.buffers['Note.md']
  return { content: b.content as string, dirty: b.content !== b.saved, conflict: (b.conflict ?? null) as string | null }
})

/** Type at the end of the line containing `text`, then change the file on disk before autosave (800 ms) runs. */
async function conflict(win: Page, file: string, line: string, typed: string, disk: string) {
  await win.locator('.cm-line', { hasText: line }).first().click()
  await win.keyboard.press('End')
  await win.keyboard.type(typed)
  fs.writeFileSync(file, disk)
  await expect(win.getByRole('button', { name: 'Merge changes' })).toBeVisible({ timeout: 5000 })
  expect(fs.readFileSync(file, 'utf8')).toBe(disk) // nothing overwritten while in conflict
}

async function open(win: Page) {
  await win.locator('.tree-item-self', { hasText: 'Note' }).click()
  await expect(win.locator('.cm-content')).toContainText('gamma')
}

test('changes in different places merge by themselves and are saved', async () => {
  env = makeEnv({ 'Note.md': BASE })
  const { app, win } = await launch(env)
  const file = path.join(env.vault, 'Note.md')
  await open(win)
  await conflict(win, file, 'alpha', ' MINE', BASE.replace('delta', 'delta DISK'))
  await win.getByRole('button', { name: 'Merge changes' }).click()
  const merged = 'title\nalpha MINE\nbeta\ngamma\ndelta DISK\nend\n'
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(merged)
  await expect(win.getByRole('dialog')).toHaveCount(0) // nothing to choose
  await expect(win.getByText('Changes merged and saved.')).toBeVisible()
  expect(await buffer(win)).toEqual({ content: merged, dirty: false, conflict: null })
  await expect(win.locator('.cm-content')).toContainText('delta DISK')
  // editing goes on normally afterwards
  await win.locator('.cm-line', { hasText: 'end' }).click()
  await win.keyboard.press('End')
  await win.keyboard.type('!')
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(merged.replace('end\n', 'end!\n'))
  await app.close()
})

test('a line changed on both sides asks which version to keep; the rest merges', async () => {
  env = makeEnv({ 'Note.md': BASE })
  const { app, win } = await launch(env)
  const file = path.join(env.vault, 'Note.md')
  await open(win)
  // both sides change "beta"; disk also changes "end", which only disk touched
  await conflict(win, file, 'beta', ' MINE', BASE.replace('beta', 'beta DISK').replace('end', 'end DISK'))
  await win.getByRole('button', { name: 'Merge changes' }).click()
  const dialog = win.getByRole('dialog', { name: 'Merge conflicts in Note' })
  const options = dialog.locator('.merge-option')
  await expect(options).toHaveCount(2) // one conflict, two sides
  await expect(options.nth(0)).toContainText('beta MINE')
  await expect(options.nth(1)).toContainText('beta DISK')
  await expect(options.nth(0)).toHaveAttribute('aria-pressed', 'true') // mine is the default
  await options.nth(1).click()
  await expect(options.nth(1)).toHaveAttribute('aria-pressed', 'true')
  await dialog.getByRole('button', { name: 'Apply merge' }).click()
  const merged = 'title\nalpha\nbeta DISK\ngamma\ndelta\nend DISK\n'
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(merged)
  await expect(dialog).toHaveCount(0)
  expect(await buffer(win)).toEqual({ content: merged, dirty: false, conflict: null })

  // and keeping mine on a second conflict
  await conflict(win, file, 'gamma', ' MINE', merged.replace('gamma', 'gamma DISK'))
  await win.getByRole('button', { name: 'Merge changes' }).click()
  await dialog.getByRole('button', { name: 'Apply merge' }).click()
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(merged.replace('gamma', 'gamma MINE'))
  await app.close()
})

test('cancelling the merge writes nothing and keeps both versions', async () => {
  env = makeEnv({ 'Note.md': BASE })
  const { app, win } = await launch(env)
  const file = path.join(env.vault, 'Note.md')
  await open(win)
  const disk = BASE.replace('beta', 'beta DISK')
  await conflict(win, file, 'beta', ' MINE', disk)
  await win.getByRole('button', { name: 'Merge changes' }).click()
  const dialog = win.getByRole('dialog', { name: 'Merge conflicts in Note' })
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(dialog).toHaveCount(0)
  await win.waitForTimeout(1200) // past the autosave delay
  expect(fs.readFileSync(file, 'utf8')).toBe(disk)
  expect(await buffer(win)).toMatchObject({ dirty: true, conflict: 'modified' })
  await expect(win.locator('.cm-content')).toContainText('beta MINE')
  await expect(win.getByRole('button', { name: 'Merge changes' })).toBeVisible() // can try again
  // quitting now asks "quit anyway?" in a native dialog (unsaved text is protected): end the process instead.
  // SIGKILL, not SIGTERM: Electron turns SIGTERM into a normal quit, which would wait on that dialog
  const exited = new Promise((r) => app.process().once('exit', r))
  app.process().kill('SIGKILL')
  await exited
})

test('the merge is refused if my note or the file changes while the dialog is open', async () => {
  env = makeEnv({ 'Note.md': BASE })
  const { app, win } = await launch(env)
  const file = path.join(env.vault, 'Note.md')
  await open(win)
  const disk = BASE.replace('beta', 'beta DISK')
  await conflict(win, file, 'beta', ' MINE', disk)
  const dialog = win.getByRole('dialog', { name: 'Merge conflicts in Note' })

  // my text changes under the dialog (e.g. another pane on the same note)
  await win.getByRole('button', { name: 'Merge changes' }).click()
  await expect(dialog).toBeVisible()
  await win.evaluate(() => {
    const m = (window as any).__synapse
    m.edit('Note.md', m.state.buffers['Note.md'].content + 'late\n')
  })
  await dialog.getByRole('button', { name: 'Apply merge' }).click()
  await expect(win.getByText('The note changed while merging. Try again.')).toBeVisible()
  await win.waitForTimeout(1200)
  expect(fs.readFileSync(file, 'utf8')).toBe(disk)

  // the file changes again under the dialog: its new text must not be overwritten by a merge of the old one
  await win.getByRole('button', { name: 'Merge changes' }).click()
  await expect(dialog).toBeVisible()
  const third = disk.replace('end', 'end THIRD')
  fs.writeFileSync(file, third)
  await win.waitForTimeout(500) // let the watcher see it
  await dialog.getByRole('button', { name: 'Apply merge' }).click()
  await expect(win.getByText('The note changed while merging. Try again.').first()).toBeVisible()
  await win.waitForTimeout(1200)
  expect(fs.readFileSync(file, 'utf8')).toBe(third)
  expect(await buffer(win)).toMatchObject({ dirty: true, conflict: 'modified' }) // my text is still there

  // merging again now includes the newest disk version
  await win.getByRole('button', { name: 'Merge changes' }).click()
  const options = dialog.locator('.merge-option')
  await expect(options).toHaveCount(4) // "beta", and the end where I added "late" and disk changed "end"
  await expect(options.nth(3)).toContainText('end THIRD')
  await options.nth(3).click() // mine for "beta", disk for the end
  await dialog.getByRole('button', { name: 'Apply merge' }).click()
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('title\nalpha\nbeta MINE\ngamma\ndelta\nend THIRD\n')
  await app.close()
})
