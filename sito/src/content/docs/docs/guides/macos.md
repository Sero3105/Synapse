---
title: macOS integration
description: Open notes from Finder, synapse:// links, quick capture from any app and the menu bar icon.
sidebar:
  order: 7
---

From version 1.5.6.

## Finder

- **Double-click a `.md` file**, use **Open With → Synapse**, or drop it on Synapse in the Dock: the note opens in the window of its vault. A note that is in none of your vaults asks first, then opens its folder as a new vault.
- **Windows come back:** every vault that had a window when you quit Synapse opens again at the next launch, each in its own window, where it was.
- **Finder tags and comments** stay on a note when Synapse saves it.

## `synapse://` links

Put these links anywhere a link works: Mail, Calendar, Reminders, Shortcuts, Raycast, Alfred or a web page.

| Link | What it does |
|---|---|
| `synapse://open?vault=Notes&file=Projects/Plan` | Opens `Projects/Plan.md` in the vault named Notes |
| `synapse://new?vault=Notes&name=Idea&text=Call%20Anna` | Creates `Idea.md` with that text and opens it; if the name is taken, it becomes `Idea 1.md` |
| `synapse://capture` | Opens the quick capture window |

`vault` is the name of the vault's folder. Without it, Synapse uses the vault you used last. `.md` is optional in `file`. Text in a link must be URL-encoded (a space is `%20`, a new line `%0A`). A link never overwrites a note and cannot write outside the vault.

## Quick capture

Press <kbd>⌘⇧Space</kbd> in any app: a small window opens over it. Type, then press <kbd>↩</kbd> to add the text to the vault you used last; <kbd>⇧↩</kbd> starts a new line and <kbd>esc</kbd> closes the window.

The text is added at the end of **today's daily note** (created from `Templates/Daily note.md` if it does not exist yet) or of **`Inbox.md`**, as set in **Settings → General → macOS**. There you can also record another shortcut or turn it off. If another app already uses the shortcut, choose a different one.

## Menu bar icon

The Synapse icon in the menu bar lists the recent notes of each open vault, plus **New Note** and **Quick Capture**. Turn it off in **Settings → General → Menu bar icon**.
