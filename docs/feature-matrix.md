# Feature matrix

Last verified against the code: 2026-10-28 (HEAD `057b085` plus the uncommitted work of the same day: in-app updater, heading links, nested tags, pinned tabs, local graph and saved views, graph colours, vault export, merge e2e, folding, multiple windows, nested splits, PDF tab). Re-check this file whenever a feature lands; a stale row here costs more than a missing one.

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
| Switch vault, several vaults in separate windows | One window per vault | A | ✅ in place, or in a new window (File → New Window, "Open in new window") | E | A vault opens in one window at a time; at launch only the last vault reopens |
| Window size/position restore | Per vault in reference | A (disk) | ✅ per vault | U, E | A new window never covers another exactly; positions on a disconnected display are not reused |
| Markdown editing (CM6) with Live Preview | CodeMirror, live preview | C | ✅ | U, E | Markup hidden except on the cursor's lines; tables edited as grids (add/remove rows and columns); KaTeX math; folding of headings, lists and code blocks; no vim |
| Reading view | `markdown:toggle-preview` | C | ✅ | E | Raw HTML not rendered; math, Mermaid and code highlighting supported |
| Autosave + external change detection | — | Hypothesis | ✅ | U, E | — |
| Conflict handling | — | — | ✅ banner: keep mine / load disk / 3-way merge | U, E | Merge unites disjoint edits on its own; regions changed on both sides need one choice each in a dialog. Deleted-on-disk conflicts still ask keep/discard. The merge is refused if the note or the file changes while the dialog is open |
| Find in note / replace | `editor:open-search` Mod+F | C | ✅ (CM search panel) | M | — |
| Formatting commands | Mod+B/I/K/L/D, headings | D table | ✅ | M | — |
| Wikilink autocomplete `[[` | — | Public | ✅ incl. headings (`[[Note#`, `[[#`) and block ids (`[[Note^`, `[[Note#^`, `[[^`) | U, E | — |
| Block links `[[Note^id]]` | block reference (`^id` at the end of a block) | Public | ✅ | U | `[[Note^id]]` and `[[Note#^id]]` are the same link; the `^id` stays visible in the file (Obsidian convention) and is hidden in the reading view; following a block link opens the note at that block |
| Cmd+click follow link, unresolved → create | — | Public | ✅ | E | — |
| Paste/drop attachments | `attachmentFolderPath` | B | ✅ | M | Image/file embed only |
| File explorer tree, filter, context menu | — | Public | ✅ | U, E | Sort by name / recently modified / recently created (menu in the panel, saved globally); folders always first |
| Create / rename / delete notes and folders | `promptDelete`, `trashOption: system` | B | ✅ (system trash) | U, E | Rename via dialog or inline title |
| Drag & drop move | — | Public | ✅ files→folders, tabs between panes | M | — |
| Update links on rename | `alwaysUpdateLinks` (default false, asks) | B | ✅ (setting, default on) | U, E | No per-rename prompt |
| Link resolution | `getLinkpathDest` algorithm | E (code) | ✅ same rules | U | — |
| Backlinks + context | backlink core plugin | E | ✅ | U, E | — |
| Unlinked mentions | backlink plugin | Public | ✅ | U | "Link" button wraps the mention in `[[…]]` in the source note (alias keeps the text as written) |
| Outgoing links (resolved / unresolved) | outgoing-links plugin | D | ✅ | M | — |
| Tags pane | `getTags` case-insensitive counts | E (code) | ✅ incl. frontmatter tags, nested tags as a tree | U, E | Expanded/collapsed state is not kept |
| Outline | outline plugin | Public | ✅ | M | — |
| Graph view | graph plugin, settings in plugin data | D, E | ✅ canvas force layout | U, E, M | Filter by search query (words, `tag:`, `path:`, `file:`), unlinked-only and show-orphans/unresolved toggles; local graph around the open note (depth 1–2, or pinned to a note); saved views per vault; node colours by top-level folder or first tag, every group coloured, each colour changeable from the legend (saved per vault); a bar on the local graph names its note and picks another; layout is exact O(n²) up to 1000 visible nodes, Barnes–Hut above |
| Search (AND, phrase, -, tag:, path:, file:) | global-search | D | ✅ | U, E | No regex or block/line operators |
| Quick switcher (+ create) | `switcher:open` | D | ✅ | E | — |
| Command palette | `command-palette:open` | D | ✅ 67 commands | E | — |
| Hotkeys (reference defaults, rebindable) | hotkeys.json per vault | B, D | ✅ global | U | — |
| Tabs, new/close/undo close, goto N, cycle, pin | workspace commands | D | ✅ | E | No stacked tabs; a link clicked in a pinned tab opens in that tab |
| Split panes + resize | split-vertical/horizontal | D | ✅ nested splits (any mix of rows and columns) | U, E | Max 8 panes; split by command or tab menu, not by dragging a tab onto a pane edge |
| Navigation history per tab | go-back/forward | D | ✅ | M | — |
| Workspace restore | workspace.json | D | ✅ | E | — |
| Resizable / toggle docks (animated, keyboard-resizable, float when narrow) | — | Design | ✅ | E | No ribbon (removed in the redesign) |
| Status bar (mode, line/column, words, chars, save state) and note info panel | — | Public | ✅ | E | — |
| Light/dark/system themes, accent, fonts | appearance.json | B | ✅ | E | No CSS themes or snippets |
| Core plugin toggles (global or per vault) | core-plugins.json | F | ✅ | M | — |
| Community plugins | `.obsidian/plugins` with Node access | F | ✗ | — | Not supported, by design (security) |
| Daily notes (open today, previous/next day) | daily-notes plugin | Public | ✅ | U, E | Date-named note (`YYYY-MM-DD.md`) anywhere in the vault; new ones are created next to the most recent daily note, from `Templates/Daily note.md` when present |
| Templates (insert in note, or create note from template) | templates plugin | Public | ✅ | U, E | Built-in templates plus notes in the vault's `Templates/` folder; only `{{title}}`, `{{date}}` and `{{time}}` are filled |
| Tasks pane (every `- [ ]` item in the vault, grouped by note) | tasks plugin | Public | ✅ | U, E | Tick in the pane or jump to the line; open / done / all filter |
| Start page (today's note, pinned, recently opened/modified) | — (Synapse design) | — | ✅ | U, E | Shown in a new/empty tab |
| Related notes (with the reason for each suggestion) | — (Synapse design) | — | ✅ | U, E | Shared tags, common links, shared title/distinctive words; direct links excluded |
| Export note to HTML / PDF, whole vault to linked HTML pages | file export | Public | ✅ | U, E | Images, code highlighting, math and Mermaid included; vault export keeps the folders, links between pages (also to headings) and an index; links to missing notes or non-image attachments stay text |
| Note version history (restore) | — (Synapse design) | — | ✅ | U, E | Snapshots kept in app data, outside the vault; restore asks first |
| Vault import preview (read-only summary before opening a new folder) | — (Synapse design) | — | ✅ | U, E | Links, attachments, duplicate names and unsupported syntax; cancelling changes nothing |
| Attachments report (missing / possibly unused) | — (Synapse design) | — | ✅ | U, E | Report only, nothing is deleted |
| PDF viewer | in-app PDF view | Public | ✅ read-only tab with Chromium's viewer (pages, zoom, search, print) | E | No annotations saved into the vault; "Open in default app" for anything else |
| Canvas, Bases, Sync, Publish | various | — | ✗ | — | Not supported |
| macOS app bundle + install, in-app update | — | — | ✅ /Applications/Synapse.app; updates download, verify (own ed25519 key) and replace the app | U, E | Ad-hoc signed, not notarized; the first version with the updater is installed by hand |
| Interface language (English, Italian; follows macOS by default) | — | — | ✅ global setting, native menu included | U, E | Two languages; note content is never translated |
