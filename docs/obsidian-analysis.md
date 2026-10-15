# Obsidian reference analysis

Evidence-based notes on the installed reference application, used to specify Synapse.
No personal note content was read. Obsidian's installation was not modified.

## Method and tooling

| Item | Value |
|---|---|
| Reference app | `/Applications/Obsidian.app`, installer version **1.12.7** (Info.plist) |
| Code actually running | `~/Library/Application Support/obsidian/obsidian-1.13.7.asar` (auto-update, loaded by the bootstrap `app.asar`) |
| Tool | REA 6.5.0 CLI (`~/.local/bin/rea`). REA is **not** registered as an MCP server for Claude Code (`rea doctor`: `clients: []`), so the CLI was used. |
| Commands | `rea doctor`; `rea analyze-javascript-application <asar> --integrity-policy record-and-continue`; `rea extract-artifact obsidian.asar` |
| Native providers | Hopper, Ghidra, IDA, JADX: not installed. Not needed: the app is Electron/JavaScript; no native analysis was attempted. |

`app.asar` analysis initially failed with `artifact_integrity_mismatch` on unpacked native addons (`btime.node`, `get-fonts.node`), which are re-signed after packaging. Rerun with `record-and-continue`; those binaries are marked untrusted and were not analyzed.

REA statistics for `obsidian.asar` (1.12.7): 31 JS files parsed, 3.89M AST nodes, 923 modules, 42 literal `ipcMain` channels, 0 parse failures. REA limitations recorded: bundle bootstrap not executed; dynamic relationships unresolved; absence of a finding is not proof of absence.

Key conclusions were then confirmed by reading the extracted (minified) `main.js`/`app.js`/`app.css` around the REA-located symbols. The 1.13.7 asar was checked only for the presence of the same identifiers (`baseFontSize`, `appearance.json`, `getLinkpathDest`, `vault-open`); its logic was not re-analyzed (**limitation**).

Observed = read in code/config. Hypothesis = inferred, not verified at runtime.

## A. Startup, windows, vault registry

**Observed (main.js)**
- `app.asar` is a small loader (uses `@electron/remote`) that loads `obsidian.asar` (or a newer downloaded asar from userData).
- Vault registry: `~/Library/Application Support/obsidian/obsidian.json` = `{ vaults: { <16-hex id>: { path, ts, open? } } }`. Ids from `ct(16)` (random hex). Our local file has only the `vaults` key.
- **One BrowserWindow per vault** (`H[id]`). Opening an already-open vault focuses its window.
- Per-vault window state in `<userData>/<vaultId>.json`: `{x, y, width, height, isMaximized, devTools, zoom}` (keys confirmed on disk).
- Open vault (`d(path)`): resolves path; **missing folder → error "folder not found"**; no permission → error; existing path → touch `ts` and focus; new path → new id. Never creates a folder on open. `vault-open` with `create=true` refuses an existing folder ("Vault already exists").
- `vault-remove` refuses while that vault's window is open; also deletes the vault's window-state file and session partition.
- `vault-move` renames the folder on disk and updates the registry path (refuses while open).
- `open-file` event resolves a file to the deepest registered vault containing it.
- Window: `titleBarStyle` hidden/custom frame, `trafficLightPosition {x:19, y:12}`, default 800×600, min 200×150.
- **Security**: `contextIsolation:false`, `nodeIntegration:true`, `webviewTag:true` in vault windows. Synapse deliberately does not copy this.

**Confidence**: high (direct code). **Unresolved**: exact restore behavior of multiple open vault windows at startup (`open` flag) not exercised at runtime.

## B. Settings persistence (the core problem)

**Observed (app.js default config object, `onConfigFileChange`)**
- Per vault, in `<vault>/.obsidian/`: `app.json` (editor + files options), `appearance.json` (theme, accent, fonts, `baseFontSize`, `cssTheme`, `enabledCssSnippets`, `translucency`, …), `hotkeys.json`, `core-plugins.json`, `community-plugins.json`, `workspace.json`, plus `<plugin-id>.json` files for core plugin data (graph, backlinks, …).
- Defaults include: `theme:"system"`, `baseFontSize:16`, `readableLineLength:true`, `showLineNumber:false`, `spellcheck:true`, `tabSize:4`, `useTab:true`, `defaultViewMode:"source"`, `livePreview:true`, `alwaysUpdateLinks:false`, `newFileLocation:"root"`, `newLinkFormat:"shortest"`, `attachmentFolderPath:"/"`, `promptDelete:true`, `trashOption:"system"`, `showInlineTitle:true`, `foldHeading`, `autoPairBrackets`, `vimMode:false`.
- Theme, fonts, editor preferences and hotkeys are therefore **vault-scoped**. Opening another vault starts from that vault's own files, which explains preferences "resetting" across vaults. Global storage holds only the registry and window geometry.

**Synapse decision**: invert this. Preferences are global by default (app-data dir); vaults may override individual keys. See `settings-architecture.md`.

## C. Editor

**Observed**: CodeMirror (bundled `lib/codemirror`, plus CM6 code in app.js), `livePreview` and `defaultViewMode: source|preview`, `markdown:toggle-preview` (Mod+E). Command ids (139 found) include formatting toggles, `editor:open-search` (Mod+F), `editor:save-file` (Mod+S), folding, multi-cursor, list indent.
**Hypothesis**: autosave is debounced (consistent with `editor:save-file` existing but not required); not measured.

## D. Navigation & workspace

**Observed**: `workspace.json` / `workspace-mobile.json` per vault; `lastOpenFiles` tracked; commands `workspace:split-vertical/horizontal`, `new-tab`, `close`, `undo-close-pane`, `goto-tab-1..8`, `goto-last-tab`, `next/previous-tab`, `toggle-pin`, `toggle-stacked-tabs`, `app:go-back/forward`, `command-palette:open`, `switcher:open`.

Default hotkeys (from command registrations, `Mod` = Cmd):

| Command | Hotkey |
|---|---|
| command-palette:open | Mod+P |
| switcher:open | Mod+O |
| app:open-settings | Mod+, |
| app:go-back / go-forward | Mod+Alt+← / → |
| file-explorer:new-file | Mod+N |
| file-explorer:new-file-in-new-pane | Mod+Shift+N |
| global-search:open | Mod+Shift+F |
| graph:open | Mod+G |
| markdown:toggle-preview | Mod+E |
| editor:open-search | Mod+F |
| editor:toggle-bold / italics | Mod+B / Mod+I |
| editor:insert-link | Mod+K |
| editor:toggle-checklist-status | Mod+L |
| editor:delete-paragraph | Mod+D |
| workspace:new-tab / close | Mod+T / Mod+W |
| workspace:goto-tab-N / goto-last-tab | Mod+1..8 / Mod+9 |
| workspace:next-tab / previous-tab | Ctrl+Tab / Ctrl+Shift+Tab |
| workspace:edit-file-title | F2 |

## E. Knowledge management

**Observed (`getLinkpathDest`)** link resolution:
1. Empty target → the source file itself.
2. Case-insensitive lookup by basename (`uniqueFileLookup`); `.md` appended when the target has no extension match.
3. Unique basename and no path → that file.
4. `./` and `../` targets resolve relative to the source folder.
5. Exact vault path match wins.
6. Otherwise files whose path ends with the target, those under the source note's folder first, each group sorted.

Tags: counted case-insensitively, displayed with the most frequent casing (`getTags`), nested tags roll up to parents. Metadata is parsed in a web worker and cached in IndexedDB keyed by file hash (`metadataCache`), which is rebuildable.

## F. Extensions

Core plugins toggled per vault (`core-plugins.json`); community plugins loaded from `<vault>/.obsidian/plugins/<id>/` (main.js + manifest.json) with full Node access (no sandbox). Synapse does not attempt plugin compatibility (see feature matrix).

## Design measurements (app.css)

Used as reference values only; Synapse's stylesheet is original.

| Token | Reference value |
|---|---|
| Header (tab bar) height | 40px |
| Ribbon width | 44px |
| Tab width / max | 200px / 320px |
| Readable line width | 700px |
| Text size | 16px |
| UI small / medium | 13px / 15px |
| Radius s / m | 4px / 8px |
| Spacing scale | 4 / 8 / 12px |
| H1 / H2 | 1.618em / 1.462em |
| Dark base colors | #1e1e1e, #262626, #363636, text #dadada / #b3b3b3 |
| Light base colors | #ffffff, #f6f6f6, #e0e0e0, text #222222 / #5c5c5c |
| Accent | hsl(258, 88%, 66%) |

## Not analyzed

Sync/Publish services, canvas, bases, PDF viewer internals, mobile UI, update mechanism, native addons (`btime`, `get-fonts`). No runtime (dynamic) experiments were run against Obsidian; all behavior above is static.
