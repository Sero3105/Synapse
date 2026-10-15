import { useState } from 'react'
import { X, RotateCcw } from 'lucide-react'
import { model, useModel } from '../model'
import { api } from '../api'
import { COMMANDS, hotkeysFor, formatHotkey, eventToHotkey } from '../commands'
import { Prefs, CORE_PLUGINS, DEFAULT_PREFS } from '../../shared/settings'

const TABS = [
  ['general', 'General'],
  ['editor', 'Editor'],
  ['files', 'Files and links'],
  ['appearance', 'Appearance'],
  ['hotkeys', 'Hotkeys'],
  ['plugins', 'Core plugins'],
  ['vault', 'This vault'],
] as const

export function SettingsModal({ close, initialTab }: { close: () => void; initialTab?: string }) {
  const [tab, setTab] = useState(initialTab ?? 'editor')
  const hasVault = useModel((s) => !!s.snap?.vault)
  return (
    <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Settings" onKeyDown={(e) => e.key === 'Escape' && !document.querySelector('.hotkey-capture') && close()}>
      <button className="icon-btn modal-close" aria-label="Close settings" onClick={close}>
        <X size={16} />
      </button>
      <nav className="settings-nav" aria-label="Settings sections">
        <div className="settings-nav-group">Settings</div>
        {TABS.filter(([id]) => hasVault || id !== 'vault').map(([id, label]) => (
          <button key={id} className={`settings-nav-item${tab === id ? ' is-active' : ''}`} aria-current={tab === id} onClick={() => setTab(id)}>
            {label}
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
            aria-label={`Scope for ${name}`}
            title="Where this setting is stored"
            value={overridden ? 'vault' : 'global'}
            onChange={(e) => model.setVault({ overrides: { [k]: e.target.value === 'vault' ? value : null } })}
          >
            <option value="global">All vaults</option>
            <option value="vault">This vault only</option>
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
      Settings apply to <b>all vaults</b> and are stored with Synapse, not inside your notes.
      {hasVault && ' Use the scope menu on a row to override it for this vault only.'}
    </p>
  )
}

function General() {
  const snap = useModel((s) => s.snap!)
  return (
    <>
      <Heading>General</Heading>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">Current vault</div>
          <div className="setting-desc">{snap.vault ? snap.vault.path : 'No vault open'}</div>
        </div>
        <div className="setting-control">
          <button className="btn" onClick={() => model.set({ modal: { kind: 'vaults' } })}>Manage vaults</button>
          {snap.vault && (
            <button className="btn" onClick={() => model.switchVault(() => api.closeVault())}>
              Close vault
            </button>
          )}
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">Where settings are stored</div>
          <div className="setting-desc">
            Global: ~/Library/Application Support/Synapse/settings.json
            <br />
            This vault: &lt;vault&gt;/.synapse/settings.json
          </div>
        </div>
      </div>
      <PrefRow k="promptDelete" name="Confirm file deletion" desc="Ask before moving files to the system trash.">
        {(v, set) => <Toggle value={v} set={set} label="Confirm file deletion" />}
      </PrefRow>
    </>
  )
}

function EditorTab() {
  return (
    <>
      <Heading>Editor</Heading>
      <ScopeNote />
      <PrefRow k="defaultViewMode" name="Default view for new tabs" desc="Editing or reading view.">
        {(v, set) => (
          <select className="dropdown" value={v} onChange={(e) => set(e.target.value as Prefs['defaultViewMode'])} aria-label="Default view">
            <option value="source">Editing view</option>
            <option value="preview">Reading view</option>
          </select>
        )}
      </PrefRow>
      <PrefRow k="readableLineLength" name="Readable line length" desc="Limit maximum line length.">
        {(v, set) => <Toggle value={v} set={set} label="Readable line length" />}
      </PrefRow>
      <PrefRow k="showInlineTitle" name="Show inline title" desc="Display the file name as an editable title above the note.">
        {(v, set) => <Toggle value={v} set={set} label="Show inline title" />}
      </PrefRow>
      <PrefRow k="showLineNumber" name="Show line numbers" desc="Show line numbers in the gutter.">
        {(v, set) => <Toggle value={v} set={set} label="Show line numbers" />}
      </PrefRow>
      <PrefRow k="spellcheck" name="Spellcheck" desc="Underline misspelled words.">
        {(v, set) => <Toggle value={v} set={set} label="Spellcheck" />}
      </PrefRow>
      <PrefRow k="autoPairBrackets" name="Auto-pair brackets" desc="Insert closing brackets and quotes automatically.">
        {(v, set) => <Toggle value={v} set={set} label="Auto-pair brackets" />}
      </PrefRow>
      <PrefRow k="tabSize" name="Tab indent size" desc="Number of spaces per indentation level.">
        {(v, set) => <NumberSlider value={v} set={set} min={1} max={8} label="Tab indent size" />}
      </PrefRow>
    </>
  )
}

function FilesTab() {
  return (
    <>
      <Heading>Files and links</Heading>
      <ScopeNote />
      <PrefRow k="newFileLocation" name="Default location for new notes">
        {(v, set) => (
          <select className="dropdown" value={v} onChange={(e) => set(e.target.value as Prefs['newFileLocation'])} aria-label="New note location">
            <option value="root">Vault folder</option>
            <option value="current">Same folder as current file</option>
          </select>
        )}
      </PrefRow>
      <PrefRow k="updateLinksOnRename" name="Automatically update internal links" desc="When renaming or moving files, rewrite links that point to them.">
        {(v, set) => <Toggle value={v} set={set} label="Automatically update internal links" />}
      </PrefRow>
    </>
  )
}

function AppearanceTab() {
  return (
    <>
      <Heading>Appearance</Heading>
      <ScopeNote />
      <PrefRow k="theme" name="Base color scheme" desc="Choose a light or dark theme, or follow macOS.">
        {(v, set) => (
          <select className="dropdown" value={v} onChange={(e) => set(e.target.value as Prefs['theme'])} aria-label="Base color scheme">
            <option value="system">Adapt to system</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        )}
      </PrefRow>
      <PrefRow k="accentColor" name="Accent color" desc="Color of links, buttons and highlights.">
        {(v, set) => (
          <>
            <input type="color" className="color-input" value={v} onChange={(e) => set(e.target.value)} aria-label="Accent color" />
            <button className="icon-btn" aria-label="Restore default accent color" onClick={() => set(DEFAULT_PREFS.accentColor)}>
              <RotateCcw size={14} />
            </button>
          </>
        )}
      </PrefRow>
      <Heading>Font</Heading>
      <PrefRow k="fontSize" name="Font size" desc="Font size in px for editing and reading views.">
        {(v, set) => <NumberSlider value={v} set={set} min={10} max={30} label="Font size" />}
      </PrefRow>
      <PrefRow k="interfaceFontSize" name="Interface font size" desc="Font size for sidebars, tabs and menus.">
        {(v, set) => <NumberSlider value={v} set={set} min={11} max={18} label="Interface font size" />}
      </PrefRow>
      <PrefRow k="textFont" name="Text font" desc="Font family for notes. Empty uses the macOS serif, New York.">
        {(v, set) => <TextSetting value={v} set={set} placeholder="New York (system serif)" label="Text font" />}
      </PrefRow>
      <PrefRow k="monoFont" name="Monospace font" desc="Font family for code. Empty uses the system monospace font.">
        {(v, set) => <TextSetting value={v} set={set} placeholder="e.g. SF Mono" label="Monospace font" />}
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
  const cmds = COMMANDS.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()))
  const assign = (id: string, keys: string[]) => model.setGlobal({ hotkeys: { [id]: keys } })
  const conflicts = (hk: string, id: string) => COMMANDS.filter((c) => c.id !== id && hotkeysFor(c.id).includes(hk)).map((c) => c.name)
  return (
    <>
      <Heading>Hotkeys</Heading>
      <p className="settings-note">Hotkeys are global: they are the same in every vault.</p>
      <input className="text-input wide" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter commands" />
      {cmds.map((c) => {
        const keys = hotkeysFor(c.id)
        return (
          <div key={c.id} className="setting-item">
            <div className="setting-info">
              <div className="setting-name">{c.name}</div>
              {keys.some((k) => conflicts(k, c.id).length) && <div className="setting-desc mod-warning">Conflicts with: {keys.flatMap((k) => conflicts(k, c.id)).join(', ')}</div>}
            </div>
            <div className="setting-control">
              {keys.map((k) => (
                <span key={k} className="hotkey-pill">
                  {formatHotkey(k)}
                  <button className="hotkey-remove" aria-label={`Remove ${k}`} onClick={() => assign(c.id, keys.filter((x) => x !== k))}>
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
                  Press hotkey…
                </span>
              ) : (
                <button className="btn small" onClick={() => setCapture(c.id)} aria-label={`Add hotkey for ${c.name}`}>+</button>
              )}
              {custom[c.id] && (
                <button className="icon-btn" title="Restore default" aria-label={`Restore default hotkey for ${c.name}`} onClick={() => model.setGlobal({ hotkeys: { [c.id]: null } })}>
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
      <Heading>Core plugins</Heading>
      <p className="settings-note">
        Built-in features can be turned off. Third-party (community) plugins are not supported.
        {snap.vault && ` Changes apply to ${overridden ? 'this vault only' : 'all vaults'}.`}
      </p>
      {snap.vault && (
        <div className="setting-item">
          <div className="setting-info">
            <div className="setting-name">Plugin set for this vault</div>
            <div className="setting-desc">Use a separate plugin selection in this vault.</div>
          </div>
          <div className="setting-control">
            <Toggle value={overridden} set={(on) => model.setVault({ overrides: { corePlugins: on ? snap.prefs.corePlugins : null } })} label="Separate plugin set for this vault" />
          </div>
        </div>
      )}
      {CORE_PLUGINS.map((p) => (
        <div key={p.id} className="setting-item">
          <div className="setting-info">
            <div className="setting-name">{p.name}</div>
            <div className="setting-desc">{p.desc}</div>
          </div>
          <div className="setting-control">
            <Toggle
              value={snap.prefs.corePlugins[p.id]}
              label={p.name}
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
      <Heading>This vault</Heading>
      <p className="settings-note">These settings are stored in {vault.path}/.synapse/settings.json and only affect this vault.</p>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">Attachment folder</div>
          <div className="setting-desc">Where pasted and dropped files are saved. Empty = vault root, "./" = same folder as the note.</div>
        </div>
        <div className="setting-control">
          <input className="text-input" value={folder} placeholder="/" aria-label="Attachment folder" onChange={(e) => setFolder(e.target.value)} onBlur={() => folder !== vault.settings.attachmentFolder && model.setVault({ attachmentFolder: folder })} />
        </div>
      </div>
      <div className="setting-item">
        <div className="setting-info">
          <div className="setting-name">Overridden preferences</div>
          <div className="setting-desc">{overrides.length ? overrides.join(', ') : 'None. This vault uses your global preferences.'}</div>
        </div>
        <div className="setting-control">
          {overrides.length > 0 && (
            <button className="btn" onClick={() => model.setVault({ overrides: Object.fromEntries(overrides.map((k) => [k, null])) })}>
              Use global preferences
            </button>
          )}
        </div>
      </div>
    </>
  )
}
