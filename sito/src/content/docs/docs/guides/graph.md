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

## Graph settings

Graph settings are stored per vault:

| Setting | Effect |
|---|---|
| Show orphans | include notes with no links |
| Show unresolved links | include links to notes that do not exist yet |
| Link distance | preferred length of edges |
| Repel force | how strongly nodes push each other apart |

The graph can be turned off in [Core plugins](/docs/configuration/settings/#core-plugins).
