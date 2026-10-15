import { useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { model, useModel } from '../model'
import { api } from '../api'
import { COMMANDS, hotkeysFor, formatHotkey, eventToHotkey } from '../commands'
import { Prefs, CORE_PLUGINS, DEFAULT_PREFS } from '../../shared/settings'
import { t, Key, LANGUAGES, LanguagePref, commandName } from '../../shared/i18n'

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
      <PrefRow k="textFont" name={t('settings.textFont')} desc={t('settings.textFontDesc')}>
        {(v, set) => <TextSetting value={v} set={set} placeholder={t('settings.textFontPlaceholder')} label={t('settings.textFont')} />}
      </PrefRow>
      <PrefRow k="monoFont" name={t('settings.monoFont')} desc={t('settings.monoFontDesc')}>
        {(v, set) => <TextSetting value={v} set={set} placeholder={t('settings.monoFontPlaceholder')} label={t('settings.monoFont')} />}
      </PrefRow>
    </>
  )
}

function NumberSlider({ value, set, min, max, label }: { value: number; set: (v: number) => void; min: number; max: number; label: string }) {
  const [local, setLocal] = useState(value)
  return (
    <span className="slider-wrap">
      <input type="range" min={min} max={max} value={local} aria-label={label} onChange={(e) => setLocal(Number(e.target.value))} onPointerUp={() => set(local)} onKeyUp={() => set(local)} onBlur={() => local !== value && set(local)} />
      <span className="slider-value">{local}</span>
    </span>
  )
}

function TextSetting({ value, set, placeholder, label }: { value: string; set: (v: string) => void; placeholder: string; label: string }) {
  const [local, setLocal] = useState(value)
  return <input className="text-input" value={local} placeholder={placeholder} aria-label={label} onChange={(e) => setLocal(e.target.value)} onBlur={() => local !== value && set(local)} onKeyDown={(e) => e.key === 'Enter' && set(local)} />
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
