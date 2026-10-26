// Attachment report: links to attachments that do not resolve, and attachments nothing links to.
// Pure: works on the in-memory NoteIndex (vault-relative paths only), never on the disk.
import { NoteIndex, basename } from './markdown'

/** File types treated as attachments when a link to them does not resolve (a "v1.2" note title is not one). */
export const ATTACHMENT_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif|heic|tiff?|pdf|mp3|wav|m4a|ogg|flac|mp4|mov|webm|mkv|csv|tsv|txt|json|zip|docx?|xlsx?|pptx?|key|pages|numbers|epub)$/i

export interface AttachmentRef { source: string; line: number }
export interface MissingAttachment { target: string; source: string; line: number; embed: boolean }
export interface UnusedAttachment { path: string }
export interface AttachmentReport {
  missing: MissingAttachment[]
  unused: UnusedAttachment[]
  /** attachment path -> notes linking or embedding it */
  refs: Map<string, AttachmentRef[]>
}

const EXT_TOKEN = /^\.[\p{L}\p{N}_%-]+$/u
const isNote = (p: string) => /\.md$/i.test(p)
const fold = (s: string) => s.normalize('NFC').toLowerCase()

export function attachmentReport(index: NoteIndex): AttachmentReport {
  const refs = new Map<string, AttachmentRef[]>()
  const missing: MissingAttachment[] = []
  for (const n of index.notes.values()) {
    for (const l of n.meta.links) {
      if (!l.target) continue
      const r = index.resolve(l.target, n.path)
      if (r && !isNote(r)) {
        const list = refs.get(r) ?? []
        list.push({ source: n.path, line: l.line })
        refs.set(r, list)
      } else if (!r && ATTACHMENT_EXT.test(basename(l.target))) {
        missing.push({ target: l.target, source: n.path, line: l.line, embed: l.embed })
      }
    }
  }
  // A name that appears anywhere in note text (frontmatter, raw HTML, code) may still be in use: not flagged.
  // macOS file names are often NFD while typed text is NFC; percent-encoding keeps that difference.
  const variants = (name: string) => [...new Set(['NFC', 'NFD'].flatMap((f) => {
    const s = name.normalize(f)
    return [s, encodeURIComponent(s), encodeURI(s)]
  }).map(fold))]
  const candidates = index.files.filter((p) => !isNote(p) && !refs.has(p))
  // One pass over the text: every ".ext" occurrence is checked only against names ending in that ext.
  const byExt = new Map<string, string[]>()
  const plain: string[] = []
  for (const p of candidates)
    for (const v of variants(basename(p))) {
      const ext = v.slice(v.lastIndexOf('.'))
      if (!EXT_TOKEN.test(ext)) plain.push(v) // no or unusual extension: plain substring check
      else byExt.set(ext, [...(byExt.get(ext) ?? []), v])
    }
  const text = fold([...index.notes.values()].map((n) => n.content).join('\n'))
  const found = new Set<string>(plain.filter((v) => text.includes(v)))
  for (const m of text.matchAll(/\.[\p{L}\p{N}_%-]+/gu)) {
    const end = m.index + m[0].length
    for (const v of byExt.get(m[0]) ?? []) if (!found.has(v) && end >= v.length && text.startsWith(v, end - v.length)) found.add(v)
  }
  const unused = candidates
    .filter((p) => !variants(basename(p)).some((v) => found.has(v)))
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path }))
  missing.sort((a, b) => a.source.localeCompare(b.source) || a.line - b.line)
  return { missing, unused, refs }
}
