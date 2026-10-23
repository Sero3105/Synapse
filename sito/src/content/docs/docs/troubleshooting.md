---
title: Troubleshooting
description: Fixes for the first launch warning, missing vaults, conflicts and resetting preferences.
---

## macOS says it cannot verify Synapse

Builds are ad-hoc signed and not notarized yet. Open **System Settings → Privacy & Security** and click **Open Anyway** next to the message about Synapse. You only need to do this once per installed version.

## “The application can't be opened” or nothing happens on an Intel Mac

The published release is built for Apple silicon. An Intel build is not published yet; you can [build from source](/docs/installation/#build-from-source) on an Intel Mac.

## A recent vault is marked unavailable

The folder was moved, renamed or deleted. On the starter screen, use **Locate…** to point to its new location, or **Remove** to drop it from the list. Synapse never creates the missing folder again by itself.

## A conflict banner appears

The note changed on disk while you had unsaved edits in Synapse, for example because a sync service or another editor wrote it. Synapse does not overwrite either version. Choose:

- **Load disk version** to take the file as it is on disk, or
- **Keep my version** to write your edits over it.

If the file was deleted outside Synapse, the banner offers **Restore my version** or **Discard**.

## Links point to the wrong note

When two notes have the same name, a link resolves to the shortest path, preferring the linking note's folder. Use a longer link such as `[[Folder/Note]]` to be explicit.

## A note shows HTML as text

Raw HTML in notes is not rendered, by design. Use Markdown instead.

## Reset preferences

Quit Synapse and delete `~/Library/Application Support/Synapse/settings.json`. Defaults return on the next launch. To reset one vault, delete `<vault>/.synapse/settings.json`. Notes are not affected.

## Report a problem

Open an issue on [GitHub](https://github.com/Sero3105/Synapse/issues) with the Synapse version, your macOS version and the steps to reproduce. For security issues, follow the [security policy](https://github.com/Sero3105/Synapse/blob/main/SECURITY.md).
