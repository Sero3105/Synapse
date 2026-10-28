// Render the DMG window background (warm paper, the Synapse mark, an arrow from the app to
// Applications and a short instruction) to build/background.tiff, 1x and 2x in one file, and the
// volume icon to build/volume.icns. The DMG lists both under their hidden names so it can place them
// out of sight (Finder shows them when hidden files are on); see build.dmg in package.json.
// Run with Electron so the page uses the system fonts: npm run dmg-background
// Icon centres (x 140 / 400, y 190) must match build.dmg.contents.
import { app, BrowserWindow } from 'electron'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const W = 540
const H = 380

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; }
  body { background: #f8f6f2; font-family: -apple-system, "SF Pro Text", sans-serif; color: #1b1b21; position: relative; }
  /* a soft glow behind each icon slot, so the icons sit on the page instead of floating */
  .slot { position: absolute; top: 118px; width: 144px; height: 144px; border-radius: 36px; background: #efece6; }
  .s1 { left: 68px; } .s2 { left: 328px; }
  .brand { position: absolute; top: 34px; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 10px; }
  .brand span { font: 600 21px/1 "New York", ui-serif, Georgia, serif; letter-spacing: -0.01em; }
  .arrow { position: absolute; left: 0; top: 0; }
  .hint { position: absolute; left: 0; right: 0; top: 302px; text-align: center; font-size: 13px; color: #55565f; }
  .hint small { display: block; margin-top: 4px; font-size: 11.5px; color: #8a8b93; }
</style></head><body>
  <div class="slot s1"></div><div class="slot s2"></div>
  <div class="brand">
    <svg width="22" height="22" viewBox="0 0 22 22"><circle cx="5" cy="7" r="3.6" fill="#1b1b21"/><circle cx="16" cy="5" r="2.6" fill="#1b1b21"/><circle cx="12" cy="16" r="4.2" fill="#6d5fe0"/></svg>
    <span>Synapse</span>
  </div>
  <svg class="arrow" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <path d="M 226 190 L 312 190" stroke="#6d5fe0" stroke-width="2" stroke-linecap="round" stroke-dasharray="1 7" fill="none"/>
    <path d="M 304 182 L 314 190 L 304 198" stroke="#6d5fe0" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>
  <div class="hint">Drag Synapse onto Applications to install it<small>Trascina Synapse su Applicazioni per installarla</small></div>
</body></html>`

app.dock?.hide()
app.on('window-all-closed', () => {}) // the 1x window closes before the 2x one opens: do not quit there
app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-dmg-'))
  const page = path.join(tmp, 'background.html')
  fs.writeFileSync(page, html)
  for (const scale of [1, 2]) {
    // the @2x image is the same page drawn at twice the size
    const w = new BrowserWindow({ show: false, width: W * scale, height: H * scale, useContentSize: true, webPreferences: { offscreen: true, zoomFactor: scale } })
    await w.loadFile(page)
    await new Promise((r) => setTimeout(r, 300))
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: W * scale, height: H * scale })
    fs.writeFileSync(path.join(tmp, scale === 1 ? 'background.png' : 'background@2x.png'), img.toPNG())
    w.destroy()
  }
  execFileSync('tiffutil', ['-cathidpicheck', path.join(tmp, 'background.png'), path.join(tmp, 'background@2x.png'), '-out', 'build/background.tiff'])
  // volume icon from the app icon
  const set = path.join(tmp, 'volume.iconset')
  fs.mkdirSync(set)
  for (const size of [16, 32, 128, 256, 512]) {
    execFileSync('sips', ['-z', String(size), String(size), 'build/icon.png', '--out', path.join(set, `icon_${size}x${size}.png`)], { stdio: 'ignore' })
    execFileSync('sips', ['-z', String(size * 2), String(size * 2), 'build/icon.png', '--out', path.join(set, `icon_${size}x${size}@2x.png`)], { stdio: 'ignore' })
  }
  execFileSync('iconutil', ['-c', 'icns', set, '-o', 'build/volume.icns'])
  fs.rmSync(tmp, { recursive: true, force: true })
  console.log('build/background.tiff, build/volume.icns')
  app.quit()
})
