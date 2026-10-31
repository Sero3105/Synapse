---
title: Releases
description: Published versions of Synapse and what changed.
---

Downloads for every version are on [GitHub Releases](https://github.com/Sero3105/Synapse/releases).

## 1.5.5 — 31 October 2026

- **Creation dates kept:** saving a note no longer resets its creation date, so **Sort by created** in the file tree orders notes by when they were really created.
- **Graph:** zoom and position stay put while you type in another pane, and the nodes no longer shake on every pause.
- **Faster on big vaults:** autosaving a note no longer re-reads the whole vault; only the saved note is updated.
- **Vault export:** each image is copied once into the site folder, next to the pages, instead of being embedded in every page that shows it. The export runs in the background and no longer freezes the app.
- **Updates:** the update check repeats once a day while Synapse stays open, and a check that failed (for example offline at launch) is tried again.
- **Version history:** removing a vault from the list also deletes the earlier versions Synapse kept for it.
- **Security:** release builds turn off Electron's `--inspect` option, so no other program can start Synapse in debug mode and run code with its permissions.

## 1.5.4 — 29 October 2026

- **Fix:** in a long note, `[[` suggestions now open below the cursor even past the first screenful.

## 1.5.3 — 28 October 2026

- **Fix:** the `[[` suggestions popup could be placed off-screen and stay invisible; it now opens next to the cursor.

## 1.5.2 — 28 October 2026

- **Fix:** `[[` suggestions open however the brackets were typed.

## 1.5.1 — 28 October 2026

- **Preview tabs:** a single click in the file tree opens a preview tab (italic title) that the next click reuses. Double-click the file or the tab, or type in the note, to keep it.
- **Fix:** on Italian and other Option-key keyboard layouts, typing `[[` could swallow the brackets and never show link suggestions. The brackets now always insert, and the suggestions open.
- **Reading comfort:** body text renders a step firmer; KaTeX formulas render a step softer and closer in size to the text around them.

## 1.5.0 — 28 October 2026

- **In-app updates:** Synapse downloads a signed update, verifies it with the project release key, and restarts into it. Releases are built, signed and published automatically from a version tag.
- **Multiple windows:** several vaults open side by side, one vault per window (File → New Window).
- **Conflicts:** a three-way merge unites edits made in different places of a note; only lines changed on both sides ask you to choose.
- **Graph:** local graph around the open note (depth 1–2), saved views per vault, node colours by folder or first tag, and a faster layout for vaults above 1,000 notes.
- **Editor:** `[[` suggests headings (`#`) and block ids (`^`) and can create the note when nothing matches; tables gain and lose columns; section folding.
- **Tabs and panes:** pinned tabs, nested split panes in any mix of rows and columns.
- **Files:** nested tags as a tree, custom sort orders, PDFs in a read-only tab, and export of the whole vault as linked HTML pages.

## 1.4.0 — 25 October 2026

Published on GitHub Releases (Apple silicon and Intel DMGs). Everything that was planned for 1.3.1 shipped here:

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
