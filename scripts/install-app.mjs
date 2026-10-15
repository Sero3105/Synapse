// Install release/mac-arm64/Synapse.app into /Applications.
// Refuses to replace anything that isn't a previous Synapse build; user data
// (~/Library/Application Support/Synapse and vaults) is never touched.
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const src = path.resolve('release/mac-arm64/Synapse.app')
const dest = process.env.SYNAPSE_INSTALL_DIR ? path.join(process.env.SYNAPSE_INSTALL_DIR, 'Synapse.app') : '/Applications/Synapse.app'
const BUNDLE_ID = 'com.synapse.notes'
const bundleId = (app) => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', path.join(app, 'Contents/Info.plist')]).toString().trim()

if (!fs.existsSync(src)) throw new Error(`Build not found: ${src}. Run "npm run package" first.`)
if (bundleId(src) !== BUNDLE_ID) throw new Error('Unexpected bundle id in build output')

if (fs.existsSync(dest)) {
  let id = ''
  try {
    id = bundleId(dest)
  } catch { /* not a bundle */ }
  if (id !== BUNDLE_ID) throw new Error(`${dest} exists and is not Synapse (${id || 'unknown'}); not replacing it.`)
  try {
    execFileSync('pgrep', ['-f', `${dest}/Contents/MacOS/Synapse`])
    throw new Error('Synapse is running. Quit it before updating.')
  } catch (e) {
    if (e.message?.startsWith('Synapse is running')) throw e
  }
}

// Copy next to the destination first, then swap, so a failed copy never leaves a broken app.
const staging = `${dest}.installing`
fs.rmSync(staging, { recursive: true, force: true })
execFileSync('/usr/bin/ditto', [src, staging])
if (fs.existsSync(dest)) {
  const old = `${dest}.previous`
  fs.rmSync(old, { recursive: true, force: true })
  fs.renameSync(dest, old)
  fs.renameSync(staging, dest)
  fs.rmSync(old, { recursive: true, force: true })
} else fs.renameSync(staging, dest)
execFileSync('/usr/bin/codesign', ['--verify', '--deep', dest])
console.log(`Installed ${dest}`)
