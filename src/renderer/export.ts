// Export the active note: render it like the reading view, draw Mermaid, hand the HTML to main to save.
import { model, isMd } from './model'
import { api } from './api'
import { renderMarkdown } from './components/Reading'
import { renderMermaid } from './code'
import { basename, noteTitle } from '../shared/markdown'
import { t } from '../shared/i18n'

export async function exportNote(kind: 'html' | 'pdf') {
  const path = model.activeFile
  if (!path || !isMd(path)) return
  await model.ensureBuffer(path)
  const content = model.state.buffers[path]?.content
  if (content === undefined) return
  // PDFs print on white paper, so only HTML follows the app theme
  const dark = kind === 'html' && !document.body.classList.contains('theme-light')
  // Mermaid measures text, so the container must be in the document (hidden, not display:none).
  const box = document.createElement('div')
  box.className = 'markdown-reading'
  box.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;visibility:hidden'
  box.innerHTML = renderMarkdown(content, path)
  document.body.append(box)
  try {
    await renderMermaid(box, !dark)
    // Links into the vault have no meaning outside Synapse: keep their text only. Web links stay links.
    for (const a of box.querySelectorAll<HTMLAnchorElement>('a')) {
      // only schemes that are safe to follow from a standalone file
      if (a.dataset.external && /^(https?|mailto):/i.test(a.dataset.external)) a.href = a.dataset.external
      else a.removeAttribute('href')
    }
    for (const c of box.querySelectorAll<HTMLInputElement>('input.task-checkbox')) c.setAttribute('disabled', '')
    const saved = await api.saveExport(kind, noteTitle(path), box.innerHTML, dark)
    if (saved) model.notice(t('export.saved', { name: basename(saved) }))
  } catch (e) {
    model.error(e)
  } finally {
    box.remove()
  }
}
