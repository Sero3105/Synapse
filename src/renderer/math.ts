// LaTeX math with KaTeX, Obsidian syntax: $inline$ and $$display$$ (display may span lines).
import katex from 'katex'
import type MarkdownIt from 'markdown-it'
import type { StateBlock, StateInline } from 'markdown-it'
import 'katex/dist/katex.min.css'

/** Rendered HTML; invalid TeX shows as a red source string instead of throwing. */
export const renderTex = (tex: string, display: boolean) => katex.renderToString(tex, { displayMode: display, throwOnError: false })

/**
 * `$x$` inline math: no `$$`, not escaped, no space just inside the dollars, and the closing `$`
 * not followed by a digit, so prices like "$5 and $10" stay text.
 */
export const INLINE_MATH = /(?<![\\$])\$(?![\s$])((?:\\.|[^$\n\\])*?(?:\\.|[^\s$\\]))\$(?![$\d])/g

/** `$$...$$` display blocks: start at a line's first `$$`, end at the next `$$` closing a line. */
export const BLOCK_MATH = /^[ \t]*\$\$([\s\S]*?)\$\$[ \t]*$/gm

export function mathPlugin(md: InstanceType<typeof MarkdownIt>) {
  md.inline.ruler.after('escape', 'math_inline', (state: StateInline, silent: boolean) => {
    if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */) return false
    const re = new RegExp(INLINE_MATH.source, 'y')
    re.lastIndex = state.pos
    const m = re.exec(state.src)
    if (!m) return false
    if (!silent) state.push('math_inline', '', 0).content = m[1]
    state.pos += m[0].length
    return true
  })

  md.block.ruler.before('fence', 'math_block', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    if (state.src.slice(start, start + 2) !== '$$') return false
    const first = state.src.slice(start + 2, state.eMarks[startLine])
    let last = startLine
    let body: string
    if (first.trimEnd().endsWith('$$') && first.trim().length >= 2) body = first.trimEnd().slice(0, -2)
    else {
      const lines = [first]
      for (last = startLine + 1; last < endLine; last++) {
        const line = state.src.slice(state.bMarks[last] + state.tShift[last], state.eMarks[last])
        if (line.trimEnd().endsWith('$$')) {
          lines.push(line.trimEnd().slice(0, -2))
          break
        }
        lines.push(line)
      }
      if (last >= endLine) return false
      body = lines.join('\n')
    }
    if (silent) return true
    const tok = state.push('math_block', 'div', 0)
    tok.content = body.trim()
    tok.map = [startLine, last + 1]
    state.line = last + 1
    return true
  })

  md.renderer.rules.math_inline = (tokens, idx) => renderTex(tokens[idx].content, false)
  md.renderer.rules.math_block = (tokens, idx) => `<div class="math-block">${renderTex(tokens[idx].content, true)}</div>`
}
