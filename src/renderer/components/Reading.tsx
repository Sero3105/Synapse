import { useEffect, useMemo, useRef } from 'react'
import MarkdownIt, { type StateInline, type StateCore, type Env as MdEnv } from 'markdown-it'
import { model, useModel, IMAGE_EXT } from '../model'
import { api, fileUrl } from '../api'
import { noteTitle } from '../../shared/markdown'
import { t } from '../../shared/i18n'
import { mathPlugin } from '../math'
import hljs from 'highlight.js/lib/common'

interface Env extends MdEnv { source: string; depth: number }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

// Raw HTML is disabled: notes are rendered without executing or injecting markup.
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
  highlight: (code, lang) => {
    if (!lang || !hljs.getLanguage(lang)) return ''
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value
    } catch {
      return ''
    }
  },
}).use(mathPlugin)

// ```mermaid fences become placeholders; Reading renders them to SVG after mount.
const fence = md.renderer.rules.fence!
md.renderer.rules.fence = (tokens, idx, opts, env, self) => {
  const tok = tokens[idx]
  if (tok.info.trim().toLowerCase() === 'mermaid') return `<pre class="mermaid-src">${esc(tok.content)}</pre>`
  return fence(tokens, idx, opts, env, self)
}

let mermaidSeq = 0
async function renderMermaid(root: HTMLElement) {
  const blocks = [...root.querySelectorAll<HTMLElement>('pre.mermaid-src')]
  if (!blocks.length) return
  const { default: mermaid } = await import('mermaid')
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: document.body.classList.contains('theme-light') ? 'default' : 'dark' })
  for (const el of blocks) {
    try {
      const { svg } = await mermaid.render(`mermaid-${++mermaidSeq}`, el.textContent ?? '')
      if (!el.isConnected) continue
      const div = document.createElement('div')
      div.className = 'mermaid'
      div.innerHTML = svg
      el.replaceWith(div)
    } catch {
      el.classList.add('is-error')
    }
  }
}

md.inline.ruler.before('link', 'wikilink', (state: StateInline, silent: boolean) => {
  const src = state.src
  let pos = state.pos
  const embed = src.charCodeAt(pos) === 0x21 /* ! */
  if (embed) pos++
  if (src.slice(pos, pos + 2) !== '[[') return false
  const end = src.indexOf(']]', pos + 2)
  if (end < 0) return false
  const inner = src.slice(pos + 2, end)
  if (!inner || inner.includes('\n') || inner.includes('[')) return false
  if (!silent) {
    const tok = state.push('wikilink', '', 0)
    tok.meta = { inner, embed }
  }
  state.pos = end + 2
  return true
})

md.inline.ruler.after('wikilink', 'tag', (state: StateInline, silent: boolean) => {
  if (state.src.charCodeAt(state.pos) !== 0x23 /* # */) return false
  const prev = state.pos > 0 ? state.src[state.pos - 1] : ' '
  if (!/[\s(,]/.test(prev)) return false
  const m = /^#([\p{L}\p{N}_\-/]*[\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(state.src.slice(state.pos))
  if (!m) return false
  if (!silent) state.push('tag', '', 0).meta = { tag: m[0] }
  state.pos += m[0].length
  return true
})

md.inline.ruler.before('emphasis', 'highlight', (state: StateInline, silent: boolean) => {
  if (state.src.slice(state.pos, state.pos + 2) !== '==') return false
  const end = state.src.indexOf('==', state.pos + 2)
  if (end < 0 || end === state.pos + 2) return false
  if (!silent) state.push('mark', '', 0).content = state.src.slice(state.pos + 2, end)
  state.pos = end + 2
  return true
})

// "- [ ] task" -> checkbox carrying its source line so clicks can toggle it.
md.core.ruler.push('tasks', (state: StateCore) => {
  const toks = state.tokens
  for (let i = 2; i < toks.length; i++) {
    const inline = toks[i]
    if (inline.type !== 'inline' || toks[i - 1].type !== 'paragraph_open' || toks[i - 2].type !== 'list_item_open') continue
    const m = /^\[( |x|X)\]\s/.exec(inline.content)
    if (!m || !inline.children?.length || inline.children[0].type !== 'text') continue
    inline.children[0].content = inline.children[0].content.replace(/^\[( |x|X)\]\s/, '')
    const box = new state.Token('html_inline', '', 0)
    const line = toks[i - 2].map?.[0] ?? 0
    box.content = `<input type="checkbox" class="task-checkbox" data-line="${line}"${m[1] === ' ' ? '' : ' checked'}> `
    inline.children.unshift(box)
    toks[i - 2].attrJoin('class', 'task-list-item' + (m[1] === ' ' ? '' : ' is-checked'))
  }
})

md.renderer.rules.wikilink = (tokens, idx, _o, rawEnv) => {
  const env = rawEnv as Env
  const { inner, embed } = tokens[idx].meta as { inner: string; embed: boolean }
  const [target, alias] = inner.split('|')
  const [linkpath] = target.split('#')
  const resolved = model.index.resolve(linkpath, env.source)
  if (embed && resolved) {
    if (IMAGE_EXT.test(resolved)) {
      const w = alias && /^\d+(x\d+)?$/.test(alias) ? ` width="${alias.split('x')[0]}"` : ''
      return `<img src="${esc(fileUrl(resolved))}" alt="${esc(alias && !w ? alias : linkpath)}"${w}>`
    }
    if (resolved.endsWith('.md') && env.depth < 1) {
      const note = model.state.buffers[resolved]?.content ?? model.index.notes.get(resolved)?.content ?? ''
      return `<div class="markdown-embed"><div class="markdown-embed-title">${esc(noteTitle(resolved))}</div>${md.render(note, { source: resolved, depth: env.depth + 1 })}</div>`
    }
  }
  const label = alias ?? (target.includes('#') ? target.replace('#', ' > ') : target)
  return `<a class="internal-link${resolved ? '' : ' is-unresolved'}" data-href="${esc(target)}" href="#">${esc(label)}</a>`
}
md.renderer.rules.tag = (tokens, idx) => {
  const tag = (tokens[idx].meta as { tag: string }).tag
  return `<a class="tag" data-tag="${esc(tag)}" href="#">${esc(tag)}</a>`
}
md.renderer.rules.mark = (tokens, idx) => `<mark>${esc(tokens[idx].content)}</mark>`

const isExternal = (h: string) => /^[a-z][a-z0-9+.-]*:/i.test(h)
md.renderer.rules.link_open = (tokens, idx, opts, rawEnv, self) => {
  const env = rawEnv as Env
  const tok = tokens[idx]
  const href = String(tok.attrGet('href') ?? '')
  if (isExternal(href)) {
    tok.attrSet('class', 'external-link')
    tok.attrSet('data-external', href)
  } else {
    let decoded = href
    try {
      decoded = decodeURI(href)
    } catch { /* keep */ }
    tok.attrSet('class', 'internal-link' + (model.index.resolve(decoded.split('#')[0], env.source) ? '' : ' is-unresolved'))
    tok.attrSet('data-href', decoded)
  }
  tok.attrSet('href', '#')
  return self.renderToken(tokens, idx, opts)
}
md.renderer.rules.image = (tokens, idx, opts, rawEnv, self) => {
  const env = rawEnv as Env
  const tok = tokens[idx]
  const src = String(tok.attrGet('src') ?? '')
  if (!isExternal(src)) {
    let decoded = src
    try {
      decoded = decodeURI(src)
    } catch { /* keep */ }
    const r = model.index.resolve(decoded, env.source)
    tok.attrSet('src', r ? fileUrl(r) : '')
  } else if (!/^https?:|^data:image\//i.test(src)) tok.attrSet('src', '')
  tok.attrSet('alt', tok.content)
  return self.renderToken(tokens, idx, opts)
}

export function renderMarkdown(text: string, source: string) {
  // strip YAML frontmatter, show it as a properties block
  let fm = ''
  const m = /^---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text)
  if (m) {
    fm = `<pre class="frontmatter">${esc(m[1])}</pre>`
    text = text.slice(m[0].length)
  }
  return fm + md.render(text, { source, depth: 0 } satisfies Env)
}

export function Reading({ path }: { path: string }) {
  const content = useModel((s) => s.buffers[path]?.content)
  const indexVersion = useModel((s) => s.indexVersion)
  const html = useMemo(() => (content === undefined ? '' : renderMarkdown(content, path)), [content, path, indexVersion])
  const root = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (root.current) renderMermaid(root.current).catch((err) => model.error(err))
  }, [html])
  if (content === undefined) return <div className="view-loading">{t('common.loading')}</div>

  const onClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement
    const a = el.closest('a')
    if (el instanceof HTMLInputElement && el.classList.contains('task-checkbox')) {
      const line = Number(el.dataset.line)
      const lines = content.split('\n')
      // reading view offsets exclude frontmatter
      const fmLines = /^---\r?\n[\s\S]*?\r?\n---\s*(\r?\n|$)/.exec(content)?.[0].split('\n').length ?? 1
      const real = line + (fmLines > 1 ? fmLines - 1 : 0)
      if (lines[real] !== undefined) {
        lines[real] = lines[real].replace(/\[( |x|X)\]/, (x) => (x === '[ ]' ? '[x]' : '[ ]'))
        model.edit(path, lines.join('\n'))
      }
      return
    }
    if (!a) return
    e.preventDefault()
    if (a.dataset.external) api.openExternal(a.dataset.external).catch((err) => model.error(err))
    else if (a.dataset.href !== undefined) model.followLink(a.dataset.href, path, e.metaKey || e.ctrlKey)
    else if (a.dataset.tag) {
      model.set({ searchQuery: `tag:${a.dataset.tag}` })
      model.setLayout({ leftOpen: true, leftTab: 'search' })
    }
  }

  return <div className="markdown-reading" ref={root} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} data-testid="reading" />
}
