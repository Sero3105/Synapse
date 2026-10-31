// Read-only inspection of a Markdown folder before it is opened as a vault.
// No electron imports and no writes: opening is what adds `.synapse/`, this only reads.
import fs from 'node:fs'
import path from 'node:path'
import { Vault, MARKDOWN_EXT } from './vault'
import { VAULT_CONFIG_DIR } from './store'
import { NoteIndex, noteTitle } from '../shared/markdown'

export interface LinkIssue { source: string; target: string }
export interface ImportReport {
  notes: number
  attachments: number
  folders: number
  /** links to notes that do not exist (first 50; total in unresolvedCount) */
  unresolved: LinkIssue[]
  unresolvedCount: number
  /** embeds/links to non-note files that do not exist */
  missing: LinkIssue[]
  missingCount: number
  /** note names used more than once: [[name]] links to them are ambiguous */
  duplicates: { name: string; paths: string[] }[]
  /** syntax from other apps that Synapse shows as plain text */
  syntax: { kind: SyntaxKind; count: number; examples: string[] }[]
  /** an Obsidian config folder exists (left untouched) */
  obsidian: boolean
  /** already opened by Synapse before (has `.synapse/`): no preview needed */
  known: boolean
}

export type SyntaxKind = 'dataview' | 'blockRef'

const SYNTAX: [SyntaxKind, RegExp][] = [
  ['dataview', /^\s*```+\s*dataview(js)?\b/im],
  ['blockRef', /\s\^[A-Za-z0-9-]+\s*$|\[\[[^\]]*#\^[^\]]*\]\]/m],
]
const CAP = 50

/** Pure analysis of a folder's files (all vault-relative paths) and note contents. */
export function analyzeNotes(files: string[], notes: { path: string; content: string }[], folders = 0): Omit<ImportReport, 'obsidian' | 'known'> {
  const index = new NoteIndex()
  index.setFiles(files)
  for (const n of notes) index.upsert(n.path, n.content)
  const unresolved: LinkIssue[] = []
  const missing: LinkIssue[] = []
  let unresolvedCount = 0
  let missingCount = 0
  const seen = new Set<string>()
  for (const n of index.notes.values()) {
    for (const l of n.meta.links) {
      if (!l.target || index.resolve(l.target, n.path)) continue
      const key = `${n.path}\u0000${l.target.toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      // a target with a non-.md extension is a file (image, PDF, …), otherwise a note
      const isFile = /\.[a-z0-9]{1,8}$/i.test(l.target) && !MARKDOWN_EXT.test(l.target)
      if (isFile) {
        missingCount++
        if (missing.length < CAP) missing.push({ source: n.path, target: l.target })
      } else {
        unresolvedCount++
        if (unresolved.length < CAP) unresolved.push({ source: n.path, target: l.target })
      }
    }
  }
  const byName = new Map<string, string[]>()
  for (const p of notes.map((n) => n.path)) {
    const k = noteTitle(p).toLowerCase()
    byName.set(k, [...(byName.get(k) ?? []), p])
  }
  const duplicates = [...byName.values()].filter((ps) => ps.length > 1).map((ps) => ({ name: noteTitle(ps[0]), paths: ps.sort() }))
  const syntax = SYNTAX.map(([kind, re]) => {
    const hits = notes.filter((n) => re.test(n.content)).map((n) => n.path).sort()
    return { kind, count: hits.length, examples: hits.slice(0, 5) }
  }).filter((s) => s.count > 0)
  return {
    notes: notes.length,
    attachments: files.filter((f) => !MARKDOWN_EXT.test(f)).length,
    folders,
    unresolved,
    unresolvedCount,
    missing,
    missingCount,
    duplicates,
    syntax,
  }
}

/** Inspect `abs` without writing anything (no `.synapse/` is created). Symlinks are not followed. */
export async function inspectFolder(abs: string): Promise<ImportReport> {
  const known = fs.existsSync(path.join(abs, VAULT_CONFIG_DIR))
  const obsidian = fs.existsSync(path.join(abs, '.obsidian'))
  // The Vault class only reads here: list/readAllMarkdown never write.
  const vault = new Vault(abs, async () => {})
  const entries = await vault.list()
  const files = entries.filter((e) => e.type === 'file').map((e) => e.path)
  const notes = await vault.readAllMarkdown()
  return { ...analyzeNotes(files, notes, entries.length - files.length), obsidian, known }
}
