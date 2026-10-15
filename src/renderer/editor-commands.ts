// Small text-editing commands used by hotkeys and the command palette.
import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

/** Wrap/unwrap each selection with `mark` (e.g. ** for bold). */
export function toggleWrap(view: EditorView, mark: string) {
  const { state } = view
  const n = mark.length
  view.dispatch(
    state.changeByRange((r) => {
      const before = state.sliceDoc(r.from - n, r.from)
      const after = state.sliceDoc(r.to, r.to + n)
      if (before === mark && after === mark) {
        return {
          changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }],
          range: EditorSelection.range(r.from - n, r.to - n),
        }
      }
      const text = state.sliceDoc(r.from, r.to)
      if (text.length >= 2 * n && text.startsWith(mark) && text.endsWith(mark)) {
        return { changes: { from: r.from, to: r.to, insert: text.slice(n, -n) }, range: EditorSelection.range(r.from, r.to - 2 * n) }
      }
      return {
        changes: [{ from: r.from, insert: mark }, { from: r.to, insert: mark }],
        range: EditorSelection.range(r.from + n, r.to + n),
      }
    }),
  )
}

export function insertLink(view: EditorView, wiki: boolean) {
  const { state } = view
  view.dispatch(
    state.changeByRange((r) => {
      const text = state.sliceDoc(r.from, r.to)
      if (wiki) {
        const insert = `[[${text}]]`
        return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(r.from + 2 + text.length) }
      }
      const insert = `[${text}]()`
      // cursor inside () when text given, otherwise inside []
      const pos = text ? r.from + text.length + 3 : r.from + 1
      return { changes: { from: r.from, to: r.to, insert }, range: EditorSelection.cursor(pos) }
    }),
  )
}

/** Cycle "- [ ] " <-> "- [x] "; plain lines become unchecked tasks. */
export function toggleChecklist(view: EditorView) {
  editLines(view, (line) => {
    const m = /^(\s*)([-*+]|\d+[.)])\s+\[( |x|X)\]\s?/.exec(line)
    if (m) return line.replace(/\[( |x|X)\]/, m[3] === ' ' ? '[x]' : '[ ]')
    const b = /^(\s*)([-*+]|\d+[.)])\s+/.exec(line)
    if (b) return line.slice(0, b[0].length) + '[ ] ' + line.slice(b[0].length)
    const indent = /^\s*/.exec(line)![0]
    return `${indent}- [ ] ${line.slice(indent.length)}`
  })
}

export function toggleLinePrefix(view: EditorView, prefix: string) {
  const re = prefix === '1. ' ? /^(\s*)\d+[.)]\s/ : new RegExp('^(\\s*)' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const lines = selectedLines(view)
  const all = lines.every((l) => re.test(l.text))
  editLines(view, (line) => {
    if (all) return line.replace(re, '$1')
    const indent = /^\s*/.exec(line)![0]
    return indent + prefix + line.slice(indent.length)
  })
}

export function setHeading(view: EditorView, level: number) {
  editLines(view, (line) => {
    const rest = line.replace(/^#{1,6}\s+/, '')
    return level ? '#'.repeat(level) + ' ' + rest : rest
  })
}

export function deleteLine(view: EditorView) {
  const { state } = view
  const lines = selectedLines(view)
  const from = lines[0].from
  const last = lines[lines.length - 1]
  const to = Math.min(last.to + 1, state.doc.length)
  view.dispatch({ changes: { from: to === state.doc.length && from > 0 ? from - 1 : from, to }, scrollIntoView: true })
}

function selectedLines(view: EditorView) {
  const { state } = view
  const seen = new Set<number>()
  const out: { from: number; to: number; text: string }[] = []
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const l = state.doc.line(n)
      out.push({ from: l.from, to: l.to, text: l.text })
    }
  }
  return out.sort((a, b) => a.from - b.from)
}

function editLines(view: EditorView, fn: (line: string) => string) {
  view.dispatch({ changes: selectedLines(view).map((l) => ({ from: l.from, to: l.to, insert: fn(l.text) })) })
}
