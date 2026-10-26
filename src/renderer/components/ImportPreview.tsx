// Read-only preview of a Markdown folder before it is opened as a vault. Cancel changes nothing.
import { useEffect, useState } from 'react'
import { model } from '../model'
import { api, ImportReport } from '../api'
import { t, tn, type Key } from '../../shared/i18n'

const MAX = 5

export function ImportPreview({ close, folder }: { close: () => void; folder: string }) {
  const [report, setReport] = useState<ImportReport | null>(null)
  const open = () => {
    model.set({ modal: null })
    model.switchVault(() => api.openVault(folder))
  }
  useEffect(() => {
    let live = true
    api.inspectFolder(folder).then(
      (r) => {
        if (!live) return
        if (r.known) open() // already a Synapse vault: nothing new to preview
        else setReport(r)
      },
      (e) => {
        model.error(e)
        close()
      },
    )
    return () => {
      live = false
    }
  }, [folder])
  const name = folder.split('/').filter(Boolean).pop() ?? folder
  const clean = report && !report.unresolvedCount && !report.missingCount && !report.duplicates.length && !report.syntax.length
  const more = (shown: number, total: number) => total > shown && <li className="import-more">{t('import.more', { n: total - shown })}</li>
  return (
    <div className="modal small import-modal" role="dialog" aria-modal="true" aria-label={t('import.title', { name })} data-testid="import-preview" onKeyDown={(e) => e.key === 'Escape' && close()}>
      <div className="modal-title">{t('import.title', { name })}</div>
      {!report ? (
        <p className="modal-text">{t('common.loading')}</p>
      ) : (
        <div className="import-body">
          <p className="modal-text">
            {tn('import.notes', report.notes)} · {tn('import.attachments', report.attachments)} · {tn('import.folders', report.folders)}
          </p>
          <p className="modal-text">{t('import.unchanged')}</p>
          {report.obsidian && <p className="modal-text">{t('import.obsidian')}</p>}
          {clean && <p className="modal-text">{t('import.clean')}</p>}
          {report.unresolvedCount > 0 && (
            <section>
              <div className="pane-subheader">{t('import.unresolved')} <span className="count">{report.unresolvedCount}</span></div>
              <ul>
                {report.unresolved.slice(0, MAX).map((l, i) => <li key={i}><b>{l.target}</b> <span className="import-path">{l.source}</span></li>)}
                {more(Math.min(MAX, report.unresolved.length), report.unresolvedCount)}
              </ul>
            </section>
          )}
          {report.missingCount > 0 && (
            <section>
              <div className="pane-subheader">{t('import.missing')} <span className="count">{report.missingCount}</span></div>
              <ul>
                {report.missing.slice(0, MAX).map((l, i) => <li key={i}><b>{l.target}</b> <span className="import-path">{l.source}</span></li>)}
                {more(Math.min(MAX, report.missing.length), report.missingCount)}
              </ul>
            </section>
          )}
          {report.duplicates.length > 0 && (
            <section>
              <div className="pane-subheader">{t('import.duplicates')} <span className="count">{report.duplicates.length}</span></div>
              <ul>
                {report.duplicates.slice(0, MAX).map((d) => <li key={d.name}><b>{d.name}</b> <span className="import-path">{d.paths.join(', ')}</span></li>)}
                {more(MAX, report.duplicates.length)}
              </ul>
            </section>
          )}
          {report.syntax.length > 0 && (
            <section>
              <div className="pane-subheader">{t('import.syntax')}</div>
              <ul>
                {report.syntax.map((s) => <li key={s.kind}><b>{t(`import.syntax.${s.kind}` as Key)}</b> <span className="import-path">{tn('import.notes', s.count)}: {s.examples.join(', ')}</span></li>)}
              </ul>
            </section>
          )}
        </div>
      )}
      <div className="modal-buttons">
        <button className="btn" onClick={close}>{t('common.cancel')}</button>
        <button className="btn mod-cta" disabled={!report} onClick={open}>{t('import.open')}</button>
      </div>
    </div>
  )
}
