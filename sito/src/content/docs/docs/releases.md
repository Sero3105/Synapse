---
title: Releases
description: Published versions of Synapse and what changed.
---

Downloads for every version are on [GitHub Releases](https://github.com/Sero3105/Synapse/releases).

## 1.3.1 — not released yet

Finished in the app code and covered by its tests; the published download is still 1.3.0, so 1.3.0 does not have these yet:

- **Related notes:** suggestions for notes you have not linked yet, each with the reason (shared tags, shared links, shared words). Insert the link only if you agree, or dismiss the suggestion.
- **Graph filters:** filter with `path:`, `tag:`, `file:` and plain words, show only unlinked notes, ⇧-click a note to highlight its connections, and **Reset view**.
- **Tasks:** every checklist item in the vault in one list, grouped by note. Tick it there or jump to its line.
- **Start page:** a new tab shows today's note, pinned notes, recently opened and recently modified notes.
- **Daily notes and templates:** open today's note, step to the previous or next day, and create or fill notes from built-in or your own templates (`{{title}}`, `{{date}}`, `{{time}}`).
- **Export:** a note to standalone HTML or PDF, with images, highlighted code and diagrams included. Internal links become plain text.
- **Version history:** earlier copies of a note, kept before Synapse overwrites it. Read a version and restore it after a confirmation; the text you replace becomes a version too.
- **Attachments report:** missing attachments, and files no note links to or mentions. A report only: nothing is deleted.
- **Opening a new folder:** a read-only summary (links, attachments, unsupported syntax) appears first. Cancel leaves the folder untouched.
- **Fonts:** pick from installed font families with live previews, or add your own font files in Settings → Appearance.
- **Not included:** saved graph views, task due dates and semantic (meaning-based) search are not available.

## 1.3.0 — 23 October 2026

- **Update notice:** at launch Synapse asks GitHub Releases for the latest version and shows a notice with a Download button when a newer one is out. Turn it off in Settings → General → Check for updates.
- **Links:** a plain click on a link rendered by Live Preview opens it.
- **Reading view:** syntax-highlighted code and Mermaid diagrams.
- **Intel build:** `Synapse-1.3.0-x64.dmg`, not yet tested on Intel hardware.
- Downloads: `Synapse-1.3.0-arm64.dmg` (Apple silicon), `Synapse-1.3.0-x64.dmg` (Intel). 1.2.0 was tagged but never published; its changes are part of 1.3.0.

## 1.1.0 — 15 October 2026

- LaTeX math rendered with KaTeX in Live Preview and the reading view.
- Live Preview with editable tables.
- DMG release with bundled third-party notices.
- Download: `Synapse-1.1.0-arm64.dmg` (Apple silicon).

## 1.0.0 — 15 October 2026

First public release: editor and reading view, wiki links with backlinks, search, graph, tabs and split panes, global settings with vault overrides, English and Italian interface.
