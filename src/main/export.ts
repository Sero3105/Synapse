// Export a rendered note to a standalone HTML or PDF file chosen in a save dialog.
// The note itself is never touched; overwriting an existing file is confirmed by the native dialog.
import { app, BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Vault } from './vault'

type Open = { id: string; vault: Vault }
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

type OpenRef = { id: string; vault: Pick<Vault, 'resolve'> }

/**
 * Give every `synapse-file://<vault id>/…` image source the src `use` returns for it. Only regular image files of this
 * vault reach `use`; anything unreadable, outside the vault or from another vault gets an empty src.
 */
function mapImages(html: string, open: OpenRef, use: (rel: string, abs: string, size: number, mime: string) => string): string {
  const cache = new Map<string, string>()
  // only inside <img> tags: in text nodes "<" is escaped, so note prose can never match
  return html.replace(/(<img\b[^>]*?\s)src="synapse-file:\/\/([a-z0-9]+)\/([^"]*)"/g, (_, tag: string, host: string, enc: string) => {
    let src = host === open.id ? cache.get(enc) : ''
    if (src === undefined) {
      src = ''
      try {
        const rel = enc.split('/').map(decodeURIComponent).join('/')
        const mime = MIME[rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()]
        const abs = open.vault.resolve(rel)
        const st = fs.statSync(abs)
        // regular files only: reading a FIFO or device would block the main process
        if (mime && st.isFile()) src = use(rel, abs, st.size, mime)
      } catch { /* unreadable or outside the vault: dropped */ }
      cache.set(enc, src)
    }
    return `${tag}src="${src}"`
  })
}

/** Image sources as data: URIs, for a single standalone file. */
export function inlineImages(html: string, open: OpenRef): string {
  let total = 0
  return mapImages(html, open, (_rel, abs, size, mime) => {
    if (size > MAX_IMAGE || total + size > MAX_IMAGES_TOTAL) return ''
    total += size
    return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`
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
.callout { border-left: 3px solid var(--accent); padding: 0.4em 1em; margin: 1em 0; break-inside: avoid; }
.callout-title { font-weight: 600; color: var(--accent); }
.footnotes { font-size: 0.88em; color: var(--ink-2); }
.markdown-embed-title { font-weight: 600; }
.mermaid { text-align: center; margin: 1em 0; }
.mermaid-error { color: var(--ink-2); font-size: 0.8em; }
.katex-html { display: none; }
.export-nav { font: 13px/1.4 -apple-system, system-ui, sans-serif; margin-bottom: 2em; }
.export-nav a { color: var(--ink-2); text-decoration: none; }
.export-index { padding-left: 1.2em; }
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
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data: https:; style-src 'unsafe-inline'">
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
export async function saveExport(win: BrowserWindow, open: Open, kind: unknown, title: unknown, body: unknown, dark: unknown): Promise<string | null> {
  if (kind !== 'html' && kind !== 'pdf') throw new VaultError('EINVAL', 'Unknown export format')
  if (typeof title !== 'string' || typeof body !== 'string' || body.length > MAX_HTML) throw new VaultError('EINVAL', 'Invalid export')
  const name = title.replace(/[\\/:*?"<>|\0]/g, '-').trim().slice(0, 120) || 'Note'
  const html = exportDocument(name, inlineImages(body, open), dark === true)
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

const MAX_PAGES = 50_000

/** A page path the renderer may ask for: relative, forward slashes, no "." or ".." parts, ending in .html. */
export function validPagePath(p: unknown): p is string {
  return typeof p === 'string' && p.length <= 1024 && p.endsWith('.html') && !p.includes('\\') && !p.includes('\0') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..')
}

/**
 * Write a static site of the vault into a new folder inside `parent`. Returns that folder. Never overwrites anything.
 * Images are copied once, at their vault path next to the pages (pages end in .html, images never do).
 */
export async function writeSite(parent: string, open: OpenRef, name: string, pages: { path: string; title: string; body: string }[], dark: boolean): Promise<string> {
  const base = `${name.replace(/[\\/:*?"<>|\0]/g, '-').trim().slice(0, 100) || 'Vault'} (HTML)`
  let out = path.join(parent, base)
  for (let i = 2; fs.existsSync(out); i++) out = path.join(parent, `${base} ${i}`)
  await fsp.mkdir(out)
  const copied = new Set<string>()
  for (const p of pages) {
    const file = path.join(out, p.path)
    if (!file.startsWith(out + path.sep)) throw new VaultError('EINVAL', 'Invalid export')
    const toRoot = '../'.repeat(p.path.split('/').length - 1)
    const copies: [string, string][] = []
    const body = mapImages(p.body, open, (rel, abs) => {
      if (!copied.has(rel)) copies.push([abs, path.join(out, rel)])
      copied.add(rel)
      return toRoot + rel.split('/').map(encodeURIComponent).join('/')
    })
    for (const [from, to] of copies) {
      await fsp.mkdir(path.dirname(to), { recursive: true })
      await fsp.copyFile(from, to, fs.constants.COPYFILE_EXCL)
    }
    await fsp.mkdir(path.dirname(file), { recursive: true })
    await fsp.writeFile(file, exportDocument(p.title, body, dark), { flag: 'wx' })
  }
  return out
}

/** Asks for a destination folder; returns the created site folder, or null when the user cancelled. */
export async function saveVaultExport(win: BrowserWindow, open: Open, name: unknown, pages: unknown, dark: unknown): Promise<string | null> {
  if (typeof name !== 'string' || !Array.isArray(pages) || pages.length > MAX_PAGES) throw new VaultError('EINVAL', 'Invalid export')
  for (const p of pages) {
    if (!p || !validPagePath(p.path) || typeof p.title !== 'string' || typeof p.body !== 'string' || p.body.length > MAX_HTML) throw new VaultError('EINVAL', 'Invalid export')
  }
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: app.getPath('documents') })
  if (r.canceled || !r.filePaths[0]) return null
  return writeSite(r.filePaths[0], open, name, pages, dark === true)
}
