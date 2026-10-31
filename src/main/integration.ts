// macOS integration without electron imports, so it is unit-testable: synapse:// links,
// quick capture into the vault, and the menu-bar menu.
import { Vault } from './vault'
import { uniqueName, noteTitle } from '../shared/markdown'
import { DAILY_TEMPLATE, isoDate, fillTemplate, dailyNotePath } from '../shared/templates'

export const INBOX = 'Inbox.md'
/** Longest text a synapse:// link or a capture may carry. */
const MAX_TEXT = 100_000

export type SynapseUrl =
  | { action: 'open'; vault?: string; file?: string }
  | { action: 'new'; vault?: string; name?: string; text: string }
  | { action: 'capture' }

/**
 * `synapse://open?vault=Name&file=Folder/Note`, `synapse://new?vault=Name&name=Title&text=…`,
 * `synapse://capture`. `vault` is a vault's folder name or id; without it the last used vault.
 */
export function parseSynapseUrl(raw: string): SynapseUrl | null {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'synapse:') return null
  const q = (k: string) => {
    const v = u.searchParams.get(k)?.trim()
    return v ? v : undefined
  }
  const action = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase()
  if (action === 'open') return { action, vault: q('vault'), file: q('file') }
  if (action === 'new') return { action, vault: q('vault'), name: q('name'), text: (u.searchParams.get('text') ?? '').slice(0, MAX_TEXT) }
  if (action === 'capture') return { action }
  return null
}

/** A vault-relative note path from a link: `.md` is optional, as in [[links]]. */
export const notePath = (file: string) => (/\.[a-z0-9]{1,8}$/i.test(file) ? file : `${file}.md`).replace(/^\/+/, '')

/** The registered vault a link names (folder name, case-insensitive, or id). */
export function findVault(vaults: Record<string, { path: string }>, name: string): string | null {
  if (vaults[name]) return vaults[name].path
  const base = (p: string) => p.slice(p.lastIndexOf('/') + 1).toLowerCase()
  return Object.values(vaults).find((v) => base(v.path) === name.toLowerCase())?.path ?? null
}

/** Create a new note with `text`, never overwriting: a taken name gets a number. Returns its path. */
export async function newNote(vault: Vault, name: string, text: string): Promise<string> {
  const existing = new Set((await vault.list()).map((f) => f.path))
  const file = notePath(name)
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : ''
  const path = uniqueName(existing, dir, noteTitle(file), '.md')
  return (await vault.create(path, text)).path
}

/** Text appended after what is already there, separated by a blank line. */
const append = (cur: string, text: string) => (cur.trim() ? `${cur.replace(/\n*$/, '')}\n\n${text}\n` : `${text}\n`)

/**
 * Quick capture: append `text` to today's daily note (created from the daily template if it
 * does not exist yet, like *Open today's daily note*) or to Inbox.md. Returns the note's path.
 */
export async function capture(vault: Vault, target: 'daily' | 'inbox', text: string, now = new Date()): Promise<string> {
  const entry = text.trim().slice(0, MAX_TEXT)
  if (!entry) throw new Error('Nothing to capture')
  const files = (await vault.list()).filter((f) => f.type === 'file').map((f) => f.path)
  const date = isoDate(now)
  const { path, exists } = target === 'daily' ? dailyNotePath(files, date) : { path: INBOX, exists: files.includes(INBOX) }
  if (!exists) {
    const tpl = target === 'daily' && files.includes(DAILY_TEMPLATE) ? fillTemplate((await vault.read(DAILY_TEMPLATE)).content, { title: date, now }) : ''
    return (await vault.create(path, append(tpl, entry))).path
  }
  // the mtime makes this refuse, instead of overwrite, a change made since the read
  const cur = await vault.read(path)
  await vault.write(path, append(cur.content, entry), cur.mtime)
  return path
}

/** "Mod+Shift+Space" (the app's hotkey form) -> "Command+Shift+Space" (an Electron accelerator). */
export function toAccelerator(hotkey: string): string {
  const keys: Record<string, string> = { Mod: 'Command', Ctrl: 'Control', Alt: 'Alt', Shift: 'Shift', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' }
  return hotkey.split('+').map((k) => keys[k] ?? k).join('+')
}

export interface TrayItem { label?: string; type?: 'separator'; enabled?: boolean; accelerator?: string; click?: () => void }

/** Menu-bar menu: each open vault with its recent notes, then New note and Quick capture. */
export function trayMenu(
  vaults: { name: string; recent: string[]; open: (path: string) => void }[],
  labels: { newNote: string; capture: string; noRecent: string },
  actions: { newNote?: () => void; capture: () => void; captureAccel?: string },
): TrayItem[] {
  const items: TrayItem[] = []
  for (const v of vaults) {
    items.push({ label: v.name, enabled: false })
    const recent = v.recent.slice(0, 5)
    if (!recent.length) items.push({ label: labels.noRecent, enabled: false })
    for (const p of recent) items.push({ label: noteTitle(p), click: () => v.open(p) })
    items.push({ type: 'separator' })
  }
  items.push({ label: labels.newNote, enabled: !!actions.newNote, click: actions.newNote })
  items.push({ label: labels.capture, accelerator: actions.captureAccel, click: actions.capture })
  return items
}

/**
 * The app icon's three linked nodes, black on transparent, as a BGRA bitmap of `size` px
 * (36 = the 18 pt menu bar at 2x). Used as a template image, so macOS tints it for the menu bar.
 */
export function trayBitmap(size = 36): Buffer {
  const k = size / 36
  const nodes = [[8.6, 9.1, 5.2], [28.6, 6.1, 4], [20.7, 27.9, 6]].map(([x, y, r]) => [x * k, y * k, r * k])
  const edges = [[0, 1], [1, 2], [2, 0]]
  const segment = (x: number, y: number, [ax, ay]: number[], [bx, by]: number[]) => {
    const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
    return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay))
  }
  const inside = (x: number, y: number) => nodes.some(([nx, ny, r]) => Math.hypot(x - nx, y - ny) < r) || edges.some(([a, b]) => segment(x, y, nodes[a], nodes[b]) < 1.5 * k)
  const out = Buffer.alloc(size * size * 4)
  const SS = 4
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let hits = 0
      for (let j = 0; j < SS; j++) for (let i = 0; i < SS; i++) if (inside(x + (i + 0.5) / SS, y + (j + 0.5) / SS)) hits++
      out[(y * size + x) * 4 + 3] = Math.round((hits / (SS * SS)) * 255)
    }
  return out
}
