# Implementation plan and status

| Phase | Items | Status |
|---|---|---|
| A. Foundation | Electron shell, theme system, global settings service, vault selection, recent vaults, fs access, Markdown editing | Done |
| B. Knowledge | File explorer, folders, internal links, backlinks, search, navigation, tags, graph | Done |
| C. Workspace | Tabs, splits, resizable sidebars, command palette, hotkeys, workspace restore, context menus | Done (flat splits) |
| D. Advanced | Attachments, link rewriting on rename, unlinked mentions, core-plugin toggles | Done. Graph filters and local graph not done. |
| E. Reliability | Atomic writes, conflicts, migrations, corruption recovery, a11y roles and focus, tests, packaging, install | Done |

## Next candidates (not implemented)
1. Folding, code highlighting in reading view, adding and removing table columns.
2. Arbitrary split tree, pinned and stacked tabs.
3. Local graph, graph filters and groups; Barnes-Hut layout for large vaults.
4. Daily notes and templates.
5. Developer ID signing and notarization (the DMG exists, but is ad-hoc signed); automatic install of updates (the app already announces new releases).
6. On-disk index for very large vaults (currently all note text is kept in memory).
