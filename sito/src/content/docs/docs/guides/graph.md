---
title: Graph
description: The graph of notes and links, and its settings.
sidebar:
  order: 5
---

![Graph view of a vault with notes as nodes and links as edges](../../../../assets/screenshots/graph.png)


Press <kbd>⌘G</kbd> to open the graph: every note is a node and every link an edge. The active note is marked in the accent colour.

- Drag nodes, scroll to zoom, click a node to open its note.
- **Restart layout** recomputes the positions.
- Filter from the settings panel with the search syntax (`path:`, `tag:`, `file:` and plain words), show only unlinked notes, ⇧-click a node to highlight its connections (<kbd>Esc</kbd> clears), and use **Reset view**.

## Local graph (from 1.5.0)

![The local graph of Spaced repetition at depth 2, with the bar naming its centre note](../../../../assets/screenshots/local-graph.png)

The crosshair button (or **Graph view: Toggle local graph**) shows only one note and its neighbourhood. A bar at the top says which note that is:

- **Local graph of [note]**: the graph follows the note you open. Click the name to pick another note by searching for it, or to go back to following the open note.
- **1 / 2**: notes one link away, or also the notes linked to those.
- **×**: back to the whole vault.

Filters still apply, and the local graph only walks through notes the filters show, so every note drawn is connected to the centre.

## Colours (from 1.5.0)

**Colour by** in the settings panel colours notes by their top-level folder or by their first tag (`#learning/memory` counts as `#learning`). Every group gets a colour and the legend lists them all. Click a colour in the legend to change it; the small × next to a changed colour returns it to the automatic one. Chosen colours are saved with the vault.

## Saved views (from 1.5.0)

**Save view…** keeps the current setup under a name: global or local, centre note, depth, filter, unlinked-only, colours and the layout sliders. Click a view to bring it back; rename or delete it with the buttons next to it. Views are stored per vault and follow a renamed centre note.

## Graph settings

Graph settings are stored per vault, in `<vault>/.synapse/settings.json`:

| Setting | Effect |
|---|---|
| Global / Local graph | the whole vault, or one note's neighbourhood |
| Show orphans | include notes with no links |
| Show unresolved links | include links to notes that do not exist yet |
| Colour by | none, top-level folder or first tag |
| Link distance | preferred length of edges |
| Repel force | how strongly nodes push each other apart |

Vaults with more than 1,000 visible notes use a faster layout (Barnes–Hut), so the graph stays smooth with thousands of notes.

The graph can be turned off in [Core plugins](/docs/configuration/settings/#core-plugins).
