import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import { mathPlugin } from '../src/renderer/math'

const md = new MarkdownIt({ html: false }).use(mathPlugin)

describe('math', () => {
  it('renders inline math', () => {
    const html = md.render('Energy $E = mc^2$ and $\\alpha$.')
    expect(html.match(/class="katex"/g)).toHaveLength(2)
    expect(html).toContain('Energy ')
  })

  it('leaves prices, escapes and code alone', () => {
    for (const src of ['Costs $5 and $10.', 'Escaped \\$x$ here', 'Code `$y$`.', 'Spaced $ x $ dollars'])
      expect(md.render(src)).not.toContain('katex')
  })

  it('renders single and multi-line display blocks', () => {
    expect(md.render('$$x^2$$')).toContain('katex-display')
    const html = md.render('before\n\n$$\n\\int_0^1 f(x)\\,dx\n= 1\n$$\n\nafter')
    expect(html).toContain('<div class="math-block">')
    expect(html).toContain('katex-display')
    expect(html).toContain('<p>after</p>')
  })

  it('does not throw on invalid TeX', () => {
    expect(md.render('$\\frac{1}{$')).toContain('katex-error')
  })
})
