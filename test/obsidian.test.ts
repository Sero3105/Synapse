import { describe, it, expect } from 'vitest'
import MarkdownIt from 'markdown-it'
import footnote from 'markdown-it-footnote'
import { obsidianPlugin } from '../src/renderer/obsidian'

const md = new MarkdownIt({ html: false }).use(footnote).use(obsidianPlugin)

describe('callouts', () => {
  it('turns a [!type] quote into a callout with its title and body', () => {
    const html = md.render('> [!warning] Be **careful**\n> Body text\n\nafter')
    expect(html).toContain('<div class="callout" data-callout="warning">')
    expect(html).toContain('<div class="callout-title">Be <strong>careful</strong></div>')
    expect(html).toContain('<p>Body text</p>')
    expect(html).toContain('<p>after</p>')
    expect(html).not.toContain('blockquote')
    expect(html).not.toContain('[!warning]')
  })

  it('uses the type as title, and folds with + or -', () => {
    const open = md.render('> [!tip]+\n> shown')
    expect(open).toContain('<details class="callout" data-callout="tip" open>')
    expect(open).toContain('<summary class="callout-title">Tip</summary>')
    expect(open).toContain('</details>')
    const closed = md.render('> [!NOTE]- Hidden\n>\n> body')
    expect(closed).toContain('<details class="callout" data-callout="note">')
    expect(closed).toContain('<summary class="callout-title">Hidden</summary>')
    expect(closed).toContain('<p>body</p>')
  })

  it('leaves plain and nested quotes alone', () => {
    expect(md.render('> just a quote')).toBe('<blockquote>\n<p>just a quote</p>\n</blockquote>\n')
    const nested = md.render('> [!info] Outer\n> > inner quote')
    expect(nested).toContain('<div class="callout" data-callout="info">')
    expect(nested).toContain('<blockquote>\n<p>inner quote</p>\n</blockquote>\n</div>')
  })

  it('cannot inject markup through the type or title', () => {
    const html = md.render('> [!x"onclick] <b>t</b>')
    expect(html).not.toContain('<b>')
    expect(md.render('> [!note] <img src=x onerror=alert(1)>')).not.toContain('<img')
  })
})

describe('comments', () => {
  it('hides %%inline%% comments but keeps the text around them', () => {
    expect(md.render('before %%secret%% after')).toBe('<p>before  after</p>\n')
  })

  it('hides block comments over several lines, blank ones included', () => {
    const html = md.render('one\n\n%%\n# not a heading\n\nhidden\n%%\n\ntwo')
    expect(html).toBe('<p>one</p>\n<p>two</p>\n')
  })

  it('leaves code and unclosed %% alone', () => {
    expect(md.render('`%%x%%`')).toContain('<code>%%x%%</code>')
    expect(md.render('```\n%%\nkept\n%%\n```')).toContain('%%\nkept\n%%')
    expect(md.render('50%% off')).toContain('50%% off')
  })
})

describe('footnotes', () => {
  it('renders references and the footnote list', () => {
    const html = md.render('Claim.[^1]\n\n[^1]: Source.')
    expect(html).toContain('class="footnote-ref"')
    expect(html).toContain('<section class="footnotes">')
    expect(html).toContain('Source.')
  })
})
