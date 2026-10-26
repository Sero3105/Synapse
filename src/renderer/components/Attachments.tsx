// Attachment report modal: missing and possibly unused attachments. Report only, nothing is deleted.
import { useMemo } from 'react'
import { model, useModel } from '../model'
import { api } from '../api'
import { attachmentReport } from '../../shared/attachments'
import { basename, noteTitle } from '../../shared/markdown'
import { t } from '../../shared/i18n'

/** Show a file in the navigator's file tree (same steps as "Reveal current file in navigation"). */
function revealInTree(p: string) {
  const parts = p.split('/')
  const expanded: Record<string, boolean> = { ...model.state.expanded }
  for (let i = 1; i < parts.length; i++) expanded[parts.slice(0, i).join('/')] = true
  model.set({ expanded, modal: null })
  model.setLayout({ leftOpen: true, leftTab: 'files' })
  requestAnimationFrame(() => document.querySelector(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'center' }))
}

export function AttachmentsReport({ close }: { close: () => void }) {
  const indexVersion = useModel((s) => s.indexVersion)
  const report = useMemo(() => attachmentReport(model.index), [indexVersion])
  const go = (fn: () => void) => () => {
    model.set({ modal: null })
    fn()
  }
  const fileMenu = (p: string) => (e: React.MouseEvent) =>
    model.openMenu(e, [
      { label: t('attachments.open'), run: go(() => model.open(p, 'new')) },
      { label: t('attachments.revealInTree'), run: () => revealInTree(p) },
      { label: t('common.revealInFinder'), run: () => api.reveal(p).catch((err) => model.error(err)) },
    ])
  return (
    <div className="modal attachments-modal" role="dialog" aria-modal="true" aria-label={t('attachments.title')} data-testid="attachments-report" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="modal-title">{t('attachments.title')}</div>
      <p className="modal-text">{t('attachments.intro')}</p>
      <div className="attachments-body">
        <div className="pane-subheader">
          {t('attachments.missing')} <span className="count">{report.missing.length}</span>
        </div>
        {!report.missing.length && <div className="pane-empty">{t('attachments.noMissing')}</div>}
        {report.missing.map((m, i) => (
          <div key={i} className="search-result" data-testid="missing-attachment">
            <div className="search-result-file" title={t('attachments.missingWhy')} onClick={go(() => model.open(m.source, 'tab', { line: m.line, mode: 'source' }))}>
              <span>{m.target}</span>
            </div>
            <div className="search-result-match" onClick={go(() => model.open(m.source, 'tab', { line: m.line, mode: 'source' }))}>
              {t('attachments.inNote', { note: noteTitle(m.source), line: m.line + 1 })}
            </div>
          </div>
        ))}
        <div className="pane-subheader">
          {t('attachments.unused')} <span className="count">{report.unused.length}</span>
        </div>
        {!report.unused.length && <div className="pane-empty">{t('attachments.noUnused')}</div>}
        {report.unused.map((u) => (
          <div key={u.path} className="search-result" data-testid="unused-attachment">
            <div className="search-result-file" title={u.path} onClick={go(() => model.open(u.path, 'new'))} onContextMenu={fileMenu(u.path)}>
              <span>{basename(u.path)}</span>
            </div>
            <div className="search-result-match" onClick={() => revealInTree(u.path)}>
              {u.path.includes('/') ? `${u.path.slice(0, u.path.lastIndexOf('/'))} · ` : ''}
              {t('attachments.unusedWhy')}
            </div>
          </div>
        ))}
      </div>
      <div className="modal-buttons">
        <button className="btn" onClick={close}>{t('common.close')}</button>
      </div>
    </div>
  )
}
