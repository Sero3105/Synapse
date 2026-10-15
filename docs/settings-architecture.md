# Settings architecture

## Two layers

| Layer | File | Owner | Contents |
|---|---|---|---|
| A. Global | `~/Library/Application Support/Synapse/settings.json` | `AppStore` (main process) | `prefs` (all preferences), `layout` (sidebars, ribbon), `hotkeys` |
| A. Registry | `~/Library/Application Support/Synapse/vaults.json` | `AppStore` | known vaults `{id: {path, ts}}`, `lastOpen` |
| A. Window | `~/Library/Application Support/Synapse/window.json` | `AppStore` | bounds, maximized |
| B. Vault | `<vault>/.synapse/settings.json` | `VaultStore` | `vaultId`, `overrides` (subset of prefs), `graph`, `attachmentFolder` |
| B. Workspace | `<vault>/.synapse/workspace.json` | `VaultStore` | panes, tabs, history, cursor/scroll, expanded folders |

The global directory comes from Electron's `app.getPath('userData')`. It never depends on the cwd or the open vault. Tests point it at a temp dir with `SYNAPSE_USER_DATA`.

## Precedence

```
effective = DEFAULT_PREFS  <-  global.prefs  <-  vault.overrides
```

`resolvePrefs()` in `src/shared/settings.ts` does this. `corePlugins` is merged per key, so a vault can override one plugin without copying the others. `layout` and `hotkeys` are global only, by design.

## Writing

- The Settings UI shows a scope menu (**All vaults** / **This vault only**) on every preference row when a vault is open.
- An edit goes to the vault layer only if that key is already overridden there. Otherwise it goes to the global layer.
- Switching to "This vault only" copies the current effective value into `overrides`. Switching back sends `null`, which deletes the override. The global value is never modified by a vault edit.
- Patches are validated key by key (`validPrefs`, `validLayout`, `validGraph`). Unknown keys are dropped.

## Safety

- **Atomic writes**: temp file, `fsync`, `rename`. A crash never leaves a half-written file.
- **Write before commit**: memory is updated only after the write succeeds, so a failed write leaves the disk and memory unchanged. The UI shows a notice.
- **Serialized writes**: each store queues its writes, so a global update during a vault switch cannot interleave with another write.
- **Corruption**: unreadable JSON is copied to `<file>.corrupt-<timestamp>` and defaults are used. Invalid individual values fall back to the lower layer, so the rest of the file still loads.
- **Migrations**: `migrateGlobal` / `migrateVault` (v1 → v2). The original file is backed up as `<file>.v1.bak` before being rewritten.
- **Moved / renamed vaults**: the vault id is stamped in `.synapse/settings.json`. Opening a folder whose stamped id belongs to a registry entry whose path no longer exists relinks that entry, keeping the id and history. If the original still exists, the folder is a copy and gets a new id.
- **Missing vaults** are shown as unavailable, with *Locate…* and *Remove from list*. They are never created automatically.

## IPC

The renderer calls `settings:global(patch)` and `settings:vault(patch)` only. Main validates the patch, persists it, and broadcasts a full `state` snapshot (`{global, vault, prefs, vaults}`). The UI re-renders from that one snapshot, so there are no duplicate settings objects in the renderer.

## Tests

`test/settings.test.ts` covers the mandatory 20-step scenario at the service level. It also covers:

- a never-opened vault
- a vault with no local settings
- old vault and global schemas
- corrupted global and vault files
- per-key fallback
- an unavailable path
- a moved/renamed vault
- a copied vault
- two vaults with different overrides
- removing an override
- partial `corePlugins` overrides
- a failed write
- a concurrent update during a switch
- unknown keys
- startup with no vault
- hotkeys reset

`e2e/app.spec.ts` runs the same 20 steps through the real UI with real restarts.
