// Obsidian syntax in the reading view: callouts (`> [!note] Title`, foldable with `+`/`-`) and
// `%%comments%%`, which stay in the file and in the editor but are not shown when reading.
import type MarkdownIt from 'markdown-it'
import type { StateBlock, StateCore, StateInline, Token } from 'markdown-it'

const CALLOUT = /^\[!([\w-]+)\]([+-]?)[ \t]*(.*)$/

type Callout = { type: string; fold: '' | '+' | '-' }

export function obsidianPlugin(md: InstanceType<typeof MarkdownIt>) {
  // %%inline%% inside a paragraph
  md.inline.ruler.before('emphasis', 'comment', (state: StateInline) => {
    if (state.src.slice(state.pos, state.pos + 2) !== '%%') return false
    const end = state.src.indexOf('%%', state.pos + 2)
    if (end < 0) return false
    state.pos = end + 2
    return true
  })

  // a comment starting a line and ending a line, possibly lines later (blank lines and headings included)
  md.block.ruler.before('fence', 'comment', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false
    const start = state.bMarks[startLine] + state.tShift[startLine]
    if (state.src.slice(start, start + 2) !== '%%') return false
    const close = state.src.indexOf('%%', start + 2)
    if (close < 0) return false
    let line = startLine
    while (line < endLine && state.eMarks[line] < close + 2) line++
    // text after the closing %% makes it an inline comment in a paragraph
    if (line >= endLine || state.src.slice(close + 2, state.eMarks[line]).trim()) return false
    if (!silent) state.line = line + 1
    return true
  })

  // > [!type]+ Title: the quote becomes a callout, the rest of its first line the title
  md.core.ruler.after('block', 'callout', (state: StateCore) => {
    const toks = state.tokens
    for (let i = 0; i < toks.length; i++) {
      const open = toks[i]
      const inline = toks[i + 2]
      if (open.type !== 'blockquote_open' || toks[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') continue
      const nl = inline.content.indexOf('\n')
      const m = CALLOUT.exec(nl < 0 ? inline.content : inline.content.slice(0, nl))
      if (!m) continue
      const meta: Callout = { type: m[1].toLowerCase(), fold: m[2] as Callout['fold'] }
      open.meta = meta
      for (let j = i + 1; j < toks.length; j++) if (toks[j].type === 'blockquote_close' && toks[j].level === open.level) {
        toks[j].meta = meta
        break
      }
      const title = new state.Token('inline', '', 0)
      title.content = m[3] || meta.type[0].toUpperCase() + meta.type.slice(1)
      title.children = []
      const titleOpen = new state.Token('callout_title_open', '', 1)
      titleOpen.meta = meta
      titleOpen.block = true
      const titleClose = new state.Token('callout_title_close', '', -1)
      titleClose.meta = meta
      titleClose.block = true
      const body = nl < 0 ? '' : inline.content.slice(nl + 1)
      if (body.trim()) {
        inline.content = body
        toks.splice(i + 1, 0, titleOpen, title, titleClose)
      } else toks.splice(i + 1, 3, titleOpen, title, titleClose) // the first paragraph held only the title
    }
  })

  const callout = (t: Token) => t.meta as Callout | null
  const quoteOpen = md.renderer.rules.blockquote_open
  const quoteClose = md.renderer.rules.blockquote_close
  md.renderer.rules.blockquote_open = (tokens, idx, opts, env, self) => {
    const c = callout(tokens[idx])
    if (!c) return quoteOpen ? quoteOpen(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts)
    tokens[idx].attrJoin('class', 'callout')
    tokens[idx].attrSet('data-callout', c.type)
    return `<${c.fold ? 'details' : 'div'}${self.renderAttrs(tokens[idx])}${c.fold === '+' ? ' open' : ''}>\n`
  }
  md.renderer.rules.blockquote_close = (tokens, idx, opts, env, self) => {
    const c = callout(tokens[idx])
    if (!c) return quoteClose ? quoteClose(tokens, idx, opts, env, self) : self.renderToken(tokens, idx, opts)
    return `</${c.fold ? 'details' : 'div'}>\n`
  }
  md.renderer.rules.callout_title_open = (tokens, idx) => `<${callout(tokens[idx])!.fold ? 'summary' : 'div'} class="callout-title">`
  md.renderer.rules.callout_title_close = (tokens, idx) => `</${callout(tokens[idx])!.fold ? 'summary' : 'div'}>\n`
}
