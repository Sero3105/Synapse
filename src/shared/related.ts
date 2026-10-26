// Related notes: explainable suggestions for notes that are not directly linked yet.
// Every point of the score comes from a signal shown to the user as a reason.
import { NoteIndex, noteTerms, noteTitle, type IndexedNote } from './markdown'

export interface RelatedNote {
  path: string
  score: number
  /** shared tags (as written in this note) */
  tags: string[]
  /** notes both are linked with (either direction) */
  via: string[]
  /** distinctive words both use */
  terms: string[]
  /** words shared by the titles/headings */
  titleWords: string[]
}

export const pairKey = (a: string, b: string) => [a, b].sort().join('\u0000')

const isNote = (p: string) => /\.md$/i.test(p)

/** Undirected note-to-note link adjacency (attachments and unresolved links left out). */
function adjacency(index: NoteIndex) {
  const adj = new Map<string, Set<string>>()
  const add = (a: string, b: string) => {
    let s = adj.get(a)
    if (!s) adj.set(a, (s = new Set()))
    s.add(b)
  }
  for (const n of index.notes.values()) {
    for (const r of resolvedTargets(index, n)) {
      if (r === n.path || !index.notes.has(r)) continue
      add(n.path, r)
      add(r, n.path)
    }
  }
  return adj
}

// Index entries are replaced when a note changes, so these per-entry caches stay valid; link
// targets also depend on the file list, so they are cached per lookup table.
const targetCache = new WeakMap<object, { lookup: object; targets: string[] }>()
function resolvedTargets(index: NoteIndex, n: IndexedNote): string[] {
  const hit = targetCache.get(n)
  if (hit && hit.lookup === index.lookup) return hit.targets
  const targets = n.meta.links.flatMap((l) => (l.target ? index.resolve(l.target, n.path) ?? [] : []))
  targetCache.set(n, { lookup: index.lookup, targets })
  return targets
}
const titleCache = new WeakMap<object, Set<string>>()

const titleTokens = (index: NoteIndex, path: string) => {
  const n = index.notes.get(path)
  const hit = n && titleCache.get(n)
  if (hit) return hit
  const words = new Set(noteTerms([noteTitle(path), ...(n?.meta.headings.map((h) => h.text) ?? [])].join(' ')).keys())
  if (n) titleCache.set(n, words)
  return words
}

/**
 * Notes related to `path`, best first. Scores: +3 per shared tag, +2 per note both are linked
 * with, +1 per shared distinctive term (only when at least two are shared), +2 per shared
 * title/heading word. Notes already linked to or from `path`, and dismissed pairs, are left out.
 */
export function relatedNotes(index: NoteIndex, path: string, opts: { dismissed?: Set<string>; limit?: number } = {}): RelatedNote[] {
  const self = index.notes.get(path)
  if (!self) return []
  const limit = opts.limit ?? 10
  const adj = adjacency(index)
  const linked = adj.get(path) ?? new Set<string>()
  const found = new Map<string, RelatedNote>()
  const get = (p: string) => {
    let r = found.get(p)
    if (!r) found.set(p, (r = { path: p, score: 0, tags: [], via: [], terms: [], titleWords: [] }))
    return r
  }
  const skip = (p: string) => p === path || !isNote(p) || linked.has(p) || !!opts.dismissed?.has(pairKey(path, p))

  // tags
  const myTags = new Map(self.meta.tags.map((t) => [t.toLowerCase(), t]))
  // distinctive terms: the note's 12 highest tf·idf words that appear in 2..N/2 notes
  const N = index.notes.size
  const myTerms = [...(self.terms ?? noteTerms(self.content))]
    .map(([t, tf]) => ({ t, df: index.df.get(t) ?? 1, tf }))
    .filter((x) => x.df >= 2 && x.df <= Math.max(2, N / 2))
    .map((x) => ({ t: x.t, w: x.tf * Math.log(N / x.df) }))
    .sort((a, b) => b.w - a.w || (a.t < b.t ? -1 : 1))
    .slice(0, 12)
    .map((x) => x.t)
  const myTitle = titleTokens(index, path)

  for (const n of index.notes.values()) {
    if (skip(n.path)) continue
    for (const t of n.meta.tags) {
      const mine = myTags.get(t.toLowerCase())
      if (mine) {
        const r = get(n.path)
        if (!r.tags.includes(mine)) {
          r.tags.push(mine)
          r.score += 3
        }
      }
    }
    if (myTerms.length) {
      const terms = n.terms ?? noteTerms(n.content)
      const shared = myTerms.filter((t) => terms.has(t))
      if (shared.length >= 2) {
        const r = get(n.path)
        r.terms = shared.slice(0, 5)
        r.score += shared.length
      }
    }
    if (myTitle.size) {
      const shared = [...titleTokens(index, n.path)].filter((w) => myTitle.has(w))
      if (shared.length) {
        const r = get(n.path)
        r.titleWords = shared.slice(0, 3)
        r.score += 2 * shared.length
      }
    }
  }

  // notes reachable through one shared neighbour
  for (const mid of linked) {
    for (const p of adj.get(mid) ?? []) {
      if (skip(p)) continue
      const r = get(p)
      r.via.push(mid)
      r.score += 2
    }
  }

  return [...found.values()]
    .filter((r) => r.score >= 2)
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, limit)
}
