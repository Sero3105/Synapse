// Render the original Synapse app icon (three linked nodes on a rounded square) to build/icon.png.
// Pure Node: signed-distance shapes, 4x4 supersampling, PNG encoded with zlib.
import fs from 'node:fs'
import zlib from 'node:zlib'

const S = 1024
const px = new Uint8Array(S * S * 4)
const bg1 = [124, 77, 255]
const bg2 = [86, 46, 214]
const nodes = [[360, 380, 92], [690, 330, 72], [560, 690, 104]]
const edges = [[0, 1], [1, 2], [2, 0]]

// macOS icon grid: 824px rounded square centered in 1024 canvas
const sdRoundRect = (x, y) => {
  const c = S / 2, h = 412, r = 186
  const qx = Math.abs(x - c) - h + r
  const qy = Math.abs(y - c) - h + r
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
const sdSegment = (x, y, a, b) => {
  const [ax, ay] = a, [bx, by] = b
  const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)))
  return Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay))
}

function sample(x, y) {
  if (sdRoundRect(x, y) > 0) return null
  const t = (x + y) / (2 * S)
  let c = bg1.map((v, i) => v + (bg2[i] - v) * t)
  let fg = false
  for (const [a, b] of edges) if (sdSegment(x, y, nodes[a], nodes[b]) < 22) fg = true
  for (const [nx, ny, r] of nodes) if (Math.hypot(x - nx, y - ny) < r) fg = true
  if (fg) c = [255, 255, 255]
  return c
}

const SS = 4
for (let y = 0; y < S; y++) {
  for (let x = 0; x < S; x++) {
    let r = 0, g = 0, b = 0, a = 0
    for (let j = 0; j < SS; j++)
      for (let i = 0; i < SS; i++) {
        const c = sample(x + (i + 0.5) / SS, y + (j + 0.5) / SS)
        if (c) { r += c[0]; g += c[1]; b += c[2]; a++ }
      }
    const o = (y * S + x) * 4
    if (a) { px[o] = r / a; px[o + 1] = g / a; px[o + 2] = b / a; px[o + 3] = (a / (SS * SS)) * 255 }
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}
const raw = Buffer.alloc(S * (S * 4 + 1))
for (let y = 0; y < S; y++) Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1)
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6
fs.mkdirSync('build', { recursive: true })
fs.writeFileSync('build/icon.png', Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
console.log('wrote build/icon.png')
