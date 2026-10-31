---
title: FAQ
description: Common questions about price, Obsidian vaults, storage, privacy and platforms.
---

## Is Synapse free?

Yes. It is open source under the MIT licence and the builds on GitHub Releases are free. There is no account and no subscription.

## Can I open my Obsidian vault?

Yes, a vault is any folder of Markdown files. Synapse reads wiki links, embeds, tags and front matter, writes only its own `.synapse/` folder and never modifies `.obsidian/`. Obsidian settings and community plugins are not used.

## Why do my preferences not change when I switch vaults?

That is the point: preferences are global. Override one for a single vault with the scope menu next to it. See [Settings](/docs/configuration/settings/).

## Where are my notes stored?

In the vault folder you chose, as `.md` files. Synapse has no database of its own content and no cloud copy.

## Does Synapse sync between devices?

Not by itself. Because notes are plain files, you can keep the vault in any folder that your own sync service manages. If a file changes on disk while you edit it, Synapse shows a conflict banner instead of overwriting.

## Does Synapse go online?

Only to check for updates at launch and once a day while it stays open (one request to GitHub Releases, which you can turn off in Settings → General) and when a note asks it to: to load a remote image embedded with an `https://` link, or when you click a web link, which opens in your browser. There is no telemetry.

## Which Macs are supported?

The published release needs macOS 13 Ventura or later on Apple silicon.

## Is there Windows, Linux or mobile?

No. Synapse is built and tested for macOS only.

## Does it update automatically?

From version 1.3.0, Synapse checks GitHub Releases at launch (from 1.5.5 also once a day while open) and shows a notice when a newer version is published. From 1.5.0 it can also install the update itself: the download is verified with the project's own ed25519 release key (not an Apple Developer ID signature), then Synapse restarts into the new version. See [Installation → Update](/docs/installation/#update).

## I read about tasks, related notes and export. Where are they?

They arrived with release 1.4.0. The current published download is 1.5.6. See [Releases](/docs/releases/).

## What is not supported yet?

- Raw HTML in notes is shown as text, for security.
- Obsidian community plugins are not supported, and Dataview queries show as code blocks. Callouts, footnotes and `%%comments%%` render from 1.5.6.
- Task due dates and semantic (meaning-based) search are not available.
- Builds are not notarized, so the first launch needs **Open Anyway** once. From 1.5.0, updates install from inside the app.
