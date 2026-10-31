// Shared setup for feature specs: an isolated temp vault and app-data folder per test.
import { _electron, ElectronApplication, Page, Locator } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface Env { tmp: string; userData: string; vault: string }

/** Temp vault with the given files (vault-relative path -> content), registered as the last open vault. */
export function makeEnv(files: Record<string, string | Buffer>): Env {
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'synapse-e2e-')))
  const userData = path.join(tmp, 'userData')
  const vault = path.join(tmp, 'Vault')
  for (const [p, c] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(vault, p)), { recursive: true })
    fs.writeFileSync(path.join(vault, p), c)
  }
  fs.mkdirSync(vault, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  fs.writeFileSync(path.join(userData, 'vaults.json'), JSON.stringify({ vaults: { aaaaaaaaaaaaaaaa: { path: vault, ts: 1 } }, lastOpen: 'aaaaaaaaaaaaaaaa' }))
  fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ version: 2, language: 'en' }))
  return { tmp, userData, vault }
}

export async function launch(env: Env): Promise<{ app: ElectronApplication; win: Page }> {
  const exe = process.env.SYNAPSE_APP
  const app = await _electron.launch({
    ...(exe ? { executablePath: exe, args: [] } : { args: [path.join(__dirname, '..')] }),
    // SYNAPSE_HIDDEN: no window on screen, no focus taken, so typing on this Mac never lands in a test; Playwright drives it through CDP
    env: { ...process.env, SYNAPSE_USER_DATA: env.userData, SYNAPSE_UPDATE_FEED: 'http://127.0.0.1:9/none', SYNAPSE_HIDDEN: '1' },
  })
  const win = await app.firstWindow()
  win.on('pageerror', (e) => console.error('pageerror', e))
  await win.waitForLoadState('domcontentloaded')
  // commands that need a vault are offered only once it has loaded
  await win.getByTestId('file-explorer').waitFor()
  return { app, win }
}

export async function palette(win: Page, text: string) {
  await win.keyboard.press('Meta+P')
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
}

export const cleanup = (env: Env) => fs.rmSync(env.tmp, { recursive: true, force: true })

/** Pick a choice in one of the app's dropdowns (Select.tsx): its button is named "<label>: <current choice>". */
export async function choose(win: Page, label: string, option: string, within: Page | Locator = win) {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  await within.getByRole('button', { name: new RegExp(`^${esc}:`) }).click()
  await win.getByRole('menuitemradio', { name: option, exact: true }).click()
}
