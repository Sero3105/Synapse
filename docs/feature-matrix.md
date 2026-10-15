# Feature matrix

Legend:

- **Impl**: ✅ implemented end to end, ◐ partial, ✗ not implemented.
- **Test**: U = unit/integration (vitest), E = E2E against the packaged and installed app (Playwright), M = checked from screenshots only.
- **Evidence**: refers to sections of `obsidian-analysis.md`. "Public" means general public knowledge of the product, not REA output.

| Feature | Reference behavior | Evidence | Impl | Test | Known limitations |
|---|---|---|---|---|---|
| Global settings across vaults | Reference stores them per vault | B (code) | ✅ | U, E | — |
| Per-vault overrides | — (Synapse design) | — | ✅ | U, E | Layout and hotkeys are global only |
| Settings migration / corruption recovery | — | — | ✅ | U | — |
| Recent vaults, reopen last | Registry `{id:{path,ts}}` | A (code) | ✅ | U, E | — |
| Open folder as vault / create vault | Missing → error; create refuses existing | A (code) | ✅ | U | Native folder dialog not automated in E2E |
| Missing vault handling | "folder not found" | A (code) | ✅ | U, E | — |
| Moved/renamed vault | `vault-move` renames while closed | A (code) | ✅ (id stamp + Locate…) | U | — |
| Switch vault | One window per vault | A | ✅ (in place) | E | No simultaneous vault windows |
| Window size/position restore | Per vault in reference | A (disk) | ✅ (global) | U | — |
| Markdown editing (CM6) | CodeMirror, live preview | C | ◐ | E | Source mode with styling; no Live Preview hiding markup; no folding or vim |
| Reading view | `markdown:toggle-preview` | C | ✅ | E | Raw HTML not rendered; no math, mermaid or code highlighting |
| Autosave + external change detection | — | Hypothesis | ✅ | U, E | — |
| Conflict handling | — | — | ✅ banner, keep/load | E | No 3-way merge |
| Find in note / replace | `editor:open-search` Mod+F | C | ✅ (CM search panel) | M | — |
| Formatting commands | Mod+B/I/K/L/D, headings | D table | ✅ | M | — |
| Wikilink autocomplete `[[` | — | Public | ✅ | E | No heading/block completion |
| Cmd+click follow link, unresolved → create | — | Public | ✅ | E | — |
| Paste/drop attachments | `attachmentFolderPath` | B | ✅ | M | Image/file embed only |
| File explorer tree, filter, context menu | — | Public | ✅ | E | No custom sort orders |
| Create / rename / delete notes and folders | `promptDelete`, `trashOption: system` | B | ✅ (system trash) | U, E | Rename via dialog or inline title |
| Drag & drop move | — | Public | ✅ files→folders, tabs between panes | M | — |
| Update links on rename | `alwaysUpdateLinks` (default false, asks) | B | ✅ (setting, default on) | U, E | No per-rename prompt |
| Link resolution | `getLinkpathDest` algorithm | E (code) | ✅ same rules | U | — |
| Backlinks + context | backlink core plugin | E | ✅ | U, E | — |
| Unlinked mentions | backlink plugin | Public | ✅ | U | No "link" button |
| Outgoing links (resolved / unresolved) | outgoing-links plugin | D | ✅ | M | — |
| Tags pane | `getTags` case-insensitive counts | E (code) | ✅ incl. frontmatter tags | U | Flat list, no nested tree |
| Outline | outline plugin | Public | ✅ | M | — |
| Graph view | graph plugin, settings in plugin data | D, E | ✅ canvas force layout | E, M | No local graph, groups or filters by query; O(n²) layout |
| Search (AND, phrase, -, tag:, path:, file:) | global-search | D | ✅ | U, E | No regex or block/line operators |
| Quick switcher (+ create) | `switcher:open` | D | ✅ | E | — |
| Command palette | `command-palette:open` | D | ✅ ~70 commands | E | — |
| Hotkeys (reference defaults, rebindable) | hotkeys.json per vault | B, D | ✅ global | U | — |
| Tabs, new/close/undo close, goto N, cycle | workspace commands | D | ✅ | E | No pinning or stacked tabs |
| Split panes + resize | split-vertical/horizontal | D | ◐ | M | Flat, max 4, one direction |
| Navigation history per tab | go-back/forward | D | ✅ | M | — |
| Workspace restore | workspace.json | D | ✅ | E | — |
| Resizable / toggle docks (animated, keyboard-resizable, float when narrow) | — | Design | ✅ | E | No ribbon (removed in the redesign) |
| Status bar (mode, line/column, words, chars, save state) and note info panel | — | Public | ✅ | E | — |
| Light/dark/system themes, accent, fonts | appearance.json | B | ✅ | E | No CSS themes or snippets |
| Core plugin toggles (global or per vault) | core-plugins.json | F | ✅ | M | — |
| Community plugins | `.obsidian/plugins` with Node access | F | ✗ | — | Not supported, by design (security) |
| Canvas, Bases, Sync, Publish, PDF viewer, daily notes, templates | various | — | ✗ | — | Future work |
| macOS app bundle + install | — | — | ✅ /Applications/Synapse.app | E | Ad-hoc signed, not notarized |
| Interface language (English, Italian; follows macOS by default) | — | — | ✅ global setting, native menu included | U, E | Two languages; note content is never translated |
