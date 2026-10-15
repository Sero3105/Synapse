# Synapse

A local-first Markdown knowledge base for macOS. Its interface and behavior follow Obsidian (as observed in `docs/obsidian-analysis.md`). The main difference: **preferences are global and survive vault switches**, and each vault can still override them individually.

Notes stay plain `.md` files in folders you choose. Synapse adds only a small `.synapse/` folder to each vault and never touches `.obsidian/`.

## Features

- Vaults: open any folder, create new vaults, recent list, reopen the last vault, unavailable vaults flagged with *Locate…* / *Remove*, moved vaults recognized automatically.
- Editor: CodeMirror 6 with styled Markdown, `[[` link autocomplete, Cmd+click to follow, find/replace (⌘F), formatting hotkeys, image paste/drop, autosave, conflict detection for external edits.
- Reading view (⌘E) with clickable links, tags and task checkboxes. Inline editable title.
- File explorer with filter, context menus, drag-and-drop moves, rename with automatic link updates, delete to Trash.
- Backlinks (with unlinked mentions), outgoing links, outline, tags, full-text search with operators, graph view.
- Tabs, split panes, per-tab back/forward history, workspace restore, quick switcher (⌘O), command palette (⌘P), rebindable hotkeys.
- Original "Signal on graphite" design (docs/design-system.md): serif writing surface, quiet graphite chrome, one accent reserved for connections. Light, dark and system themes, configurable accent, fonts and sizes. Core plugins can be toggled globally or per vault.

See `docs/feature-matrix.md` for exact status and limitations.

## Requirements

macOS on Apple Silicon (arm64), Node 22+ and npm for building.

## Develop

```sh
npm install
npm run dev          # Vite + Electron with hot reload
npm run typecheck
npm test             # unit/integration (vitest)
npm run test:e2e     # builds, then Playwright E2E on Electron
```

## Build, package, install

```sh
npm run package      # build + electron-builder -> release/mac-arm64/Synapse.app
npm run install:app  # copies it to /Applications/Synapse.app
```

`install:app` refuses to replace anything at `/Applications/Synapse.app` that is not a Synapse build (`com.synapse.notes`) and refuses while Synapse is running. It copies to a staging path and then swaps, and verifies the code signature. The build is ad-hoc signed, not notarized. Because it is built locally, Gatekeeper does not quarantine it.

**Update**: pull the new source, run `npm run package && npm run install:app`. Settings and vaults are not part of the bundle and are untouched.

**Uninstall**: quit Synapse, then delete `/Applications/Synapse.app`. Optionally delete `~/Library/Application Support/Synapse` to drop preferences. Your notes are never inside either location; each vault's `.synapse/` folder can be deleted safely.

## Where settings live

| What | Where |
|---|---|
| Global preferences, layout, hotkeys | `~/Library/Application Support/Synapse/settings.json` |
| Vault list, last vault | `~/Library/Application Support/Synapse/vaults.json` |
| Window bounds | `~/Library/Application Support/Synapse/window.json` |
| Per-vault overrides, graph settings, attachment folder | `<vault>/.synapse/settings.json` |
| Open tabs and panes per vault | `<vault>/.synapse/workspace.json` |

In Settings, each preference row has a scope menu: **All vaults** (default) or **This vault only**. Precedence is defaults ← global ← vault override. Details: `docs/settings-architecture.md`.

## Known limitations

- No Live Preview: Markdown syntax stays visible in the editor; the reading view renders it.
- Raw HTML in notes is not rendered (security). No math, Mermaid or code highlighting in reading view.
- Splits are flat (up to 4 panes in one direction). No pinned or stacked tabs.
- Obsidian community plugins are not supported. Core plugins can only be toggled.
- No local graph or graph filters. Graph layout is O(n²) (fine to roughly 2k notes).
- All note text is held in memory for search and links.
- Arm64 only, ad-hoc signed, no auto-update.

## Docs

`docs/project-audit.md` · `docs/ui-redesign-audit.md` · `docs/design-system.md` · `docs/ui-implementation.md` · `docs/ui-testing.md` · `docs/obsidian-analysis.md` · `docs/feature-specification.md` · `docs/feature-matrix.md` · `docs/architecture.md` · `docs/settings-architecture.md` · `docs/implementation-plan.md` · `docs/testing.md`
