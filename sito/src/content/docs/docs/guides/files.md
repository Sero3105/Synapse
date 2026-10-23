---
title: Files and vaults
description: The file tree, moving and deleting files, switching vaults, and what Synapse writes to disk.
sidebar:
  order: 6
---

## File tree

The **Files** view in the left dock shows the vault's folders and files. You can filter it, collapse all folders, drag files and folders to move them, and use the context menu to rename, delete, open in a new tab, open to the right or reveal in Finder.

New notes are created in the vault folder or in the current note's folder, depending on **Default location for new notes** (Settings → Files and links).

## Deleting

Delete moves the file to the macOS Trash, so it can be restored from there. By default Synapse asks first; turn off **Confirm file deletion** to skip the question.

## Switching vaults

Use **Switch vault** at the top of the left dock, or **Manage vaults…** to open the starter screen. To leave the vault and go back to the starter screen, where you can create or open another one, choose **Close vault** in the same menu, in **File → Close Vault**, on an empty tab, or press <kbd>⇧⌘W</kbd> (from version 1.3.1). Unsaved notes and the workspace are saved before switching. Your global preferences stay the same in every vault.

## What Synapse writes

| Location | Contents |
|---|---|
| Your notes | only the notes and attachments you create or edit |
| `<vault>/.synapse/settings.json` | this vault's overrides, graph settings, attachment folder |
| `<vault>/.synapse/workspace.json` | open tabs, panes and recent notes |
| `~/Library/Application Support/Synapse/` | global preferences, recent vaults, window size |

Every file operation is confined to the open vault. Synapse never modifies `.obsidian/`.
