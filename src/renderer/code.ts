// Fenced code: highlighting for the editor and the reading view, and Mermaid diagrams.
import hljs from 'highlight.js/lib/common'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { t } from '../shared/i18n'

/** Above this size a block is shown as plain text, so one huge paste cannot stall rendering. */
const MAX_HIGHLIGHT = 100_000

/** Highlighted HTML for a fence, or '' to let markdown-it escape it as plain text (unknown language). */
export function highlightCode(code: string, lang: string): string {
  if (!lang || code.length > MAX_HIGHLIGHT || !hljs.getLanguage(lang)) return ''
  try {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
  } catch {
    return ''
  }
}

/**
 * Editor (CodeMirror) language for a fence's info string, loaded lazily on first use. Aliases
 * CodeMirror lacks (py, md, rs, …) go through highlight.js's names, so both views agree.
 */
export function codeLanguage(info: string): LanguageDescription | null {
  const lang = info.trim().split(/\s+/)[0]
  const h = hljs.getLanguage(lang)
  if (!lang || h?.name === 'Plain text') return null // CodeMirror's fuzzy match would pick LaTeX
  return LanguageDescription.matchLanguageName(languages, lang, true) ?? (h?.name ? LanguageDescription.matchLanguageName(languages, h.name, true) : null)
}

export const isMermaidFence = (info: string) => info.trim().split(/\s+/)[0].toLowerCase() === 'mermaid'

export const mermaidConfig = (light: boolean) =>
  ({
    startOnLoad: false,
    // strict: the whole SVG goes through DOMPurify, click handlers and links in diagrams are disabled.
    // Mermaid's default `secure` list stops %%{init}%% directives from loosening this.
    securityLevel: 'strict',
    // throw instead of drawing an error diagram, which would leave a stray element in <body>
    suppressErrorRendering: true,
    theme: light ? 'default' : 'dark',
  }) as const

let seq = 0
/** Replace `pre.mermaid-src` placeholders under `root` with diagrams; invalid ones keep their source and get a message. */
export async function renderMermaid(root: HTMLElement, light: boolean) {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre.mermaid-src')]
  if (!blocks.length) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize(mermaidConfig(light))
  for (const el of blocks) {
    const src = el.textContent ?? ''
    try {
      if (!src.trim()) throw new Error(t('reading.mermaidEmpty'))
      const { svg } = await mermaid.render(`mermaid-${++seq}`, src)
      if (!el.isConnected) continue
      const div = document.createElement('div')
      div.className = 'mermaid'
      div.innerHTML = svg
      el.replaceWith(div)
    } catch (err) {
      if (!el.isConnected || el.classList.contains('is-error')) continue
      el.classList.add('is-error')
      const msg = document.createElement('div')
      msg.className = 'mermaid-error'
      // Mermaid parse errors: "Parse error on line N:", a source excerpt, then "Expecting …, got …"
      const lines = String((err as Error)?.message ?? err).split('\n').filter((l) => l.trim())
      const text = lines.length > 2 ? `${lines[0]} ${lines[lines.length - 1]}` : lines.join(' ')
      msg.textContent = t('reading.mermaidError', { message: text.slice(0, 240) })
      el.after(msg)
    }
  }
}
