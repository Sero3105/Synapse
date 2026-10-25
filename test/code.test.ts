import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { highlightCode, codeLanguage, isMermaidFence, mermaidConfig } from '../src/renderer/code'

const SAMPLES: Record<string, string> = {
  swift: 'let x: Int = 1 // c',
  python: 'def f(): return "a"',
  py: 'import os',
  javascript: 'const x = "a"',
  js: 'function f() {}',
  typescript: 'let x: string = "a"',
  ts: 'interface A {}',
  html: '<div class="a">x</div>',
  css: 'a { color: red; }',
  json: '{ "a": 1 }',
  sql: 'SELECT * FROM t WHERE a = 1',
  bash: 'echo "hi" # c',
  sh: 'if [ -f x ]; then exit 1; fi',
  markdown: '# Heading\n**bold**',
  md: '# Heading',
}
const LANGS = Object.keys(SAMPLES)
const md = new MarkdownIt({ html: false, highlight: highlightCode })

describe('reading view highlighting', () => {
  it.each(LANGS)('highlights %s', (lang) => {
    expect(highlightCode(SAMPLES[lang], lang)).toMatch(/hljs-/)
  })

  it('renders a fence with its language class and escaped, highlighted code', () => {
    const html = md.render('```python\ndef f():\n    return "<b>"\n```\n')
    expect(html).toContain('<pre><code class="language-python">')
    expect(html).toContain('<span class="hljs-keyword">def</span>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).not.toContain('<b>')
  })

  it('falls back to escaped plain text for unknown, missing or odd identifiers', () => {
    for (const fence of ['```klingon', '```', '```{weird}', '```c++ extra words']) {
      const html = md.render(`${fence}\n<script>alert(1)</script>\n\`\`\`\n`)
      expect(html).toContain('&lt;script&gt;')
      expect(html).not.toContain('<script>')
    }
    expect(highlightCode('x', 'klingon')).toBe('')
  })

  it('skips highlighting for huge blocks', () => {
    expect(highlightCode('x = 1\n'.repeat(30_000), 'python')).toBe('')
  })

  it('leaves the source text of code unchanged (wiki links stay literal)', () => {
    const html = md.render('```js\nconst a = "[[Note]]"\n```\n')
    expect(html).toContain('[[Note]]')
  })
})

describe('editor highlighting', () => {
  it.each(LANGS)('resolves the fence identifier %s to a lazily loaded language', (lang) => {
    const d = codeLanguage(`${lang} {title="x"}`)
    expect(d, lang).toBeTruthy()
    expect(d!.support).toBeUndefined() // not loaded until a note uses it
  })

  it('agrees with the reading view on aliases', () => {
    expect(codeLanguage('py')?.name).toBe('Python')
    expect(codeLanguage('md')?.name).toBe('Markdown')
    expect(codeLanguage('sh')?.name).toBe('Shell')
  })

  it('unknown and plain-text identifiers resolve to nothing (plain code block)', () => {
    for (const info of ['klingon', '', 'text', 'plaintext', 'txt']) expect(codeLanguage(info), info).toBeNull()
  })
})

describe('mermaid', () => {
  it('only fences explicitly marked mermaid become diagrams', () => {
    expect(isMermaidFence('mermaid')).toBe(true)
    expect(isMermaidFence(' Mermaid  title')).toBe(true)
    for (const info of ['', 'js', 'mermaidx', 'text mermaid']) expect(isMermaidFence(info)).toBe(false)
  })

  it('is configured securely and follows the theme', () => {
    expect(mermaidConfig(false)).toMatchObject({ securityLevel: 'strict', startOnLoad: false, suppressErrorRendering: true, theme: 'dark' })
    expect(mermaidConfig(true).theme).toBe('default')
    expect(mermaidConfig(true)).not.toHaveProperty('secure') // keep Mermaid's default protected keys
  })
})

describe('markdown-it robustness (reading view options)', () => {
  const reading = new MarkdownIt({ html: false, linkify: true, highlight: highlightCode })
  const time = (src: string) => {
    const t0 = performance.now()
    reading.render(src)
    return performance.now() - t0
  }
  it.each([
    ['multi-line link reference definition (GHSA-gfr2-rv44-r23c)', '[ref]:\n/url\n"' + 'title line\n'.repeat(120000) + '"\n'],
    ['unterminated link label', '[' + 'a\n'.repeat(40000)],
    ['inline HTML-like text (html disabled)', '<a ' + 'x="y" '.repeat(40000)],
    ['deep nesting', '> '.repeat(5000) + 'x\n' + '- '.repeat(5000) + 'x\n'],
    ['many emphasis markers', '*a'.repeat(50000)],
  ])('%s renders quickly', (_, src) => {
    expect(time(src)).toBeLessThan(1000)
  })
})
