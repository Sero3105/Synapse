import { test, expect } from '@playwright/test'
import { makeEnv, launch, cleanup, Env } from './helpers'

let env: Env
test.afterEach(() => cleanup(env))

// a one-page PDF with a web link on it
const PDF = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 24 Tf 40 100 Td (Hello PDF) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
%%EOF
`

test('a PDF opens in a tab with the built-in viewer, and can still go to the default app', async () => {
  env = makeEnv({ 'Note.md': 'see [[doc.pdf]]', 'doc.pdf': PDF })
  const { app, win } = await launch(env)
  await win.locator('.tree-item-self', { hasText: 'doc.pdf' }).click()
  await expect(win.getByTestId('pdf-frame')).toBeVisible()
  // the frame loaded the vault file and Chromium's viewer took it over
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.mainFrame.framesInSubtree.map((f) => f.url).join('\n')), { timeout: 10_000 })
    .toMatch(/synapse-file:\/\/[a-z0-9]+\/doc\.pdf/)
  const opened: string[] = await app.evaluate(({ shell }) => {
    const calls: string[] = []
    shell.openPath = (async (p: string) => (calls.push(p), '')) as never
    ;(globalThis as any).__opened = calls
    return calls
  })
  expect(opened).toEqual([])
  await win.getByRole('button', { name: 'Open in default app' }).click()
  await expect.poll(() => app.evaluate(() => (globalThis as any).__opened as string[])).toEqual([expect.stringMatching(/doc\.pdf$/)])
  await app.close()
})

test('a frame never loads a web page inside the app; a link the document follows opens in the browser', async () => {
  env = makeEnv({ 'doc.pdf': PDF })
  const { app, win } = await launch(env)
  await win.locator('.tree-item-self', { hasText: 'doc.pdf' }).click()
  await expect(win.getByTestId('pdf-frame')).toBeVisible()
  // origins, not URLs: a frame blocked by the CSP keeps the requested URL but has a null origin and no content
  const origins = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.mainFrame.framesInSubtree.map((f) => f.origin))
  await expect.poll(async () => (await origins()).some((o) => o.startsWith('synapse-file:'))).toBe(true)
  await app.evaluate(({ shell }) => {
    ;(globalThis as any).__external = []
    shell.openExternal = (async (u: string) => void (globalThis as any).__external.push(u)) as never
  })

  // the document navigating its own frame, as a followed link does: stopped in main, sent to the browser
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.mainFrame.frames[0].executeJavaScript('location.href = "https://example.com/"').catch(() => {}))
  await expect.poll(() => app.evaluate(() => (globalThis as any).__external)).toEqual(['https://example.com/'])
  expect((await origins()).some((o) => o.startsWith('http'))).toBe(false)
  await expect.poll(async () => (await origins()).some((o) => o.startsWith('synapse-file:'))).toBe(true) // the PDF is still there
  // the page itself pointing the frame elsewhere: stopped the same way
  await win.evaluate(() => ((document.querySelector('[data-testid="pdf-frame"]') as HTMLIFrameElement).src = 'https://example.org/'))
  await expect.poll(() => app.evaluate(() => (globalThis as any).__external)).toEqual(['https://example.com/', 'https://example.org/'])
  expect((await origins()).some((o) => o.startsWith('http'))).toBe(false)

  // with the first guard gone, the second still refuses to load a web page in a frame
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.removeAllListeners('will-frame-navigate'))
  await win.evaluate(() => ((document.querySelector('[data-testid="pdf-frame"]') as HTMLIFrameElement).src = 'https://example.net/'))
  await win.waitForTimeout(1500)
  expect((await origins()).some((o) => o.startsWith('http'))).toBe(false)
  await app.close()
})
