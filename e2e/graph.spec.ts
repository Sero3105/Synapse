import { test, expect, Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

// A → B → C → D, E alone
const chain = { 'A.md': '[[B]]', 'B.md': '[[C]]', 'C.md': '[[D]]', 'D.md': 'd', 'E.md': 'e' }
const open = (win: Page, p: string, where = 'tab') => win.evaluate(([p, w]) => (window as any).__synapse.open(p, w), [p, where])

async function prompt(win: Page, title: string, value: string) {
  const dialog = win.getByRole('dialog', { name: title })
  await dialog.getByRole('textbox').fill(value)
  await dialog.getByRole('textbox').press('Enter')
}

test('global graph, local graph around the open note, depth 1 and 2', async () => {
  env = makeEnv(chain)
  const { app, win } = await launch(env)
  await open(win, 'B.md')
  await palette(win, 'open graph view')
  const count = win.getByTestId('graph-count')
  await expect(count).toHaveText('5 notes') // global: the whole vault, as before

  const localBtn = win.locator('.graph-controls').getByRole('button', { name: 'Local graph' })
  await localBtn.click()
  await expect(localBtn).toHaveAttribute('aria-pressed', 'true')
  await expect(count).toHaveText('3 notes') // B with A (links to it) and C (linked from it)

  await win.getByRole('button', { name: 'Graph settings' }).click()
  await expect(win.getByTestId('graph-center')).toContainText('B')
  await win.getByRole('radiogroup', { name: 'Depth' }).getByRole('radio', { name: '2' }).click()
  await expect(count).toHaveText('4 notes') // + D, two links away; E is never reached

  // filters still apply, and the walk does not cross hidden notes
  await win.getByRole('textbox', { name: 'Filter graph' }).fill('-file:C')
  await expect(count).toHaveText('2 notes') // B and A; D is only reachable through C

  await win.getByRole('textbox', { name: 'Filter graph' }).fill('')
  await win.getByRole('radiogroup', { name: 'Depth' }).getByRole('radio', { name: '1' }).click()
  // the local graph follows the note you open
  await open(win, 'D.md', 'new')
  await win.locator('.tab', { hasText: 'Graph' }).click()
  await expect(count).toHaveText('2 notes') // D and C
  await win.getByRole('button', { name: 'Graph settings' }).click() // the panel closes with the tab switch
  await expect(win.getByTestId('graph-center')).toContainText('D')

  // back to global: everything again
  await win.getByRole('radiogroup', { name: 'Graph mode' }).getByRole('radio', { name: 'Global' }).click()
  await expect(count).toHaveText('5 notes')
  // the palette command switches too
  await palette(win, 'toggle local graph')
  await expect(count).toHaveText('2 notes')
  await app.close()
})

test('saved views: save, apply, rename, delete; kept per vault across restarts', async () => {
  env = makeEnv(chain)
  let { app, win } = await launch(env)
  await open(win, 'B.md')
  await palette(win, 'open graph view')
  const count = win.getByTestId('graph-count')
  await win.getByRole('button', { name: 'Graph settings' }).click()
  const views = win.getByRole('group', { name: 'Saved views' })

  // "Progetto": local around B, depth 2
  await win.getByRole('radiogroup', { name: 'Graph mode' }).getByRole('radio', { name: 'Local graph' }).click()
  await win.getByRole('radiogroup', { name: 'Depth' }).getByRole('radio', { name: '2' }).click()
  await views.getByRole('button', { name: 'Save view…' }).click()
  await prompt(win, 'Name of the view', 'Progetto')
  // "Isolate": global, only unlinked notes
  await win.getByRole('radiogroup', { name: 'Graph mode' }).getByRole('radio', { name: 'Global' }).click()
  await win.getByLabel('Only unlinked notes').check()
  await expect(count).toHaveText('1 note')
  await views.getByRole('button', { name: 'Save view…' }).click()
  await prompt(win, 'Name of the view', 'Isolate')
  await expect(views.locator('.graph-view-name')).toHaveText(['Progetto', 'Isolate'])

  // applying "Progetto" restores mode, depth and its own centre, even with another note open
  await open(win, 'E.md', 'new')
  await win.locator('.tab', { hasText: 'Graph' }).click()
  await win.getByRole('button', { name: 'Graph settings' }).click()
  await views.getByRole('button', { name: 'Progetto', exact: true }).click()
  await expect(count).toHaveText('4 notes')
  await expect(win.getByLabel('Only unlinked notes')).not.toBeChecked()
  await expect(win.getByTestId('graph-center')).toContainText('B')
  // letting it follow the open note again: E has no links
  await win.getByTestId('graph-center').click()
  await win.getByRole('option', { name: 'Follow the open note' }).click()
  await expect(count).toHaveText('1 note')
  await views.getByRole('button', { name: 'Isolate', exact: true }).click()
  await expect(win.getByLabel('Only unlinked notes')).toBeChecked()
  await expect(count).toHaveText('1 note')

  await views.getByRole('button', { name: 'Rename view Isolate' }).click()
  await prompt(win, 'Rename view Isolate', 'Orphans')
  await expect(views.locator('.graph-view-name')).toHaveText(['Progetto', 'Orphans'])
  await views.getByRole('button', { name: 'Delete view Orphans' }).click()
  await win.getByRole('alertdialog').getByRole('button', { name: 'Delete' }).click()
  await expect(views.locator('.graph-view-name')).toHaveText(['Progetto'])
  const file = path.join(env.vault, '.synapse', 'settings.json')
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).graphViews.map((v: { name: string }) => v.name)).toEqual(['Progetto'])
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).graphViews[0]).toMatchObject({ center: 'B.md', graph: { local: true, depth: 2 } })
  // renaming the centre note keeps the view pointing at it
  await win.evaluate(() => (window as any).__synapse.rename('B.md', 'Hub.md'))
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).graphViews[0].center).toBe('Hub.md')
  await app.close()

  // after a restart the view is still there and works
  ;({ app, win } = await launch(env))
  await palette(win, 'open graph view')
  await win.getByRole('button', { name: 'Graph settings' }).click()
  await win.getByRole('group', { name: 'Saved views' }).getByRole('button', { name: 'Progetto', exact: true }).click()
  await expect(win.getByTestId('graph-count')).toHaveText('4 notes')
  await app.close()

  // another vault has none
  const other = makeEnv({ 'X.md': 'x' })
  try {
    ;({ app, win } = await launch(other))
    await palette(win, 'open graph view')
    await win.getByRole('button', { name: 'Graph settings' }).click()
    await expect(win.locator('.graph-view-name')).toHaveCount(0)
    await app.close()
  } finally {
    cleanup(other)
  }
})

test('colour by folder or by first tag, with a legend; off by default and kept per vault', async () => {
  env = makeEnv({
    'work/A.md': '#lavoro [[B]]', 'work/B.md': '#lavoro/clienti', 'work/C.md': 'c',
    'home/D.md': '#casa [[A]]', 'Root.md': 'r',
  })
  const { app, win } = await launch(env)
  await palette(win, 'open graph view')
  const legend = win.getByTestId('graph-legend')
  await expect(legend).toHaveCount(0)
  await win.getByRole('button', { name: 'Graph settings' }).click()
  const colorBy = win.getByRole('radiogroup', { name: 'Colour by' })
  await expect(colorBy.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true')

  await colorBy.getByRole('radio', { name: 'Folder' }).click()
  await expect(legend.locator('li')).toHaveText(['work', 'home']) // biggest first; root notes stay uncoloured
  await colorBy.getByRole('radio', { name: 'Tag' }).click()
  await expect(legend.locator('li')).toHaveText(['#lavoro', '#casa']) // nested tags join their parent
  const file = path.join(env.vault, '.synapse', 'settings.json')
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).graph.colorBy).toBe('tag')
  await colorBy.getByRole('radio', { name: 'None' }).click()
  await expect(legend).toHaveCount(0)
  await app.close()
})

test('every folder gets a colour, each can be changed and reset; the local graph bar picks its note', async () => {
  const files: Record<string, string> = { 'Hub.md': '[[a0]]' }
  for (let i = 0; i < 11; i++) files[`f${String(i).padStart(2, '0')}/a${i}.md`] = i ? `[[a${i - 1}]]` : 'start'
  env = makeEnv(files)
  const { app, win } = await launch(env)
  await palette(win, 'open graph view')
  await win.getByRole('button', { name: 'Graph settings' }).click()
  await win.getByRole('radiogroup', { name: 'Colour by' }).getByRole('radio', { name: 'Folder' }).click()
  const legend = win.getByTestId('graph-legend')
  await expect(legend.locator('li')).toHaveCount(11) // more folders than the palette: all of them listed and coloured

  // pick a colour for one folder: saved in the vault, marked as custom, resettable
  await legend.getByLabel('Colour of f03').evaluate((el: HTMLInputElement) => {
    // as the system colour panel does: React only sees a value set through the native setter
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, '#123456')
    el.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const file = path.join(env.vault, '.synapse', 'settings.json')
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).graphColors).toEqual({ f03: '#123456' })
  await legend.getByRole('button', { name: 'Automatic colour for f03' }).click()
  await expect.poll(() => JSON.parse(fs.readFileSync(file, 'utf8')).graphColors).toEqual({})

  // local graph: the bar says which note it is about, and another can be picked by name
  await win.getByRole('radiogroup', { name: 'Graph mode' }).getByRole('radio', { name: 'Local graph' }).click()
  await win.getByRole('button', { name: 'Graph settings' }).click() // close the panel
  const bar = win.getByRole('group', { name: 'Local graph' })
  await expect(bar).toBeVisible()
  await bar.getByRole('button', { name: /^Choose a note/ }).click()
  await win.getByRole('textbox', { name: 'Find a note…' }).fill('a5')
  await win.keyboard.press('Enter')
  await expect(bar.getByRole('button', { name: /^Choose a note/ })).toContainText('a5')
  await expect(win.getByTestId('graph-count')).toHaveText('3 notes') // a5 with a4 and a6
  await bar.getByRole('button', { name: 'Back to the whole vault' }).click()
  await expect(bar).toHaveCount(0)
  await expect(win.getByTestId('graph-count')).toHaveText('12 notes')
  await app.close()
})
