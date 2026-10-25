import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { fontFormat, fontInfo, validateFont, FontStore, MAX_FONT_BYTES } from '../src/main/fonts'

/** Minimal structurally valid WOFF2 header (48 bytes, length field matches); table data is left to Chromium. */
function woff2() {
  const b = Buffer.alloc(48)
  b.write('wOF2', 0, 'latin1')
  b.writeUInt32BE(0x00010000, 4)
  b.writeUInt32BE(b.length, 8)
  b.writeUInt16BE(1, 12)
  b.writeUInt32BE(100, 16)
  return b
}

/** Minimal sfnt with a 'name' table (family, Windows UTF-16BE) and an 'OS/2' table (weight, italic bit). */
function sfnt(family: string, weight = 400, italic = false, magic: 'true' | 'OTTO' = 'true') {
  const str = Buffer.from(family, 'utf16le').swap16()
  const name = Buffer.alloc(6 + 12 + str.length)
  name.writeUInt16BE(0, 0); name.writeUInt16BE(1, 2); name.writeUInt16BE(18, 4)
  ;[3, 1, 0x409, 1, str.length, 0].forEach((v, i) => name.writeUInt16BE(v, 6 + i * 2))
  str.copy(name, 18)
  const os2 = Buffer.alloc(96)
  os2.writeUInt16BE(weight, 4)
  os2.writeUInt16BE(italic ? 1 : 0, 62)
  const tables: [string, Buffer][] = [['OS/2', os2], ['name', name]]
  const head = Buffer.alloc(12 + tables.length * 16)
  if (magic === 'OTTO') head.write('OTTO', 0, 'latin1')
  else head.writeUInt32BE(0x00010000, 0)
  head.writeUInt16BE(tables.length, 4)
  let offset = head.length
  tables.forEach(([tag, data], i) => {
    head.write(tag, 12 + i * 16, 'latin1')
    head.writeUInt32BE(offset, 12 + i * 16 + 8)
    head.writeUInt32BE(data.length, 12 + i * 16 + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...tables.map(([, d]) => d)])
}

/** The same tables wrapped as WOFF 1, compressed. */
function woff(family: string, weight = 400) {
  const src = sfnt(family, weight)
  const tags = ['OS/2', 'name']
  const datas = tags.map((_, i) => {
    const at = 12 + i * 16
    return src.subarray(src.readUInt32BE(at + 8), src.readUInt32BE(at + 8) + src.readUInt32BE(at + 12))
  })
  // per the WOFF spec a table is stored compressed only when that makes it smaller
  const comp = datas.map((d) => (zlib.deflateSync(d).length < d.length ? zlib.deflateSync(d) : d))
  const head = Buffer.alloc(44 + tags.length * 20)
  head.write('wOFF', 0, 'latin1')
  head.writeUInt16BE(tags.length, 12)
  let offset = head.length
  tags.forEach((tag, i) => {
    const at = 44 + i * 20
    head.write(tag, at, 'latin1')
    head.writeUInt32BE(offset, at + 4)
    head.writeUInt32BE(comp[i].length, at + 8)
    head.writeUInt32BE(datas[i].length, at + 12)
    offset += comp[i].length
  })
  return Buffer.concat([head, ...comp])
}

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-fonts-'))
})
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }))

describe('font files', () => {
  it('recognises fonts by their first bytes, not by extension', () => {
    expect(fontFormat(sfnt('A'))).toBe('truetype')
    expect(fontFormat(sfnt('A', 400, false, 'OTTO'))).toBe('opentype')
    expect(fontFormat(woff('A'))).toBe('woff')
    expect(fontFormat(woff2())).toBe('woff2')
    expect(fontFormat(Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'))).toBeNull() // a PNG renamed .ttf
    expect(fontFormat(Buffer.from('%PDF-1.7 hello'))).toBeNull()
  })

  it('reads family, weight and style from inside the font', () => {
    expect(fontInfo(sfnt('Literata Display', 700, true), 'whatever.ttf')).toEqual({ family: 'Literata Display', weight: 700, style: 'italic' })
    expect(fontInfo(woff('Inter', 300), 'x.woff')).toEqual({ family: 'Inter', weight: 300, style: 'normal' })
  })

  it('falls back to the file name for WOFF2 and damaged fonts', () => {
    const w2 = woff2()
    expect(fontInfo(w2, 'Inter-BoldItalic.woff2')).toEqual({ family: 'Inter', weight: 700, style: 'italic' })
    expect(fontInfo(w2, 'Open_Sans.woff2')).toEqual({ family: 'Open Sans', weight: 400, style: 'normal' })
    const broken = Buffer.from(sfnt('X')).fill(0xff, 12) // table directory garbage
    expect(fontInfo(broken, 'Source Serif-Light.ttf')).toEqual({ family: 'Source Serif', weight: 300, style: 'normal' })
  })

  it('validates structure, not only the signature', () => {
    expect(validateFont(sfnt('Inter'))).toBe('truetype')
    expect(validateFont(sfnt('Inter', 400, false, 'OTTO'))).toBe('opentype')
    expect(validateFont(woff('Inter'))).toBe('woff')
    expect(validateFont(woff2())).toBe('woff2')
    // signature only, truncated headers, and directories pointing past the buffer are rejected
    expect(validateFont(Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(40)]))).toBeNull()
    expect(validateFont(sfnt('X').subarray(0, 20))).toBeNull()
    const oob = Buffer.from(sfnt('X'))
    oob.writeUInt32BE(0xfffffff0, 12 + 8) // first table offset outside the file
    expect(validateFont(oob)).toBeNull()
    const noName = Buffer.from(sfnt('X'))
    noName.write('head', 12 + 16, 'latin1') // rename the 'name' directory entry away
    expect(validateFont(noName)).toBeNull()
    // a WOFF table claiming a huge decompressed size is rejected before inflating
    const bomb = Buffer.from(woff('X'))
    bomb.writeUInt32BE(0x7fffffff, 44 + 12)
    expect(validateFont(bomb)).toBeNull()
  })
})

describe('font store', () => {
  const put = (name: string, data: Buffer) => {
    const p = path.join(tmp, 'src', name)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, data)
    return p
  }

  it('copies fonts into its own folder, rejects non-fonts, never overwrites', () => {
    const store = new FontStore(path.join(tmp, 'fonts'))
    const r = store.add([put('Inter.ttf', sfnt('Inter')), put('photo.ttf', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')), put('Inter.ttf'.replace('.ttf', '.otf'), sfnt('Inter', 400, false, 'OTTO'))])
    expect(r.rejected).toEqual(['photo.ttf'])
    expect(r.added.map((f) => [f.id, f.family, f.format])).toEqual([['Inter.ttf', 'Inter', 'truetype'], ['Inter.otf', 'Inter', 'opentype']])
    const again = store.add([put('Inter.ttf', sfnt('Inter Bold', 700))])
    expect(again.added[0].id).toBe('Inter 2.ttf')
    expect(store.list().map((f) => f.id)).toEqual(['Inter 2.ttf', 'Inter.otf', 'Inter.ttf'])
    expect(store.data('Inter.ttf').equals(sfnt('Inter'))).toBe(true)
  })

  it('stores a font with the extension of its real format', () => {
    const store = new FontStore(path.join(tmp, 'fonts'))
    expect(store.add([put('Weird.woff2', sfnt('Weird'))]).added[0].id).toBe('Weird.ttf')
  })

  it('rejects oversized files and refuses ids that leave the folder', () => {
    const store = new FontStore(path.join(tmp, 'fonts'))
    const big = Buffer.concat([sfnt('Big'), Buffer.alloc(MAX_FONT_BYTES)])
    expect(store.add([put('Big.ttf', big)]).rejected).toEqual(['Big.ttf'])
    fs.writeFileSync(path.join(tmp, 'secret.ttf'), sfnt('Secret'))
    for (const id of ['../secret.ttf', '/etc/passwd', 'a/b.ttf', 'note.md', '', 7]) expect(() => store.data(id)).toThrow(/Invalid font/)
    expect(() => store.remove('../secret.ttf')).toThrow(/Invalid font/)
    expect(fs.existsSync(path.join(tmp, 'secret.ttf'))).toBe(true)
  })

  it('removes a font', () => {
    const store = new FontStore(path.join(tmp, 'fonts'))
    store.add([put('A.ttf', sfnt('A'))])
    store.remove('A.ttf')
    expect(store.list()).toEqual([])
    expect(() => store.data('A.ttf')).toThrow(/not found/)
  })

  it('rejects duplicate bytes and keeps the original file untouched', () => {
    const store = new FontStore(path.join(tmp, 'fonts'))
    const src = put('Inter.ttf', sfnt('Inter'))
    expect(store.add([src]).added).toHaveLength(1)
    expect(store.add([src]).rejected).toEqual(['Inter.ttf'])
    expect(store.list()).toHaveLength(1)
    expect(fs.readFileSync(src).equals(sfnt('Inter'))).toBe(true) // the user's file is only ever read
    // same family in another weight is not a duplicate: both are kept
    expect(store.add([put('Inter-Bold.ttf', sfnt('Inter', 700))]).added[0]).toMatchObject({ family: 'Inter', weight: 700 })
    expect(store.list()).toHaveLength(2)
  })

  it('stores a valid WOFF2 by header and rejects a signature-only one', () => {
    const store = new FontStore(path.join(tmp, 'fonts'))
    const r = store.add([put('Inter-Bold.woff2', woff2()), put('Fake.woff2', Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(40)]))])
    expect(r.added.map((f) => [f.id, f.family, f.weight, f.format])).toEqual([['Inter-Bold.woff2', 'Inter', 700, 'woff2']])
    expect(r.rejected).toEqual(['Fake.woff2'])
  })
})
