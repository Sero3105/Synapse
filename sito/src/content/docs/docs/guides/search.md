---
title: Search and navigation
description: Search syntax, the quick switcher, the command palette, tabs and split panes.
sidebar:
  order: 4
---

![Search results with matching lines highlighted](../../../../assets/screenshots/search.png)


## Search

Open **Search** in the left dock or press <kbd>⇧⌘F</kbd>. Results show the matching lines with the match highlighted; click one to jump to that line.

| Query | Finds |
|---|---|
| `spaced review` | notes with both words |
| `"spaced repetition"` | the exact phrase |
| `memory -sleep` | notes with *memory* and without *sleep* |
| `tag:#learning` | notes with that tag |
| `path:Projects` | notes inside a folder |
| `file:outline` | notes whose file name matches |

## Tasks and the start page (1.3.1, not released yet)

The **Tasks** view in the left dock lists every `- [ ]` checklist item in the vault — open, done or all — grouped by note. Ticking a task changes only that line; if the note changed since the list was built, nothing is written and Synapse tells you. Click a task to jump to its line.

A new tab is a start page: today's daily note, pinned notes (file context menu → **Pin to start page**), recently opened and recently modified notes.

Daily notes and templates have their own commands: **Daily notes: Open today's note** (also **File → Open Today's Note**), **Open previous/next daily note**, **Templates: Insert template** and **Templates: Create new note from template**. Built-in templates cover general, study, meeting and project notes; your own live in the vault folder `Templates/`, and `Templates/Daily note.md` is used for new daily notes when present. Placeholders: `{{title}}`, `{{date}}` (YYYY-MM-DD) and `{{time}}` (HH:mm).

## Quick switcher and command palette

- <kbd>⌘O</kbd> jumps to any note by name, with fuzzy matching.
- <kbd>⌘P</kbd> opens the command palette: every action, with its shortcut.

## Tabs and panes

- <kbd>⌘T</kbd> opens a tab, <kbd>⌘W</kbd> closes it, <kbd>⇧⌘T</kbd> reopens the last closed one.
- <kbd>⌃⇥</kbd> and <kbd>⌃⇧⇥</kbd> move between tabs; <kbd>⌥⌘←</kbd> and <kbd>⌥⌘→</kbd> go back and forward in a tab's history.
- **Split right** or **Split down** from a tab's menu, or **Open to the right** from the file tree. Panes run in one direction, up to four.

Open tabs, panes and recent notes are remembered per vault.
