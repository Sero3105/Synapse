import { useEffect, useState } from 'react'
import { X, RotateCcw, Trash2, ChevronDown, Plus } from 'lucide-react'
import { model, useModel } from '../model'
import { api, type CustomFont } from '../api'
import { COMMANDS, hotkeysFor, formatHotkey, eventToHotkey } from '../commands'
import { FONT_GROUPS, isInstalled, loadCustomFonts, unloadableFonts } from '../fonts'
import { Prefs, CORE_PLUGINS, DEFAULT_PREFS } from '../../shared/settings'
import { t, tn, Key, LANGUAGES, LanguagePref, commandName } from '../../shared/i18n'

const TABS = ['general', 'editor', 'files', 'appearance', 'hotkeys', 'plugins', 'vault'] as const

export function SettingsModal({ close, initialTab }: { close: () => void; initialTab?: string }) {
  const [tab, setTabState] = useState(initialTab ?? 'editor')
  // remember the section in the modal state so a language switch (which remounts) stays on it
  const setTab = (id: string) => {
    setTabState(id)
    model.set({ modal: { kind: 'settings', tab: id } })
  }
  const hasVault = useModel((s) => !!s.snap?.vault)
  return (
    <div className="modal settings-modal" role="dialog" aria-modal="true" tabIndex={-1} ref={(el) => {
        if (el && !el.contains(document.activeElement)) el.focus()
      }} aria-label={t('settings.title')} onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.hotkey-capture') && close()}>
      <button className="icon-btn modal-close" aria-label={t('settings.close')} onClick={close}>
        <X size={16} />
      </button>
      <nav className="settings-nav" aria-label={t('settings.sections')}>
        <div className="settings-nav-group">{t('settings.title')}</div>
        {TABS.filter((id) => hasVault || id !== 'vault').map((id) => (
          <button key={id} className={`settings-nav-item${tab === id ? ' is-active' : ''}`} aria-current={tab === id} onClick={() => setTab(id)}>
            {t(`settings.tab.${id}` as Key)}
          </button>
        ))}
      </nav>
      <div className="settings-content" tabIndex={-1}>
        {tab === 'general' && <General />}
        {tab === 'editor' && <EditorTab />}
        {tab === 'files' && <FilesTab />}
        {tab === 'appearance' && <AppearanceTab />}
        {tab === 'hotkeys' && <HotkeysTab />}
        {tab === 'plugins' && <PluginsTab />}
        {tab === 'vault' && hasVault && <VaultTab />}
      </div>
    </div>
  )
}

/**
 * One preference row. Edits go to the GLOBAL layer unless the open vault overrides this key,
 * in which case they go to the vault layer. The scope selector toggles the override.
 */
function PrefRow<K extends keyof Prefs>({ k, name, desc, children }: { k: K; name: string; desc?: string; children: (value: Prefs[K], set: (v: Prefs[K]) => void) => React.ReactNode }) {
  const snap = useModel((s) => s.snap!)
  const value = snap.prefs[k]
  const overridden = !!snap.vault && snap.vault.settings.overrides[k] !== undefined
  const set = (v: Prefs[K]) => (overridden ? model.setVault({ overrides: { [k]: v } }) : model.setGlobal({ prefs: { [k]: v } as Partial<Prefs> }))
  return (
    <div className="setting-item" data-setting={k}>
      <div className="setting-info">
        <div className="setting-name">{name}</div>
        {desc && <div className="setting-desc">{desc}</div>}
      </div>
      <div className="setting-control">
        {children(value, set)}
        {snap.vault && (
          <select
            className="scope-select"
            aria-label={t('settings.scopeFor', { name })}
            title={t('settings.scopeTitle')}
            value={overridden ? 'vault' : 'global'}
            onChange={(e) => model.setVault({ overrides: { [k]: e.target.value === 'vault' ? value : null } })}
          >
            <option value="global">{t('settings.scopeAll')}</option>
            <option value="vault">{t('settings.scopeVault')}</option>
          </select>
        )}
      </div>
    </div>
  )
}

const Toggle = ({ value, set, label }: { value: boolean; set: (v: boolean) => void; label: string }) => (
  <button role="switch" aria-checked={value} aria-label={label} className={`toggle${value ? ' is-on' : ''}`} onClick={() => set(!value)}>
    <span className="toggle-knob" />
  </button>
)

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="setting-heading">{children}</div>
}

function ScopeNote() {
  const hasVault = useModel((s) => !!s.snap?.vault)
  return (
    <p className="settings-note">
      {t('settings.scopeNote')}
      {hasVault && ' ' + t('settings.scopeNoteVault')}
    </p>
  )
}

function General() {
  const snap = useModel((s) => s.snap!)
  return (
    <>
      <Heading>{t('settings.tab.general')}</Heading>
      <div className="setting-item" data-setting="language">
        <div className="setting-info">
          <div className="setting-name">{t('settings.language')}</div>
          <div className="setting-desc">{t('settings.languageDesc')}</div>
        </div>
        <div className="setting-control">
          <select className="dropdown" aria-label={t('settings.language')} value={snap.global.language} onChange={(e) => model.setGlobal({ language: e.target.value as LanguagePref })}>
            <option value="system">{t('settings.languageSystem')}</option>
            {LANGUAGES.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t('settings.currentVault')}</div>
          <div className="setting-desc">{snap.vault ? snap.vault.path : t('settings.noVault')}</div>
        </div>
        <div className="setting-control">
          <button className="btn" onClick={() => model.set({ modal: { kind: 'vaults' } })}>{t('settings.manageVaults')}</button>
          {snap.vault && (
            <button className="btn" onClick={() => model.switchVault(() => api.closeVault())}>
              {t('settings.closeVault')}
            </button>
          )}
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t('settings.storage')}</div>
          <div className="setting-desc">
            {t('settings.storageGlobal')}
            <br />
            {t('settings.storageVault')}
          </div>
        </div>
      </div>
      <PrefRow k="promptDelete" name={t('settings.promptDelete')} desc={t('settings.promptDeleteDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.promptDelete')} />}
      </PrefRow>
      <div className="setting-item" data-setting="checkUpdates">
        <div className="setting-info">
          <div className="setting-name">{t('settings.checkUpdates')}</div>
          <div className="setting-desc">{t('settings.checkUpdatesDesc')}</div>
        </div>
        <div className="setting-control">
          <Toggle value={snap.global.checkUpdates} set={(v) => model.setGlobal({ checkUpdates: v })} label={t('settings.checkUpdates')} />
        </div>
      </div>
    </>
  )
}

function EditorTab() {
  return (
    <>
      <Heading>{t('settings.tab.editor')}</Heading>
      <ScopeNote />
      <PrefRow k="defaultViewMode" name={t('settings.defaultView')} desc={t('settings.defaultViewDesc')}>
        {(v, set) => (
          <select className="dropdown" value={v} onChange={(e) => set(e.target.value as Prefs['defaultViewMode'])} aria-label={t('settings.defaultView')}>
            <option value="source">{t('settings.editingView')}</option>
            <option value="preview">{t('settings.readingView')}</option>
          </select>
        )}
      </PrefRow>
      <PrefRow k="livePreview" name={t('settings.livePreview')} desc={t('settings.livePreviewDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.livePreview')} />}
      </PrefRow>
      <PrefRow k="readableLineLength" name={t('settings.readable')} desc={t('settings.readableDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.readable')} />}
      </PrefRow>
      <PrefRow k="showInlineTitle" name={t('settings.inlineTitle')} desc={t('settings.inlineTitleDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.inlineTitle')} />}
      </PrefRow>
      <PrefRow k="showLineNumber" name={t('settings.lineNumbers')} desc={t('settings.lineNumbersDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.lineNumbers')} />}
      </PrefRow>
      <PrefRow k="spellcheck" name={t('settings.spellcheck')} desc={t('settings.spellcheckDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.spellcheck')} />}
      </PrefRow>
      <PrefRow k="autoPairBrackets" name={t('settings.autoPair')} desc={t('settings.autoPairDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.autoPair')} />}
      </PrefRow>
      <PrefRow k="tabSize" name={t('settings.tabSize')} desc={t('settings.tabSizeDesc')}>
        {(v, set) => <NumberSlider value={v} set={set} min={1} max={8} label={t('settings.tabSize')} />}
      </PrefRow>
    </>
  )
}

function FilesTab() {
  return (
    <>
      <Heading>{t('settings.tab.files')}</Heading>
      <ScopeNote />
      <PrefRow k="newFileLocation" name={t('settings.newLocation')}>
        {(v, set) => (
          <select className="dropdown" value={v} onChange={(e) => set(e.target.value as Prefs['newFileLocation'])} aria-label={t('settings.newLocation')}>
            <option value="root">{t('settings.newLocationRoot')}</option>
            <option value="current">{t('settings.newLocationCurrent')}</option>
          </select>
        )}
      </PrefRow>
      <PrefRow k="updateLinksOnRename" name={t('settings.updateLinks')} desc={t('settings.updateLinksDesc')}>
        {(v, set) => <Toggle value={v} set={set} label={t('settings.updateLinks')} />}
      </PrefRow>
    </>
  )
}

function AppearanceTab() {
  return (
    <>
      <Heading>{t('settings.tab.appearance')}</Heading>
      <ScopeNote />
      <PrefRow k="theme" name={t('settings.theme')} desc={t('settings.themeDesc')}>
        {(v, set) => (
          <select className="dropdown" value={v} onChange={(e) => set(e.target.value as Prefs['theme'])} aria-label={t('settings.theme')}>
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        )}
      </PrefRow>
      <PrefRow k="accentColor" name={t('settings.accent')} desc={t('settings.accentDesc')}>
        {(v, set) => (
          <>
            <input type="color" className="color-input" value={v} onChange={(e) => set(e.target.value)} aria-label={t('settings.accent')} />
            <button className="icon-btn" aria-label={t('settings.accentReset')} onClick={() => set(DEFAULT_PREFS.accentColor)}>
              <RotateCcw size={14} />
            </button>
          </>
        )}
      </PrefRow>
      <Heading>{t('settings.font')}</Heading>
      <PrefRow k="fontSize" name={t('settings.fontSize')} desc={t('settings.fontSizeDesc')}>
        {(v, set) => <NumberSlider value={v} set={set} min={10} max={30} label={t('settings.fontSize')} />}
      </PrefRow>
      <PrefRow k="interfaceFontSize" name={t('settings.uiFontSize')} desc={t('settings.uiFontSizeDesc')}>
        {(v, set) => <NumberSlider value={v} set={set} min={11} max={18} label={t('settings.uiFontSize')} />}
      </PrefRow>
      <FontSetting k="textFont" kind="text" name={t('settings.textFont')} desc={t('settings.textFontDesc')} />
      <FontSetting k="monoFont" kind="mono" name={t('settings.monoFont')} desc={t('settings.monoFontDesc')} />
    </>
  )
}

/** Font family picker: installed curated families with live previews, plus fonts the user added. */
function FontSetting({ k, kind, name, desc }: { k: 'textFont' | 'monoFont'; kind: 'text' | 'mono'; name: string; desc: string }) {
  const snap = useModel((s) => s.snap!)
  const value = snap.prefs[k]
  const overridden = !!snap.vault && snap.vault.settings.overrides[k] !== undefined
  const set = (v: string) => (overridden ? model.setVault({ overrides: { [k]: v } }) : model.setGlobal({ prefs: { [k]: v } }))
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [custom, setCustom] = useState<CustomFont[]>([])
  useEffect(() => {
    loadCustomFonts().then(setCustom).catch((e) => model.error(e))
  }, [])
  const q = query.trim().toLowerCase()
  const match = (f: string) => !q || f.toLowerCase().includes(q)
  const groups = (kind === 'text'
    ? ([['serif', FONT_GROUPS.serif], ['sans', FONT_GROUPS.sans], ['display', FONT_GROUPS.display]] as const)
    : ([['mono', FONT_GROUPS.mono]] as const)
  ).map(([id, fams]) => ({ id, fams: fams.filter((f) => match(f) && (f === value || isInstalled(f))) }))
  const customShown = custom.filter((f) => match(f.family))
  const shownFamilies = new Set([...groups.flatMap((g) => g.fams), ...customShown.map((f) => f.family)])
  const sample = kind === 'mono' ? t('fonts.sampleMono') : t('fonts.sample')
  const generic = kind === 'mono' ? 'monospace' : 'serif'
  const defaultLabel = kind === 'mono' ? t('fonts.defaultMono') : t('fonts.defaultText')

  const addFonts = async () => {
    try {
      const r = await api.addFonts()
      setCustom(await loadCustomFonts())
      if (r.added.length) model.notice(tn('fonts.added', r.added.length))
      for (const name of r.rejected) model.notice(t('fonts.rejected', { name }), true)
    } catch (e) {
      model.error(e)
    }
  }
  const removeFont = async (f: CustomFont) => {
    const ok = await model.confirm(t('fonts.removeTitle'), t('fonts.removeBody', { name: f.family }), t('fonts.removeOk'))
    if (!ok) return
    try {
      await api.removeFont(f.id)
      setCustom(await loadCustomFonts())
    } catch (e) {
      model.error(e)
    }
  }
  const row = (family: string, label = family) => (
    <button key={family} className={`font-row${value === family ? ' is-active' : ''}`} aria-pressed={value === family} onClick={() => set(family)}>
      <span className="font-row-name">{label}</span>
      <span className="font-row-sample" style={{ fontFamily: `"${family}", ${generic}` }}>{sample}</span>
    </button>
  )

  return (
    <div data-setting={k}>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{name}</div>
          <div className="setting-desc">{desc}</div>
        </div>
        <div className="setting-control">
          <span className="font-current">{value || defaultLabel}</span>
          <button className={`btn small font-choose-btn${open ? ' is-open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? t('fonts.change') : t('fonts.choose')}
            <ChevronDown size={13} aria-hidden />
          </button>
          {snap.vault && (
            <select
              className="scope-select"
              aria-label={t('settings.scopeFor', { name })}
              title={t('settings.scopeTitle')}
              value={overridden ? 'vault' : 'global'}
              onChange={(e) => model.setVault({ overrides: { [k]: e.target.value === 'vault' ? value : null } })}
            >
              <option value="global">{t('settings.scopeAll')}</option>
              <option value="vault">{t('settings.scopeVault')}</option>
            </select>
          )}
        </div>
      </div>
      {open && (
        <div className="font-picker">
          <div className="font-picker-bar">
            <input className="text-input" type="search" value={query} placeholder={t('fonts.search')} aria-label={t('fonts.search')} onChange={(e) => setQuery(e.target.value)} />
            <button className="btn font-add-btn" onClick={addFonts}>
              <Plus size={14} aria-hidden />
              {t('fonts.add')}
            </button>
          </div>
          <p className="settings-note">{t('fonts.addHint')}</p>
          <p className="settings-note">{t('fonts.detectNote')}</p>
          <div className="font-group-name">{defaultLabel}</div>
          {row('', defaultLabel)}
          {value && !shownFamilies.has(value) && (
            <>
              <div className="font-group-name">{t('fonts.current')}</div>
              {row(value)}
            </>
          )}
          {customShown.length > 0 && (
            <>
              <div className="font-group-name">{t('fonts.yours')}</div>
              {customShown.map((f) => (
                <div key={f.id} className={`font-row${value === f.family ? ' is-active' : ''}`}>
                  <button className="font-row-main" aria-pressed={value === f.family} onClick={() => set(f.family)}>
                    <span className="font-row-name">{f.family} {f.weight}{f.style === 'italic' ? ' italic' : ''}</span>
                    <span className="font-row-sample" style={{ fontFamily: `"${f.family}", ${generic}`, fontWeight: f.weight, fontStyle: f.style }}>{sample}</span>
                  </button>
                  <button className="icon-btn font-remove-btn" aria-label={t('fonts.remove', { name: f.family })} title={t('fonts.remove', { name: f.family })} onClick={() => removeFont(f)}>
                    <Trash2 size={14} />
                  </button>
                  {unloadableFonts.has(f.id) && <div className="setting-desc mod-warning">{t('fonts.unloadable')}</div>}
                </div>
              ))}
            </>
          )}
          {groups.map((g) => g.fams.length > 0 && (
            <div key={g.id}>
              <div className="font-group-name">{t(`fonts.${g.id}` as Key)}</div>
              {g.fams.map((f) => row(f))}
            </div>
          ))}
          {!groups.some((g) => g.fams.length) && !customShown.length && !(value && match(value)) && <p className="settings-note">{t('fonts.none')}</p>}
        </div>
      )}
    </div>
  )
}

function NumberSlider({ value, set, min, max, label }: { value: number; set: (v: number) => void; min: number; max: number; label: string }) {
  const [local, setLocal] = useState(value)
  return (
    <span className="slider-wrap">
      <input type="range" min={min} max={max} value={local} aria-label={label} style={{ '--fill': `${((local - min) / (max - min)) * 100}%` } as React.CSSProperties} onChange={(e) => setLocal(Number(e.target.value))} onPointerUp={() => set(local)} onKeyUp={() => set(local)} onBlur={() => local !== value && set(local)} />
      <span className="slider-value">{local}</span>
    </span>
  )
}

function HotkeysTab() {
  const [filter, setFilter] = useState('')
  const [capture, setCapture] = useState<string | null>(null)
  const custom = useModel((s) => s.snap!.global.hotkeys)
  const nameOf = (c: (typeof COMMANDS)[number]) => commandName(c.id, c.name)
  const cmds = COMMANDS.filter((c) => nameOf(c).toLowerCase().includes(filter.toLowerCase()))
  const assign = (id: string, keys: string[]) => model.setGlobal({ hotkeys: { [id]: keys } })
  const conflicts = (hk: string, id: string) => COMMANDS.filter((c) => c.id !== id && hotkeysFor(c.id).includes(hk)).map(nameOf)
  return (
    <>
      <Heading>{t('settings.tab.hotkeys')}</Heading>
      <p className="settings-note">{t('settings.hotkeysNote')}</p>
      <input className="text-input wide" placeholder={t('settings.filter')} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('settings.filterCommands')} />
      {cmds.map((c) => {
        const keys = hotkeysFor(c.id)
        return (
          <div key={c.id} className="setting-item">
            <div className="setting-info">
              <div className="setting-name">{nameOf(c)}</div>
              {keys.some((k) => conflicts(k, c.id).length) && <div className="setting-desc mod-warning">{t('settings.conflicts', { list: keys.flatMap((k) => conflicts(k, c.id)).join(', ') })}</div>}
            </div>
            <div className="setting-control">
              {keys.map((k) => (
                <span key={k} className="hotkey-pill">
                  {formatHotkey(k)}
                  <button className="hotkey-remove" aria-label={t('settings.removeHotkey', { key: k })} onClick={() => assign(c.id, keys.filter((x) => x !== k))}>
                    <X size={11} />
                  </button>
                </span>
              ))}
              {capture === c.id ? (
                <span
                  className="hotkey-pill hotkey-capture"
                  tabIndex={0}
                  ref={(el) => el?.focus()}
                  onBlur={() => setCapture(null)}
                  onKeyDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (e.key === 'Escape') return setCapture(null)
                    const hk = eventToHotkey(e.nativeEvent)
                    if (!hk) return
                    assign(c.id, [...keys.filter((x) => x !== hk), hk])
                    setCapture(null)
                  }}
                >
                  {t('settings.pressHotkey')}
                </span>
              ) : (
                <button className="btn small" onClick={() => setCapture(c.id)} aria-label={t('settings.addHotkey', { name: nameOf(c) })}>+</button>
              )}
              {custom[c.id] && (
                <button className="icon-btn" title={t('settings.restoreDefault')} aria-label={t('settings.restoreHotkey', { name: nameOf(c) })} onClick={() => model.setGlobal({ hotkeys: { [c.id]: null } })}>
                  <RotateCcw size={14} />
                </button>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

function PluginsTab() {
  const snap = useModel((s) => s.snap!)
  const overridden = !!snap.vault && snap.vault.settings.overrides.corePlugins !== undefined
  return (
    <>
      <Heading>{t('settings.tab.plugins')}</Heading>
      <p className="settings-note">
        {t('settings.pluginsNote')}
        {snap.vault && ' ' + (overridden ? t('settings.pluginsScopeVault') : t('settings.pluginsScopeAll'))}
      </p>
      {snap.vault && (
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-name">{t('settings.pluginSet')}</div>
            <div className="setting-desc">{t('settings.pluginSetDesc')}</div>
          </div>
          <div className="setting-control">
            <Toggle value={overridden} set={(on) => model.setVault({ overrides: { corePlugins: on ? snap.prefs.corePlugins : null } })} label={t('settings.pluginSet')} />
          </div>
        </div>
      )}
      {CORE_PLUGINS.map((p) => (
        <div key={p.id} className="setting-item">
          <div className="setting-info">
            <div className="setting-name">{t(`plugin.${p.id}` as Key)}</div>
            <div className="setting-desc">{t(`plugin.${p.id}.desc` as Key)}</div>
          </div>
          <div className="setting-control">
            <Toggle
              value={snap.prefs.corePlugins[p.id]}
              label={t(`plugin.${p.id}` as Key)}
              set={(v) => (overridden ? model.setVault({ overrides: { corePlugins: { [p.id]: v } } }) : model.setGlobal({ prefs: { corePlugins: { ...snap.global.prefs.corePlugins, [p.id]: v } } }))}
            />
          </div>
        </div>
      ))}
    </>
  )
}

function VaultTab() {
  const vault = useModel((s) => s.snap!.vault!)
  const [folder, setFolder] = useState(vault.settings.attachmentFolder)
  const overrides = Object.keys(vault.settings.overrides)
  return (
    <>
      <Heading>{t('settings.tab.vault')}</Heading>
      <p className="settings-note">{t('settings.vaultNote', { path: vault.path })}</p>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t('settings.attachments')}</div>
          <div className="setting-desc">{t('settings.attachmentsDesc')}</div>
        </div>
        <div className="setting-control">
          <input className="text-input" value={folder} placeholder="/" aria-label={t('settings.attachments')} onChange={(e) => setFolder(e.target.value)} onBlur={() => folder !== vault.settings.attachmentFolder && model.setVault({ attachmentFolder: folder })} />
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">{t('settings.overridden')}</div>
          <div className="setting-desc">{overrides.length ? overrides.join(', ') : t('settings.overriddenNone')}</div>
        </div>
        <div className="setting-control">
          {overrides.length > 0 && (
            <button className="btn" onClick={() => model.setVault({ overrides: Object.fromEntries(overrides.map((k) => [k, null])) })}>
              {t('settings.useGlobal')}
            </button>
          )}
        </div>
      </div>
    </>
  )
}
