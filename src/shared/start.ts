// Lists for the start page (empty tab): pinned, recently opened, recently modified.
import { TEMPLATE_FOLDER } from './templates'

/**
 * Each note appears once, in the first list that has it (pinned, then opened, then modified);
 * paths no longer in `files` are dropped, so moved or deleted notes never show up.
 */
export function startLists(files: { path: string; type: string; mtime: number }[], recent: string[], pinned: string[], limit = 7) {
  const exists = new Set(files.filter((f) => f.type === 'file').map((f) => f.path))
  const seen = new Set<string>()
  const take = (paths: string[], n: number) => {
    const out: string[] = []
    for (const p of paths) {
      if (out.length >= n) break
      if (!exists.has(p) || seen.has(p)) continue
      seen.add(p)
      out.push(p)
    }
    return out
  }
  const pin = take(pinned, 50)
  const opened = take(recent, limit)
  // templates are tools, not notes you work on: they stay out of "recently modified"
  const byMtime = files.filter((f) => f.type === 'file' && /\.md$/i.test(f.path) && !f.path.startsWith(TEMPLATE_FOLDER + '/')).sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path))
  const modified = take(byMtime.map((f) => f.path), 5)
  return { pinned: pin, recent: opened, modified }
}
