# UI testing and visual verification

## Automated

| Check | Result (2026-10-15) |
|---|---|
| `npm run typecheck` | pass |
| `npm test` (vitest) | 68/68 pass. New: the retired `showRibbon` layout key is dropped without losing other values. |
| `npm run test:e2e` (Playwright on Electron) | 10/10 pass on the dev build |
| Taste-Skill `lint.mjs src/renderer` | 0 FAIL, 0 WARN |

New E2E tests added for the redesign:

- Editing: undo (⌘Z) and redo (⌘⇧Z), status bar line and column, save state, file content on disk.
- An empty vault shows the empty state, and "Create first note" creates `Untitled.md`.
- Long file and folder names at 1400, 900 and 640px wide: no horizontal overflow; the editor keeps at least 360px (or half the window).
- Keyboard: ⌘N focuses the new note's title; ⌘T, ⌘W and ⌘⇧T change the tab count; docks toggle and are `inert` while closed.
- The existing tests still cover the 20-step settings scenario, restarts, rename with link rewriting, external conflicts, missing vaults, search/switcher/palette/graph, and security.

## Visual inspection performed

Screenshots were taken with Playwright from the real Electron renderer, using isolated test vaults and app data. I read each one and fixed what it showed:

| Viewed | Problems found → fixed |
|---|---|
| Starter (dark) | Vault list blended into the page → list column raised one tone; Locate/Remove buttons invisible on the raised tone → buttons take the page tone |
| Editor, reading, long title (dark) | None blocking. Long titles wrap, and long names truncate in the tree and backlinks. |
| Search | Search and Graph both looked selected → Graph now marks itself with a signal icon only |
| Graph | A 95-character label spanned half the canvas → labels truncated unless hovered |
| Quick switcher | Typing "ide" listed unrelated notes (scoring bug) → fixed; also removed the focus ring from the palette input |
| Settings (dark, light) | Native select arrows sat apart from the text → custom chevron that survives hover and focus |
| Light editor, vault menu | OK |
| 760×640 with both docks | Editor squeezed to about 200px → note context floats below 960px, navigator floats below 720px |
| Docks collapsed | OK. Tab rail leaves room for the traffic lights and toggles. |

Console during the screenshot run: no errors or warnings.

## Not verified

- Taste-Skill `inspect.mjs` was not run. It serves a static page in Chrome, and the renderer needs the Electron preload (`window.synapse`), so it would only measure an empty shell. I also did not run Taste's critique rubric, which is written for marketing pages. Its house rules were applied and linted instead.
- Native folder dialogs and drag and drop were not driven automatically.
- Display scaling other than the default and VoiceOver were not tested.
