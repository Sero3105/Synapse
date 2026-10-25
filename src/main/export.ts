// Export a rendered note to a standalone HTML or PDF file chosen in a save dialog.
// The note itself is never touched; overwriting an existing file is confirmed by the native dialog.
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Vault } from './vault'
import { VaultError } from './vault'
import { atomicWrite } from './store'

const MAX_HTML = 50 * 1024 * 1024
const MAX_IMAGE = 20 * 1024 * 1024
const MAX_IMAGES_TOTAL = 200 * 1024 * 1024
const LOAD_TIMEOUT = 15_000
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif',
}

/** Replace `synapse-file://vault/…` image sources with data: URIs. Anything unreadable or outside the vault is dropped. */
export function inlineImages(html: string, vault: Pick<Vault, 'resolve'>): string {
  const cache = new Map<string, string>()
  let total = 0
  // only inside <img> tags: in text nodes "<" is escaped, so note prose can never match
  return html.replace(/(<img\b[^>]*?\s)src="synapse-file:\/\/vault\/([^"]*)"/g, (_, tag: string, enc: string) => {
    let src = cache.get(enc)
    if (src === undefined) {
      src = ''
      try {
        const rel = enc.split('/').map(decodeURIComponent).join('/')
        const mime = MIME[rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()]
        const abs = vault.resolve(rel)
        const st = fs.statSync(abs)
        // regular files only: reading a FIFO or device would block the main process
        if (mime && st.isFile() && st.size <= MAX_IMAGE && total + st.size <= MAX_IMAGES_TOTAL) {
          total += st.size
          src = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`
        }
      } catch { /* unreadable or outside the vault: dropped */ }
      cache.set(enc, src)
    }
    return `${tag}src="${src}"`
  })
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

const CSS = (dark: boolean) => `
:root { color-scheme: ${dark ? 'dark' : 'light'}; --bg: ${dark ? '#15181c' : '#ffffff'}; --ink: ${dark ? '#e6e8eb' : '#1c1f23'}; --ink-2: ${dark ? '#a9afb7' : '#5b626b'}; --line: ${dark ? '#2b3036' : '#e3e6ea'}; --code: ${dark ? '#0f1114' : '#f4f5f7'}; --accent: ${dark ? '#4cc9b0' : '#14806b'}; }
html { background: var(--bg); color: var(--ink); }
body { max-width: 760px; margin: 0 auto; padding: 48px 32px; font: 17px/1.65 "New York", Georgia, serif; }
h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.5em; break-after: avoid; }
a { color: var(--accent); }
img, svg { max-width: 100%; height: auto; }
img, svg, pre, table, blockquote { break-inside: avoid; }
pre { background: var(--code); padding: 14px 18px; border-radius: 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
code { font: 0.86em/1.55 ui-monospace, Menlo, monospace; background: var(--code); padding: 0.1em 0.3em; border-radius: 4px; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; margin: 1em 0; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 3px solid var(--line); color: var(--ink-2); }
hr { border: 0; border-top: 1px solid var(--line); }
mark { background: ${dark ? '#6b5a1e' : '#fbeaa0'}; color: inherit; }
.frontmatter { color: var(--ink-2); }
.task-list-item { list-style: none; }
.markdown-embed { border-left: 3px solid var(--line); padding-left: 1em; }
.markdown-embed-title { font-weight: 600; }
.mermaid { text-align: center; margin: 1em 0; }
.mermaid-error { color: var(--ink-2); font-size: 0.8em; }
.katex-html { display: none; }
.hljs-keyword, .hljs-selector-tag, .hljs-built_in, .hljs-type { color: ${dark ? '#c792ea' : '#8e3fa8'}; }
.hljs-string, .hljs-regexp, .hljs-attr, .hljs-symbol { color: ${dark ? '#a5d6a7' : '#2e7d32'}; }
.hljs-number, .hljs-literal { color: ${dark ? '#f2b880' : '#a1520b'}; }
.hljs-comment, .hljs-quote { color: var(--ink-2); font-style: italic; }
.hljs-title, .hljs-function, .hljs-section { color: ${dark ? '#82b1ff' : '#1f5fbf'}; }
@media print { html { background: none; } body { padding: 0; max-width: none; } }
`

/** Standalone document: no scripts can run (CSP), styles inline, images must be data: or https:. */
export function exportDocument(title: string, body: string, dark: boolean): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS(dark)}</style>
</head>
<body>
${body}
</body>
</html>
`
}

async function toPdf(html: string): Promise<Buffer> {
  // a temp file, not a data: URL, so large inlined images stay under URL length limits
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-export-'))
  const file = path.join(dir, 'note.html')
  const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } })
  try {
    fs.writeFileSync(file, html)
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    // "load" also waits for remote images: one that never answers would stall the export forever,
    // so after a while the page is printed as it is and unfinished images are left out
    const loaded = w.loadFile(file).catch(() => {})
    await Promise.race([loaded, new Promise((r) => setTimeout(r, LOAD_TIMEOUT))])
    if (w.webContents.isLoading()) w.webContents.stop()
    return await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } })
  } finally {
    w.destroy()
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/** Returns the saved file path, or null when the user cancelled. */
export async function saveExport(win: BrowserWindow, vault: Vault, kind: unknown, title: unknown, body: unknown, dark: unknown): Promise<string | null> {
  if (kind !== 'html' && kind !== 'pdf') throw new VaultError('EINVAL', 'Unknown export format')
  if (typeof title !== 'string' || typeof body !== 'string' || body.length > MAX_HTML) throw new VaultError('EINVAL', 'Invalid export')
  const name = title.replace(/[\\/:*?"<>|\0]/g, '-').trim().slice(0, 120) || 'Note'
  const html = exportDocument(name, inlineImages(body, vault), dark === true)
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), `${name}.${kind}`),
    filters: [kind === 'html' ? { name: 'HTML', extensions: ['html'] } : { name: 'PDF', extensions: ['pdf'] }],
  })
  if (r.canceled || !r.filePath) return null
  if (kind === 'html') atomicWrite(r.filePath, html)
  else {
    const pdf = await toPdf(html)
    const tmp = `${r.filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      fs.writeFileSync(tmp, pdf)
      fs.renameSync(tmp, r.filePath)
    } catch (e) {
      fs.rmSync(tmp, { force: true })
      throw e
    }
  }
  return r.filePath
}
