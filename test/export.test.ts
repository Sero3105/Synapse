import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { inlineImages, exportDocument } from '../src/main/export'
import { Vault } from '../src/main/vault'

let tmp: string
afterEach(() => tmp && fs.rmSync(tmp, { recursive: true, force: true }))
const url = (p: string) => 'synapse-file://vault/' + p.split('/').map(encodeURIComponent).join('/')

describe('export', () => {
  it('builds a standalone document that cannot run scripts', () => {
    const body = new MarkdownIt({ html: false }).render('# Título ✓\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nx()\n```\n\n<script>alert(1)</script>\n')
    const doc = exportDocument('Ünïcode "note"', body, false)
    expect(doc).toContain('<meta charset="utf-8">')
    expect(doc).toMatch(/Content-Security-Policy" content="default-src 'none'; img-src data: https:; style-src 'unsafe-inline'"/)
    expect(doc).toContain('<title>Ünïcode &quot;note&quot;</title>')
    for (const tag of ['<h1>Título ✓</h1>', '<li>one</li>', '<table>', '<pre><code class="language-js">']) expect(doc).toContain(tag)
    expect(doc).not.toContain('<script')
    expect(exportDocument('x', '', true)).toContain('color-scheme: dark')
  })

  it('inlines vault images and drops anything outside the vault', () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-export-')))
    const root = path.join(tmp, 'vault')
    fs.mkdirSync(path.join(root, 'img'), { recursive: true })
    fs.writeFileSync(path.join(root, 'img', 'caffè 1.png'), 'PNGDATA')
    fs.writeFileSync(path.join(root, 'notes.txt'), 'text')
    fs.writeFileSync(path.join(tmp, 'secret.png'), 'SECRET')
    fs.symlinkSync(tmp, path.join(root, 'link'))
    const vault = new Vault(root, async () => {})
    const html = [url('img/caffè 1.png'), url('../secret.png'), url('link/secret.png'), url('notes.txt'), url('missing.png')].map((s) => `<img src="${s}">`).join('')
    const out = inlineImages(html, vault)
    expect(out).toContain(`src="data:image/png;base64,${Buffer.from('PNGDATA').toString('base64')}"`)
    expect(out).not.toContain(Buffer.from('SECRET').toString('base64'))
    expect(out).not.toContain('synapse-file:')
    expect(out.match(/src=""/g)).toHaveLength(4)
  })

  it('leaves note prose alone and skips special files', () => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-export-')))
    const root = path.join(tmp, 'vault')
    fs.mkdirSync(root)
    fs.writeFileSync(path.join(root, 'a.png'), 'PNGDATA')
    execFileSync('mkfifo', [path.join(root, 'pipe.png')]) // reading it would block forever
    const vault = new Vault(root, async () => {})
    // what markdown-it produces for prose that merely mentions an image source
    const prose = `<p>write src=&quot;${url('a.png')}&quot; or src="${url('a.png')}" in HTML</p>`
    expect(inlineImages(prose, vault)).toBe(prose)
    expect(inlineImages(`<img alt="p" src="${url('pipe.png')}">`, vault)).toBe('<img alt="p" src="">')
    const twice = inlineImages(`<img src="${url('a.png')}"><img src="${url('a.png')}">`, vault)
    expect(twice.match(/data:image\/png/g)).toHaveLength(2)
  })
})
