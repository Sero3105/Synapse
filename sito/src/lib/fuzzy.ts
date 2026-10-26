// Same scoring as the app's `[[` autocomplete (src/shared/markdown.ts in the repository), so the
// demo on the homepage ranks notes the way Synapse does.
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let score = 0
  let ti = 0
  let prev = -2
  for (const ch of q) {
    const i = t.indexOf(ch, ti)
    if (i < 0) return -1
    score += i === prev + 1 ? 5 : 1
    if (i === 0 || /[\s/_\-.]/.test(t[i - 1] ?? '')) score += 3
    prev = i
    ti = i + 1
  }
  if (t.includes(q)) score += 10
  return score - t.length * 0.01
}

export interface NoteMatch {
  title: string
  folder: string
}

/** Notes ranked like the `[[` autocomplete; `query` may include the leading `[[`. */
export function matchNotes(paths: readonly string[], query: string, limit = 3): NoteMatch[] {
  const q = query.replace(/^\[\[/, '').replace(/\]\]$/, '')
  return paths
    .map((p) => ({ p, s: fuzzyScore(q, p) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map(({ p }) => {
      const slash = p.lastIndexOf('/')
      return { title: p.slice(slash + 1).replace(/\.md$/, ''), folder: slash > 0 ? p.slice(0, slash) : '' }
    })
}
