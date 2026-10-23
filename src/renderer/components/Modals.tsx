import { useEffect, useMemo, useRef, useState } from 'react'
import { FolderOpen, FolderPlus, AlertTriangle, X } from 'lucide-react'
import { model, useModel, Modal, isMd } from '../model'
import { api } from '../api'
import { COMMANDS, hotkeysFor, formatHotkey, runCommand } from '../commands'
import { fuzzyScore, noteTitle, INVALID_NAME } from '../../shared/markdown'
import { SettingsModal } from './Settings'
import { t, commandName } from '../../shared/i18n'

/** Left-to-right mark: keeps a path's leading "/" in place inside the rtl (start-truncated) path boxes. */
const LRM = '\u200E'

export function Modals() {
  const modal = useModel((s) => s.modal)
  const close = () => {
    const m = model.state.modal
    if (m?.kind === 'prompt') m.resolve(null)
    if (m?.kind === 'confirm') m.resolve(false)
    model.set({ modal: null })
  }
  // Escape closes any modal even when focus has left it (e.g. after a language switch remount).
  useEffect(() => {
    if (!modal) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.hotkey-capture')) return
      if ((e.target as HTMLElement | null)?.closest?.('.modal')) return // the modal's own handler runs
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [modal])
  if (!modal) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      {modal.kind === 'palette' && <Palette close={close} />}
      {modal.kind === 'switcher' && <Switcher close={close} />}
      {modal.kind === 'prompt' && <Prompt modal={modal} />}
      {modal.kind === 'confirm' && <Confirm modal={modal} />}
      {modal.kind === 'settings' && <SettingsModal close={close} initialTab={modal.tab} />}
      {modal.kind === 'vaults' && (
        <div className="modal vault-modal" role="dialog" aria-modal="true" aria-label={t('vaults.manage')} onKeyDown={(e) => e.key === 'Escape' && close()}>
          <button className="icon-btn modal-close" aria-label={t('common.close')} onClick={close}>
            <X size={16} />
          </button>
          <VaultManager />
        </div>
      )}
    </div>
  )
}

interface Item { key: string; label: string; detail?: string; hint?: string; run: (e: { metaKey: boolean }) => void }

function Picker({ items, placeholder, close, empty, onEnterEmpty, instructions }: { items: (q: string) => Item[]; placeholder: string; close: () => void; empty: string; onEnterEmpty?: (q: string) => void; instructions: string }) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const list = useMemo(() => items(q), [q])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  const choose = (i: number, e: { metaKey: boolean }) => {
    const it = list[i]
    if (!it) {
      if (onEnterEmpty && q.trim()) {
        model.set({ modal: null })
        onEnterEmpty(q.trim())
      }
      return
    }
    model.set({ modal: null })
    it.run(e)
  }
  return (
    <div className="modal prompt" role="dialog" aria-modal="true" aria-label={placeholder}>
      <input
        className="prompt-input"
        autoFocus
        placeholder={placeholder}
        value={q}
        aria-activedescendant={list[sel] ? `opt-${sel}` : undefined}
        aria-controls="prompt-results"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
            e.preventDefault()
            setSel(Math.min(sel + 1, list.length - 1))
          } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
            e.preventDefault()
            setSel(Math.max(sel - 1, 0))
          } else if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey && onEnterEmpty && q.trim()) {
              model.set({ modal: null })
              onEnterEmpty(q.trim())
            } else choose(sel, e)
          }
        }}
      />
      <div className="prompt-results" id="prompt-results" role="listbox" ref={listRef}>
        {list.map((it, i) => (
          <div key={it.key} id={`opt-${i}`} role="option" aria-selected={i === sel} className={`suggestion-item${i === sel ? ' is-selected' : ''}`} onMouseMove={() => setSel(i)} onClick={(e) => choose(i, e)}>
            <div className="suggestion-content">
              <div className="suggestion-title">{it.label}</div>
              {it.detail && <div className="suggestion-note">{it.detail}</div>}
            </div>
            {it.hint && <kbd className="suggestion-hotkey">{it.hint}</kbd>}
          </div>
        ))}
        {!list.length && <div className="suggestion-empty">{empty}</div>}
      </div>
      <div className="prompt-instructions">{instructions}</div>
    </div>
  )
}

function Palette({ close }: { close: () => void }) {
  return (
    <Picker
      close={close}
      placeholder={t('palette.placeholder')}
      empty={t('palette.empty')}
      instructions={t('palette.help')}
      items={(q) =>
        COMMANDS.filter((c) => !c.when || c.when())
          .map((c) => ({ c, s: fuzzyScore(q, commandName(c.id, c.name)) }))
          .filter((x) => x.s >= 0)
          .sort((a, b) => (q ? b.s - a.s : commandName(a.c.id, a.c.name).localeCompare(commandName(b.c.id, b.c.name))))
          .map(({ c }) => ({ key: c.id, label: commandName(c.id, c.name), hint: hotkeysFor(c.id).map(formatHotkey)[0], run: () => runCommand(c.id) }))
      }
    />
  )
}

function Switcher({ close }: { close: () => void }) {
  return (
    <Picker
      close={close}
      placeholder={t('switcher.placeholder')}
      empty={t('switcher.empty')}
      instructions={t('switcher.help')}
      onEnterEmpty={(q) => {
        if (INVALID_NAME.test(q.split('/').pop()!)) return model.notice(t('switcher.invalid'), true)
        model.createNote({ path: q.endsWith('.md') ? q : `${q}.md` })
      }}
      items={(q) => {
        const files = model.state.files.filter((f) => f.type === 'file')
        if (!q) {
          // recent: files from open tabs' history first
          const recent = new Set<string>()
          for (const p of model.state.ws.panes) for (const t of p.tabs) [...t.back].reverse().concat(t.path ? [t.path] : []).forEach((x) => recent.add(x))
          const rest = files.map((f) => f.path).filter((p) => !recent.has(p))
          return [...recent, ...rest].slice(0, 100).map((p) => toItem(p))
        }
        return files
          .map((f) => {
            const title = fuzzyScore(q, isMd(f.path) ? noteTitle(f.path) : f.path)
            // a title match ranks above a match that only spans the folder path
            return { p: f.path, s: title >= 0 ? title + 5 : fuzzyScore(q, f.path) }
          })
          .filter((x) => x.s >= 0)
          .sort((a, b) => b.s - a.s)
          .slice(0, 100)
          .map(({ p }) => toItem(p))
      }}
    />
  )
}

const toItem = (p: string): Item => ({
  key: p,
  label: isMd(p) ? noteTitle(p) : p.slice(p.lastIndexOf('/') + 1),
  detail: p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : undefined,
  run: (e) => model.open(p, e.metaKey ? 'new' : 'tab'),
})

function Prompt({ modal }: { modal: Extract<Modal, { kind: 'prompt' }> }) {
  const [value, setValue] = useState(modal.value)
  const done = (v: string | null) => {
    model.set({ modal: null })
    modal.resolve(v)
  }
  return (
    <form
      className="modal small"
      role="dialog"
      aria-modal="true"
      aria-label={modal.title}
      onSubmit={(e) => {
        e.preventDefault()
        done(value.trim() || null)
      }}
      onKeyDown={(e) => e.key === 'Escape' && done(null)}
    >
      <div className="modal-title">{modal.title}</div>
      <input className="text-input wide" autoFocus value={value} onFocus={(e) => e.target.select()} onChange={(e) => setValue(e.target.value)} aria-label={modal.title} />
      <div className="modal-buttons">
        <button type="button" className="btn" onClick={() => done(null)}>{t('common.cancel')}</button>
        <button type="submit" className="btn mod-cta">{modal.okText ?? t('common.save')}</button>
      </div>
    </form>
  )
}

function Confirm({ modal }: { modal: Extract<Modal, { kind: 'confirm' }> }) {
  const done = (ok: boolean) => {
    model.set({ modal: null })
    modal.resolve(ok)
  }
  return (
    <div className="modal small" role="alertdialog" aria-modal="true" aria-label={modal.title} onKeyDown={(e) => e.key === 'Escape' && done(false)}>
      <div className="modal-title">{modal.title}</div>
      <p className="modal-text">{modal.message}</p>
      <div className="modal-buttons">
        <button className="btn" onClick={() => done(false)}>{t('common.cancel')}</button>
        <button className={`btn ${modal.danger ? 'mod-warning' : 'mod-cta'}`} autoFocus onClick={() => done(true)}>
          {modal.okText}
        </button>
      </div>
    </div>
  )
}

/** Vault list + open/create. Used as the starter screen and the "Manage vaults" modal. */
export function VaultManager() {
  const vaults = useModel((s) => s.snap?.vaults ?? [])
  const currentId = useModel((s) => s.snap?.vault?.id)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [parent, setParent] = useState<string | null>(null)

  const open = (fn: () => Promise<unknown>) => model.switchVault(fn)
  const create = async () => {
    if (!parent || !name.trim()) return
    await open(() => api.createVault(parent, name.trim()))
    setCreating(false)
  }
  const nameError = name.trim() && (INVALID_NAME.test(name) || name.trim().startsWith('.')) ? t('common.invalidName') : null

  return (
    <div className="vault-manager" data-testid="vault-manager">
      <section className="vm-intro">
        <div className="vm-mark" aria-hidden>
          <span /><span /><span />
        </div>
        <h1 className="vm-wordmark">Synapse</h1>
        <p className="vm-statement">{t('vaults.statement')}</p>
        {!creating ? (
          <div className="vm-actions">
            <button className="vm-action" onClick={() => setCreating(true)}>
              <FolderPlus size={17} />
              <span>
                <span className="vm-action-title">{t('vaults.create')}</span>
                <span className="vm-action-desc">{t('vaults.createDesc')}</span>
              </span>
            </button>
            <button
              className="vm-action"
              onClick={async () => {
                const p = await api.pickFolder(t('vaults.openDialog'))
                if (p) open(() => api.openVault(p))
              }}
            >
              <FolderOpen size={17} />
              <span>
                <span className="vm-action-title">{t('vaults.open')}</span>
                <span className="vm-action-desc">{t('vaults.openDesc')}</span>
              </span>
            </button>
          </div>
        ) : (
          <form
            className="vm-create"
            onSubmit={(e) => {
              e.preventDefault()
              if (!nameError) create()
            }}
          >
            <label className="field">
              <span>{t('vaults.name')}</span>
              <input className="text-input wide" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={t('vaults.namePlaceholder')} aria-invalid={!!nameError} />
              {nameError && <span className="field-error">{nameError}</span>}
            </label>
            <div className="field">
              <span>{t('vaults.location')}</span>
              <div className="row">
                <span className="path-display" title={parent ?? undefined}>{parent ? LRM + parent : t('vaults.noFolder')}</span>
                <button type="button" className="btn" onClick={async () => setParent((await api.pickFolder(t('vaults.chooseDialog'))) ?? parent)}>
                  {t('vaults.choose')}
                </button>
              </div>
            </div>
            <div className="modal-buttons">
              <button type="button" className="btn" onClick={() => setCreating(false)}>{t('common.back')}</button>
              <button type="submit" className="btn mod-cta" disabled={!parent || !name.trim() || !!nameError}>{t('vaults.createButton')}</button>
            </div>
          </form>
        )}
      </section>
      <section className="vm-list" aria-label={t('vaults.recent')}>
        <h2 className="vm-list-title">{t('vaults.recent')}</h2>
        {!vaults.length && <p className="vm-list-empty">{t('vaults.recentEmpty')}</p>}
        {vaults.map((v) => (
          <div
            key={v.id}
            className={`vault-row${v.id === currentId ? ' is-active' : ''}${v.available ? '' : ' is-missing'}`}
            // a missing vault's row holds its own buttons, so it is not itself a button
            tabIndex={v.available ? 0 : undefined}
            role={v.available ? 'button' : 'group'}
            aria-label={v.available ? undefined : t('vaults.notFoundLabel', { name: v.name })}
            onClick={() => v.available && v.id !== currentId && open(() => api.openVaultId(v.id))}
            onKeyDown={(e) => e.key === 'Enter' && v.available && v.id !== currentId && open(() => api.openVaultId(v.id))}
            onContextMenu={(e) =>
              model.openMenu(e, [
                { label: t('vaults.removeFromList'), disabled: v.id === currentId, run: () => api.removeVault(v.id).catch((err) => model.error(err)) },
              ])
            }
          >
            <span className="vault-mark" aria-hidden>{[...v.name][0]?.toUpperCase()}</span>
            <span className="vault-row-text">
              <span className="vault-row-name">
                {v.name}
                {v.id === currentId && <span className="vault-row-current">{t('vaults.current')}</span>}
              </span>
              <span className="vault-row-path" title={v.path}>{v.available ? LRM + v.path : t('vaults.notFound', { path: v.path })}</span>
              {!v.available && (
                <span className="vault-row-actions">
                  <button className="btn small" onClick={(e) => { e.stopPropagation(); open(() => api.locateVault(v.id)) }}>{t('vaults.locate')}</button>
                  <button className="btn small" onClick={(e) => { e.stopPropagation(); api.removeVault(v.id).catch((err) => model.error(err)) }}>{t('vaults.removeFromList')}</button>
                </span>
              )}
            </span>
            {!v.available && <AlertTriangle size={14} className="warn-icon" aria-label={t('vaults.unavailable')} />}
          </div>
        ))}
      </section>
    </div>
  )
}

export function ContextMenu() {
  const menu = useModel((s) => s.menu)
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  useEffect(() => {
    if (!menu) return
    const el = ref.current!
    const r = el.getBoundingClientRect()
    setPos({ x: Math.min(menu.x, window.innerWidth - r.width - 4), y: Math.min(menu.y, window.innerHeight - r.height - 4) })
    el.querySelector<HTMLElement>('.menu-item:not([aria-disabled="true"])')?.focus()
    const close = () => model.set({ menu: null })
    const onDown = (e: MouseEvent) => !el.contains(e.target as Node) && close()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [menu])
  if (!menu) return null
  return (
    <div
      className="menu"
      role="menu"
      ref={ref}
      style={{ left: pos.x || menu.x, top: pos.y || menu.y }}
      onKeyDown={(e) => {
        const items = [...ref.current!.querySelectorAll<HTMLElement>('.menu-item:not([aria-disabled="true"])')]
        const i = items.indexOf(document.activeElement as HTMLElement)
        if (e.key === 'Escape') model.set({ menu: null })
        if (e.key === 'ArrowDown') items[(i + 1) % items.length]?.focus()
        if (e.key === 'ArrowUp') items[(i - 1 + items.length) % items.length]?.focus()
      }}
    >
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-separator" role="separator" />
        ) : (
          <div
            key={i}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={it.disabled}
            className={`menu-item${it.danger ? ' is-warning' : ''}${it.disabled ? ' is-disabled' : ''}`}
            onClick={() => {
              if (it.disabled) return
              model.set({ menu: null })
              it.run?.()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !it.disabled) {
                model.set({ menu: null })
                it.run?.()
              }
            }}
          >
            {it.label}
          </div>
        ),
      )}
    </div>
  )
}

export function Notices() {
  const notices = useModel((s) => s.notices)
  const update = useModel((s) => s.update)
  return (
    <div className="notice-container" aria-live="polite">
      {update && (
        <div className="notice update-notice" role="status" data-testid="update-notice">
          <div className="update-title">{t('update.available', { version: update.version })}</div>
          <div className="update-desc">{t('update.desc')}</div>
          <div className="update-actions">
            <button className="btn" onClick={() => model.set({ update: null })}>{t('update.later')}</button>
            <button
              className="btn mod-cta"
              onClick={() => {
                api.openExternal(update.url).catch((e) => model.error(e))
                model.set({ update: null })
              }}
            >
              {t('update.download')}
            </button>
          </div>
        </div>
      )}
      {notices.map((n) => (
        <div key={n.id} className={`notice${n.error ? ' is-error' : ''}`} role={n.error ? 'alert' : 'status'} onClick={() => model.set({ notices: model.state.notices.filter((x) => x.id !== n.id) })}>
          {n.text}
        </div>
      ))}
    </div>
  )
}
