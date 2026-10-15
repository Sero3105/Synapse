// Live Preview for the CodeMirror editor: Markdown syntax is hidden except on the lines the
// cursor touches, and tables outside the cursor render as editable grids. The document text is
// never changed by rendering; every edit made through a widget is a normal (undoable) transaction.
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view'
import { EditorState, Range, StateField } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
import { parseTable, formatTable } from '../shared/table'
import { fileUrl } from './api'
import { model, IMAGE_EXT } from './model'
import { t } from '../shared/i18n'

const hide = Decoration.replace({})

class BulletWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lp-bullet'
    s.textContent = '•'
    return s
  }
}

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(o: CheckboxWidget) {
    return o.checked === this.checked
  }
  toDOM(view: EditorView) {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-lp-checkbox'
    box.checked = this.checked
    box.setAttribute('aria-label', t('lp.task'))
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(box)
      const mark = view.state.sliceDoc(pos, pos + 3)
      if (/^\[[ xX]\]$/.test(mark)) view.dispatch({ changes: { from: pos, to: pos + 3, insert: this.checked ? '[ ]' : '[x]' } })
    })
    return box
  }
  ignoreEvent() {
    return true
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM() {
    const s = document.createElement('span')
    s.className = 'cm-lp-hr'
    return s
  }
}

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super()
  }
  eq(o: ImageWidget) {
    return o.src === this.src
  }
  toDOM() {
    const img = document.createElement('img')
    img.className = 'cm-lp-image'
    img.src = this.src
    img.alt = this.alt
    return img
  }
}

/** Lines touched by any selection range; empty when the editor is not focused. */
function activeLines(view: EditorView): Set<number> {
  const out = new Set<number>()
  if (!view.hasFocus) return out
  for (const r of view.state.selection.ranges) {
    const a = view.state.doc.lineAt(r.from).number
    const b = view.state.doc.lineAt(r.to).number
    for (let n = a; n <= b; n++) out.add(n)
  }
  return out
}

function imageSrc(target: string, notePath: string): string | null {
  if (/^https?:\/\//i.test(target)) return target
  let decoded = target
  try {
    decoded = decodeURI(target)
  } catch { /* keep */ }
  const resolved = model.index.resolve(decoded.split('#')[0], notePath)
  return resolved && IMAGE_EXT.test(resolved) ? fileUrl(resolved) : null
}

function buildDecorations(view: EditorView, notePath: string): DecorationSet {
  const { state } = view
  const active = activeLines(view)
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number)
  const spanActive = (from: number, to: number) => {
    for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) if (active.has(n)) return true
    return false
  }
  const decos: Range<Decoration>[] = []
  const codeRanges: [number, number][] = []

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const n = node.node
        switch (node.name) {
          case 'FencedCode': {
            codeRanges.push([node.from, node.to])
            const first = state.doc.lineAt(node.from).number
            const last = state.doc.lineAt(node.to).number
            for (let l = first; l <= last; l++) {
              const line = state.doc.line(l)
              const cls = 'cm-lp-codeblock' + (l === first ? ' is-first' : '') + (l === last ? ' is-last' : '')
              decos.push(Decoration.line({ class: cls }).range(line.from))
            }
            if (!spanActive(node.from, node.to)) {
              for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === 'CodeMark' || c.name === 'CodeInfo') decos.push(hide.range(c.from, c.to))
            }
            return false
          }
          case 'InlineCode':
            codeRanges.push([node.from, node.to])
            if (!isActive(node.from)) for (let c = n.firstChild; c; c = c.nextSibling) if (c.name === 'CodeMark') decos.push(hide.range(c.from, c.to))
            return false
          case 'HeaderMark': {
            if (n.parent?.name.startsWith('ATXHeading') && !isActive(node.from)) {
              const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
              decos.push(hide.range(node.from, end))
            }
            return
          }
          case 'EmphasisMark':
          case 'StrikethroughMark':
            if (!isActive(node.from)) decos.push(hide.range(node.from, node.to))
            return
          case 'QuoteMark':
            if (!isActive(node.from)) {
              const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
              decos.push(hide.range(node.from, end))
            }
            decos.push(Decoration.line({ class: 'cm-lp-quote' }).range(state.doc.lineAt(node.from).from))
            return
          case 'HorizontalRule':
            if (!isActive(node.from)) decos.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to))
            return
          case 'ListMark': {
            if (isActive(node.from)) return
            const task = n.nextSibling?.name === 'Task' ? n.nextSibling.firstChild : null
            if (task?.name === 'TaskMarker') {
              // "- [ ] " -> checkbox only
              decos.push(hide.range(node.from, task.from))
              const checked = /x/i.test(state.sliceDoc(task.from, task.to))
              decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(task.from, task.to))
              if (checked) {
                const line = state.doc.lineAt(node.from)
                if (task.to < line.to) decos.push(Decoration.mark({ class: 'cm-lp-done' }).range(task.to, line.to))
              }
            } else if (/^[-*+]$/.test(state.sliceDoc(node.from, node.to))) {
              decos.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to))
            }
            return
          }
          case 'Link':
          case 'Image':
            linkDecorations(n, node.name === 'Image', state, isActive(node.from), notePath, decos)
            return false
        }
      },
    })

    // Wiki links and ==highlights== are not part of the Markdown grammar: match them per line.
    const inCode = (pos: number) => codeRanges.some(([a, b]) => pos >= a && pos < b)
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos)
      if (!active.has(line.number)) {
        const wiki = /(!?)\[\[([^[\]\n|#]*)(#[^[\]\n|]*)?(\|[^[\]\n]*)?\]\]/g
        let m: RegExpExecArray | null
        while ((m = wiki.exec(line.text))) {
          const start = line.from + m.index
          if (inCode(start)) continue
          const end = start + m[0].length
          if (m[1]) {
            const src = IMAGE_EXT.test(m[2]) ? imageSrc(m[2], notePath) : null
            if (src) {
              decos.push(Decoration.replace({ widget: new ImageWidget(src, m[2]) }).range(start, end))
              continue
            }
          }
          const labelFrom = m[4] ? end - 2 - (m[4].length - 1) : start + 2 + m[1].length
          decos.push(hide.range(start, labelFrom))
          decos.push(Decoration.mark({ class: 'cm-lp-link' }).range(labelFrom, end - 2))
          decos.push(hide.range(end - 2, end))
        }
        const hl = /==([^=\n]+)==/g
        while ((m = hl.exec(line.text))) {
          const start = line.from + m.index
          if (inCode(start)) continue
          const end = start + m[0].length
          decos.push(hide.range(start, start + 2), Decoration.mark({ class: 'cm-lp-highlight' }).range(start + 2, end - 2), hide.range(end - 2, end))
        }
      }
      pos = line.to + 1
    }
  }
  return Decoration.set(decos, true)
}

function linkDecorations(n: SyntaxNode, image: boolean, state: EditorState, active: boolean, notePath: string, decos: Range<Decoration>[]) {
  if (active) return
  const marks: SyntaxNode[] = []
  let url: SyntaxNode | null = null
  for (let c = n.firstChild; c; c = c.nextSibling) {
    if (c.name === 'LinkMark') marks.push(c)
    if (c.name === 'URL') url = c
  }
  // [text](url): marks are "[" "]" "(" ")" (images start with "![")
  if (marks.length < 4 || !url) return
  const textFrom = marks[0].to
  const textTo = marks[1].from
  if (image) {
    const src = imageSrc(state.sliceDoc(url.from, url.to), notePath)
    if (src) decos.push(Decoration.replace({ widget: new ImageWidget(src, state.sliceDoc(textFrom, textTo)) }).range(n.from, n.to))
    return
  }
  decos.push(hide.range(n.from, textFrom))
  if (textTo > textFrom) decos.push(Decoration.mark({ class: 'cm-lp-link' }).range(textFrom, textTo))
  decos.push(hide.range(textTo, n.to))
}

export function livePreview(notePath: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, notePath)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.selectionSet || u.viewportChanged || u.focusChanged || syntaxTree(u.state) !== syntaxTree(u.startState))
          this.decorations = buildDecorations(u.view, notePath)
      }
    },
    { decorations: (v) => v.decorations },
  )
}

// ---------- tables ----------

class TableWidget extends WidgetType {
  /** Current Markdown of the table; updated in place as cells are edited so the DOM is kept. */
  constructor(public text: string) {
    super()
  }

  eq(other: TableWidget) {
    return other.text === this.text
  }

  toDOM(view: EditorView) {
    const table = parseTable(this.text)!
    const wrap = document.createElement('div')
    wrap.className = 'cm-lp-table'
    const grid = document.createElement('table')
    const commit = () => {
      const read = (tr: HTMLTableRowElement) => [...tr.cells].map((td) => td.textContent ?? '')
      const rows = [...grid.rows]
      const next = formatTable({ header: read(rows[0]), delimiter: table.delimiter, rows: rows.slice(1).map(read) })
      if (next === this.text) return
      const from = view.posAtDOM(wrap)
      const old = this.text
      this.text = next
      view.dispatch({ changes: { from, to: from + old.length, insert: next } })
    }
    const addRow = (cells: string[], header: boolean) => {
      const tr = grid.insertRow()
      cells.forEach((value, i) => {
        const td = document.createElement(header ? 'th' : 'td')
        td.textContent = value
        td.contentEditable = 'plaintext-only'
        td.spellcheck = false
        const align = table.delimiter[i]
        if (align?.endsWith(':')) td.style.textAlign = align.startsWith(':') ? 'center' : 'right'
        td.addEventListener('input', commit)
        td.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            const below = grid.rows[tr.rowIndex + 1]?.cells[i] as HTMLElement | undefined
            ;(below ?? td).focus()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            view.focus()
          }
        })
        tr.appendChild(td)
      })
    }
    addRow(table.header, true)
    table.rows.forEach((r) => addRow(r, false))
    wrap.appendChild(grid)

    const tools = document.createElement('div')
    tools.className = 'cm-lp-table-tools'
    const btn = (label: string, run: () => void) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('mousedown', (e) => e.preventDefault())
      b.addEventListener('click', run)
      tools.appendChild(b)
    }
    btn(t('table.addRow'), () => {
      addRow(table.header.map(() => ''), false)
      commit()
      ;(grid.rows[grid.rows.length - 1].cells[0] as HTMLElement).focus()
    })
    btn(t('table.markdown'), () => {
      const from = view.posAtDOM(wrap)
      view.dispatch({ selection: { anchor: from + 1 } })
      view.focus()
    })
    wrap.appendChild(tools)
    return wrap
  }

  ignoreEvent() {
    return true
  }
}

function tableDecorations(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const sel = state.selection.ranges
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'Table') return
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(node.to).to
      const text = state.sliceDoc(from, to)
      // raw Markdown only when the cursor is strictly inside the table text (the "Markdown" button
      // or a click there); focus inside a cell must not count, or editing would flip to source
      if (sel.some((r) => r.head > from && r.head < to)) return false
      if (parseTable(text)) decos.push(Decoration.replace({ widget: new TableWidget(text), block: true }).range(from, to))
      return false
    },
  })
  return Decoration.set(decos)
}

/** Block decorations must come from a state field, so tables live here rather than in the plugin. */
export const liveTables = StateField.define<DecorationSet>({
  create: tableDecorations,
  update(value, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.state) !== syntaxTree(tr.startState)) return tableDecorations(tr.state)
    return value
  },
  provide: (f) => EditorView.decorations.from(f),
})
