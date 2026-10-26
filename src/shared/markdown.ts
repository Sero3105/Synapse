// Pure note-analysis helpers: link/tag/heading extraction, link resolution, search,
// link rewriting on rename. Shared by renderer and tests.

export interface Link {
  /** Target as written, without alias or #subpath: "folder/Note" */
  target: string
  subpath: string
  alias: string
  embed: boolean
  kind: 'wiki' | 'md'
  /** Character offsets of the whole link in the source text. */
  start: number
  end: number
  line: number
}

export interface Heading { level: number; text: string; line: number }

export interface NoteMeta { links: Link[]; tags: string[]; headings: Heading[] }

/** Ranges inside fenced/inline code where links and tags are not parsed. */
function codeRanges(text: string): [number, number][] {
  const ranges: [number, number][] = []
  const fence = /^(\s{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1?\2[^\n]*$|(?![\s\S]))/gm
  let m: RegExpExecArray | null
  while ((m = fence.exec(text))) ranges.push([m.index, m.index + m[0].length])
  const inline = /`[^`\n]+`/g
  while ((m = inline.exec(text))) if (!inRanges(ranges, m.index)) ranges.push([m.index, m.index + m[0].length])
  return ranges
}

const inRanges = (r: [number, number][], i: number) => r.some(([a, b]) => i >= a && i < b)

function lineAt(text: string, offset: number, lineStarts: number[]) {
  let lo = 0
  let hi = lineStarts.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lineStarts[mid] <= offset) lo = mid
    else hi = mid - 1
  }
  return lo
}

function frontmatterEnd(text: string): number {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return 0
  const m = /\n---\s*(\n|$)/.exec(text.slice(3))
  return m ? 3 + m.index + m[0].length : 0
}

function frontmatterTags(text: string, end: number): string[] {
  if (!end) return []
  const fm = text.slice(0, end)
  const out: string[] = []
  const inline = /^tags:[ \t]*\[([^\]]*)\]/m.exec(fm)
  if (inline) out.push(...inline[1].split(','))
  const single = /^tags:[ \t]*([^\s[][^\n]*)$/m.exec(fm)
  if (single) out.push(...single[1].split(/[,\s]+/))
  const list = /^tags:[ \t]*\n((?:[ \t]*-[ \t]+[^\n]+\n?)+)/m.exec(fm)
  if (list) out.push(...list[1].split('\n').map((l) => l.replace(/^\s*-\s*/, '')))
  return out.map((t) => t.trim().replace(/^["']|["']$/g, '').replace(/^#/, '')).filter(Boolean).map((t) => '#' + t)
}

export function parseNote(text: string): NoteMeta {
  const code = codeRanges(text)
  const lineStarts = [0]
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1)
  const fmEnd = frontmatterEnd(text)
  const links: Link[] = []
  let m: RegExpExecArray | null

  const wiki = /(!?)\[\[([^\[\]\n]+?)\]\]/g
  while ((m = wiki.exec(text))) {
    if (inRanges(code, m.index) || m.index < fmEnd) continue
    const [raw, alias = ''] = splitOnce(m[2], '|')
    const [target, subpath = ''] = splitOnce(raw, '#')
    links.push({ target: target.trim(), subpath, alias, embed: m[1] === '!', kind: 'wiki', start: m.index, end: m.index + m[0].length, line: lineAt(text, m.index, lineStarts) })
  }

  const md = /(!?)\[([^\]\n]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  while ((m = md.exec(text))) {
    if (inRanges(code, m.index) || m.index < fmEnd) continue
    const url = m[3].replace(/^<|>$/g, '')
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) continue // external / anchor-only
    let decoded = url
    try {
      decoded = decodeURI(url)
    } catch { /* keep raw */ }
    const [target, subpath = ''] = splitOnce(decoded, '#')
    links.push({ target, subpath, alias: m[2], embed: m[1] === '!', kind: 'md', start: m.index, end: m.index + m[0].length, line: lineAt(text, m.index, lineStarts) })
  }
  links.sort((a, b) => a.start - b.start)

  const tags = new Set<string>(frontmatterTags(text, fmEnd))
  const tagRe = /(^|[\s(,])#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu
  while ((m = tagRe.exec(text))) {
    const at = m.index + m[1].length
    if (inRanges(code, at) || at < fmEnd) continue
    // "# Heading" has a space after #, so it never matches; pure numbers (#123) are not tags.
    tags.add('#' + m[2])
  }

  const headings: Heading[] = []
  const hRe = /^(#{1,6})[ \t]+(.+?)[ \t#]*$/gm
  while ((m = hRe.exec(text))) {
    if (inRanges(code, m.index) || m.index < fmEnd) continue
    headings.push({ level: m[1].length, text: m[2], line: lineAt(text, m.index, lineStarts) })
  }

  return { links, tags: [...tags], headings }
}

function splitOnce(s: string, sep: string): [string, string?] {
  const i = s.indexOf(sep)
  return i < 0 ? [s] : [s.slice(0, i), s.slice(i + 1)]
}

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '')
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1)
export const stripMd = (p: string) => p.replace(/\.md$/i, '')
export const noteTitle = (p: string) => stripMd(basename(p))

/** Lookup table: lowercased file basename -> files with that basename. */
export function buildLookup(paths: string[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const p of paths) {
    const k = basename(p).normalize('NFC').toLowerCase()
    const list = map.get(k)
    if (list) list.push(p)
    else map.set(k, [p])
  }
  for (const list of map.values()) list.sort(byDepthThenAlpha)
  return map
}

const byDepthThenAlpha = (a: string, b: string) => a.split('/').length - b.split('/').length || a.localeCompare(b)

/**
 * Resolve a link target to a vault path, mirroring the observed reference behavior:
 * case-insensitive; ".md" is implied; relative ("./", "../") paths resolve against the
 * source folder; otherwise an exact vault path wins, then any file whose path ends with
 * the target, preferring files under the source note's folder.
 */
export function resolveLink(target: string, sourcePath: string, lookup: Map<string, string[]>): string | null {
  if (!target) return sourcePath // [[#Heading]] links to self
  let n = target.normalize('NFC').toLowerCase()
  let cands = n.includes('.') ? lookup.get(basename(n)) : undefined
  if (!cands) {
    n = n + '.md'
    cands = lookup.get(basename(n))
  }
  if (!cands) return null
  if (!n.includes('/') && cands.length === 1) return cands[0]
  const srcDir = dirname(sourcePath).toLowerCase()
  if (n.startsWith('./') || n.startsWith('../')) {
    let dir = srcDir
    let rest = n.replace(/^\.\//, '')
    while (rest.startsWith('../')) {
      rest = rest.slice(3)
      dir = dirname(dir)
    }
    const full = dir ? `${dir}/${rest}` : rest
    return cands.find((c) => c.toLowerCase() === full) ?? null
  }
  if (n.startsWith('/')) n = n.slice(1)
  const exact = cands.find((c) => c.toLowerCase() === n)
  if (exact) return exact
  if (target.startsWith('/')) return null
  const suffix = cands.filter((c) => {
    const l = c.toLowerCase()
    return l === n || l.endsWith('/' + n)
  })
  const near = suffix.filter((c) => srcDir && c.toLowerCase().startsWith(srcDir + '/'))
  return near[0] ?? suffix[0] ?? null
}

/** Shortest link text that uniquely resolves to `path` (reference default "shortest"). */
export function shortestLinkText(path: string, lookup: Map<string, string[]>): string {
  const same = lookup.get(basename(path).toLowerCase()) ?? []
  const p = path.toLowerCase().endsWith('.md') ? stripMd(path) : path
  return same.length <= 1 ? basename(p) : p
}

// ---------- index ----------

export interface IndexedNote { path: string; content: string; meta: NoteMeta; terms?: Map<string, number> }

// Common words carry no topic; dropped from term statistics (English and Italian, 4+ letters).
const STOPWORDS = new Set(
  ('that this with from have they will what when there their which about would these other into more some than then them been were your also only just like ' +
    'could should after before where while being does here very much many most such each over under same well make made want need know ' +
    'della delle degli dello sono come anche questo questa questi queste quello quella nella nelle negli alla alle dalla dalle perché però molto ' +
    'tutti tutto tutte essere hanno fare dove quando ogni senza ancora cosa così loro sulla sulle stato stata fatto prima dopo mentre').split(' '),
)

/** Word counts of a note's prose (no code, URLs or frontmatter), lowercased, 4+ letters. */
export function noteTerms(content: string): Map<string, number> {
  const text = content
    .slice(frontmatterEnd(content))
    .replace(/^(\s{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^\1?\2[^\n]*$|(?![\s\S]))/gm, ' ')
    .replace(/`[^`\n]+`|https?:\/\/\S+/g, ' ')
    .toLowerCase()
  const out = new Map<string, number>()
  for (const w of text.match(/\p{L}[\p{L}\p{N}'’-]{3,}/gu) ?? []) if (!STOPWORDS.has(w)) out.set(w, (out.get(w) ?? 0) + 1)
  return out
}

export class NoteIndex {
  notes = new Map<string, IndexedNote>()
  /** All vault file paths (notes + attachments) for resolution. */
  files: string[] = []
  lookup = new Map<string, string[]>()
  /** Number of notes containing each term, kept in step with upsert/remove. */
  df = new Map<string, number>()

  setFiles(paths: string[]) {
    this.files = paths
    this.lookup = buildLookup(paths)
  }

  upsert(path: string, content: string) {
    const prev = this.notes.get(path)
    if (prev?.content === content) return
    this.countTerms(prev, -1)
    const n = { path, content, meta: parseNote(content), terms: noteTerms(content) }
    this.countTerms(n, 1)
    this.notes.set(path, n)
  }

  remove(path: string) {
    this.countTerms(this.notes.get(path), -1)
    this.notes.delete(path)
  }

  private countTerms(n: IndexedNote | undefined, d: 1 | -1) {
    for (const t of n?.terms?.keys() ?? []) {
      const c = (this.df.get(t) ?? 0) + d
      if (c > 0) this.df.set(t, c)
      else this.df.delete(t)
    }
  }

  resolve(target: string, source: string) {
    return resolveLink(target, source, this.lookup)
  }

  outgoing(path: string) {
    const n = this.notes.get(path)
    if (!n) return []
    return n.meta.links.map((l) => ({ link: l, resolved: this.resolve(l.target, path) }))
  }

  /** Notes linking to `path`, with the lines containing the links. */
  backlinks(path: string) {
    const out: { source: string; links: Link[] }[] = []
    for (const n of this.notes.values()) {
      if (n.path === path) continue
      const links = n.meta.links.filter((l) => l.target && this.resolve(l.target, n.path) === path)
      if (links.length) out.push({ source: n.path, links })
    }
    return out.sort((a, b) => a.source.localeCompare(b.source))
  }

  /** Plain-text mentions of the note title in notes that don't already link to it. */
  unlinkedMentions(path: string) {
    const title = noteTitle(path)
    if (title.length < 2) return []
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(title)}(?![\\p{L}\\p{N}])`, 'iu')
    const linked = new Set(this.backlinks(path).map((b) => b.source))
    const out: { source: string; line: number; text: string }[] = []
    for (const n of this.notes.values()) {
      if (n.path === path || linked.has(n.path)) continue
      const lines = n.content.split('\n')
      for (let i = 0; i < lines.length; i++) {
        const stripped = lines[i].replace(/\[\[[^\]]*\]\]|\[[^\]]*\]\([^)]*\)/g, '')
        if (re.test(stripped)) out.push({ source: n.path, line: i, text: lines[i] })
      }
    }
    return out
  }

  tags(): Map<string, number> {
    const counts = new Map<string, number>()
    const display = new Map<string, string>()
    for (const n of this.notes.values()) {
      for (const t of n.meta.tags) {
        const k = t.toLowerCase()
        display.set(k, display.get(k) ?? t)
        counts.set(k, (counts.get(k) ?? 0) + 1)
      }
    }
    return new Map([...counts].map(([k, c]) => [display.get(k)!, c]))
  }

  /** Unique resolved edges (source -> target) plus unresolved targets. */
  graph() {
    const edges = new Set<string>()
    const unresolved = new Map<string, Set<string>>()
    for (const n of this.notes.values()) {
      for (const l of n.meta.links) {
        if (!l.target) continue
        const r = this.resolve(l.target, n.path)
        if (r && r !== n.path) edges.add(`${n.path}\u0000${r}`)
        else if (!r) {
          const key = l.target.toLowerCase()
          if (!unresolved.has(key)) unresolved.set(key, new Set())
          unresolved.get(key)!.add(n.path)
        }
      }
    }
    return { edges: [...edges].map((e) => e.split('\u0000') as [string, string]), unresolved }
  }

  search(query: string, limit = 200) {
    return searchNotes([...this.notes.values()], query, limit)
  }
}

export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- search ----------
// Query syntax: words are ANDed; "quoted phrase"; -exclude; tag:#x; path:foo; file:name.

export interface SearchHit { path: string; titleMatch: boolean; matches: { line: number; text: string; ranges: [number, number][] }[] }

interface Term { kind: 'text' | 'tag' | 'path' | 'file'; value: string; neg: boolean }

/** Examples shown under an empty search field; test/markdown.test.ts checks each one against the parser. */
export const SEARCH_SYNTAX = [
  { example: 'memory recall', hint: 'search.hintWords' },
  { example: '"spaced repetition"', hint: 'search.hintPhrase' },
  { example: '-draft', hint: 'search.hintExclude' },
  { example: 'tag:#project', hint: 'search.hintTag' },
  { example: 'path:Research', hint: 'search.hintPath' },
  { example: 'file:roadmap', hint: 'search.hintFile' },
] as const

export function parseQuery(q: string): Term[] {
  const terms: Term[] = []
  const re = /(-?)(?:(tag|path|file):)?(?:"([^"]*)"|(\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(q))) {
    const value = (m[3] ?? m[4] ?? '').toLowerCase()
    if (!value) continue
    terms.push({ kind: (m[2] as Term['kind']) ?? 'text', value, neg: m[1] === '-' })
  }
  return terms
}

export function searchNotes(notes: IndexedNote[], query: string, limit = 200): SearchHit[] {
  const terms = parseQuery(query)
  if (!terms.length) return []
  const hits: SearchHit[] = []
  for (const n of notes) {
    const lower = n.content.toLowerCase()
    const pathL = n.path.toLowerCase()
    const tags = n.meta.tags.map((t) => t.toLowerCase())
    const ok = terms.every((t) => {
      let found: boolean
      if (t.kind === 'tag') {
        const v = t.value.startsWith('#') ? t.value : '#' + t.value
        found = tags.some((x) => x === v || x.startsWith(v + '/'))
      } else if (t.kind === 'path') found = pathL.includes(t.value)
      else if (t.kind === 'file') found = noteTitle(pathL).includes(t.value)
      else found = lower.includes(t.value) || noteTitle(pathL).includes(t.value)
      return t.neg ? !found : found
    })
    if (!ok) continue
    const textTerms = terms.filter((t) => t.kind === 'text' && !t.neg).map((t) => t.value)
    const matches: SearchHit['matches'] = []
    if (textTerms.length) {
      const lines = n.content.split('\n')
      for (let i = 0; i < lines.length && matches.length < 20; i++) {
        const ll = lines[i].toLowerCase()
        const ranges: [number, number][] = []
        for (const t of textTerms) {
          let at = ll.indexOf(t)
          while (at >= 0) {
            ranges.push([at, at + t.length])
            at = ll.indexOf(t, at + t.length)
          }
        }
        if (ranges.length) matches.push({ line: i, text: lines[i], ranges: ranges.sort((a, b) => a[0] - b[0]) })
      }
    }
    const titleMatch = textTerms.some((t) => noteTitle(pathL).includes(t))
    hits.push({ path: n.path, titleMatch, matches })
    if (hits.length >= limit) break
  }
  return hits.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.matches.length - a.matches.length || a.path.localeCompare(b.path))
}

/** Subsequence fuzzy score (higher is better), or -1 if no match. */
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
    if (i === 0 || /[\s/_\-.]/.test(t[i - 1])) score += 3
    prev = i
    ti = i + 1
  }
  if (t.includes(q)) score += 10
  return score - t.length * 0.01
}

// ---------- rename support ----------

/**
 * Rewrite links in `content` (of note `sourcePath`) that resolved to a renamed file.
 * `moves` maps old path -> new path; `before` resolves with the pre-rename lookup,
 * `after` is the lookup including new paths. Returns null if nothing changed.
 */
export function rewriteLinks(
  content: string,
  sourcePath: string,
  moves: Map<string, string>,
  before: Map<string, string[]>,
  after: Map<string, string[]>,
): string | null {
  const meta = parseNote(content)
  let out = ''
  let last = 0
  let changed = false
  for (const l of meta.links) {
    if (!l.target) continue
    const old = resolveLink(l.target, sourcePath, before)
    const neu = old ? moves.get(old) : undefined
    if (!neu) continue
    const sub = l.subpath ? '#' + l.subpath : ''
    let text: string
    if (l.kind === 'wiki') {
      const target = shortestLinkText(neu, after)
      text = `${l.embed ? '!' : ''}[[${target}${sub}${l.alias ? '|' + l.alias : ''}]]`
    } else {
      text = `${l.embed ? '!' : ''}[${l.alias}](${encodeURI(neu).replace(/\(/g, '%28').replace(/\)/g, '%29')}${sub ? encodeURI(sub) : ''})`
    }
    out += content.slice(last, l.start) + text
    last = l.end
    changed = true
  }
  return changed ? out + content.slice(last) : null
}

/** Next free "Untitled.md", "Untitled 1.md", ... in `folder`. */
export function uniqueName(existing: Set<string>, folder: string, base: string, ext: string) {
  const join = (name: string) => (folder ? `${folder}/${name}` : name)
  const lower = new Set([...existing].map((p) => p.toLowerCase()))
  let candidate = join(`${base}${ext}`)
  for (let i = 1; lower.has(candidate.toLowerCase()); i++) candidate = join(`${base} ${i}${ext}`)
  return candidate
}

/** Characters not allowed in note names (cross-platform safe + link syntax). */
export const INVALID_NAME = /[\\/:*?"<>|#^[\]]/

export function wordCount(text: string) {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
  return { words: words?.length ?? 0, chars: text.length }
}
