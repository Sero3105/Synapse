// Command registry. Default hotkeys mirror the reference app's defaults (see docs/obsidian-analysis.md).
// Users can rebind any command; overrides are stored in GLOBAL settings.
import { openSearchPanel } from '@codemirror/search'
import { foldAll, unfoldAll, toggleFold } from '@codemirror/language'
import { model, setCommandRunner } from './model'
import { toggleWrap, toggleChecklist, insertLink, deleteLine, setHeading, toggleLinePrefix } from './editor-commands'
import { api } from './api'
import { remember } from '../shared/recent'

export interface Command {
  id: string
  name: string
  hotkeys?: string[]
  /** Only offered when this returns true. */
  when?: () => boolean
  run: () => void
}

const hasVault = () => !!model.state.snap?.vault
const hasEditor = () => !!model.activeEditor
const hasNote = () => model.activeTab.kind === 'note'
const plugin = (id: keyof typeof model.prefs.corePlugins) => () => hasVault() && model.prefs.corePlugins[id]
const ed = (fn: (v: NonNullable<typeof model.activeEditor>) => void) => () => {
  const v = model.activeEditor
  if (v) {
    fn(v)
    v.focus()
  }
}

export const COMMANDS: Command[] = [
  { id: 'command-palette:open', name: 'Command palette: Open', hotkeys: ['Mod+P'], run: () => model.set({ modal: { kind: 'palette' } }) },
  { id: 'switcher:open', name: 'Quick switcher: Open', hotkeys: ['Mod+O'], when: hasVault, run: () => model.set({ modal: { kind: 'switcher' } }) },
  { id: 'app:open-settings', name: 'Open settings', hotkeys: ['Mod+,'], run: () => model.set({ modal: { kind: 'settings' } }) },
  { id: 'app:new-window', name: 'New window', run: () => api.newWindow().catch((e) => model.error(e)) },
  { id: 'app:open-vault', name: 'Open another vault', run: () => model.set({ modal: { kind: 'vaults' } }) },
  { id: 'app:close-vault', name: 'Close vault', hotkeys: ['Mod+Shift+W'], when: hasVault, run: () => model.switchVault(() => api.closeVault()) },
  { id: 'app:go-back', name: 'Navigate back', hotkeys: ['Mod+Alt+ArrowLeft'], when: hasVault, run: () => model.goBack() },
  { id: 'app:go-forward', name: 'Navigate forward', hotkeys: ['Mod+Alt+ArrowRight'], when: hasVault, run: () => model.goForward() },
  { id: 'app:toggle-left-sidebar', name: 'Toggle left sidebar', when: hasVault, run: () => model.setLayout({ leftOpen: !model.layout.leftOpen }) },
  { id: 'app:toggle-right-sidebar', name: 'Toggle right sidebar', when: hasVault, run: () => model.setLayout({ rightOpen: !model.layout.rightOpen }) },
  { id: 'app:delete-file', name: 'Delete current file', when: () => !!model.activeFile, run: () => model.remove(model.activeFile!) },
  { id: 'file-explorer:new-file', name: 'Create new note', hotkeys: ['Mod+N'], when: hasVault, run: () => model.createNote() },
  { id: 'file-explorer:new-file-in-new-pane', name: 'Create new note to the right', hotkeys: ['Mod+Shift+N'], when: hasVault, run: () => model.createNote({ where: 'split' }) },
  { id: 'file-explorer:new-folder', name: 'Create new folder', when: hasVault, run: () => model.createFolder() },
  { id: 'file-explorer:open', name: 'Files: Show file explorer', when: hasVault, run: () => model.setLayout({ leftOpen: true, leftTab: 'files' }) },
  {
    id: 'file-explorer:reveal-active-file', name: 'Reveal current file in navigation', when: () => !!model.activeFile, run: () => {
      const p = model.activeFile!
      const parts = p.split('/')
      const exp: Record<string, boolean> = { ...model.state.expanded }
      for (let i = 1; i < parts.length; i++) exp[parts.slice(0, i).join('/')] = true
      model.set({ expanded: exp })
      model.setLayout({ leftOpen: true, leftTab: 'files' })
      requestAnimationFrame(() => document.querySelector(`[data-path="${CSS.escape(p)}"]`)?.scrollIntoView({ block: 'center' }))
    },
  },
  { id: 'workspace:reveal-in-finder', name: 'Reveal current file in Finder', when: () => !!model.activeFile, run: () => api.reveal(model.activeFile!) },
  { id: 'workspace:edit-file-title', name: 'Rename file', hotkeys: ['F2'], when: () => !!model.activeFile, run: () => model.renamePrompt(model.activeFile!) },
  {
    id: 'global-search:open', name: 'Search: Search in all files', hotkeys: ['Mod+Shift+F'], when: plugin('search'), run: () => {
      const sel = model.activeEditor?.state.sliceDoc(model.activeEditor.state.selection.main.from, model.activeEditor.state.selection.main.to)
      if (sel && !sel.includes('\n')) model.set({ searchQuery: sel })
      model.setLayout({ leftOpen: true, leftTab: 'search' })
      requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#search-input')?.select())
    },
  },
  { id: 'tag-pane:open', name: 'Tags: Show tags', when: plugin('tags'), run: () => model.setLayout({ leftOpen: true, leftTab: 'tags' }) },
  { id: 'backlink:open', name: 'Backlinks: Show backlinks', when: plugin('backlinks'), run: () => model.setLayout({ rightOpen: true, rightTab: 'backlinks' }) },
  { id: 'outgoing-links:open', name: 'Outgoing links: Show outgoing links', when: plugin('outgoing'), run: () => model.setLayout({ rightOpen: true, rightTab: 'outgoing' }) },
  { id: 'outline:open', name: 'Outline: Show outline', when: plugin('outline'), run: () => model.setLayout({ rightOpen: true, rightTab: 'outline' }) },
  { id: 'graph:open', name: 'Graph view: Open graph view', hotkeys: ['Mod+G'], when: plugin('graph'), run: () => model.openGraph() },
  { id: 'graph:toggle-local', name: 'Graph view: Toggle local graph', when: plugin('graph'), run: () => model.toggleLocalGraph() },
  { id: 'markdown:toggle-preview', name: 'Toggle reading view', hotkeys: ['Mod+E'], when: hasNote, run: () => model.updateTab(model.activeTab.id, { mode: model.activeTab.mode === 'source' ? 'preview' : 'source' }) },
  { id: 'editor:save-file', name: 'Save current file', hotkeys: ['Mod+S'], when: hasNote, run: () => model.activeFile && model.save(model.activeFile) },
  { id: 'editor:open-search', name: 'Search current file', hotkeys: ['Mod+F'], when: hasEditor, run: ed((v) => openSearchPanel(v)) },
  { id: 'editor:open-search-replace', name: 'Search & replace in current file', hotkeys: ['Mod+Alt+F'], when: hasEditor, run: ed((v) => openSearchPanel(v)) },
  { id: 'editor:toggle-bold', name: 'Toggle bold', hotkeys: ['Mod+B'], when: hasEditor, run: ed((v) => toggleWrap(v, '**')) },
  { id: 'editor:toggle-fold', name: 'Toggle fold on the current line', when: hasEditor, run: ed((v) => toggleFold(v)) },
  { id: 'editor:fold-all', name: 'Fold all headings and lists', when: hasEditor, run: ed((v) => foldAll(v)) },
  { id: 'editor:unfold-all', name: 'Unfold all headings and lists', when: hasEditor, run: ed((v) => unfoldAll(v)) },
  { id: 'editor:toggle-italics', name: 'Toggle italics', hotkeys: ['Mod+I'], when: hasEditor, run: ed((v) => toggleWrap(v, '*')) },
  { id: 'editor:toggle-strikethrough', name: 'Toggle strikethrough', when: hasEditor, run: ed((v) => toggleWrap(v, '~~')) },
  { id: 'editor:toggle-highlight', name: 'Toggle highlight', when: hasEditor, run: ed((v) => toggleWrap(v, '==')) },
  { id: 'editor:toggle-code', name: 'Toggle code', when: hasEditor, run: ed((v) => toggleWrap(v, '`')) },
  { id: 'editor:insert-link', name: 'Insert Markdown link', hotkeys: ['Mod+K'], when: hasEditor, run: ed((v) => insertLink(v, false)) },
  { id: 'editor:insert-wikilink', name: 'Add internal link', when: hasEditor, run: ed((v) => insertLink(v, true)) },
  { id: 'editor:toggle-checklist-status', name: 'Toggle checkbox status', hotkeys: ['Mod+L'], when: hasEditor, run: ed(toggleChecklist) },
  { id: 'editor:toggle-bullet-list', name: 'Toggle bullet list', when: hasEditor, run: ed((v) => toggleLinePrefix(v, '- ')) },
  { id: 'editor:toggle-numbered-list', name: 'Toggle numbered list', when: hasEditor, run: ed((v) => toggleLinePrefix(v, '1. ')) },
  { id: 'editor:toggle-blockquote', name: 'Toggle blockquote', when: hasEditor, run: ed((v) => toggleLinePrefix(v, '> ')) },
  { id: 'editor:delete-paragraph', name: 'Delete paragraph', hotkeys: ['Mod+D'], when: hasEditor, run: ed(deleteLine) },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ id: `editor:set-heading-${n}`, name: `Set as heading ${n}`, when: hasEditor, run: ed((v) => setHeading(v, n)) })),
  { id: 'editor:set-heading-0', name: 'Remove heading', when: hasEditor, run: ed((v) => setHeading(v, 0)) },
  { id: 'editor:toggle-line-numbers', name: 'Toggle line numbers', when: hasVault, run: () => model.setGlobal({ prefs: { showLineNumber: !model.prefs.showLineNumber } }) },
  { id: 'editor:toggle-readable-line-length', name: 'Toggle readable line length', when: hasVault, run: () => model.setGlobal({ prefs: { readableLineLength: !model.prefs.readableLineLength } }) },
  { id: 'workspace:new-tab', name: 'New tab', hotkeys: ['Mod+T'], when: hasVault, run: () => model.newTab() },
  // Without a vault there are no tabs: Cmd+W closes the window, as macOS users expect.
  { id: 'workspace:close', name: 'Close current tab', hotkeys: ['Mod+W'], run: () => (hasVault() ? model.closeTab(model.activePane.id, model.activeTab.id) : window.close()) },
  { id: 'workspace:toggle-pin', name: 'Toggle pin', when: hasVault, run: () => model.togglePinTab(model.activeTab.id) },
  { id: 'workspace:close-others', name: 'Close all other tabs', when: hasVault, run: () => model.closeOthers(model.activePane.id, model.activeTab.id) },
  { id: 'workspace:undo-close-pane', name: 'Undo close tab', hotkeys: ['Mod+Shift+T'], when: hasVault, run: () => model.reopenClosed() },
  { id: 'workspace:next-tab', name: 'Go to next tab', hotkeys: ['Ctrl+Tab', 'Mod+Shift+]'], when: hasVault, run: () => model.cycleTab(1) },
  { id: 'workspace:previous-tab', name: 'Go to previous tab', hotkeys: ['Ctrl+Shift+Tab', 'Mod+Shift+['], when: hasVault, run: () => model.cycleTab(-1) },
  ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ id: `workspace:goto-tab-${n}`, name: `Go to tab #${n}`, hotkeys: [`Mod+${n}`], when: hasVault, run: () => model.gotoTab(n - 1) })),
  { id: 'workspace:goto-last-tab', name: 'Go to last tab', hotkeys: ['Mod+9'], when: hasVault, run: () => model.gotoTab(-1) },
  { id: 'workspace:split-vertical', name: 'Split right', when: hasVault, run: () => model.split('row') },
  { id: 'workspace:split-horizontal', name: 'Split down', when: hasVault, run: () => model.split('column') },
  { id: 'workspace:copy-path', name: 'Copy file path', when: () => !!model.activeFile, run: () => navigator.clipboard.writeText(model.activeFile!) },
  { id: 'daily-notes:open-today', name: 'Daily notes: Open today’s note', when: hasVault, run: () => model.openDailyNote() },
  { id: 'daily-notes:previous', name: 'Daily notes: Open previous daily note', when: hasVault, run: () => model.openAdjacentDaily(-1) },
  { id: 'daily-notes:next', name: 'Daily notes: Open next daily note', when: hasVault, run: () => model.openAdjacentDaily(1) },
  { id: 'templates:insert', name: 'Templates: Insert template', when: hasEditor, run: () => model.set({ modal: { kind: 'templates', mode: 'insert' } }) },
  { id: 'templates:new-note', name: 'Templates: Create new note from template', when: hasVault, run: () => model.set({ modal: { kind: 'templates', mode: 'new' } }) },
  { id: 'history:open', name: 'Show version history', when: hasNote, run: () => model.set({ modal: { kind: 'history', path: model.activeFile! } }) },
  { id: 'attachments:report', name: 'Attachments: Show missing and unused attachments', when: hasVault, run: () => model.set({ modal: { kind: 'attachments' } }) },
  { id: 'tasks:open', name: 'Tasks: Show tasks', when: hasVault, run: () => model.setLayout({ leftOpen: true, leftTab: 'tasks' }) },
  { id: 'export:html', name: 'Export to HTML', when: hasNote, run: () => import('./export').then((m) => m.exportNote('html')) },
  { id: 'export:vault', name: 'Export vault to HTML', when: hasVault, run: () => import('./export').then((m) => m.exportVault()) },
  { id: 'export:pdf', name: 'Export to PDF', when: hasNote, run: () => import('./export').then((m) => m.exportNote('pdf')) },
]

const byId = new Map(COMMANDS.map((c) => [c.id, c]))

/** Commands run from the palette this session, newest first (ids only, never what was typed). */
export let recentCommands: string[] = []
export function runFromPalette(id: string) {
  recentCommands = remember(recentCommands, id)
  runCommand(id)
}

export function hotkeysFor(id: string): string[] {
  const custom = model.state.snap?.global.hotkeys[id]
  return custom ?? byId.get(id)?.hotkeys ?? []
}

export function runCommand(id: string) {
  const c = byId.get(id)
  if (c && (!c.when || c.when())) c.run()
}
setCommandRunner(runCommand)

/** Normalize a keyboard event to "Mod+Shift+K" form (Mod = Cmd on macOS). */
export function eventToHotkey(e: KeyboardEvent): string | null {
  if (['Meta', 'Control', 'Shift', 'Alt'].includes(e.key)) return null
  const parts: string[] = []
  if (e.metaKey) parts.push('Mod')
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey) parts.push('Shift')
  // e.code keeps the physical key when Alt/Shift change e.key (e.g. Alt+F -> "ƒ")
  let key = e.key
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (e.code === 'BracketLeft') key = '['
  else if (e.code === 'BracketRight') key = ']'
  else if (e.code === 'Comma') key = ','
  else if (e.code === 'Slash') key = '/'
  else if (e.code === 'Semicolon') key = ';'
  else if (key.length === 1) key = key.toUpperCase()
  if (!parts.length && !/^F\d+$/.test(key)) return null // plain typing is never a global hotkey
  parts.push(key)
  return parts.join('+')
}

export function formatHotkey(h: string) {
  return h
    .split('+')
    .map((p) => ({ Mod: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Tab: '⇥', Enter: '↩' })[p] ?? p)
    .join('')
}

/** Global keydown handler (capture phase so it wins over editor defaults, like the reference). */
export function installHotkeys() {
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.isComposing) return
      const hk = eventToHotkey(e)
      if (!hk) return
      // While a modal is open only Escape-like handling inside the modal applies, except the palette toggles.
      if (model.state.modal && !['command-palette:open', 'switcher:open'].some((id) => hotkeysFor(id).includes(hk))) return
      if (document.querySelector('.hotkey-capture')) return
      for (const c of COMMANDS) {
        if (hotkeysFor(c.id).includes(hk) && (!c.when || c.when())) {
          e.preventDefault()
          e.stopPropagation()
          if (model.state.modal) model.set({ modal: null })
          c.run()
          return
        }
      }
    },
    true,
  )
}
