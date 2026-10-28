import type { LanguagePref } from './i18n'
import type { FileSort } from './file-sort'

// Settings schema shared by main (persistence) and renderer (UI).
//
// Precedence (lowest -> highest): DEFAULT_PREFS -> global settings -> vault overrides.
// Global settings live in the OS app-data dir and never depend on the open vault.
// Vault settings live in <vault>/.synapse/settings.json and only hold overrides for
// keys listed in PREF_KEYS plus vault-only data (graph, attachment folder).

export const GLOBAL_SCHEMA_VERSION = 2
export const VAULT_SCHEMA_VERSION = 2

export type Theme = 'dark' | 'light' | 'system'
export type ViewMode = 'source' | 'preview'
export type CorePlugin = 'graph' | 'backlinks' | 'outgoing' | 'tags' | 'outline' | 'search' | 'wordCount'

export const CORE_PLUGINS: { id: CorePlugin; name: string; desc: string }[] = [
  { id: 'search', name: 'Search', desc: 'Search across all notes in the vault.' },
  { id: 'backlinks', name: 'Backlinks', desc: 'Show notes that link to the current note.' },
  { id: 'outgoing', name: 'Outgoing links', desc: 'Show links leaving the current note.' },
  { id: 'graph', name: 'Graph view', desc: 'Visualize links between notes.' },
  { id: 'tags', name: 'Tags view', desc: 'List all tags with counts.' },
  { id: 'outline', name: 'Outline', desc: 'Show the headings of the current note.' },
  { id: 'wordCount', name: 'Word count', desc: 'Show word and character counts in the status bar.' },
]

/** Preferences: set globally, optionally overridden per vault. */
export interface Prefs {
  theme: Theme
  accentColor: string
  fontSize: number
  interfaceFontSize: number
  textFont: string
  monoFont: string
  readableLineLength: boolean
  showLineNumber: boolean
  spellcheck: boolean
  tabSize: number
  autoPairBrackets: boolean
  defaultViewMode: ViewMode
  /** hide Markdown syntax except on the cursor's lines; edit tables as grids */
  livePreview: boolean
  showInlineTitle: boolean
  promptDelete: boolean
  updateLinksOnRename: boolean
  newFileLocation: 'root' | 'current'
  corePlugins: Record<CorePlugin, boolean>
}

/** Global-only state: layout, hotkeys. Never overridden by a vault. */
export interface Layout {
  leftOpen: boolean
  rightOpen: boolean
  leftWidth: number
  rightWidth: number
  leftTab: 'files' | 'search' | 'tags' | 'tasks'
  rightTab: 'backlinks' | 'outgoing' | 'outline'
  /** File explorer ordering, global like the rest of the layout. */
  fileSort: FileSort
}

export interface GlobalSettings {
  version: number
  /** Interface language; global only. 'system' follows macOS preferred languages. */
  language: LanguagePref
  prefs: Prefs
  layout: Layout
  /** command id -> hotkeys like "Mod+Shift+F"; [] = unbound. Missing = default. */
  hotkeys: Record<string, string[]>
  /** Ask GitHub Releases for a newer version at launch. */
  checkUpdates: boolean
}

export interface GraphSettings {
  showOrphans: boolean
  showUnresolved: boolean
  linkDistance: number
  repel: number
  /** Local graph: only the reference note and the notes within `depth` links of it. */
  local: boolean
  depth: number
  /** Node colour by top-level folder or by first tag. */
  colorBy: 'none' | 'folder' | 'tag'
}

/** A named graph configuration, stored per vault. */
export interface SavedGraphView {
  id: string
  name: string
  graph: GraphSettings
  /** Filter query, same syntax as search. */
  query: string
  orphansOnly: boolean
  /** Local graph centred on this note instead of the open one. */
  center?: string
}

export interface VaultSettings {
  version: number
  /** Stable id stamped into the vault so a moved/renamed vault can be recognized. */
  vaultId: string
  overrides: Partial<Prefs>
  graph: GraphSettings
  graphViews: SavedGraphView[]
  /** Colours the user picked for graph groups (folder name, or "#tag"), over the automatic ones. */
  graphColors: Record<string, string>
  attachmentFolder: string
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'system',
  accentColor: '#8b7cff',
  fontSize: 16,
  interfaceFontSize: 13,
  textFont: '',
  monoFont: '',
  readableLineLength: true,
  showLineNumber: false,
  spellcheck: true,
  tabSize: 4,
  autoPairBrackets: true,
  defaultViewMode: 'source',
  livePreview: true,
  showInlineTitle: true,
  promptDelete: true,
  updateLinksOnRename: true,
  newFileLocation: 'root',
  corePlugins: { graph: true, backlinks: true, outgoing: true, tags: true, outline: true, search: true, wordCount: true },
}

export const DEFAULT_LAYOUT: Layout = {
  leftOpen: true,
  rightOpen: true,
  leftWidth: 260,
  rightWidth: 300,
  leftTab: 'files',
  rightTab: 'backlinks',
  fileSort: 'name',
}

export const DEFAULT_GRAPH: GraphSettings = { showOrphans: true, showUnresolved: false, linkDistance: 80, repel: 600, local: false, depth: 1, colorBy: 'none' }

export const defaultGlobal = (): GlobalSettings => ({
  version: GLOBAL_SCHEMA_VERSION,
  language: 'system',
  prefs: structuredClone(DEFAULT_PREFS),
  layout: { ...DEFAULT_LAYOUT },
  hotkeys: {},
  checkUpdates: true,
})

export const defaultVault = (vaultId: string): VaultSettings => ({
  version: VAULT_SCHEMA_VERSION,
  vaultId,
  overrides: {},
  graph: { ...DEFAULT_GRAPH },
  graphViews: [],
  graphColors: {},
  attachmentFolder: '',
})

// ---------- validation ----------
// Each validator returns the value if valid, else undefined. Invalid keys fall back
// to the lower layer instead of discarding the whole file.

type V<T> = (x: unknown) => T | undefined
const bool: V<boolean> = (x) => (typeof x === 'boolean' ? x : undefined)
const num = (min: number, max: number): V<number> => (x) =>
  typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : undefined
const oneOf = <T extends string | number>(...vals: T[]): V<T> => (x) => (vals.includes(x as T) ? (x as T) : undefined)
const str = (max = 500): V<string> => (x) => (typeof x === 'string' && x.length <= max ? x : undefined)
const color: V<string> = (x) => (typeof x === 'string' && /^#[0-9a-f]{6}$/i.test(x) ? x : undefined)
const strList: V<string[]> = (x) =>
  Array.isArray(x) && x.length <= 500 && x.every((s) => typeof s === 'string' && s.length <= 500) ? x : undefined
const plugins: V<Partial<Record<CorePlugin, boolean>>> = (x) => {
  if (!isObj(x)) return undefined
  const out: Partial<Record<CorePlugin, boolean>> = {}
  for (const p of CORE_PLUGINS) if (typeof x[p.id] === 'boolean') out[p.id] = x[p.id] as boolean
  return out
}

const PREF_VALIDATORS: { [K in keyof Prefs]: V<unknown> } = {
  theme: oneOf('dark', 'light', 'system'),
  accentColor: color,
  fontSize: num(10, 40),
  interfaceFontSize: num(10, 24),
  textFont: str(200),
  monoFont: str(200),
  readableLineLength: bool,
  showLineNumber: bool,
  spellcheck: bool,
  tabSize: num(1, 8),
  autoPairBrackets: bool,
  defaultViewMode: oneOf('source', 'preview'),
  livePreview: bool,
  showInlineTitle: bool,
  promptDelete: bool,
  updateLinksOnRename: bool,
  newFileLocation: oneOf('root', 'current'),
  corePlugins: plugins,
}
export const PREF_KEYS = Object.keys(PREF_VALIDATORS) as (keyof Prefs)[]

const LAYOUT_VALIDATORS: { [K in keyof Layout]: V<unknown> } = {
  leftOpen: bool,
  rightOpen: bool,
  leftWidth: num(160, 800),
  rightWidth: num(160, 800),
  leftTab: oneOf('files', 'search', 'tags', 'tasks'),
  rightTab: oneOf('backlinks', 'outgoing', 'outline'),
  fileSort: oneOf('name', 'modified', 'created'),
}

const GRAPH_VALIDATORS: { [K in keyof GraphSettings]: V<unknown> } = {
  showOrphans: bool,
  showUnresolved: bool,
  linkDistance: num(20, 400),
  repel: num(50, 3000),
  local: bool,
  depth: oneOf(1, 2),
  colorBy: oneOf('none', 'folder', 'tag'),
}

export function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x)
}

/** Keep only valid keys of `input` according to `validators`. */
function pick<T>(input: unknown, validators: Record<string, V<unknown>>): Partial<T> {
  const out: Record<string, unknown> = {}
  if (!isObj(input)) return out as Partial<T>
  for (const [k, v] of Object.entries(validators)) {
    const val = v(input[k])
    if (val !== undefined) out[k] = val
  }
  return out as Partial<T>
}

const validLanguage = oneOf<LanguagePref>('system', 'en', 'it')

export const validPrefs = (x: unknown) => pick<Prefs>(x, PREF_VALIDATORS)
export const validLayout = (x: unknown) => pick<Layout>(x, LAYOUT_VALIDATORS)
export const validGraph = (x: unknown) => pick<GraphSettings>(x, GRAPH_VALIDATORS)

function validColors(x: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isObj(x)) return out
  for (const [k, v] of Object.entries(x).slice(0, 500)) if (k.length <= 200 && k !== '__proto__' && color(v)) out[k] = v as string
  return out
}

/** Saved views: invalid entries are dropped, missing graph options take the defaults. */
function validViews(x: unknown): SavedGraphView[] {
  if (!Array.isArray(x)) return []
  const out: SavedGraphView[] = []
  for (const v of x.slice(0, 100)) {
    if (!isObj(v)) continue
    const id = str(64)(v.id)
    const name = str(100)(v.name)?.trim()
    if (!id || !name) continue
    const center = str(1024)(v.center)
    out.push({ id, name, graph: { ...DEFAULT_GRAPH, ...validGraph(v.graph) }, query: str(500)(v.query) ?? '', orphansOnly: bool(v.orphansOnly) ?? false, ...(center ? { center } : {}) })
  }
  return out
}

function validHotkeys(x: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  if (!isObj(x)) return out
  for (const [k, v] of Object.entries(x)) {
    const list = strList(v)
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue
    if (list && k.length < 200 && list.length <= 5) out[k] = list.filter((s) => s.length < 60)
  }
  return out
}

const mergePrefs = (base: Prefs, patch: Partial<Prefs>): Prefs => ({
  ...base,
  ...patch,
  corePlugins: { ...base.corePlugins, ...(patch.corePlugins ?? {}) },
})

// ---------- migrations ----------
// v1 (pre-release) stored a flat object: { darkMode: boolean, editorFontSize: number, sidebarWidth: number, ... }.

export function migrateGlobal(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  const v = typeof raw.version === 'number' ? raw.version : 1
  if (v >= 2) return raw
  const prefs: Record<string, unknown> = {}
  const layout: Record<string, unknown> = {}
  if (typeof raw.darkMode === 'boolean') prefs.theme = raw.darkMode ? 'dark' : 'light'
  if (raw.editorFontSize !== undefined) prefs.fontSize = raw.editorFontSize
  for (const k of PREF_KEYS) if (raw[k] !== undefined) prefs[k] = raw[k]
  if (raw.sidebarWidth !== undefined) layout.leftWidth = raw.sidebarWidth
  return { version: 2, prefs, layout, hotkeys: raw.hotkeys ?? {} }
}

export function migrateVault(raw: unknown): unknown {
  if (!isObj(raw)) return raw
  const v = typeof raw.version === 'number' ? raw.version : 1
  if (v >= 2) return raw
  // v1 stored overrides at the top level and graph settings under "graphView".
  const overrides: Record<string, unknown> = {}
  for (const k of PREF_KEYS) if (raw[k] !== undefined) overrides[k] = raw[k]
  return { version: 2, vaultId: raw.vaultId, overrides, graph: raw.graphView ?? {}, attachmentFolder: raw.attachmentFolder }
}

/** Parse + migrate + validate a global settings object. Never throws. */
/** Every pref is stored, so the old default accent is on disk even if nobody chose it: follow the new default. */
const PREVIOUS_DEFAULT_ACCENT = '#4cc9b0'
const withCurrentDefaultAccent = (p: Prefs): Prefs => (p.accentColor.toLowerCase() === PREVIOUS_DEFAULT_ACCENT ? { ...p, accentColor: DEFAULT_PREFS.accentColor } : p)

export function normalizeGlobal(raw: unknown): GlobalSettings {
  const m = migrateGlobal(raw)
  const d = defaultGlobal()
  if (!isObj(m)) return d
  return {
    version: GLOBAL_SCHEMA_VERSION,
    language: validLanguage(m.language) ?? d.language,
    prefs: withCurrentDefaultAccent(mergePrefs(d.prefs, validPrefs(m.prefs))),
    layout: { ...d.layout, ...validLayout(m.layout) },
    hotkeys: validHotkeys(m.hotkeys),
    checkUpdates: typeof m.checkUpdates === 'boolean' ? m.checkUpdates : d.checkUpdates,
  }
}

/** Shape of a vault id; it also names the vault's history folder in app data. */
export const VAULT_ID = /^[a-z0-9]{8,64}$/

export function normalizeVault(raw: unknown, fallbackId: string): VaultSettings {
  const m = migrateVault(raw)
  const d = defaultVault(fallbackId)
  if (!isObj(m)) return d
  const id = typeof m.vaultId === 'string' && VAULT_ID.test(m.vaultId) ? m.vaultId : fallbackId
  return {
    version: VAULT_SCHEMA_VERSION,
    vaultId: id,
    overrides: validPrefs(m.overrides),
    graph: { ...d.graph, ...validGraph(m.graph) },
    graphViews: validViews(m.graphViews),
    graphColors: validColors(m.graphColors),
    attachmentFolder: str(300)(m.attachmentFolder) ?? '',
  }
}

/** Effective preferences for a vault: defaults <- global <- vault overrides. */
export function resolvePrefs(global: GlobalSettings, vault: VaultSettings | null): Prefs {
  const base = mergePrefs(DEFAULT_PREFS, global.prefs)
  return vault ? mergePrefs(base, vault.overrides) : base
}

/** Apply a validated partial update. `null` for a key removes a vault override. */
export function applyGlobalPatch(g: GlobalSettings, patch: unknown): GlobalSettings {
  if (!isObj(patch)) return g
  return normalizeGlobal({
    ...g,
    language: validLanguage(patch.language) ?? g.language,
    prefs: isObj(patch.prefs) ? mergePrefs(g.prefs, validPrefs(patch.prefs)) : g.prefs,
    layout: isObj(patch.layout) ? { ...g.layout, ...validLayout(patch.layout) } : g.layout,
    hotkeys: isObj(patch.hotkeys) ? patchHotkeys(g.hotkeys, patch.hotkeys) : g.hotkeys,
    checkUpdates: typeof patch.checkUpdates === 'boolean' ? patch.checkUpdates : g.checkUpdates,
  })
}

/** Merge hotkey overrides; `null` restores the command's default. */
function patchHotkeys(cur: Record<string, string[]>, patch: Record<string, unknown>) {
  const next = { ...cur, ...validHotkeys(patch) }
  for (const [k, v] of Object.entries(patch)) if (v === null) delete next[k]
  return next
}

export interface VaultPatch {
  overrides?: Partial<Record<keyof Prefs, unknown>>
  graph?: Partial<GraphSettings>
  /** Replaces the whole list. */
  graphViews?: SavedGraphView[]
  /** Replaces the whole map. */
  graphColors?: Record<string, string>
  attachmentFolder?: string
}

export function applyVaultPatch(v: VaultSettings, patch: unknown): VaultSettings {
  if (!isObj(patch)) return v
  const overrides: Record<string, unknown> = { ...v.overrides }
  if (isObj(patch.overrides)) {
    for (const [k, val] of Object.entries(patch.overrides)) {
      if (!(PREF_KEYS as string[]).includes(k)) continue
      if (val === null) delete overrides[k]
      else if (k === 'corePlugins') overrides[k] = { ...(v.overrides.corePlugins ?? {}), ...(plugins(val) ?? {}) }
      else overrides[k] = val
    }
  }
  return normalizeVault(
    {
      ...v,
      overrides,
      graph: isObj(patch.graph) ? { ...v.graph, ...patch.graph } : v.graph,
      graphViews: Array.isArray(patch.graphViews) ? patch.graphViews : v.graphViews,
      graphColors: isObj(patch.graphColors) ? patch.graphColors : v.graphColors,
      attachmentFolder: patch.attachmentFolder ?? v.attachmentFolder,
    },
    v.vaultId,
  )
}
