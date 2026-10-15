# Architecture

## Stack choice

| Option | Verdict |
|---|---|
| Electron + React + TypeScript | **Chosen.** Node and npm are present. Chromium gives consistent rendering, and CodeMirror 6 is the mature editor for Markdown. Playwright can drive Electron for E2E tests. |
| Tauri | Rejected: no Rust toolchain on this machine (`cargo`/`rustc` missing). It would also need a second language for the filesystem layer. |
| Native SwiftUI | Rejected: a rich Markdown editor with a link graph would mean much more custom code. |

Electron was **not** chosen because Obsidian uses it. Unlike Obsidian (`contextIsolation:false`, `nodeIntegration:true`), Synapse runs a sandboxed renderer with context isolation.

## Processes and modules

```
main process (Node)                         renderer (sandboxed, no Node)
├─ main.ts      window, menu, IPC, watcher, ├─ api.ts        typed wrapper over window.synapse
│               synapse-file:// protocol    ├─ model.ts      state + actions (tabs, buffers, saving, rename…)
├─ store.ts     AppStore / VaultStore       ├─ commands.ts   command registry + hotkeys
│               (settings, registry, atomic ├─ editor-commands.ts
│               writes, migrations)         ├─ components/   Editor (CM6), Reading (markdown-it), Workspace,
├─ session.ts   open/create vault, moved-   │                Sidebars, Graph, Modals, Settings
│               vault detection, snapshot   └─ App.tsx       shell, theme application, status bar
└─ vault.ts     path-confined fs access     shared/
preload.ts      contextBridge: invoke(channel) ├─ settings.ts  schema, defaults, validation, migrations, precedence
                with channel allowlist         └─ markdown.ts  link/tag/heading parsing, link resolution, index, search, rename rewriting
```

## Security boundary

- `BrowserWindow`: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. `will-navigate` is blocked, and new windows are denied (http(s) links open in the default browser).
- The preload exposes only `invoke(channel, …args)` and `on(event)`, each checked against an allowlist. Main also checks the sender is the app window.
- Every renderer path is **vault-relative**. `Vault.resolve()` rejects absolute paths, `..` escapes, NUL bytes and the `.synapse` config folder. It also resolves the nearest existing ancestor through `realpath`, so a symlink cannot lead outside the vault.
- Listing never traverses symlinks or hidden folders (`.obsidian`, `.git`, `.synapse`, …).
- Attachments are served through `synapse-file://vault/<path>`, which uses the same `resolve()`.
- `shell:openExternal` allows only http, https and mailto.
- Raw HTML in notes is not rendered (`markdown-it` with `html:false`). A strict CSP blocks inline scripts.

## Data flow

1. On launch, main loads `AppStore` and reopens `lastOpen` **only if the folder exists**. It then creates the window.
2. The renderer fetches the `state` snapshot. When a vault is open it calls `fs:list` and `fs:readAll` to build the in-memory `NoteIndex` (links, tags, headings), then restores `workspace.json`.
3. Edits update a per-path buffer and the index at once. Autosave runs after 800 ms with `expectedMtime`. If the file changed on disk and differs, main returns `ECONFLICT` and the renderer shows a conflict banner instead of overwriting.
4. A recursive `fs.watch` sends `fs:changed`. Clean buffers reload, dirty buffers get a conflict, and the index updates.
5. On window close, main asks the renderer to flush dirty buffers and the workspace. If saving fails, the user must confirm before quitting.

## Rename / move

The renderer computes the old→new map (a whole folder when needed), flushes buffers, renames on disk, and moves buffers, tabs, history and index entries. When `updateLinksOnRename` is on, it rewrites wiki and markdown links that pointed to moved files. It uses the pre-rename lookup for resolution and the shortest unique link text for output. Notes changed on disk in the meantime are skipped.

## Deliberate differences from the reference

- One window that switches vaults in place, instead of one window per vault.
- Preferences are global with per-vault overrides. In the reference they are only per-vault.
- The editor is source mode with styled Markdown, plus a separate reading view. There is no Live Preview that hides markup.
- A flat split layout (up to 4 panes in one direction) instead of an arbitrary split tree.
- Rename uses a dialog. The inline title also renames the file.
- No community plugin API.
