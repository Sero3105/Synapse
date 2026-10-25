// Opening vaults: validation, moved-vault detection, registry bookkeeping.
// No electron imports so the whole flow is covered by unit tests.
import fs from 'node:fs'
import path from 'node:path'
import { AppStore, VaultStore } from './store'
import { Vault, VaultError } from './vault'
import { NoteHistory } from './history'
import { resolvePrefs } from '../shared/settings'

export interface OpenVault { id: string; vault: Vault; store: VaultStore }

export interface VaultListItem { id: string; path: string; name: string; ts: number; available: boolean }

export function listVaults(app: AppStore): VaultListItem[] {
  const reg = app.getRegistry()
  return Object.entries(reg.vaults)
    .map(([id, v]) => ({ id, path: v.path, name: path.basename(v.path), ts: v.ts, available: isDir(v.path) }))
    .sort((a, b) => b.ts - a.ts)
}

export const isDir = (p: string) => {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/**
 * Open an existing folder as a vault. Never creates a folder: a missing path is an
 * error, not an empty vault. With `create`, the folder must NOT exist yet.
 */
export async function openVault(
  app: AppStore,
  folder: string,
  trash: (abs: string) => Promise<void>,
  { create = false } = {},
): Promise<OpenVault> {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new VaultError('EINVAL', 'Vault path must be absolute')
  const abs = path.resolve(folder)
  if (create) {
    if (fs.existsSync(abs)) throw new VaultError('EEXIST', 'A folder with that name already exists')
    fs.mkdirSync(abs, { recursive: true })
  }
  if (!isDir(abs)) throw new VaultError('ENOENT', `Vault folder not found: ${abs}`)
  try {
    fs.accessSync(abs, fs.constants.R_OK | fs.constants.W_OK)
  } catch {
    throw new VaultError('EACCES', 'No permission to read and write this folder')
  }

  const reg = app.getRegistry()
  const stamped = VaultStore.peekId(abs)
  const byPath = Object.keys(reg.vaults).find((k) => reg.vaults[k].path === abs)
  let id: string | undefined = byPath
  if (!id && stamped) {
    const known = reg.vaults[stamped]
    // Known id at a path that no longer exists -> the vault was moved/renamed: relink it.
    // Known id still present elsewhere -> this folder is a copy: give it a fresh id.
    if (!known || !isDir(known.path)) id = stamped
  }
  const store = new VaultStore(abs)
  const finalId = await app.touchVault(abs, id)
  await store.ensureStamped(finalId)
  return { id: finalId, vault: new Vault(abs, trash, new NoteHistory(path.join(app.dir, 'history', finalId))), store }
}

/** Snapshot sent to the renderer whenever settings or the vault change. */
export function snapshot(app: AppStore, open: OpenVault | null) {
  const global = app.getGlobal()
  const vaultSettings = open ? open.store.get() : null
  return {
    global,
    vault: open ? { id: open.id, path: open.vault.root, name: path.basename(open.vault.root), settings: vaultSettings! } : null,
    prefs: resolvePrefs(global, vaultSettings),
    vaults: listVaults(app),
  }
}
export type Snapshot = ReturnType<typeof snapshot>
