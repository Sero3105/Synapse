// Page preview: hold ⌘ over an internal link, in the editor or the reading view, to read the
// linked note in a floating card without leaving the current one. A click on the card opens it.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { model, isMd } from '../model'
import { linkAt } from './Editor'
import { renderMarkdown } from './Reading'
import { renderMermaid } from '../code'
import { noteTitle } from '../../shared/markdown'

interface Shown { path: string; line?: number; target: string; source: string; rect: DOMRect }

const WIDTH = 460
const HEIGHT = 340

/** The internal link under the pointer: its target as written, the note it is written in, and where it is on screen. */
function linkUnder(el: Element | null, x: number, y: number): Omit<Shown, 'path' | 'line'> | null {
  const source = el?.closest<HTMLElement>('[data-note-path]')?.dataset.notePath
  if (!el || !source) return null
  const a = el.closest<HTMLElement>('a.internal-link')
  if (a?.dataset.href !== undefined) return { target: a.dataset.href, source, rect: a.getBoundingClientRect() }
  // in the editor only over the text of a line, not the empty space after it
  const lineEl = el.closest('.cm-line')
  const editor = el.closest<HTMLElement>('.cm-editor')
  const view = editor && lineEl ? EditorView.findFromDOM(editor) : null
  const pos = view?.posAtCoords({ x, y })
  if (!view || pos == null) return null
  const link = linkAt(view, pos)
  if (link?.kind !== 'wiki') return null
  const c = view.coordsAtPos(pos)
  const rect = el.closest('.cm-lp-link')?.getBoundingClientRect() ?? (c ? new DOMRect(c.left, c.top, 1, c.bottom - c.top) : new DOMRect(x, y, 1, 16))
  return { target: link.target, source, rect }
}

export function HoverPreview() {
  const [shown, setShown] = useState<Shown | null>(null)
  const current = useRef<Shown | null>(null)
  current.current = shown
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let x = -1
    let y = -1
    let hideTimer = 0
    const near = (r: DOMRect) => x >= r.left - 4 && x <= r.right + 4 && y >= r.top - 4 && y <= r.bottom + 4
    const update = (meta: boolean) => {
      const el = x < 0 ? null : document.elementFromPoint(x, y)
      const cur = current.current
      const inCard = !!el && !!box.current?.contains(el)
      const hit = meta && !inCard ? linkUnder(el, x, y) : null
      const to = hit && model.linkTarget(hit.target, hit.source)
      window.clearTimeout(hideTimer)
      if (hit && to && isMd(to.path)) {
        if (!cur || cur.path !== to.path || cur.line !== to.line || cur.source !== hit.source) setShown({ ...hit, ...to })
        return
      }
      // a short grace period lets the pointer travel from the link onto the card
      if (cur && !inCard && !near(cur.rect)) hideTimer = window.setTimeout(() => setShown(null), 300)
    }
    const onMove = (e: MouseEvent) => {
      x = e.clientX
      y = e.clientY
      update(e.metaKey)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Meta') update(true)
      if (e.key === 'Escape') setShown(null)
    }
    const close = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setShown(null)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('mousedown', close, true)
    const hide = () => setShown(null)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', hide)
    return () => {
      window.clearTimeout(hideTimer)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', hide)
    }
  }, [])

  const content = shown ? (model.state.buffers[shown.path]?.content ?? model.index.notes.get(shown.path)?.content ?? '') : ''
  const html = useMemo(() => (shown ? renderMarkdown(content, shown.path) : ''), [shown?.path, content])

  // land on the linked heading or block, as opening the link would; then draw any diagrams
  useLayoutEffect(() => {
    const el = box.current?.querySelector('.markdown-reading')
    if (!el || !shown) return
    let at: Element | null = null
    if (shown.line !== undefined) for (const c of el.querySelectorAll('[data-line]')) if (Number(c.getAttribute('data-line')) <= shown.line) at = c
    el.scrollTop = at ? (at as HTMLElement).offsetTop - 8 : 0
    renderMermaid(el as HTMLElement, document.body.classList.contains('theme-light')).catch(() => {})
  }, [html, shown?.line])

  if (!shown) return null
  const r = shown.rect
  const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8))
  const below = r.bottom + 6 + HEIGHT <= window.innerHeight - 8
  const top = below ? r.bottom + 6 : Math.max(8, r.top - 6 - HEIGHT)
  return (
    <div
      ref={box}
      className="hover-preview"
      style={{ left, top, width: WIDTH, maxHeight: HEIGHT }}
      role="tooltip"
      data-testid="hover-preview"
      onClick={() => {
        setShown(null)
        model.followLink(shown.target, shown.source)
      }}
    >
      <div className="hover-preview-title">{noteTitle(shown.path)}</div>
      <div className="markdown-reading" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
