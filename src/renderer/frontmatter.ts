// YAML frontmatter in the editor: one "Frontmatter" block at the top of the note, shown as a quiet
// properties box. Without it the markdown parser reads "key: value" above the closing "---" as a heading.
import type { MarkdownConfig } from '@lezer/markdown'
import { foldNodeProp, syntaxTree } from '@codemirror/language'
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view'
import { RangeSetBuilder } from '@codemirror/state'

const FENCE = /^---\s*$/
const CLOSE = /^(---|\.\.\.)\s*$/

export const frontmatter: MarkdownConfig = {
  defineNodes: [{ name: 'Frontmatter', block: true }],
  parseBlock: [
    {
      name: 'Frontmatter',
      before: 'HorizontalRule',
      parse(cx, line) {
        if (cx.lineStart !== 0 || !FENCE.test(line.text)) return false
        const from = cx.lineStart
        let to = from + line.text.length
        // shortcut: an unclosed block runs to the end of the note; Obsidian would show it as text
        while (cx.nextLine()) {
          to = cx.lineStart + line.text.length
          if (CLOSE.test(line.text)) {
            cx.nextLine()
            break
          }
        }
        cx.addElement(cx.elt('Frontmatter', from, to))
        return true
      },
    },
  ],
  props: [
    foldNodeProp.add({
      Frontmatter: (node, state) => ({ from: state.doc.lineAt(node.from).to, to: node.to }),
      // paragraphs and quotes are not worth an arrow each; headings, lists, code and tables keep theirs
      Paragraph: () => null,
      Blockquote: () => null,
    }),
  ],
}

function lines(view: EditorView): DecorationSet {
  const node = syntaxTree(view.state).topNode.firstChild
  if (!node || node.name !== 'Frontmatter') return Decoration.none
  const b = new RangeSetBuilder<Decoration>()
  for (let pos = node.from; pos <= node.to; ) {
    const line = view.state.doc.lineAt(pos)
    const cls = `cm-frontmatter${line.from === node.from ? ' is-first' : ''}${line.to >= node.to ? ' is-last' : ''}`
    b.add(line.from, line.from, Decoration.line({ class: cls }))
    pos = line.to + 1
  }
  return b.finish()
}

export const frontmatterLines = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = lines(view)
    }
    update(u: ViewUpdate) {
      if (u.docChanged || syntaxTree(u.startState) !== syntaxTree(u.state)) this.decorations = lines(u.view)
    }
  },
  { decorations: (v) => v.decorations },
)
