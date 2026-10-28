// In-app update without Apple's Developer ID: download the signed zip from the GitHub release,
// check our own ed25519 signature, unpack, then a detached shell swaps the bundle after we quit.
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { UPDATE_PUBLIC_KEY, UpdateInfo, isNewer } from '../shared/update'
import { t } from '../shared/i18n'

const run = promisify(execFile)
const BUNDLE_ID = 'com.synapse.notes'

export function verifySignature(data: Buffer, sigBase64: string, publicKey = UPDATE_PUBLIC_KEY): boolean {
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), format: 'der', type: 'spki' })
    return crypto.verify(null, data, key, Buffer.from(sigBase64.trim(), 'base64'))
  } catch {
    return false
  }
}

const plist = async (app: string, key: string) =>
  (await run('/usr/bin/plutil', ['-extract', key, 'raw', path.join(app, 'Contents/Info.plist')])).stdout.trim()

/** Swap script: wait for our pid to exit, move old app aside, move new in (roll back on failure), relaunch, clean up. */
const SWAP = `
while kill -0 "$1" 2>/dev/null; do sleep 0.2; done
if mv "$2" "$4/previous.app"; then
  if mv "$3" "$2"; then rm -rf "$4"; else mv "$4/previous.app" "$2"; fi
fi
open "$2"
`

/**
 * Download, verify and stage the update; returns a function that starts the swap (call it right before quitting).
 * `bundle` is the running Synapse.app.
 */
export async function prepareUpdate(
  info: UpdateInfo, bundle: string, current: string, fetch: (url: string) => Promise<Response>,
): Promise<() => void> {
  if (!info.zip || !info.sig) throw new Error(t('update.noZip'))
  if (!bundle.endsWith('.app') || bundle.includes('/AppTranslocation/')) throw new Error(t('update.moveToApps'))
  try {
    fs.accessSync(path.dirname(bundle), fs.constants.W_OK)
  } catch {
    throw new Error(t('update.moveToApps'))
  }

  const get = async (url: string) => {
    const r = await fetch(url)
    if (!r.ok) throw new Error(t('update.downloadFailed', { status: r.status }))
    return Buffer.from(await r.arrayBuffer())
  }
  const [zip, sig] = await Promise.all([get(info.zip), get(info.sig)])
  if (!verifySignature(zip, sig.toString('utf8'))) throw new Error(t('update.badSignature'))

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-update-'))
  try {
    const file = path.join(dir, 'update.zip')
    fs.writeFileSync(file, zip)
    await run('/usr/bin/ditto', ['-x', '-k', file, dir])
    fs.rmSync(file)
    const next = path.join(dir, 'Synapse.app')
    // the signature proves it is ours; this stops an old signed build being replayed as "latest"
    if ((await plist(next, 'CFBundleIdentifier')) !== BUNDLE_ID) throw new Error(t('update.mismatch'))
    const version = await plist(next, 'CFBundleShortVersionString')
    if (version !== info.version || !isNewer(version, current)) throw new Error(t('update.mismatch'))
    await run('/usr/bin/xattr', ['-dr', 'com.apple.quarantine', next]).catch(() => {})
    return () => spawn('/bin/sh', ['-c', SWAP, 'sh', String(process.pid), bundle, next, dir], { detached: true, stdio: 'ignore' }).unref()
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw e
  }
}
