# UI implementation notes

The redesign kept the architecture: same model, IPC, settings service and editor. These are the changes per file.

| File | Change |
|---|---|
| `src/renderer/styles.css` | Rewritten around the token set in `design-system.md`. Every colour is a role token; dark and light are role remaps. |
| `src/renderer/App.tsx` | Ribbon removed. Docks stay mounted with `inert` when closed, so they animate open and closed. Keyboard-resizable dock separators (←/→). New status bar. Serif text font by default. |
| `src/renderer/components/Sidebars.tsx` | `Navigator` (vault switcher, jump field, view rows, panel, footer) and `ContextPanel` (`NoteInfo` + segmented tabs) replace the icon-tab sidebars. Folder and file icons in the tree. Empty-vault state with a "Create first note" action. |
| `src/renderer/components/Workspace.tsx` | Inline title is an auto-growing `textarea`: long titles wrap, Enter still commits the rename. Empty tab lists actions and recent notes. |
| `src/renderer/components/Modals.tsx` | Vault manager redesigned, with name validation while typing. Missing-vault rows are groups rather than buttons, so they don't nest buttons. Quick switcher scoring fixed: a failed title match no longer passes as a match. |
| `src/renderer/components/Graph.tsx` | Labels truncated to 32 characters unless focused. Colours come from tokens. |
| `src/renderer/model.ts` | New state: `cursor` (status bar) and `recent` (per-vault recent files, saved in `.synapse/workspace.json`, validated against existing files on load). |
| `src/shared/settings.ts` | `layout.showRibbon` removed. Old files keep loading, because unknown layout keys are dropped by validation (tested). Default accent is now `#4cc9b0`. |
| `src/main/main.ts` | Window background matches the new sunk ground, so there is no flash on launch. |
| `scripts/make-icon.mjs` | Flat graphite icon with one signal node. |

## Decisions

- **No custom window chrome beyond the hidden title bar.** Traffic lights stay native. The 44px title zone is a drag region, and the dock and tab rail share it.
- **The ribbon is gone.** Its commands are in the navigator, the palette and the menu bar. One fewer column makes the layout less like Obsidian and gives the page more room.
- **Search stays a navigator view**, not a modal. Results need to stay visible while notes are opened from them.
- **Note info shows only real metadata** from the buffer and index: folder, mtime, word count, tags. Nothing is invented.
- **No Live Preview was added.** The editor stays source-mode Markdown with typographic styling, and the reading view is separate. The status bar says which mode is active.

## Not changed

Settings precedence and storage, vault opening and moved-vault detection, the filesystem boundary, IPC and the preload allowlist, link resolution, search, and saving with conflict detection.
