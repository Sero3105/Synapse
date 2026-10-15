# Feature specification

Scope is derived from `obsidian-analysis.md`. Status per feature is in `feature-matrix.md`.

## Shell
- The window uses a hidden title bar with traffic lights. Ribbon is 44px; header rows are 40px.
- Layout: left sidebar (Files, Search, Tags), workspace with tabbed panes, right sidebar (Backlinks, Outgoing links, Outline). The status bar sits bottom-right.
- Both sidebars can be toggled and resized (160–800px). Layout is stored globally.
- Starter screen when no vault is open: recent vaults (unavailable ones flagged, with Locate… and Remove), Create new vault, Open folder as vault.

## Vaults
- A vault is any folder. Synapse writes only `<vault>/.synapse/` and never touches `.obsidian/`.
- Opening a missing path is an error. Folders are created only by "Create new vault", which refuses an existing folder.
- Switching vaults first flushes unsaved notes and the workspace.

## Notes
- New note: `Untitled.md`, `Untitled 1.md`, … in the vault root or the current folder (setting). The inline title is focused for naming.
- Autosave 800 ms after typing, plus on tab close, vault switch and quit. Writes are atomic and check mtime; a conflicting external change produces a banner instead of an overwrite.
- Delete moves to the system Trash, with confirmation (setting).
- Rename via inline title, F2, or context menu. Links in other notes are rewritten (setting).
- Attachments: paste or drop into the editor. The file is saved to the attachment folder (vault setting: root, a folder, or `./` = beside the note) and `![[name]]` is inserted.

## Links, tags, search
- Wikilinks `[[target#heading|alias]]`, embeds `![[img.png]]` and `![[Note]]` (one level), and Markdown links to vault files.
- Resolution follows the reference algorithm (case-insensitive, shortest path, prefers the source folder).
- Tags `#tag/nested` inline and `tags:` in frontmatter. Code blocks are ignored.
- Search syntax: words (AND), `"phrase"`, `-exclude`, `tag:#x`, `path:dir`, `file:name`. Results show highlighted line context; clicking jumps to the line.

## Settings
Layering, scopes and storage are in `settings-architecture.md`. Sections: General, Editor, Files and links, Appearance, Hotkeys, Core plugins, This vault.
