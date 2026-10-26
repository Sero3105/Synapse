---
title: Files and vaults
description: The file tree, moving and deleting files, switching vaults, and what Synapse writes to disk.
sidebar:
  order: 6
---

## File tree

The **Files** view in the left dock shows the vault's folders and files. You can filter it, collapse all folders, drag files and folders to move them, and use the context menu to rename, delete, open in a new tab, open to the right or reveal in Finder.

New notes are created in the vault folder or in the current note's folder, depending on **Default location for new notes** (Settings → Files and links).

## Attachments (from 1.4.0)

**Attachments: Show missing and unused attachments** builds a report: attachments notes point to that are missing, and files that look unused. A file counts as possibly unused only when no note links to or embeds it and its name appears in no note at all. References from other apps, CSS or scripts are not detected. The report deletes nothing.

PDFs open in your default app.

## Opening a folder that is not a vault yet (from 1.4.0)

Synapse opens any Markdown folder in place and never converts it. When the folder is not a Synapse vault yet, a read-only summary appears first — notes, links, attachments and syntax Synapse does not use — reading every note once. **Cancel** leaves the folder untouched; **Open vault** only adds the `.synapse/` folder.

## Deleting

Delete moves the file to the macOS Trash, so it can be restored from there. By default Synapse asks first; turn off **Confirm file deletion** to skip the question.

## Switching vaults

Use **Switch vault** at the top of the left dock, or **Manage vaults…** to open the starter screen. To leave the vault and go back to the starter screen, where you can create or open another one, choose **Close vault** in the same menu, in **File → Close Vault**, on an empty tab, or press <kbd>⇧⌘W</kbd> (from version 1.4.0). Unsaved notes and the workspace are saved before switching. Your global preferences stay the same in every vault.

## What Synapse writes

| Location | Contents |
|---|---|
| Your notes | only the notes and attachments you create or edit |
| `<vault>/.synapse/settings.json` | this vault's overrides, graph settings, attachment folder |
| `<vault>/.synapse/workspace.json` | open tabs, panes and recent notes |
| `~/Library/Application Support/Synapse/` | global preferences, recent vaults, window size |

Every file operation is confined to the open vault. Synapse never modifies `.obsidian/`.
