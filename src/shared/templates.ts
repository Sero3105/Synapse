// Daily notes and templates: pure helpers, no I/O.
import { basename } from './markdown'

/** User templates are the notes in this vault folder (same convention as the reference app). */
export const TEMPLATE_FOLDER = 'Templates'
/** If `Templates/Daily note.md` exists, new daily notes start from it. */
export const DAILY_TEMPLATE = `${TEMPLATE_FOLDER}/Daily note.md`
export const BUILTIN_TEMPLATES = ['general', 'study', 'meeting', 'project'] as const

const pad = (n: number) => String(n).padStart(2, '0')
/** Local date as YYYY-MM-DD. */
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const isoTime = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

/** Fill {{title}}, {{date}} and {{time}}. Anything else in braces is left as written. */
export function fillTemplate(text: string, vars: { title: string; now: Date }) {
  return text.replace(/\{\{\s*(title|date|time)\s*\}\}/gi, (_, k: string) => {
    const key = k.toLowerCase()
    return key === 'title' ? vars.title : key === 'date' ? isoDate(vars.now) : isoTime(vars.now)
  })
}

const DAILY = /^(\d{4}-\d{2}-\d{2})\.md$/i
/** The date of a daily note (`YYYY-MM-DD.md`), or null. */
export const dailyDate = (path: string) => DAILY.exec(basename(path))?.[1] ?? null

const dailyNotes = (files: string[]) =>
  files
    .filter((p) => !p.startsWith(TEMPLATE_FOLDER + '/'))
    .map((path) => ({ path, date: dailyDate(path) }))
    .filter((d): d is { path: string; date: string } => !!d.date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.path.localeCompare(b.path))

/**
 * Where the daily note for `date` is: an existing `<date>.md` anywhere in the vault, otherwise
 * next to the most recent daily note (so a "Daily/" folder keeps being used), otherwise the root.
 */
export function dailyNotePath(files: string[], date: string): { path: string; exists: boolean } {
  const all = dailyNotes(files)
  const hit = all.find((d) => d.date === date)
  if (hit) return { path: hit.path, exists: true }
  const last = all[all.length - 1]?.path
  const dir = last?.includes('/') ? last.slice(0, last.lastIndexOf('/') + 1) : ''
  return { path: `${dir}${date}.md`, exists: false }
}

/** The nearest existing daily note before (`-1`) or after (`1`) `date`. */
export function adjacentDaily(files: string[], date: string, dir: 1 | -1): string | null {
  const all = dailyNotes(files)
  const hit = dir < 0 ? all.filter((d) => d.date < date).pop() : all.find((d) => d.date > date)
  return hit?.path ?? null
}
