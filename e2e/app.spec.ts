// End-to-end tests against the real Electron app with isolated temp data.
// SYNAPSE_APP=/Applications/Synapse.app/Contents/MacOS/Synapse runs them against an installed build.
import { test, expect, _electron, ElectronApplication, Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { choose } from './helpers'

let tmp: string
let userData: string
let vaultA: string
let vaultB: string
let updateFeed = 'http://127.0.0.1:9/none'

function makeVault(dir: string, extra: Record<string, string> = {}) {
  fs.mkdirSync(dir, { recursive: true })
  const files: Record<string, string> = {
    'Welcome.md': '# Welcome\n\nLinks to [[Ideas]].\n',
    'Ideas.md': '# Ideas\n\nBack to [[Welcome]]. Unique word: zebracorn.\n',
    ...extra,
  }
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true })
    fs.writeFileSync(path.join(dir, p), c)
  }
}

function seedRegistry(lastOpen: 'A' | 'B' | null, extra: Record<string, { path: string; ts: number }> = {}) {
  fs.mkdirSync(userData, { recursive: true })
  const vaults = { aaaaaaaaaaaaaaaa: { path: vaultA, ts: 2 }, bbbbbbbbbbbbbbbb: { path: vaultB, ts: 1 }, ...extra }
  const id = lastOpen === 'A' ? 'aaaaaaaaaaaaaaaa' : lastOpen === 'B' ? 'bbbbbbbbbbbbbbbb' : null
  fs.writeFileSync(path.join(userData, 'vaults.json'), JSON.stringify({ vaults, lastOpen: id }))
}

async function launch(): Promise<{ app: ElectronApplication; win: Page }> {
  // Selectors are English; pin the language unless a test wrote its own settings.
  const settingsFile = path.join(userData, 'settings.json')
  if (!fs.existsSync(settingsFile)) {
    fs.mkdirSync(userData, { recursive: true })
    fs.writeFileSync(settingsFile, JSON.stringify({ version: 2, language: 'en' }))
  }
  const exe = process.env.SYNAPSE_APP
  const app = await _electron.launch({
    ...(exe ? { executablePath: exe, args: [] } : { args: [path.join(__dirname, '..')] }),
    // the update check talks to a closed local port unless a test serves its own feed
    // SYNAPSE_HIDDEN: no window on screen, no focus taken (see helpers.ts)
    env: { ...process.env, SYNAPSE_USER_DATA: userData, SYNAPSE_UPDATE_FEED: updateFeed, SYNAPSE_HIDDEN: '1' },
  })
  const win = await app.firstWindow()
  win.on('pageerror', (e) => console.error('pageerror', e))
  await win.waitForLoadState('domcontentloaded')
  return { app, win }
}

const prefs = (win: Page) => win.evaluate(() => (window as any).__synapse.state.snap.prefs)
const vaultName = (win: Page) => win.evaluate(() => (window as any).__synapse.state.snap.vault?.name ?? null)

async function switchTo(win: Page, name: string) {
  await win.getByRole('button', { name: 'Switch vault' }).click()
  await win.getByRole('menuitem', { name }).click()
  await expect.poll(() => vaultName(win)).toBe(name)
  await expect(win.getByTestId('file-explorer')).toBeVisible()
}

async function openSettings(win: Page, section: string) {
  await win.keyboard.press('Meta+Comma')
  await win.getByRole('button', { name: section, exact: true }).click()
}

test.beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-e2e-')))
  userData = path.join(tmp, 'userData')
  vaultA = path.join(tmp, 'Vault A')
  vaultB = path.join(tmp, 'Vault B')
  makeVault(vaultA)
  makeVault(vaultB, { 'Only B.md': '# B\n' })
})
test.afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('mandatory settings acceptance scenario', async () => {
  seedRegistry(null)
  // 1. launch: no previous vault -> starter screen
  let { app, win } = await launch()
  await expect(win.getByTestId('vault-manager')).toBeVisible()
  // 2. open Vault A
  await win.locator('.vault-row', { hasText: 'Vault A' }).click()
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  // 3-4. dark theme + font size
  await openSettings(win, 'Appearance')
  await choose(win, 'Base color scheme', 'Dark')
  const slider = win.getByLabel('Font size', { exact: true })
  await slider.focus()
  for (let i = 0; i < 3; i++) await slider.press('ArrowRight')
  await expect.poll(async () => (await prefs(win)).fontSize).toBe(19)
  await win.keyboard.press('Escape')
  // 5. sidebar layout: hide the right sidebar
  await win.getByRole('button', { name: 'Toggle right sidebar' }).click()
  await expect(win.locator('.dock-right.is-open')).toHaveCount(0)
  // 6-8. restart, preferences persist
  await app.close()
  ;({ app, win } = await launch())
  await expect.poll(() => vaultName(win)).toBe('Vault A')
  await expect(win.locator('body')).toHaveClass(/theme-dark/)
  await expect.poll(() => win.evaluate(() => document.body.style.getPropertyValue('--font-text-size'))).toBe('19px')
  await expect(win.locator('.dock-right.is-open')).toHaveCount(0)
  // 9-10. Vault B: globals unchanged
  await switchTo(win, 'Vault B')
  expect(await prefs(win)).toMatchObject({ theme: 'dark', fontSize: 19 })
  await expect(win.locator('.dock-right.is-open')).toHaveCount(0)
  // 11. vault-specific setting in B
  await openSettings(win, 'Editor')
  const row = win.locator('[data-setting="showLineNumber"]')
  await choose(win, 'Scope for Show line numbers', 'This vault only', row)
  await row.getByRole('switch').click()
  await expect.poll(async () => (await prefs(win)).showLineNumber).toBe(true)
  await win.keyboard.press('Escape')
  // 12-13. A keeps its own configuration
  await switchTo(win, 'Vault A')
  expect((await prefs(win)).showLineNumber).toBe(false)
  // 14-15. B keeps its configuration
  await switchTo(win, 'Vault B')
  expect((await prefs(win)).showLineNumber).toBe(true)
  // 16. change a global preference while B is open
  await openSettings(win, 'Appearance')
  await choose(win, 'Base color scheme', 'Light')
  await win.keyboard.press('Escape')
  // 17-18. applies in A too
  await switchTo(win, 'Vault A')
  await expect(win.locator('body')).toHaveClass(/theme-light/)
  // 19-20. restart: globals and both vault configs restored
  await app.close()
  ;({ app, win } = await launch())
  await expect.poll(() => vaultName(win)).toBe('Vault A')
  expect(await prefs(win)).toMatchObject({ theme: 'light', fontSize: 19, showLineNumber: false })
  await switchTo(win, 'Vault B')
  expect(await prefs(win)).toMatchObject({ theme: 'light', fontSize: 19, showLineNumber: true })
  // settings files live in the right places
  expect(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).prefs).toMatchObject({ theme: 'light', fontSize: 19 })
  expect(JSON.parse(fs.readFileSync(path.join(vaultB, '.synapse', 'settings.json'), 'utf8')).overrides).toEqual({ showLineNumber: true })
  expect(fs.readFileSync(path.join(vaultA, '.synapse', 'settings.json'), 'utf8')).not.toContain('theme')
  await app.close()
})

test('create, edit, rename with link update, persist across restart', async () => {
  seedRegistry('A')
  let { app, win } = await launch()
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  await win.keyboard.press('Meta+N')
  const title = win.getByLabel('Note title')
  await expect(title).toBeFocused()
  await title.fill('Résumé 日本')
  await title.press('Enter')
  await expect.poll(() => fs.existsSync(path.join(vaultA, 'Résumé 日本.md'))).toBe(true)
  await win.locator('.cm-content').click()
  await win.keyboard.type('Hello **world** with link [[Ideas')
  await win.keyboard.press('Escape')
  await expect.poll(() => fs.readFileSync(path.join(vaultA, 'Résumé 日本.md'), 'utf8'), { timeout: 5000 }).toContain('Hello **world** with link [[Ideas]]')
  // backlink shows up on Ideas
  await win.locator('.tree-item-self', { hasText: 'Ideas' }).click()
  await expect(win.getByTestId('backlinks')).toContainText('Résumé 日本')
  // rename Ideas -> Concepts: links in other notes are rewritten
  const t2 = win.getByLabel('Note title')
  await t2.fill('Concepts')
  await t2.press('Enter')
  await expect.poll(() => fs.existsSync(path.join(vaultA, 'Concepts.md'))).toBe(true)
  await expect.poll(() => fs.readFileSync(path.join(vaultA, 'Welcome.md'), 'utf8')).toContain('[[Concepts]]')
  await expect.poll(() => fs.readFileSync(path.join(vaultA, 'Résumé 日本.md'), 'utf8')).toContain('[[Concepts]]')
  // restart: tabs restored, content intact
  await app.close()
  ;({ app, win } = await launch())
  await expect(win.locator('.tab', { hasText: 'Concepts' })).toBeVisible()
  await win.locator('.tree-item-self', { hasText: 'Résumé 日本' }).click()
  // Live Preview hides the markup on lines without the cursor; the file keeps it
  await expect(win.locator('.cm-content')).toContainText(/Hello (\*\*)?world(\*\*)? with link (\[\[)?Concepts/)
  expect(fs.readFileSync(path.join(vaultA, 'Résumé 日本.md'), 'utf8')).toContain('Hello **world** with link [[Concepts]]')
  await app.close()
})

test('external changes: clean buffer reloads, dirty buffer shows conflict and never clobbers', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Welcome' }).click()
  await expect(win.locator('.cm-content')).toContainText('Links to')
  fs.writeFileSync(path.join(vaultA, 'Welcome.md'), '# Welcome\n\nChanged on disk.\n')
  await expect(win.locator('.cm-content')).toContainText('Changed on disk.')
  // make a local edit, then change the file externally before autosave
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type(' local edit')
  fs.writeFileSync(path.join(vaultA, 'Welcome.md'), '# Welcome\n\nSecond external change.\n')
  await expect(win.getByRole('alert').filter({ hasText: 'changed outside Synapse' })).toBeVisible({ timeout: 5000 })
  expect(fs.readFileSync(path.join(vaultA, 'Welcome.md'), 'utf8')).toContain('Second external change.')
  await win.getByRole('button', { name: 'Keep my version' }).click()
  await expect.poll(() => fs.readFileSync(path.join(vaultA, 'Welcome.md'), 'utf8')).toContain('local edit')
  await app.close()
})

test('missing last vault: starter lists it as unavailable and never creates it', async () => {
  const gone = path.join(tmp, 'Gone Vault')
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, 'vaults.json'), JSON.stringify({ vaults: { cccccccccccccccc: { path: gone, ts: 3 } }, lastOpen: 'cccccccccccccccc' }))
  const { app, win } = await launch()
  await expect(win.getByTestId('vault-manager')).toBeVisible()
  await expect(win.locator('.vault-row.is-missing')).toContainText('Folder not found')
  await expect(win.getByRole('button', { name: 'Locate…' })).toBeVisible()
  expect(fs.existsSync(gone)).toBe(false)
  await app.close()
})

test('search, quick switcher, command palette, graph', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  await expect(win.locator('.tree-item-self', { hasText: 'Ideas' })).toBeVisible()
  await win.keyboard.press('Meta+Shift+F')
  await win.locator('#search-input').fill('zebracorn')
  await expect(win.getByTestId('search-results')).toContainText('Ideas')
  await win.locator('.search-result-match').first().click()
  await expect(win.locator('.tab.is-active')).toContainText('Ideas')
  await win.keyboard.press('Meta+O')
  await win.keyboard.type('welc')
  await win.keyboard.press('Enter')
  await expect(win.locator('.tab.is-active')).toContainText('Welcome')
  await win.keyboard.press('Meta+P')
  await win.keyboard.type('toggle reading')
  await win.keyboard.press('Enter')
  await expect(win.getByTestId('reading')).toBeVisible()
  await win.getByTestId('reading').getByText('Ideas').click()
  await expect(win.locator('.tab.is-active')).toContainText('Ideas')
  await win.keyboard.press('Meta+G')
  await expect(win.getByTestId('graph')).toBeVisible()
  await app.close()
})

test('security: renderer has no Node access and cannot leave the vault', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  const r = await win.evaluate(async () => ({
    require: typeof (window as any).require,
    process: typeof (window as any).process,
    escape: await (window as any).synapse.invoke('fs:read', '../userData/settings.json'),
    abs: await (window as any).synapse.invoke('fs:read', '/etc/hosts'),
    config: await (window as any).synapse.invoke('fs:write', '.synapse/settings.json', 'x'),
    blocked: await (window as any).synapse.invoke('evil:channel').catch((e: Error) => e.message),
    // only folders picked in a native dialog (or already registered) can become vaults
    openHome: await (window as any).synapse.invoke('vault:open', '/Users'),
    createAnywhere: await (window as any).synapse.invoke('vault:create', '/tmp', 'x'),
    notifications: await Notification.requestPermission(),
    csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content') ?? '',
  }))
  expect(r.require).toBe('undefined')
  expect(r.process).toBe('undefined')
  expect(r.escape.error.code).toBe('EOUTSIDE')
  expect(r.abs.error.code).toBe('EOUTSIDE')
  expect(r.config.error.code).toBe('EOUTSIDE')
  expect(r.blocked).toContain('Blocked')
  expect(r.openHome.error.code).toBe('EPERM')
  expect(r.createAnywhere.error.code).toBe('EPERM')
  expect(r.notifications).toBe('denied')
  if (process.env.SYNAPSE_APP) expect(r.csp).not.toContain('localhost')
  await app.close()
})

test('editing: undo/redo, status bar, save state', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Welcome' }).click()
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type(' typed')
  await expect(win.locator('.cm-content')).toContainText('typed')
  await expect(win.getByTestId('status-bar')).toContainText(/Ln \d+, Col \d+/)
  await win.keyboard.press('Meta+Z')
  await expect(win.locator('.cm-content')).not.toContainText('typed')
  await win.keyboard.press('Meta+Shift+Z')
  await expect(win.locator('.cm-content')).toContainText('typed')
  await expect(win.getByTestId('save-state')).toHaveText('Saved', { timeout: 5000 })
  await expect.poll(() => fs.readFileSync(path.join(vaultA, 'Welcome.md'), 'utf8')).toContain('typed')
  await app.close()
})

test('empty vault shows an empty state that creates the first note', async () => {
  fs.rmSync(vaultA, { recursive: true })
  fs.mkdirSync(vaultA)
  seedRegistry('A')
  const { app, win } = await launch()
  await expect(win.getByTestId('empty-vault')).toBeVisible()
  await win.getByRole('button', { name: 'Create first note' }).click()
  await expect.poll(() => fs.existsSync(path.join(vaultA, 'Untitled.md'))).toBe(true)
  await expect(win.getByTestId('empty-vault')).toHaveCount(0)
  await app.close()
})

test('layout holds with long names at wide and narrow window sizes', async () => {
  const long = 'An extremely long note name that keeps going well past any reasonable width for a sidebar row'
  fs.mkdirSync(path.join(vaultA, 'A folder with a similarly long name for nesting tests'), { recursive: true })
  fs.writeFileSync(path.join(vaultA, 'A folder with a similarly long name for nesting tests', long + '.md'), '# x\n\n[[Welcome]]\n')
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'A folder with' }).click()
  await win.locator('.tree-item-self', { hasText: 'An extremely long' }).click()
  // Resize the real native window: viewport emulation would not reflow the BrowserWindow.
  for (const [w, h] of [[1400, 900], [1200, 800], [1000, 720], [900, 700], [640, 520]]) {
    await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h), [w, h])
    await expect.poll(() => win.evaluate(() => innerWidth)).toBe(w)
    await win.waitForTimeout(350)
    // both docks end inside the window
    const docks = await win.evaluate(() => [...document.querySelectorAll('.dock.is-open')].map((d) => d.getBoundingClientRect().right))
    for (const right of docks) expect(right, `dock clipped at ${w}px`).toBeLessThanOrEqual(w + 1)
    const overflow = await win.evaluate(() =>
      ['.shell', '.workspace', '.nav-files', '.tab-strip', '.status-bar', '.note-scroll'].map((sel) => {
        const el = document.querySelector(sel) as HTMLElement | null
        return el && !sel.includes('tab-strip') && !sel.includes('nav-files') ? el.scrollWidth - el.clientWidth : 0
      }).concat(document.documentElement.scrollWidth - document.documentElement.clientWidth),
    )
    expect(Math.max(...overflow), `horizontal overflow at ${w}px`).toBeLessThanOrEqual(1)
    // the editor keeps a usable width
    const editorWidth = await win.locator('.pane-content').evaluate((el) => el.getBoundingClientRect().width)
    expect(editorWidth, `editor width at ${w}px`).toBeGreaterThan(Math.min(360, w * 0.5))
  }
  await app.close()
})

test('keyboard shortcuts drive the workspace', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  await win.keyboard.press('Meta+N')
  await expect(win.getByLabel('Note title')).toBeFocused()
  const tabs = win.locator('.tab')
  const before = await tabs.count()
  await win.keyboard.press('Meta+T')
  await expect(tabs).toHaveCount(before + 1)
  await win.keyboard.press('Meta+W')
  await expect(tabs).toHaveCount(before)
  await win.keyboard.press('Meta+Shift+T')
  await expect(tabs).toHaveCount(before + 1)
  await win.getByRole('button', { name: 'Toggle left sidebar' }).click()
  await expect(win.locator('.dock-left')).not.toHaveClass(/is-open/)
  await expect(win.locator('.dock-left')).toHaveAttribute('inert', '')
  await win.getByRole('button', { name: 'Toggle left sidebar' }).click()
  await expect(win.locator('.dock-left')).toHaveClass(/is-open/)
  await app.close()
})

test('language: switch to Italian, persists across restart, back to English', async () => {
  seedRegistry('A')
  let { app, win } = await launch()
  await win.keyboard.press('Meta+Comma')
  await win.getByRole('button', { name: 'General', exact: true }).click()
  await choose(win, 'Language', 'Italiano')
  await expect(win.getByRole('button', { name: 'Generali', exact: true })).toBeVisible()
  await win.keyboard.press('Escape')
  await expect(win.locator('.jump-field')).toHaveText(/Vai alla nota/)
  await win.locator('.tree-item-self', { hasText: 'Welcome' }).click()
  await expect(win.getByTestId('status-bar')).toContainText('parole')
  expect(JSON.parse(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8')).language).toBe('it')
  // the native menu follows the language
  const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => i.label))
  expect(menu).toContain('Vista')
  await app.close()
  ;({ app, win } = await launch())
  await expect(win.locator('.jump-field')).toHaveText(/Vai alla nota/)
  await win.keyboard.press('Meta+Comma')
  await win.getByRole('button', { name: 'Generali', exact: true }).click()
  await choose(win, 'Lingua', 'English')
  await expect(win.getByRole('button', { name: 'General', exact: true })).toBeVisible()
  await app.close()
})

test('fast typing is never reordered or lost', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Ideas' }).click()
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  const text = ' ' + 'The quick brown fox jumps over the lazy dog 0123456789. '.repeat(7)
  await win.keyboard.type(text)
  await expect(win.locator('.cm-content')).toContainText(text.trim())
  await expect.poll(() => fs.readFileSync(path.join(vaultA, 'Ideas.md'), 'utf8'), { timeout: 5000 }).toContain(text.trim())
  await app.close()
})

test('live preview hides markup off the cursor line and edits tables in place', async () => {
  fs.writeFileSync(path.join(vaultA, 'Live.md'), 'First line\n\n## Section\n\nSome **bold** text and [[Welcome]].\n\n| Name | Value |\n|---|---|\n| alpha | 1 |\n\nLast line\n')
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Live' }).click()
  const content = win.locator('.cm-content')
  await content.click({ position: { x: 5, y: 5 } }) // cursor on the first line
  await expect(content).toContainText('Some bold text and Welcome.')
  await expect(content).not.toContainText('**')
  await expect(content).not.toContainText('## ')
  // the cursor's line shows its Markdown
  await win.locator('.cm-line', { hasText: 'Some' }).click()
  await expect(win.locator('.cm-line', { hasText: 'Some' })).toContainText('**bold**')
  // tables render as a grid; editing a cell rewrites the Markdown table
  const cell = win.locator('.cm-lp-table td', { hasText: '1' })
  await expect(win.locator('.cm-lp-table')).toBeVisible()
  await cell.click()
  await win.keyboard.press('End')
  await win.keyboard.type('00')
  await expect(win.locator('.cm-lp-table')).toBeVisible() // still a grid while editing
  await expect.poll(() => fs.readFileSync(path.join(vaultA, 'Live.md'), 'utf8'), { timeout: 5000 }).toContain('| alpha | 100 |')
  await app.close()
})

test('math renders with KaTeX in live preview and reading view', async () => {
  fs.writeFileSync(path.join(vaultA, 'Math.md'), 'Top\n\nInline $E = mc^2$ here.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nCosts $5 and $10.\n')
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Math' }).click()
  const content = win.locator('.cm-content')
  await content.click({ position: { x: 5, y: 5 } })
  await expect(win.locator('.cm-lp-math .katex')).toHaveCount(1)
  await expect(win.locator('.cm-lp-math-block .katex-display')).toHaveCount(1)
  await expect(content).toContainText('Costs $5 and $10.')
  // the cursor's line shows the TeX source
  await win.locator('.cm-line', { hasText: 'Inline' }).click()
  await expect(win.locator('.cm-line', { hasText: 'Inline' })).toContainText('$E = mc^2$')
  await win.keyboard.press('Meta+P')
  await win.keyboard.type('toggle reading')
  await win.keyboard.press('Enter')
  const reading = win.getByTestId('reading')
  await expect(reading.locator('.katex')).toHaveCount(2)
  await expect(reading.locator('.math-block .katex-display')).toHaveCount(1)
  await app.close()
})

test('clicking a rendered wiki link in live preview opens the note', async () => {
  fs.writeFileSync(path.join(vaultA, 'Hub.md'), 'Top\n\nGo to [[Ideas|my ideas]] now.\n')
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Hub' }).click()
  await win.locator('.cm-content').click({ position: { x: 5, y: 5 } })
  await win.locator('.cm-lp-link', { hasText: 'my ideas' }).click()
  await expect(win.locator('.cm-content')).toContainText('zebracorn')
  await app.close()
})

async function palette(win: Page, text: string) {
  await win.keyboard.press('Meta+P')
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
}

test('reading view highlights code and renders Mermaid', async () => {
  const note = [
    '```js\nconst x = 1\n```',
    '```py\ndef f(): pass\n```',
    '```klingon\n<b>qapla</b>\n```',
    '```mermaid\ngraph TD\n  A --> B\n```',
    '```mermaid\nflowchart TD\n  A[Start] -->\n```',
    '```mermaid\n\n```',
    '```mermaid\n%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A["<img src=x onerror=window.__pwned=1>"] --> B\n  click A call alert()\n```',
    '```text\nmermaid\n```',
  ].join('\n\n')
  fs.writeFileSync(path.join(vaultA, 'Code.md'), note + '\n')
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Code' }).click()
  // the editor loads each fence's language on demand, aliases included
  await expect(win.locator('.cm-content .cm-kw', { hasText: 'def' })).toHaveCount(1)
  await expect(win.locator('.cm-content .cm-kw', { hasText: 'const' })).toHaveCount(1)
  await palette(win, 'toggle reading')
  const reading = win.getByTestId('reading')
  await expect(reading.locator('.hljs-keyword', { hasText: 'const' })).toHaveCount(1)
  await expect(reading.locator('.hljs-keyword', { hasText: 'def' })).toHaveCount(1)
  // unknown language: plain, escaped text
  await expect(reading.locator('code', { hasText: '<b>qapla</b>' })).toHaveCount(1)
  // the valid diagram and the sanitized one render; invalid and empty ones keep their source with a message
  await expect(reading.locator('.mermaid svg')).toHaveCount(2)
  await expect(reading.locator('pre.mermaid-src.is-error')).toHaveCount(2)
  await expect(reading.locator('.mermaid-error')).toHaveCount(2)
  await expect(reading.locator('.mermaid-error').last()).toContainText('empty')
  expect(await win.evaluate(() => (window as any).__pwned)).toBeUndefined()
  // failed renders leave no temporary Mermaid elements behind
  expect(await win.evaluate(() => document.querySelectorAll('body > [id^="dmermaid"], body > [id^="mermaid-"]').length)).toBe(0)
  await expect(reading.locator('.mermaid [onerror], .mermaid script, .mermaid [onclick]')).toHaveCount(0)
  // an ordinary fence that merely says "mermaid" stays code
  await expect(reading.locator('pre:not(.mermaid-src) code', { hasText: 'mermaid' })).toHaveCount(1)
  // switching theme redraws diagrams with the other palette
  const fill = () => reading.locator('.mermaid svg').first().evaluate((svg) => svg.querySelector('style')?.textContent)
  const before = await fill()
  const wasLight = await win.evaluate(() => document.body.classList.contains('theme-light'))
  await win.evaluate((theme) => (window as any).__synapse.setGlobal({ prefs: { theme } }), wasLight ? 'dark' : 'light')
  await expect(win.locator(wasLight ? 'body.theme-dark' : 'body.theme-light')).toHaveCount(1)
  await expect(reading.locator('.mermaid svg')).toHaveCount(2)
  await expect.poll(fill).not.toBe(before)
  // the file on disk is untouched by rendering
  expect(fs.readFileSync(path.join(vaultA, 'Code.md'), 'utf8')).toBe(note + '\n')
  await app.close()
})

test('daily notes: open today once, navigate between days, never duplicate', async () => {
  const d = new Date()
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  fs.mkdirSync(path.join(vaultA, 'Daily'))
  fs.writeFileSync(path.join(vaultA, 'Daily', '2000-01-01.md'), 'old day\n')
  fs.mkdirSync(path.join(vaultA, 'Templates'))
  fs.writeFileSync(path.join(vaultA, 'Templates', 'Daily note.md'), '# {{title}}\n\n## Log\n')
  seedRegistry('A')
  const { app, win } = await launch()
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  await palette(win, 'open today')
  const file = path.join(vaultA, 'Daily', `${today}.md`)
  await expect.poll(() => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')).toBe(`# ${today}\n\n## Log\n`)
  await win.keyboard.type('my day')
  await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('my day')
  // again: opens the same note, nothing new is created or overwritten
  await palette(win, 'open previous daily')
  await expect(win.locator('.cm-content')).toContainText('old day')
  await palette(win, 'open today')
  await expect.poll(() => fs.readdirSync(path.join(vaultA, 'Daily')).sort()).toEqual(['2000-01-01.md', `${today}.md`])
  expect(fs.readdirSync(vaultA).filter((f) => f.endsWith('.md')).sort()).toEqual(['Ideas.md', 'Welcome.md'])
  expect(fs.readFileSync(file, 'utf8')).toContain('my day')
  await app.close()
})

test('templates: insert at the cursor and create notes, never overwriting', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  await win.locator('.tree-item-self', { hasText: 'Ideas' }).click()
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await palette(win, 'insert template')
  await win.keyboard.type('meeting')
  await win.keyboard.press('Enter')
  const ideas = path.join(vaultA, 'Ideas.md')
  await expect.poll(() => fs.readFileSync(ideas, 'utf8')).toContain('## Action items')
  const text = fs.readFileSync(ideas, 'utf8')
  expect(text.startsWith('# Ideas\n\nBack to [[Welcome]]. Unique word: zebracorn.\n# Ideas\n')).toBe(true)
  expect(text).not.toContain('{{')
  // undo removes the inserted template in one step
  await win.keyboard.press('Meta+Z')
  await expect.poll(() => fs.readFileSync(ideas, 'utf8')).toBe('# Ideas\n\nBack to [[Welcome]]. Unique word: zebracorn.\n')
  // new note from template; an existing name is refused
  await palette(win, 'new note from template')
  await win.keyboard.type('study')
  await win.keyboard.press('Enter')
  await win.keyboard.type('Physics')
  await win.keyboard.press('Enter')
  const physics = path.join(vaultA, 'Physics.md')
  // the file appears (empty) a moment before its content is written: wait for the content
  await expect.poll(() => (fs.existsSync(physics) ? fs.readFileSync(physics, 'utf8') : '')).toMatch(/^# Physics\n\nDate: \d{4}-\d{2}-\d{2}\n/)
  await palette(win, 'new note from template')
  await win.keyboard.type('project')
  await win.keyboard.press('Enter')
  await win.keyboard.type('Welcome')
  await win.keyboard.press('Enter')
  await expect(win.locator('.notice.is-error')).toContainText('already exists')
  expect(fs.readFileSync(path.join(vaultA, 'Welcome.md'), 'utf8')).toBe('# Welcome\n\nLinks to [[Ideas]].\n')
  // names that would leave the folder or the vault are refused
  for (const bad of ['../escape', '.hidden']) {
    await palette(win, 'new note from template')
    await win.keyboard.press('Enter')
    await win.keyboard.type(bad)
    await win.keyboard.press('Enter')
    await expect(win.locator('.notice.is-error').last()).toContainText('Names cannot')
  }
  expect(fs.existsSync(path.join(tmp, 'escape.md'))).toBe(false)
  expect(fs.readdirSync(vaultA).filter((f) => f.endsWith('.md')).sort()).toEqual(['Ideas.md', 'Physics.md', 'Welcome.md'])
  await app.close()
})

test('version history: earlier text is kept outside the vault and restored on confirmation', async () => {
  seedRegistry('A')
  const { app, win } = await launch()
  const ideas = path.join(vaultA, 'Ideas.md')
  const original = fs.readFileSync(ideas, 'utf8')
  await win.locator('.tree-item-self', { hasText: 'Ideas' }).click()
  await win.locator('.cm-content').click()
  await win.keyboard.press('Meta+ArrowDown')
  await win.keyboard.type('new line')
  await expect.poll(() => fs.readFileSync(ideas, 'utf8')).toContain('new line')
  const edited = fs.readFileSync(ideas, 'utf8')
  // file context menu → Version history…
  await win.locator('.tree-item-self', { hasText: 'Ideas' }).click({ button: 'right' })
  await win.getByRole('menuitem', { name: 'Version history…' }).click()
  await expect(win.getByTestId('history-preview')).toHaveText(original)
  // cancelling the confirmation changes nothing
  await win.getByRole('button', { name: 'Restore' }).click()
  await win.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click()
  expect(fs.readFileSync(ideas, 'utf8')).toBe(edited)
  await win.getByRole('button', { name: 'Restore' }).click()
  await win.getByRole('alertdialog').getByRole('button', { name: 'Restore' }).click()
  await expect.poll(() => fs.readFileSync(ideas, 'utf8')).toBe(original)
  await expect(win.locator('.cm-content')).not.toContainText('new line')
  // the replaced text is now a version itself; nothing was written into the vault
  await palette(win, 'show version history')
  await expect(win.getByTestId('history-preview')).toHaveText(edited)
  expect(fs.readdirSync(path.join(vaultA, '.synapse')).filter((f) => !['settings.json', 'workspace.json'].includes(f))).toEqual([])
  expect(fs.existsSync(path.join(userData, 'history'))).toBe(true)
  await app.close()
})

async function serveRelease(tag: string, assets: string[] = []) {
  const server = http.createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const dl = (name: string) => ({ name, browser_download_url: `https://github.com/Sero3105/Synapse/releases/download/${tag}/${name}` })
    res.end(JSON.stringify({ tag_name: tag, html_url: `https://github.com/Sero3105/Synapse/releases/tag/${tag}`, draft: false, prerelease: false, assets: assets.map(dl) }))
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  updateFeed = `http://127.0.0.1:${(server.address() as { port: number }).port}/latest`
  return server
}

test('a newer release on GitHub shows an update notice, unless turned off', async () => {
  seedRegistry('A')
  const server = await serveRelease('v99.0.0')
  try {
    let { app, win } = await launch()
    const notice = win.getByTestId('update-notice')
    await expect(notice).toContainText('Synapse 99.0.0 is available')
    await notice.getByRole('button', { name: 'Not now' }).click()
    await expect(notice).toHaveCount(0)
    // turn the check off in Settings → General; the next launch stays quiet
    await openSettings(win, 'General')
    await win.getByRole('switch', { name: 'Check for updates' }).click()
    await expect.poll(async () => (await win.evaluate(() => (window as any).__synapse.state.snap.global.checkUpdates))).toBe(false)
    await app.close()
    ;({ app, win } = await launch())
    await expect(win.getByTestId('file-explorer')).toBeVisible()
    await win.waitForTimeout(1000)
    await expect(win.getByTestId('update-notice')).toHaveCount(0)
    await app.close()
  } finally {
    server.close()
    updateFeed = 'http://127.0.0.1:9/none'
  }
})

test('a release with a signed zip offers the in-app update', async () => {
  seedRegistry('A')
  const zip = `Synapse-99.0.0-${process.arch}.zip`
  const server = await serveRelease('v99.0.0', [zip, `${zip}.sig`])
  try {
    const { app, win } = await launch()
    const notice = win.getByTestId('update-notice')
    await expect(notice.getByRole('button', { name: 'Update and restart' })).toBeVisible()
    await expect(notice.getByRole('button', { name: 'Download' })).toHaveCount(0)
    await app.close()
  } finally {
    server.close()
    updateFeed = 'http://127.0.0.1:9/none'
  }
})

test('no notice when the published release is not newer', async () => {
  seedRegistry('A')
  const server = await serveRelease('v0.1.0')
  try {
    const { app, win } = await launch()
    await expect(win.getByTestId('file-explorer')).toBeVisible()
    await win.waitForTimeout(1000)
    await expect(win.getByTestId('update-notice')).toHaveCount(0)
    await app.close()
  } finally {
    server.close()
    updateFeed = 'http://127.0.0.1:9/none'
  }
})

test('close the vault from the switcher or with the shortcut, back to the starter screen', async () => {
  seedRegistry('A')
  let { app, win } = await launch()
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  // vault switcher menu
  await win.getByRole('button', { name: 'Switch vault' }).click()
  await win.getByRole('menuitem', { name: 'Close vault' }).click()
  await expect(win.getByTestId('vault-manager')).toBeVisible()
  // the starter offers creating or opening a vault, and does not reopen the closed one at next launch
  await expect(win.getByText('Create a vault')).toBeVisible()
  await app.close()
  ;({ app, win } = await launch())
  await expect(win.getByTestId('vault-manager')).toBeVisible()
  // open it again, then close with ⇧⌘W
  await win.locator('.vault-row', { hasText: 'Vault A' }).click()
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  await win.keyboard.press('Meta+Shift+W')
  await expect(win.getByTestId('vault-manager')).toBeVisible()
  await app.close()
})
