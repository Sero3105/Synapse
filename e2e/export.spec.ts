// Export to HTML/PDF and the read-only preview before opening a folder as a vault.
import { test, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { makeEnv, launch, palette, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

const NOTE = '# Résumé ✓\n\n- [ ] task\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```python\ndef f(): pass\n```\n\n![[pic 1.png]]\n\n```mermaid\nflowchart TD\n  A --> B\n```\n\nSee [[Other]] and <script>window.x=1</script>\n'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64')

test('export a note to standalone HTML and to PDF without touching it', async () => {
  env = makeEnv({ 'Note.md': NOTE, 'Other.md': 'x', 'pic 1.png': PNG })
  const { app, win } = await launch(env)
  const out = path.join(env.tmp, 'out')
  fs.mkdirSync(out)
  // the native save dialog cannot be driven: answer it from the main process
  const answer = (file: string | null) => app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = (async () => ({ canceled: !f, filePath: f ?? undefined })) as never }, file)
  await win.locator('.tree-item-self', { hasText: 'Note' }).first().click()

  await answer(path.join(out, 'Note.html'))
  await palette(win, 'export to html')
  await expect.poll(() => fs.existsSync(path.join(out, 'Note.html'))).toBe(true)
  const html = fs.readFileSync(path.join(out, 'Note.html'), 'utf8')
  expect(html).toContain('Résumé ✓')
  expect(html).toContain('<table>')
  expect(html).toContain('hljs-keyword')
  expect(html).toContain('<svg')
  expect(html).toContain('src="data:image/png;base64,')
  expect(html).not.toContain('synapse-file:')
  expect(html).not.toMatch(/<script/i)
  expect(html).toContain("default-src 'none'")

  await answer(path.join(out, 'Note.pdf'))
  await palette(win, 'export to pdf')
  await expect.poll(() => fs.existsSync(path.join(out, 'Note.pdf')), { timeout: 15000 }).toBe(true)
  expect(fs.readFileSync(path.join(out, 'Note.pdf')).subarray(0, 4).toString()).toBe('%PDF')

  // cancelling writes nothing
  await answer(null)
  await palette(win, 'export to html')
  await win.waitForTimeout(500)
  expect(fs.readdirSync(out).sort()).toEqual(['Note.html', 'Note.pdf'])
  expect(fs.readFileSync(path.join(env.vault, 'Note.md'), 'utf8')).toBe(NOTE)
  await app.close()
})

test('export of hostile content stays inert, and the exported file runs no script when opened', async () => {
  const hostile = [
    '# Hostile',
    '[click](javascript:alert(1)) [data](data:text/html,<script>1</script>) <svg onload="window.pwned=1"></svg>',
    '<img src=x onerror="window.pwned=1">',
    '```mermaid\n%%{init: {"securityLevel": "loose"}}%%\nflowchart TD\n  A["<img src=x onerror=window.pwned=1>"] --> B\n  click A call alert()\n```',
  ].join('\n\n')
  env = makeEnv({ 'Hostile.md': hostile + '\n' })
  const { app, win } = await launch(env)
  const out = path.join(env.tmp, 'out')
  fs.mkdirSync(out)
  const file = path.join(out, 'Hostile.html')
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as never }, file)
  await win.locator('.tree-item-self', { hasText: 'Hostile' }).first().click()
  await palette(win, 'export to html')
  await expect.poll(() => fs.existsSync(file)).toBe(true)
  const html = fs.readFileSync(file, 'utf8')
  expect(html).not.toMatch(/<script/i)
  expect(html).toContain('<svg') // the diagram itself is kept
  // open the export in a window WITH JavaScript enabled: the CSP alone must stop everything
  const ran = await app.evaluate(async ({ BrowserWindow }, f) => {
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true } })
    await w.loadFile(f)
    await new Promise((r) => setTimeout(r, 300))
    const v = await w.webContents.executeJavaScript(`window.pwned === undefined &&
      document.querySelectorAll('script, [onload], [onerror], [onclick], a[href^="javascript:" i], a[href^="data:" i]').length === 0`)
    w.destroy()
    return v
  }, file)
  expect(ran).toBe(true)
  await app.close()
})

test('a PDF export never hangs on a remote image that does not answer', async () => {
  test.setTimeout(60000)
  // 10.255.255.1 is unroutable: the connection neither succeeds nor fails quickly
  env = makeEnv({ 'Remote.md': '# Remote\n\nText stays.\n\n![x](https://10.255.255.1/stall.png)\n' })
  const { app, win } = await launch(env)
  const file = path.join(env.tmp, 'Remote.pdf')
  await app.evaluate(({ dialog }, f) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: f })) as never }, file)
  await win.locator('.tree-item-self', { hasText: 'Remote' }).click()
  const t0 = Date.now()
  await palette(win, 'export to pdf')
  await expect.poll(() => fs.existsSync(file), { timeout: 30000 }).toBe(true)
  expect(Date.now() - t0).toBeLessThan(25000)
  expect(fs.readFileSync(file).subarray(0, 4).toString()).toBe('%PDF')
  await app.close()
})

test('a new folder is previewed read-only before it becomes a vault', async () => {
  env = makeEnv({ 'Note.md': 'x' })
  const other = path.join(env.tmp, 'Imported')
  for (const [p, c] of Object.entries({ 'a/Note.md': '[[Missing]] ![[gone.png]]', 'b/Note.md': 'dup', 'Ünï.md': '```dataview\nLIST\n```' })) {
    fs.mkdirSync(path.dirname(path.join(other, p)), { recursive: true })
    fs.writeFileSync(path.join(other, p), c)
  }
  // registered but never opened: approved for inspection, no .synapse yet
  const reg = JSON.parse(fs.readFileSync(path.join(env.userData, 'vaults.json'), 'utf8'))
  reg.vaults.bbbbbbbbbbbbbbbb = { path: other, ts: 0 }
  fs.writeFileSync(path.join(env.userData, 'vaults.json'), JSON.stringify(reg))
  const { app, win } = await launch(env)
  await expect(win.getByTestId('file-explorer')).toBeVisible()
  await win.evaluate((folder) => (window as any).__synapse.set({ modal: { kind: 'import', folder } }), other)
  const preview = win.getByTestId('import-preview')
  await expect(preview).toContainText('3 notes')
  await expect(preview).toContainText('Missing')
  await expect(preview).toContainText('gone.png')
  await expect(preview).toContainText('a/Note.md, b/Note.md')
  await expect(preview).toContainText('Dataview')
  await preview.getByRole('button', { name: 'Cancel' }).click()
  expect(fs.existsSync(path.join(other, '.synapse'))).toBe(false)
  // opening goes ahead only on request
  await win.evaluate((folder) => (window as any).__synapse.set({ modal: { kind: 'import', folder } }), other)
  await win.getByTestId('import-preview').getByRole('button', { name: 'Open vault' }).click()
  await expect.poll(() => win.evaluate(() => (window as any).__synapse.state.snap.vault?.name)).toBe('Imported')
  await app.close()
})

test('export the whole vault as a small site: one page per note, links between pages, an index', async () => {
  env = makeEnv({
    'Home.md': '# Home\n\nSee [[Deep]], [[Deep#Final Part|the end]], [[Missing]] and [md](sub/inner/Deep.md).\n\n![[pic 1.png]]\n',
    'sub/inner/Deep.md': '# Deep\n\nBack to [[Home]].\n\n## Final Part\n\nEnd. #tag\n',
    'pic 1.png': PNG,
  })
  const { app, win } = await launch(env)
  const out = path.join(env.tmp, 'out')
  fs.mkdirSync(out)
  const answer = (dir: string | null) => app.evaluate(({ dialog }, d) => { dialog.showOpenDialog = (async () => ({ canceled: !d, filePaths: d ? [d] : [] })) as never }, dir)

  await answer(null)
  await palette(win, 'export vault to html')
  await win.waitForTimeout(500)
  expect(fs.readdirSync(out)).toEqual([]) // cancelled: nothing written

  await answer(out)
  await palette(win, 'export vault to html')
  const site = path.join(out, 'Vault (HTML)')
  await expect.poll(() => fs.existsSync(path.join(site, 'index.html'))).toBe(true)
  const home = fs.readFileSync(path.join(site, 'Home.html'), 'utf8')
  expect(home).toContain('href="sub/inner/Deep.html"')
  expect(home).toContain('href="sub/inner/Deep.html#final-part"')
  expect(home).toMatch(/<a class="internal-link is-unresolved"[^>]*>Missing<\/a>/) // no page to go to: text only
  expect(home).not.toMatch(/<a class="internal-link is-unresolved"[^>]*[^-]href=/)
  expect(home).toContain('src="data:image/png;base64,')
  expect(home).toContain('<nav class="export-nav"><a href="index.html">Vault</a></nav>')
  const deep = fs.readFileSync(path.join(site, 'sub', 'inner', 'Deep.html'), 'utf8')
  expect(deep).toContain('href="../../Home.html"')
  expect(deep).toContain('id="final-part"')
  expect(deep).toContain('href="../../index.html"')
  const index = fs.readFileSync(path.join(site, 'index.html'), 'utf8')
  expect(index).toContain('href="Home.html"')
  expect(index).toContain('href="sub/inner/Deep.html"')
  // the vault itself is untouched
  expect(fs.readdirSync(env.vault).sort()).toEqual(['.synapse', 'Home.md', 'pic 1.png', 'sub'])

  // the site works offline in a browser: following a link opens the other page at the heading
  const page = await app.evaluate(async ({ BrowserWindow }, file) => {
    const w = new BrowserWindow({ show: false })
    await w.loadFile(file)
    await w.webContents.executeJavaScript(`document.querySelector('a[href="sub/inner/Deep.html#final-part"]').click()`)
    await new Promise((r) => setTimeout(r, 500))
    const url = w.webContents.getURL()
    w.destroy()
    return { url }
  }, path.join(site, 'Home.html'))
  expect(page.url).toMatch(/sub\/inner\/Deep\.html#final-part$/)

  // a second export goes to a new folder, the first one stays as it was
  await palette(win, 'export vault to html')
  await expect.poll(() => fs.existsSync(path.join(out, 'Vault (HTML) 2', 'index.html'))).toBe(true)
  await app.close()
})
