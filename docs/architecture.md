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
│               synapse-file:// protocol    ├─ model.ts      state + actions; layers in model-*.ts (types, base, buffers, workspace, files)
├─ store.ts     AppStore / VaultStore       ├─ commands.ts   command registry + hotkeys
│               (settings, registry, atomic ├─ editor-commands.ts
│               writes, migrations)         ├─ components/   Editor (CM6), Reading (markdown-it), Workspace,
├─ session.ts   open/create vault, moved-   │                Sidebars, Graph, Modals, Settings
│               vault detection, snapshot   ├─ code.ts       fence highlighting (both views), Mermaid
├─ vault.ts     path-confined fs access     └─ App.tsx       shell, theme application, status bar
└─ history.ts   note versions in app data   shared/
preload.ts      contextBridge: invoke(channel) ├─ settings.ts  schema, defaults, validation, migrations, precedence
                with channel allowlist         ├─ markdown.ts  link/tag/heading parsing, link resolution, index, search, rename rewriting
                                               └─ templates.ts daily note paths, template placeholders
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
   Main keeps one context per window (`BrowserWindow`, open vault, watcher), keyed by `webContents` id. Every IPC call acts on its sender's vault, `fs:changed` goes only to that window, and `synapse-file://<vault id>/…` URLs name the vault an image comes from. A vault already open in one window is not opened in a second (`EWINDOW`); that window is brought forward. Window bounds are saved per vault in `window.json`, and `placeWindow` (`src/main/store.ts`) keeps a new window on a connected display and off another window's exact spot.
2. The renderer fetches the `state` snapshot. When a vault is open it calls `fs:list` and `fs:readAll` to build the in-memory `NoteIndex` (links, tags, headings), then restores `workspace.json`.
3. Edits update a per-path buffer and the index at once. Autosave runs after 800 ms with `expectedMtime`. If the file changed on disk and differs, main returns `ECONFLICT` and the renderer shows a conflict banner instead of overwriting.
4. A recursive `fs.watch` sends `fs:changed`. Clean buffers reload, dirty buffers get a conflict, and the index updates.
5. On window close, main asks the renderer to flush dirty buffers and the workspace. If saving fails, the user must confirm before quitting.

## Code, diagrams and version history

- Fenced code: the editor resolves a fence's language with `codeLanguage()` (`src/renderer/code.ts`). It uses `@codemirror/language-data`, loaded on demand, and falls back to highlight.js aliases (`py`, `md`, …). The reading view uses highlight.js with the same identifiers. Unknown languages stay plain text, and blocks over 100 000 characters are not highlighted.
- Mermaid is imported only when a note in the reading view has a ```` ```mermaid ```` fence. It runs with `securityLevel: 'strict'` (Mermaid sanitizes the whole SVG with DOMPurify and disables click callbacks; its default `secure` list stops `%%{init}%%` from changing that) and `suppressErrorRendering`. Invalid diagrams keep their source with a message. Diagrams are redrawn when the theme changes.
- Version history (`src/main/history.ts`): `Vault.write()` copies the text it is about to replace into `<userData>/history/<vault id>/<hash of path>/<ms>-<sha256 prefix>.md`, written atomically. A copy is skipped if it equals the newest one. It is throttled to one per 10 minutes, except when the disk text is not what this Synapse session last wrote (an external edit, or the first save after launch), on forced writes, and on restore. The newest 50 per note are kept. `Vault.rename()` moves the history along. Snapshot failures are logged and never block a save. `history:restore` goes through `write()` with the caller's `expectedMtime`, so newer changes on disk win with `ECONFLICT`.

## Discovery, tasks, attachments, export, import

- `src/shared/related.ts` ranks related notes from the `NoteIndex`, which now also keeps per-note terms and their document frequency, updated in `upsert`/`remove`. A query runs only while the Related section is expanded.
- `src/shared/graph-filter.ts`: visible nodes and neighbours for the graph filters, the local graph walk (`localNodes`, through visible nodes only) and colour groups. Filter state lives in refs read by the draw loop, so filtering does not rebuild the simulation.
- `src/shared/graph-layout.ts`: the force layout. Repulsion is the exact pairwise sum up to 1000 visible nodes and Barnes–Hut above (measured with `npm run bench:graph`). Graph mode, depth, colouring and saved views are vault settings.
- `src/shared/tasks.ts`: `parseTasks` and `toggleTaskLine(content, line, expectedRaw)`, which refuses when the line changed. Toggles go through `model.edit` and the normal autosave conflict check.
- `src/shared/attachments.ts`: report from the in-memory index only; no disk access, no deletion.
- `src/shared/start.ts`: start page lists. Pins and dismissed suggestions are stored in `workspace.json`, follow renames and drop deleted notes.
- Export: the renderer renders the note (`src/renderer/export.ts`); `src/main/export.ts` inlines `synapse-file:` images of its own vault through `Vault.resolve`, wraps the page with a strict CSP, saves through the native dialog, and prints PDFs in a hidden window with JavaScript off. *Export vault* renders every note with internal links rewritten to relative `.html` paths (`relativeHref`) and heading ids; main checks each page path (`validPagePath`) and writes them into a new folder, never over an existing one.
- Update: `src/main/updater.ts` downloads the release zip found at launch, checks its ed25519 signature against the key in `src/shared/update.ts`, unpacks it, checks bundle id and version, and a detached shell swaps the app after Synapse quits. The private key never enters the repo (`scripts/sign-update.mjs`).
- Import: `src/main/migrate.ts` `inspectFolder` reads a picked folder (no writes, no symlinks) before it becomes a vault.
- `fs:openFile` opens PDFs only, so a click can never launch an executable in a vault.
- PDF tabs show the file in an `<iframe>` with Chromium's viewer (`plugins: true`). Frames may only stay on `synapse-file:` and the viewer: `will-frame-navigate` sends any other navigation to the browser, and a `webRequest` filter cancels web pages requested as frames in case that check is ever bypassed. The CSP allows web URLs in `frame-src` only so that a clicked link reaches those checks instead of blanking the tab.

## Rename / move

The renderer computes the old→new map (a whole folder when needed), flushes buffers, renames on disk, and moves buffers, tabs, history and index entries. When `updateLinksOnRename` is on, it rewrites wiki and markdown links that pointed to moved files. It uses the pre-rename lookup for resolution and the shortest unique link text for output. Notes changed on disk in the meantime are skipped.

## Deliberate differences from the reference

- A window can switch vaults in place, and other vaults open in their own windows; the same vault is never open in two windows.
- Preferences are global with per-vault overrides. In the reference they are only per-vault.
- Live Preview is implemented as CodeMirror decorations (`src/renderer/live-preview.ts`). The file text is never altered by rendering. Tables outside the cursor are block widgets whose cell edits are written back as normal, undoable transactions. Math (`$…$`, `$$…$$`) is rendered with KaTeX by `src/renderer/math.ts`, shared by Live Preview and the reading view.
- Splits form a tree (`src/shared/layout.ts`, up to 8 panes) saved in `workspace.json` as `layout`, with leaves pointing at saved panes by index. Files from earlier versions (`direction` + `paneSizes`) and layouts that do not place every pane exactly once open as a single row. Panes are rendered as one flat list placed from the tree, so changing the layout never remounts an editor.
- Rename uses a dialog. The inline title also renames the file.
- No community plugin API.
