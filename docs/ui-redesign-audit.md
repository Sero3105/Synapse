# UI redesign audit (2026-10-15)

## Architecture (unchanged by the redesign)

- Electron 44 main process (`src/main`): window, IPC, vault filesystem, settings persistence.
- Sandboxed renderer (`src/renderer`): React 19 + CodeMirror 6 + markdown-it, bundled by Vite.
- No router. Views are derived from state in `model.ts`:
  - no vault → starter screen;
  - otherwise the shell: sidebars, panes, and tabs of kind `note` / `file` / `graph` / `empty`, plus modals.
- Notes are read and written only through `window.synapse.invoke` (`fs:*`). Autosave is debounced, with an mtime conflict check.
- Settings: global `settings.json` in app data plus per-vault `.synapse/settings.json` overrides, resolved in `shared/settings.ts`.
- Styling: one global `styles.css` with CSS custom properties; components use class names only.

## Existing interface: problems

| Problem | Where |
|---|---|
| Visually a close copy of Obsidian: same ribbon, same grey palette, same tab shapes, same violet accent | whole shell |
| Violet accent with a gradient app icon and gradient vault logo. Taste-Skill lists violet/indigo and gradients as the most common generated-UI tells. | tokens, `build/icon.png`, starter |
| 1px hairlines separate every region (ribbon, sidebars, tab bar, panes, status bar, settings rows) | `styles.css` |
| One sans face for both the interface and long-form text; no editorial character for writing | editor, reading view |
| Shadows on resting elements (status bar box, tabs) | `styles.css` |
| Ribbon duplicates commands already in the palette and menus; it adds chrome without adding hierarchy | `App.tsx` |
| Sidebars appear and disappear instantly (unmounted), with no transition | `App.tsx` |
| Status bar shows counts only: no cursor position, no mode | `StatusBar` |
| Note has no metadata line (folder, modified time, length) | `NoteBody` |
| Inline title is a single-line `<input>`, so long titles scroll sideways | `InlineTitle` |
| Empty tab offers commands but not the user's recent notes | `EmptyTab` |
| Empty vault has a one-line message, no action | `FileExplorer` |
| Starter screen is a generic two-card dialog | `VaultManager` |

## Direction

**Signal on graphite.** A cool graphite workspace, quiet and editorial. A single phosphor-mint accent is reserved for *connections*: links, the caret, focus, the active note in the graph, live link counts. The accent means "this connects", which is the product's name and purpose, and appears nowhere else.

- Surfaces are separated by tone steps, not lines. Floating layers (menus, dialogs, palette) are the only elements with shadows.
- Two faces only: the system sans (SF Pro) for the interface, the system serif (New York) for notes. Monospace appears in code only.
- The left column becomes a navigator: vault identity, a jump field, views, and the file tree. The ribbon is removed.
- The right column becomes note context: info (real metadata), backlinks, outgoing links, outline.
- Sidebars animate open and closed. All motion respects reduced-motion settings.
