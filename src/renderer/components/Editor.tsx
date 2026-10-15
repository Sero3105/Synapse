import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, Decoration, MatchDecorator, ViewPlugin, ViewUpdate, DecorationSet, dropCursor, rectangularSelection, crosshairCursor } from '@codemirror/view'
import { EditorState, Compartment, EditorSelection } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching, syntaxTree } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, CompletionContext, completionKeymap } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { model, useModel, Tab } from '../model'
import { api } from '../api'
import { noteTitle, shortestLinkText, fuzzyScore } from '../../shared/markdown'
import { t as tr } from '../../shared/i18n'
import { livePreview, liveTables, liveMath } from '../live-preview'

const hl = HighlightStyle.define([
  { tag: t.heading1, class: 'cm-h1' },
  { tag: t.heading2, class: 'cm-h2' },
  { tag: t.heading3, class: 'cm-h3' },
  { tag: t.heading4, class: 'cm-h4' },
  { tag: t.heading5, class: 'cm-h5' },
  { tag: t.heading6, class: 'cm-h6' },
  { tag: t.strong, class: 'cm-strong' },
  { tag: t.emphasis, class: 'cm-em' },
  { tag: t.strikethrough, class: 'cm-strike' },
  { tag: t.link, class: 'cm-link' },
  { tag: t.url, class: 'cm-url' },
  { tag: t.monospace, class: 'cm-inline-code' },
  { tag: t.quote, class: 'cm-quote' },
  { tag: [t.processingInstruction, t.meta, t.contentSeparator], class: 'cm-formatting' },
  { tag: t.list, class: 'cm-list' },
  { tag: t.keyword, class: 'cm-kw' },
  { tag: [t.string, t.special(t.string)], class: 'cm-str' },
  { tag: t.comment, class: 'cm-comment' },
  { tag: [t.number, t.bool, t.atom], class: 'cm-num' },
  { tag: [t.function(t.variableName), t.typeName, t.className], class: 'cm-fn' },
])

const wikiDeco = new MatchDecorator({
  regexp: /!?\[\[[^[\]\n]+\]\]|(?<=^|[\s(,])#[\p{L}_\-/][\p{L}\p{N}_\-/]*/gu,
  decorate: (add, from, to, m, view) => {
    // no link/tag styling inside code
    const node = syntaxTree(view.state).resolveInner(from, 1)
    for (let n: typeof node | null = node; n; n = n.parent) if (/Code/.test(n.name)) return
    add(from, to, Decoration.mark({ class: m[0].startsWith('#') ? 'cm-tag' : 'cm-wikilink' }))
  },
})
const wikiPlugin = ViewPlugin.fromClass(
  class {
    decos: DecorationSet
    constructor(view: EditorView) {
      this.decos = wikiDeco.createDeco(view)
    }
    update(u: ViewUpdate) {
      this.decos = wikiDeco.updateDeco(u, this.decos)
    }
  },
  { decorations: (v) => v.decos },
)

/** Link under a document position: wiki link, markdown link, or bare URL. */
function linkAt(view: EditorView, pos: number): { kind: 'wiki' | 'url'; target: string } | null {
  const line = view.state.doc.lineAt(pos)
  const off = pos - line.from
  const tests: [RegExp, (m: RegExpExecArray) => { kind: 'wiki' | 'url'; target: string }][] = [
    [/!?\[\[([^[\]\n|]+)(?:\|[^\]]*)?\]\]/g, (m) => ({ kind: 'wiki', target: m[1] })],
    [/\[[^\]\n]*\]\(([^)\s]+)\)/g, (m) => (/^[a-z]+:/i.test(m[1]) ? { kind: 'url', target: m[1] } : { kind: 'wiki', target: safeDecode(m[1]) })],
    [/https?:\/\/[^\s)>\]]+/g, (m) => ({ kind: 'url', target: m[0] })],
  ]
  for (const [re, make] of tests) {
    let m: RegExpExecArray | null
    while ((m = re.exec(line.text))) if (off >= m.index && off <= m.index + m[0].length) return make(m)
  }
  return null
}
const safeDecode = (s: string) => {
  try {
    return decodeURI(s)
  } catch {
    return s
  }
}

function wikiCompletions(path: string) {
  return (ctx: CompletionContext) => {
    const m = ctx.matchBefore(/\[\[[^[\]\n|#]*$/)
    if (!m) return null
    const q = m.text.slice(2)
    const options = model.index.files
      .map((f) => ({ f, s: fuzzyScore(q, f) }))
      .filter((x) => x.s >= 0 && x.f !== path)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map(({ f }) => ({
        label: f.endsWith('.md') ? noteTitle(f) : f.slice(f.lastIndexOf('/') + 1),
        detail: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : undefined,
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          const text = shortestLinkText(f, model.index.lookup)
          const closing = view.state.sliceDoc(to, to + 2) === ']]' ? '' : ']]'
          view.dispatch({ changes: { from, to, insert: text + closing }, selection: { anchor: from + text.length + 2 } })
        },
      }))
    return { from: m.from + 2, options, filter: false }
  }
}

export function Editor({ tab, paneId }: { tab: Tab; paneId: string }) {
  const host = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const path = tab.path!
  const buffer = useModel((s) => s.buffers[path])
  const prefs = useModel((s) => s.snap!.prefs)
  const comps = useRef({ lines: new Compartment(), tab: new Compartment(), spell: new Compartment(), pair: new Compartment(), live: new Compartment() })

  // create the view once per tab+path
  useEffect(() => {
    if (!host.current || !buffer) return
    const c = comps.current
    const p = model.prefs
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: buffer.content,
        selection: tab.cursor !== undefined && tab.cursor <= buffer.content.length ? EditorSelection.cursor(tab.cursor) : undefined,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          bracketMatching(),
          search({ top: true }),
          EditorView.lineWrapping,
          markdown({ base: markdownLanguage, codeLanguages: languages }),
          syntaxHighlighting(hl),
          wikiPlugin,
          autocompletion({ override: [wikiCompletions(path)], icons: false }),
          c.lines.of(p.showLineNumber ? lineNumbers() : []),
          c.tab.of([EditorState.tabSize.of(p.tabSize), indentUnit.of(' '.repeat(p.tabSize))]),
          c.spell.of(EditorView.contentAttributes.of({ spellcheck: String(p.spellcheck), autocorrect: 'off' })),
          c.pair.of(p.autoPairBrackets ? closeBrackets() : []),
          c.live.of(p.livePreview ? [livePreview(path), liveTables, liveMath] : []),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, indentWithTab, ...defaultKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) model.edit(path, u.state.doc.toString())
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head
              const line = u.state.doc.lineAt(head)
              model.updateTab(tab.id, { cursor: head }, false)
              model.set({ cursor: { line: line.number, col: head - line.from + 1 } })
            }
          }),
          EditorView.domEventHandlers({
            mousedown: (e, v) => {
              if (!(e.metaKey || e.ctrlKey)) return false
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos == null) return false
              const link = linkAt(v, pos)
              if (!link) return false
              e.preventDefault()
              if (link.kind === 'url') api.openExternal(link.target).catch((err) => model.error(err))
              else model.followLink(link.target, path, e.altKey)
              return true
            },
            paste: (e, v) => handleFiles(e.clipboardData?.files, v, path, e),
            drop: (e, v) => handleFiles(e.dataTransfer?.files, v, path, e),
            focus: () => {
              model.focusPane(paneId)
              return false
            },
          }),
        ],
      }),
    })
    viewRef.current = view
    model.editors.set(tab.id, view)
    if (tab.scroll) requestAnimationFrame(() => (view.scrollDOM.scrollTop = tab.scroll!))
    const onScroll = () => model.updateTab(tab.id, { scroll: view.scrollDOM.scrollTop }, false)
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    if (model.state.ws.activePane === paneId && model.state.focusTitle !== tab.id && !document.activeElement?.closest('.modal, .sidebar')) view.focus()
    return () => {
      view.scrollDOM.removeEventListener('scroll', onScroll)
      if (model.editors.get(tab.id) === view) model.editors.delete(tab.id)
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, path, !!buffer])

  // external buffer changes (disk reload, link rewrite, other tab)
  useEffect(() => {
    const v = viewRef.current
    // Compare with the model's current buffer, not this render's copy: keystrokes typed after the
    // render already updated both the view and the model, and the stale copy would undo them.
    const latest = model.state.buffers[path]?.content
    if (!v || latest === undefined) return
    const cur = v.state.doc.toString()
    if (cur !== latest) {
      const head = Math.min(v.state.selection.main.head, latest.length)
      v.dispatch({ changes: { from: 0, to: cur.length, insert: latest }, selection: { anchor: head } })
    }
  }, [buffer?.content])

  // preference changes
  useEffect(() => {
    const v = viewRef.current
    if (!v) return
    const c = comps.current
    v.dispatch({
      effects: [
        c.lines.reconfigure(prefs.showLineNumber ? lineNumbers() : []),
        c.tab.reconfigure([EditorState.tabSize.of(prefs.tabSize), indentUnit.of(' '.repeat(prefs.tabSize))]),
        c.spell.reconfigure(EditorView.contentAttributes.of({ spellcheck: String(prefs.spellcheck), autocorrect: 'off' })),
        c.pair.reconfigure(prefs.autoPairBrackets ? closeBrackets() : []),
        c.live.reconfigure(prefs.livePreview ? [livePreview(path), liveTables, liveMath] : []),
      ],
    })
  }, [prefs.showLineNumber, prefs.tabSize, prefs.spellcheck, prefs.autoPairBrackets, prefs.livePreview])

  // jump to a line requested by search/backlinks/outline
  useModel((s) => s.navTick)
  useEffect(() => {
    const v = viewRef.current
    const pl = model.pendingLine
    if (!v || !pl || pl.tabId !== tab.id) return
    model.pendingLine = null
    const n = Math.min(Math.max(1, pl.line + 1), v.state.doc.lines)
    const line = v.state.doc.line(n)
    v.dispatch({ selection: EditorSelection.range(line.from, line.to), effects: EditorView.scrollIntoView(line.from, { y: 'center' }) })
    v.focus()
  })

  if (!buffer) return <div className="view-loading">{tr('common.loading')}</div>
  return <div className="cm-host" ref={host} data-testid="editor" />
}

function handleFiles(files: FileList | undefined, view: EditorView, notePath: string, e: Event) {
  if (!files || !files.length) return false
  e.preventDefault()
  ;(async () => {
    const links: string[] = []
    for (const f of Array.from(files)) {
      const name = f.name && f.name !== 'image.png' ? f.name : `${tr('file.pastedImage')} ${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.png`
      const saved = await model.saveAttachment(name, new Uint8Array(await f.arrayBuffer()), notePath)
      if (saved) links.push(`![[${shortestLinkText(saved, model.index.lookup)}]]`)
    }
    if (links.length) view.dispatch(view.state.replaceSelection(links.join('\n')))
  })()
  return true
}
