import { useEffect, useRef } from 'react'
import { EditorView, keymap, lineNumbers, drawSelection, highlightActiveLine, Decoration, MatchDecorator, ViewPlugin, ViewUpdate, DecorationSet, dropCursor, rectangularSelection, crosshairCursor, gutters } from '@codemirror/view'
import { EditorState, Compartment, EditorSelection } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, HighlightStyle, indentUnit, bracketMatching, syntaxTree, foldGutter, foldKeymap } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches, search } from '@codemirror/search'
import { autocompletion, closeBrackets, closeBracketsKeymap, CompletionContext, completionKeymap, completionStatus, startCompletion, type Completion } from '@codemirror/autocomplete'
import { tags as t } from '@lezer/highlight'
import { model, useModel, Tab } from '../model'
import { api } from '../api'
import { noteTitle, shortestLinkText, fuzzyScore, headingRef, INVALID_NAME } from '../../shared/markdown'
import { t as tr } from '../../shared/i18n'
import { livePreview, liveTables, liveMath } from '../live-preview'
import { codeLanguage } from '../code'
import { frontmatter, frontmatterLines } from '../frontmatter'

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
  // HTML tags, CSS properties and JSON keys inside fenced code
  { tag: t.tagName, class: 'cm-kw' },
  { tag: [t.propertyName, t.attributeName], class: 'cm-fn' },
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

/** A selectable row that only explains why there is nothing to pick; choosing it changes nothing. */
const infoOption = (label: string) => ({ label, type: 'text' as const, apply: () => {} })

/** `]]` the editor may already have auto-inserted after the cursor must not be duplicated. */
const closingFor = (view: EditorView, to: number) => (view.state.sliceDoc(to, to + 2) === ']]' ? '' : ']]')

/** A typed name that may become a new note file: one plain name, no folder path, no leading dot. */
const creatable = (q: string) => {
  const name = q.trim()
  return name && !name.startsWith('.') && !name.includes('/') && !INVALID_NAME.test(name) ? name : null
}

const createOption = (name: string) => ({
  label: tr('autocomplete.createNote', { name }),
  detail: undefined,
  apply: (view: EditorView, _c: unknown, from: number, to: number) => {
    view.dispatch({ changes: { from, to, insert: name + closingFor(view, to) }, selection: { anchor: from + name.length + 2 } })
    void model.createNoteFile(name)
  },
})

/** After `[[Note^` or `[[Note#^`: the block ids of that note (or of this note for `[[^`). */
function blockCompletions(path: string, ctx: CompletionContext) {
  const m = ctx.matchBefore(/\[\[([^[\]\n|#^]*)(?:#)?\^([^[\]\n|^]*)$/)
  if (!m) return null
  const [, name, q] = /^\[\[([^#^]*)(?:#)?\^(.*)$/.exec(m.text)!
  const target = name ? model.index.resolve(name, path) : path
  const note = target ? model.index.notes.get(target) : undefined
  const lines = note?.content.split('\n') ?? []
  const all = note?.meta.blocks ?? []
  const options = all
    .map((b) => ({ b, s: fuzzyScore(q, b.id) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => (q ? b.s - a.s : 0))
    .map(({ b }) => ({
      label: `^${b.id}`,
      detail: lines[b.line]?.replace(/[ \t]\^[A-Za-z0-9_-]+[ \t]*$/, '').trim().slice(0, 60),
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        view.dispatch({ changes: { from, to, insert: b.id + closingFor(view, to) }, selection: { anchor: from + b.id.length + 2 } })
      },
    }))
  if (!options.length) {
    const label = !target ? tr('autocomplete.noMatch', { name }) : all.length ? tr('autocomplete.noMatch', { name: q }) : tr('autocomplete.noBlocks', { name: noteTitle(target) })
    return { from: m.to - q.length, options: [infoOption(label)], filter: false }
  }
  return { from: m.to - q.length, options, filter: false }
}

/** After `[[Note#`: the headings of that note (or of this note for `[[#`). */
function headingCompletions(path: string, ctx: CompletionContext) {
  const m = ctx.matchBefore(/\[\[([^[\]\n|#]*)#([^[\]\n|#]*)$/)
  if (!m) return null
  const [, name, q] = /^\[\[([^#]*)#(.*)$/.exec(m.text)!
  if (q.startsWith('^')) return null // block ids have their own completions
  const target = name ? model.index.resolve(name, path) : path
  const headings = (target && model.index.notes.get(target)?.meta.headings) || []
  const options = headings
    .map((h) => ({ h, s: fuzzyScore(q, h.text) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => (q ? b.s - a.s : 0))
    .map(({ h }) => ({
      label: h.text,
      detail: `H${h.level}`,
      apply: (view: EditorView, _c: unknown, from: number, to: number) => {
        const text = headingRef(h.text)
        view.dispatch({ changes: { from, to, insert: text + closingFor(view, to) }, selection: { anchor: from + text.length + 2 } })
      },
    }))
  if (!options.length) {
    const label = !target ? tr('autocomplete.noMatch', { name }) : headings.length ? tr('autocomplete.noMatch', { name: q }) : tr('autocomplete.noHeadings', { name: noteTitle(target) })
    return { from: m.to - q.length, options: [infoOption(label)], filter: false }
  }
  return { from: m.to - q.length, options, filter: false }
}

function wikiCompletions(path: string) {
  return (ctx: CompletionContext) => {
    const hm = headingCompletions(path, ctx)
    if (hm) return hm
    const bm = blockCompletions(path, ctx)
    if (bm) return bm
    const m = ctx.matchBefore(/\[\[[^[\]\n|#]*$/)
    if (!m) return null
    const q = m.text.slice(2)
    const options: Completion[] = model.index.files
      .map((f) => ({ f, s: fuzzyScore(q, f) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
      .map(({ f }) => ({
        label: f.endsWith('.md') ? noteTitle(f) : f.slice(f.lastIndexOf('/') + 1),
        detail: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : undefined,
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          const text = shortestLinkText(f, model.index.lookup)
          view.dispatch({ changes: { from, to, insert: text + closingFor(view, to) }, selection: { anchor: from + text.length + 2 } })
        },
      }))
    const fresh = creatable(q)
    const exists = fresh !== null && model.index.files.some((f) => noteTitle(f).toLowerCase() === fresh.toLowerCase())
    if (fresh && !exists) options.push(createOption(fresh))
    if (!options.length) options.push(infoOption(tr('autocomplete.noNotes')))
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
          markdown({ base: markdownLanguage, codeLanguages: codeLanguage, extensions: [frontmatter] }),
          frontmatterLines,
          // the markdown language folds a heading's section, a list item's children and code blocks
          foldGutter({ markerDOM: (open) => Object.assign(document.createElement('span'), { className: `cm-fold-marker${open ? ' is-open' : ''}`, textContent: '›', title: tr(open ? 'editor.fold' : 'editor.unfold') }) }),
          syntaxHighlighting(hl),
          wikiPlugin,
          autocompletion({ override: [wikiCompletions(path)], icons: false }),
          // without line numbers the fold gutter sits outside the editor (styles.css): unfixed, CodeMirror
          // stops treating the text's first 22px as covered, which hid the [[ popup at the start of a line
          c.lines.of(p.showLineNumber ? lineNumbers() : gutters({ fixed: false })),
          c.tab.of([EditorState.tabSize.of(p.tabSize), indentUnit.of(' '.repeat(p.tabSize))]),
          c.spell.of(EditorView.contentAttributes.of({ spellcheck: String(p.spellcheck), autocorrect: 'off' })),
          c.pair.of(p.autoPairBrackets ? closeBrackets() : []),
          c.live.of(p.livePreview ? [livePreview(path), liveTables, liveMath] : []),
          keymap.of([...closeBracketsKeymap, ...completionKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab, ...defaultKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) model.edit(path, u.state.doc.toString())
            // Whatever put the brackets there (Option-key layouts, paste, IME), if the cursor sits
            // after [[… and no popup is open, open it: do not rely on CodeMirror's typing trigger.
            if (u.docChanged && completionStatus(u.state) === null) {
              const head = u.state.selection.main.head
              const line = u.state.doc.lineAt(head)
              if (/\[\[[^[\]\n]*$/.test(line.text.slice(0, head - line.from))) startCompletion(u.view)
            }
            if (u.selectionSet || u.docChanged) {
              const head = u.state.selection.main.head
              const line = u.state.doc.lineAt(head)
              model.updateTab(tab.id, { cursor: head }, false)
              model.set({ cursor: { line: line.number, col: head - line.from + 1 } })
            }
          }),
          EditorView.domEventHandlers({
            // On Italian and other Option-key layouts, [ is Option+è: Chromium may swallow it as a
            // shortcut instead of typing it, which silently kills [[ links. Insert the bracket here.
            keydown: (e, v) => {
              if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== '[' && e.key !== ']')) return false
              e.preventDefault()
              v.dispatch(v.state.replaceSelection(e.key))
              if (e.key === '[') startCompletion(v)
              return true
            },
            mousedown: (e, v) => {
              // Cmd/Ctrl-click follows any link; a plain click follows links rendered by Live Preview
              const rendered = e.button === 0 && !e.shiftKey && (e.target as HTMLElement).closest?.('.cm-lp-link')
              if (!(e.metaKey || e.ctrlKey || rendered)) return false
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY })
              if (pos == null) return false
              const link = linkAt(v, pos)
              if (!link) return false
              e.preventDefault()
              if (link.kind === 'url') api.openExternal(link.target).catch((err) => model.error(err))
              else model.followLink(link.target, path, e.altKey || (!!rendered && (e.metaKey || e.ctrlKey)))
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
        c.lines.reconfigure(prefs.showLineNumber ? lineNumbers() : gutters({ fixed: false })),
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
  return <div className={`cm-host${prefs.showLineNumber ? ' has-line-numbers' : ''}`} ref={host} data-testid="editor" />
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
