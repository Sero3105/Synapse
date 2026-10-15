import type { Snapshot } from '../main/session'
import type { FileEntry, NoteData } from '../main/vault'

export type { Snapshot, FileEntry, NoteData }

interface Bridge {
  invoke(channel: string, ...args: unknown[]): Promise<{ ok?: unknown; error?: { code: string; message: string } }>
  on(channel: string, cb: (...args: unknown[]) => void): () => void
  flushed(ok: boolean): void
}

declare global {
  interface Window { synapse: Bridge }
}

export class ApiError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = await window.synapse.invoke(channel, ...args)
  if (r.error) throw new ApiError(r.error.code, r.error.message)
  return r.ok as T
}

export const api = {
  state: () => call<Snapshot>('state:get'),
  updateGlobal: (patch: unknown) => call<void>('settings:global', patch),
  updateVault: (patch: unknown) => call<void>('settings:vault', patch),
  openVault: (p: string) => call<Snapshot>('vault:open', p),
  openVaultId: (id: string) => call<Snapshot>('vault:openId', id),
  createVault: (parent: string, name: string) => call<Snapshot>('vault:create', parent, name),
  removeVault: (id: string) => call<void>('vault:remove', id),
  closeVault: () => call<void>('vault:close'),
  locateVault: (id: string) => call<Snapshot | null>('vault:locate', id),
  pickFolder: (title: string) => call<string | null>('dialog:folder', title),
  list: () => call<FileEntry[]>('fs:list'),
  read: (p: string) => call<NoteData>('fs:read', p),
  readAll: () => call<NoteData[]>('fs:readAll'),
  write: (p: string, content: string, mtime?: number) => call<{ mtime: number }>('fs:write', p, content, mtime),
  create: (p: string, content = '') => call<NoteData>('fs:create', p, content),
  createBinary: (p: string, data: Uint8Array) => call<string>('fs:createBinary', p, data),
  mkdir: (p: string) => call<void>('fs:mkdir', p),
  rename: (a: string, b: string) => call<void>('fs:rename', a, b),
  trash: (p: string) => call<void>('fs:trash', p),
  exists: (p: string) => call<boolean>('fs:exists', p),
  reveal: (p: string) => call<void>('fs:reveal', p),
  loadWorkspace: () => call<unknown>('workspace:load'),
  saveWorkspace: (ws: unknown) => call<void>('workspace:save', ws),
  openExternal: (url: string) => call<void>('shell:openExternal', url),
  on: (ch: string, cb: (...a: unknown[]) => void) => window.synapse.on(ch, cb),
  flushed: (ok: boolean) => window.synapse.flushed(ok),
}

/** URL for an attachment inside the open vault (served by the main process with boundary checks). */
export const fileUrl = (p: string) => 'synapse-file://vault/' + p.split('/').map(encodeURIComponent).join('/')
