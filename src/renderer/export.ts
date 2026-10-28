// Export notes: render them like the reading view, draw Mermaid, hand the HTML to main to save.
import { model, isMd } from './model'
import { api } from './api'
import { renderMarkdown } from './components/Reading'
import { renderMermaid } from './code'
import { basename, noteTitle, relativeHref, headingId } from '../shared/markdown'
import { t } from '../shared/i18n'

/**
 * Render a note to export HTML. Web links stay links; internal links go where `linkTo` says
 * (a URL, or null to keep their text only). Headings get ids so `Note#Heading` links can land on them.
 */
async function renderPage(path: string, content: string, dark: boolean, linkTo: (target: string) => string | null): Promise<string> {
  // Mermaid measures text, so the container must be in the document (hidden, not display:none).
  const box = document.createElement('div')
  box.className = 'markdown-reading'
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;visibility:hidden'
  box.innerHTML = renderMarkdown(content, path)
  document.body.append(box)
  try {
    await renderMermaid(box, !dark)
    for (const a of box.querySelectorAll<HTMLAnchorElement>('a')) {
      // only schemes that are safe to follow from a standalone file
      const href = a.dataset.external ? (/^(https?|mailto):/i.test(a.dataset.external) ? a.dataset.external : null) : a.dataset.href !== undefined ? linkTo(a.dataset.href) : null
      if (href) a.href = href
      else a.removeAttribute('href')
    }
    for (const h of box.querySelectorAll('h1, h2, h3, h4, h5, h6')) if (!h.closest('.markdown-embed')) h.id = headingId(h.textContent ?? '')
    for (const c of box.querySelectorAll<HTMLInputElement>('input.task-checkbox')) c.setAttribute('disabled', '')
    return box.innerHTML
  } finally {
    box.remove()
  }
}

export async function exportNote(kind: 'html' | 'pdf') {
  const path = model.activeFile
  if (!path || !isMd(path)) return
  await model.ensureBuffer(path)
  const content = model.state.buffers[path]?.content
  if (content === undefined) return
  // PDFs print on white paper, so only HTML follows the app theme
  const dark = kind === 'html' && !document.body.classList.contains('theme-light')
  try {
    // links into the vault have no meaning in a single file: keep their text only
    const body = await renderPage(path, content, dark, () => null)
    const saved = await api.saveExport(kind, noteTitle(path), body, dark)
    if (saved) model.notice(t('export.saved', { name: basename(saved) }))
  } catch (e) {
    model.error(e)
  }
}

const htmlPath = (note: string) => note.replace(/\.md$/i, '.html')
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

/** Every note as an HTML page, same folders as the vault, internal links pointing at each other, plus an index. */
export async function exportVault() {
  const vaultName = model.state.snap?.vault?.name ?? 'Vault'
  const notes = [...model.index.notes.keys()].sort((a, b) => a.localeCompare(b))
  // a root note called "index" keeps its name; the generated list moves aside
  const indexFile = notes.some((p) => p.toLowerCase() === 'index.md') ? 'synapse-index.html' : 'index.html'
  const dark = !document.body.classList.contains('theme-light')
  model.notice(t('export.vaultRunning', { n: notes.length }))
  try {
    const pages: { path: string; title: string; body: string }[] = []
    for (const p of notes) {
      const content = model.state.buffers[p]?.content ?? model.index.notes.get(p)!.content
      const body = await renderPage(p, content, dark, (target) => {
        const [linkpath, sub] = target.split('#')
        const r = linkpath ? model.index.resolve(linkpath, p) : p
        if (!r || !isMd(r)) return null // missing notes and attachments: text only
        return (r === p ? '' : relativeHref(htmlPath(p), htmlPath(r))) + (sub ? `#${encodeURIComponent(headingId(sub))}` : '') || '#'
      })
      const nav = `<nav class="export-nav"><a href="${esc(relativeHref(htmlPath(p), indexFile))}">${esc(vaultName)}</a></nav>`
      pages.push({ path: htmlPath(p), title: noteTitle(p), body: nav + body })
    }
    const list = notes.map((p) => `<li><a href="${esc(relativeHref(indexFile, htmlPath(p)))}">${esc(p.replace(/\.md$/i, ''))}</a></li>`).join('\n')
    pages.push({ path: indexFile, title: vaultName, body: `<h1>${esc(vaultName)}</h1>\n<ul class="export-index">\n${list}\n</ul>` })
    const dir = await api.exportVault(vaultName, pages, dark)
    if (dir) model.notice(t('export.vaultSaved', { name: basename(dir), n: notes.length }))
  } catch (e) {
    model.error(e)
  }
}
