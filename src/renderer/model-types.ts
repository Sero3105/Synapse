// Renderer model: types and small helpers shared by every layer of the model.
import type { Snapshot, FileEntry } from './api'
import { ApiError } from './api'
import type { UpdateInfo } from '../shared/update'
import type { LayoutNode } from '../shared/layout'
import { t, Key } from '../shared/i18n'
import type { BUILTIN_TEMPLATES } from '../shared/templates'
import type { MergePart } from '../shared/merge'

export type ViewMode = 'source' | 'preview'
export interface Tab {
  id: string
  kind: 'note' | 'file' | 'graph' | 'empty'
  path?: string
  mode: ViewMode
  back: string[]
  fwd: string[]
  /** restored on open */
  cursor?: number
  scroll?: number
  /** kept at the left, shrunk to its icon, skipped by "close others" */
  pinned?: boolean
  /** VS Code-style preview: reused by the next file-tree click until kept (double-click, tab double-click or typing in it) */
  preview?: boolean
}
export interface Pane { id: string; tabs: Tab[]; active: string }
/** `layout` places the panes; `panes` holds them in creation order. */
export interface Workspace { panes: Pane[]; activePane: string; layout: LayoutNode }

export interface Buffer {
  content: string
  saved: string
  mtime: number
  conflict?: 'modified' | 'deleted'
  saving?: boolean
}

export type Modal =
  | { kind: 'palette' }
  | { kind: 'switcher' }
  | { kind: 'settings'; tab?: string }
  | { kind: 'vaults' }
  | { kind: 'templates'; mode: 'insert' | 'new' }
  | { kind: 'history'; path: string }
  | { kind: 'attachments' }
  | { kind: 'import'; folder: string }
  | { kind: 'merge'; path: string; parts: MergePart[]; mine: string; theirs: string }
  | { kind: 'prompt'; title: string; value: string; placeholder?: string; okText?: string; resolve: (v: string | null) => void }
  | { kind: 'confirm'; title: string; message: string; okText: string; danger?: boolean; resolve: (ok: boolean) => void }

/** A built-in template (`id`) or a note in the Templates folder (`path`). */
export interface Template { name: string; id?: (typeof BUILTIN_TEMPLATES)[number]; path?: string }

/** `checked` makes the item one choice of a dropdown (a tick marks the current one). */
export interface MenuItem { label: string; run?: () => void; danger?: boolean; separator?: boolean; disabled?: boolean; checked?: boolean }

export interface State {
  snap: Snapshot | null
  loading: boolean
  files: FileEntry[]
  indexVersion: number
  buffers: Record<string, Buffer>
  ws: Workspace
  modal: Modal | null
  menu: { x: number; y: number; items: MenuItem[]; minWidth?: number } | null
  notices: { id: number; text: string; error?: boolean }[]
  /** a newer release found on GitHub at launch; null once dismissed */
  update: UpdateInfo | null
  searchQuery: string
  expanded: Record<string, boolean>
  /** tab whose inline title should be focused (new note) */
  focusTitle: string | null
  /** bumped when a line jump is requested */
  navTick: number
  /** caret of the focused editor, for the status bar */
  cursor: { line: number; col: number } | null
  /** recently opened files in this vault, newest first */
  recent: string[]
  /** notes pinned to the start page (empty tab), per vault */
  pinned: string[]
  /** related-note suggestions the user dismissed, as "a\u0000b" pairs (sorted), per vault */
  dismissedRelated: string[]
}

let uid = 0
export const newId = () => `${Date.now().toString(36)}${(uid++).toString(36)}`
export const emptyTab = (): Tab => ({ id: newId(), kind: 'empty', mode: 'source', back: [], fwd: [] })
export const defaultWs = (): Workspace => {
  const t = emptyTab()
  const p = { id: newId(), tabs: [t], active: t.id }
  return { panes: [p], activePane: p.id, layout: p.id }
}

export const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i
export const isMd = (p: string) => /\.md$/i.test(p)
/** Window width (px) under which the side docks float over the note; matches the CSS media query. */
export const NARROW = 720
export const dirOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')

/** User-facing error text: known filesystem error codes are translated, anything else keeps its message. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const key = `error.${e.code}` as Key
    const text = t(key)
    if (text !== key) return text
  }
  return e instanceof Error ? e.message : String(e)
}
