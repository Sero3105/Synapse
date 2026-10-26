import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

test('tasks: list across notes, toggle the right line, open the source', async () => {
  env = makeEnv({
    'Plan.md': '# Plan\n- [ ] write\n  - [ ] nested\n- [x] shipped\n',
    'sub/Other.md': '## Section\n- [ ] write\n```\n- [ ] in code\n```\n',
  })
  const { app, win } = await launch(env)
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  await palette(win, 'tasks: show tasks')
  const panel = win.getByTestId('tasks')
  await expect(panel.locator('.task-row')).toHaveCount(3) // open tasks only, code ignored
  await expect(panel).toContainText('3 tasks')
  // the second "write" (in Other) is toggled, not the one in Plan
  await panel.locator('.search-result', { hasText: 'Other' }).getByRole('checkbox', { name: 'write' }).click()
  const other = path.join(env.vault, 'sub', 'Other.md')
  await expect.poll(() => fs.readFileSync(other, 'utf8')).toBe('## Section\n- [x] write\n```\n- [ ] in code\n```\n')
  expect(fs.readFileSync(path.join(env.vault, 'Plan.md'), 'utf8')).toBe('# Plan\n- [ ] write\n  - [ ] nested\n- [x] shipped\n')
  await expect(panel.locator('.task-row')).toHaveCount(2)
  await panel.getByRole('radio', { name: 'Done' }).click()
  await expect(panel.locator('.task-row')).toHaveCount(2)
  // clicking a task opens its note in the editor at that line
  await panel.locator('.task-row', { hasText: 'shipped' }).click()
  await expect(win.locator('.cm-content')).toContainText('shipped')
  await expect(win.locator('.cm-activeLine')).toContainText('shipped')
  await app.close()
})

test('tasks: a stale list never overwrites a note changed on disk', async () => {
  env = makeEnv({ 'Plan.md': '- [ ] a\n- [ ] b\n' })
  const { app, win } = await launch(env)
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  await palette(win, 'tasks: show tasks')
  const panel = win.getByTestId('tasks')
  await expect(panel.locator('.task-row')).toHaveCount(2)
  // simulate a list built before an external edit: hold the old row, change the file under it
  await win.evaluate(() => {
    const m = (window as any).__synapse
    m.index.upsert('Plan.md', '- [ ] a\n- [ ] b\n') // keep the index stale
    m.onFsChanged = () => {}
  })
  fs.writeFileSync(path.join(env.vault, 'Plan.md'), 'inserted\n- [ ] a\n- [ ] b\n')
  await panel.getByRole('checkbox', { name: 'b' }).click()
  await expect(win.locator('.notice.is-error')).toContainText('changed')
  expect(fs.readFileSync(path.join(env.vault, 'Plan.md'), 'utf8')).toBe('inserted\n- [ ] a\n- [ ] b\n')
  await app.close()
})
