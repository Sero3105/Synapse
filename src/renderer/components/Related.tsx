// Related notes for the active note, shown in the Backlinks panel. Computed only while expanded.
import { useMemo, useState } from 'react'
import { ChevronRight, X } from 'lucide-react'
import { model, useModel } from '../model'
import { noteTitle, shortestLinkText } from '../../shared/markdown'
import { relatedNotes, RelatedNote } from '../../shared/related'
import { t } from '../../shared/i18n'

const list = (xs: string[]) => xs.slice(0, 3).join(', ') + (xs.length > 3 ? '…' : '')

function reason(r: RelatedNote) {
  const parts: string[] = []
  if (r.tags.length) parts.push(t('related.tags', { list: list(r.tags) }))
  if (r.via.length) parts.push(t('related.via', { list: list(r.via.map(noteTitle)) }))
  if (r.titleWords.length) parts.push(t('related.title', { list: list(r.titleWords) }))
  if (r.terms.length) parts.push(t('related.terms', { list: list(r.terms) }))
  return parts.join(' · ')
}

/** Insert a wiki link to `target` at the cursor, only when the active editor shows `path`. */
function insertLink(path: string, target: string) {
  const v = model.activeEditor
  if (!v || model.activeFile !== path) return
  v.dispatch(v.state.replaceSelection(`[[${shortestLinkText(target, model.index.lookup)}]]`))
  v.focus()
}

export function RelatedNotes({ path }: { path: string }) {
  const [open, setOpen] = useState(false)
  const indexVersion = useModel((s) => s.indexVersion)
  const dismissed = useModel((s) => s.dismissedRelated)
  const items = useMemo(() => (open ? relatedNotes(model.index, path, { dismissed: new Set(dismissed) }) : []), [open, path, indexVersion, dismissed])
  return (
    <div data-testid="related">
      <button className="pane-subheader collapsible" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ChevronRight size={14} className={`tree-chevron${open ? ' is-open' : ''}`} /> {t('related.heading')} {open && <span className="count">{items.length}</span>}
      </button>
      {open && !items.length && <div className="pane-empty">{t('related.none')}</div>}
      {items.map((r) => (
        <div
          key={r.path}
          className="search-result"
          onContextMenu={(e) =>
            model.openMenu(e, [
              { label: t('files.openNewTab'), run: () => model.open(r.path, 'new') },
              { label: t('related.insertLink'), disabled: !model.activeEditor || model.activeFile !== path, run: () => insertLink(path, r.path) },
              { separator: true, label: '' },
              { label: t('related.dismiss'), run: () => model.dismissRelated(path, r.path) },
            ])
          }
        >
          <div className="search-result-file" onClick={(e) => model.open(r.path, e.metaKey ? 'new' : 'tab')}>
            <span>{noteTitle(r.path)}</span>
            <button className="icon-btn related-dismiss" aria-label={t('related.dismiss')} title={t('related.dismiss')} onClick={(e) => (e.stopPropagation(), model.dismissRelated(path, r.path))}>
              <X size={13} />
            </button>
          </div>
          <div className="search-result-match related-reason">{reason(r)}</div>
        </div>
      ))}
    </div>
  )
}
