// Fonts the user adds to Synapse: copied into the app-data folder (never into a vault) and
// served to the renderer as bytes. Pure Node, no electron import, so it is unit-testable.
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import crypto from 'node:crypto'
import { VaultError } from './vault'

export type FontFormat = 'truetype' | 'opentype' | 'woff' | 'woff2'
export interface CustomFont { id: string; family: string; weight: number; style: 'normal' | 'italic'; format: FontFormat }

export const MAX_FONT_BYTES = 20 * 1024 * 1024
/** Stored file names: a plain name with a font extension, nothing that could leave the folder. */
const ID = /^[\w .()+'-]{1,120}\.(ttf|otf|woff2?)$/i

/** Format from the first bytes, so a renamed image or document is never accepted as a font. */
export function fontFormat(buf: Buffer): FontFormat | null {
  if (buf.length < 12) return null
  const tag = buf.toString('latin1', 0, 4)
  if (tag === 'wOFF') return 'woff'
  if (tag === 'wOF2') return 'woff2'
  if (tag === 'OTTO') return 'opentype'
  if (tag === 'true' || buf.readUInt32BE(0) === 0x00010000) return 'truetype'
  return null
}

const MAX_TABLE_BYTES = 8 * 1024 * 1024

/** Tables of a TrueType/OpenType or WOFF 1 file (WOFF tables are zlib-compressed when smaller). All offsets are bounds-checked: a malformed directory throws instead of reading past the buffer. */
function tables(buf: Buffer, format: FontFormat): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  if (format === 'woff') {
    if (buf.length < 44) throw new Error('short woff')
    const n = buf.readUInt16BE(12)
    if (n < 1 || n > 128 || 44 + n * 20 > buf.length) throw new Error('bad woff directory')
    for (let i = 0; i < n; i++) {
      const at = 44 + i * 20
      const tag = buf.toString('latin1', at, at + 4)
      const offset = buf.readUInt32BE(at + 4)
      const comp = buf.readUInt32BE(at + 8)
      const orig = buf.readUInt32BE(at + 12)
      if (offset + comp > buf.length || comp > orig || orig > MAX_TABLE_BYTES) throw new Error('bad woff table')
      if (tag !== 'name' && tag !== 'OS/2') continue
      const raw = buf.subarray(offset, offset + comp)
      const data = comp < orig ? zlib.inflateSync(raw, { maxOutputLength: MAX_TABLE_BYTES }) : raw
      if (data.length !== orig) throw new Error('bad woff table size')
      out.set(tag, data)
    }
  } else {
    const n = buf.readUInt16BE(4)
    if (n < 1 || n > 128 || 12 + n * 16 > buf.length) throw new Error('bad sfnt directory')
    for (let i = 0; i < n; i++) {
      const at = 12 + i * 16
      const tag = buf.toString('latin1', at, at + 4)
      const offset = buf.readUInt32BE(at + 8)
      const length = buf.readUInt32BE(at + 12)
      if (offset + length > buf.length) throw new Error('bad sfnt table')
      out.set(tag, buf.subarray(offset, offset + length))
    }
  }
  return out
}

/**
 * Structural validation beyond the 4-byte signature. SFNT/WOFF files must carry a
 * bounds-checked 'name' table; WOFF2 table data is brotli-compressed, so only its
 * 48-byte header is checked here and Chromium's FontFace load is the final validator.
 */
export function validateFont(buf: Buffer): FontFormat | null {
  const format = fontFormat(buf)
  if (!format || buf.length > MAX_FONT_BYTES) return null
  try {
    if (format === 'woff2') {
      if (buf.length < 48 || buf.readUInt32BE(8) !== buf.length) return null
      const numTables = buf.readUInt16BE(12)
      if (numTables < 1 || numTables > 128 || buf.readUInt32BE(16) > 64 * 1024 * 1024) return null
      return format
    }
    const name = tables(buf, format).get('name')
    return name && familyName(name) ? format : null
  } catch {
    return null
  }
}

/** Family from the 'name' table: typographic family (16) before family (1), Windows English first. */
function familyName(name: Buffer): string | null {
  if (name.length < 6) return null
  const count = name.readUInt16BE(2)
  const strings = name.readUInt16BE(4)
  let best: { score: number; value: string } | null = null
  for (let i = 0; i < count && 6 + i * 12 + 12 <= name.length; i++) {
    const at = 6 + i * 12
    const [platform, , language, id, length, offset] = [0, 2, 4, 6, 8, 10].map((o) => name.readUInt16BE(at + o))
    if (id !== 16 && id !== 1) continue
    const raw = name.subarray(strings + offset, strings + offset + length)
    const value = platform === 3 || platform === 0 ? Buffer.from(raw).swap16().toString('utf16le') : raw.toString('latin1')
    const score = (id === 16 ? 4 : 0) + (platform === 3 ? 2 : 0) + (language === 0x409 || language === 0 ? 1 : 0)
    if (value.trim() && (!best || score > best.score)) best = { score, value: value.trim() }
  }
  return best?.value ?? null
}

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/i, 100], [/extra.?light|ultra.?light/i, 200], [/light/i, 300], [/medium/i, 500],
  [/semi.?bold|demi.?bold/i, 600], [/extra.?bold|ultra.?bold/i, 800], [/black|heavy/i, 900], [/bold/i, 700],
]

/** Family, weight and style from the font itself, falling back to the file name ("Inter-BoldItalic"). */
export function fontInfo(buf: Buffer, fileName: string): { family: string; weight: number; style: 'normal' | 'italic' } | null {
  const format = fontFormat(buf)
  if (!format) return null
  const base = path.basename(fileName).replace(/\.(ttf|otf|woff2?)$/i, '')
  // "Inter-BoldItalic": the last part is a style only when it reads like one ("Open_Sans" stays whole)
  const split = base.match(/^(.*)[-_ ]((?:regular|italic|oblique|book|normal|thin|hairline|light|medium|semi\w*|demi\w*|bold|extra\w*|ultra\w*|black|heavy)+)$/i)
  const [famPart, stylePart] = split ? [split[1], split[2]] : [base, '']
  let family = famPart.replace(/[_-]+/g, ' ').trim() || 'Font'
  let weight = WEIGHTS.find(([re]) => re.test(stylePart))?.[1] ?? 400
  let style: 'normal' | 'italic' = /italic|oblique/i.test(stylePart) ? 'italic' : 'normal'
  if (format !== 'woff2') {
    try {
      const t = tables(buf, format)
      const name = t.get('name')
      const fam = name && familyName(name)
      if (fam) family = fam
      const os2 = t.get('OS/2')
      if (os2 && os2.length >= 64) {
        weight = Math.min(1000, Math.max(1, os2.readUInt16BE(4))) || weight
        style = os2.readUInt16BE(62) & 1 ? 'italic' : style
      }
    } catch { /* damaged tables: keep what the file name says */ }
  }
  return { family: family.replace(/["\\;{}]/g, '').slice(0, 100), weight, style }
}

export class FontStore {
  constructor(readonly dir: string) {}

  private file(id: unknown): string {
    if (typeof id !== 'string' || !ID.test(id) || path.basename(id) !== id) throw new VaultError('EINVAL', 'Invalid font')
    return path.join(this.dir, id)
  }

  list(): CustomFont[] {
    let names: string[]
    try {
      names = fs.readdirSync(this.dir)
    } catch {
      return []
    }
    const out: CustomFont[] = []
    for (const id of names.filter((n) => ID.test(n)).sort()) {
      try {
        const buf = fs.readFileSync(path.join(this.dir, id))
        const info = fontInfo(buf, id)
        if (info && validateFont(buf)) out.push({ id, ...info, format: fontFormat(buf)! })
      } catch { /* unreadable: skip */ }
    }
    return out
  }

  data(id: unknown): Buffer {
    try {
      return fs.readFileSync(this.file(id))
    } catch (e) {
      if (e instanceof VaultError) throw e
      throw new VaultError('ENOENT', 'Font not found')
    }
  }

  /** Copy chosen files in; anything that is not a font (or is too large) is rejected, nothing is overwritten. */
  add(paths: string[]): { added: CustomFont[]; rejected: string[] } {
    const added: CustomFont[] = []
    const rejected: string[] = []
    fs.mkdirSync(this.dir, { recursive: true })
    for (const src of paths) {
      const name = path.basename(src)
      try {
        const st = fs.statSync(src)
        if (!st.isFile() || st.size > MAX_FONT_BYTES) throw new Error('size')
        const buf = fs.readFileSync(src)
        const format = validateFont(buf)
        const info = format && fontInfo(buf, name)
        if (!format || !info) throw new Error('format')
        // identical bytes already stored: a duplicate, not a second copy
        const hash = crypto.createHash('sha256').update(buf).digest('hex')
        const dup = fs.readdirSync(this.dir).some((f) => {
          try {
            return crypto.createHash('sha256').update(fs.readFileSync(path.join(this.dir, f))).digest('hex') === hash
          } catch {
            return false
          }
        })
        if (dup) throw new Error('duplicate')
        const ext = { truetype: '.ttf', opentype: '.otf', woff: '.woff', woff2: '.woff2' }[format]
        const stem = name.replace(/\.[^.]*$/, '').replace(/[^\w .()+'-]/g, '-').slice(0, 100) || 'font'
        let id = stem + ext
        for (let i = 2; fs.existsSync(path.join(this.dir, id)); i++) id = `${stem} ${i}${ext}`
        fs.writeFileSync(path.join(this.dir, id), buf, { flag: 'wx' })
        added.push({ id, ...info, format })
      } catch {
        rejected.push(name)
      }
    }
    return { added, rejected }
  }

  remove(id: unknown) {
    fs.rmSync(this.file(id), { force: true })
  }
}
