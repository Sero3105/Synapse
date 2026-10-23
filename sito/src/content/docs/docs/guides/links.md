---
title: Links and backlinks
description: Wiki links, embeds, how links resolve, backlinks, unlinked mentions and renaming.
sidebar:
  order: 2
---

## Writing links

| Syntax | Meaning |
|---|---|
| `[[Note]]` | Link to a note |
| `[[Note#Heading]]` | Link to a heading in a note |
| `[[Note\|shown text]]` | Link with different text |
| `![[image.png]]` | Embed an image |
| `![[Note]]` | Embed another note (one level deep) |
| `[text](Folder/Note.md)` | Standard Markdown link to a vault file |

Links resolve case-insensitively. When two notes share a name, the shortest path wins, and a note in the same folder as the linking note is preferred.

## Following links

- <kbd>⌘-click</kbd> a link in the editor to open it. Add <kbd>⌥</kbd> to open it in a new tab.
- From version 1.3.0, a plain click on a link rendered by Live Preview opens it too.
- In the reading view, click any link.

Following a link to a note that does not exist creates it.

## Backlinks and the note context

The dock on the right shows the open note's details and three panels:

- **Backlinks**: every note that links here, with the line around the link. **Unlinked mentions** lists notes that use the title as plain text without linking it.
- **Outgoing**: links leaving this note, including **unresolved links**. Click an unresolved one to create the note.
- **Outline**: the note's headings.

## Renaming

Rename a note from its title, with **F2**, or from the file tree's context menu. With **Automatically update internal links** on (Settings → Files and links, on by default), every link pointing to the old name or location is rewritten across the vault.

## Tags

Write tags inline as `#tag` or `#tag/nested`, or in front matter under `tags:`. Tags inside code are ignored. The **Tags** view in the left dock lists every tag with its count.
