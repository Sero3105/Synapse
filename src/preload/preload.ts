import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron'

// Only these channels are reachable from the renderer; each is validated again in main.
const INVOKE = [
  'state:get', 'settings:global', 'settings:vault',
  'vault:open', 'vault:openId', 'vault:create', 'vault:remove', 'vault:close', 'vault:locate', 'dialog:folder',
  'fs:list', 'fs:read', 'fs:readAll', 'fs:write', 'fs:create', 'fs:createBinary', 'fs:mkdir', 'fs:rename', 'fs:trash', 'fs:exists', 'fs:reveal',
  'workspace:load', 'workspace:save', 'shell:openExternal',
]
const EVENTS = ['state', 'fs:changed', 'command', 'app:flush']

contextBridge.exposeInMainWorld('synapse', {
  invoke: (channel: string, ...args: unknown[]) => {
    if (!INVOKE.includes(channel)) return Promise.reject(new Error(`Blocked channel ${channel}`))
    return ipcRenderer.invoke(channel, ...args)
  },
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    if (!EVENTS.includes(channel)) throw new Error(`Blocked event ${channel}`)
    const fn = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...args)
    ipcRenderer.on(channel, fn)
    return () => ipcRenderer.removeListener(channel, fn)
  },
  flushed: (ok: boolean) => ipcRenderer.send('app:flushed', ok === true),
})
