<p align="center">
  <img src="build/icon.png" width="112" alt="Synapse app icon" />
</p>

<h1 align="center">Synapse</h1>

<p align="center">
  <b>A calm, local-first Markdown workspace for connected notes on macOS.</b><br />
  Your notes stay plain files in folders you own. Your preferences follow you across every vault.
</p>

<p align="center">
  <img alt="macOS" src="https://img.shields.io/badge/macOS-Apple%20Silicon-15181c?logo=apple&logoColor=white" />
  <img alt="Electron" src="https://img.shields.io/badge/Electron-44-15181c?logo=electron&logoColor=4cc9b0" />
  <img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-15181c?logo=typescript&logoColor=4cc9b0" />
  <img alt="Languages" src="https://img.shields.io/badge/UI-English%20%C2%B7%20Italiano-15181c" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-74%20unit%20%C2%B7%2011%20e2e-4cc9b0" />
</p>

<p align="center">
  <img src="docs/screenshots/editor.png" alt="Synapse editor with the navigator on the left and note context on the right" />
</p>

---

## Why Synapse

- **Plain files, no lock-in.** Every note is a `.md` file in a normal folder. Open the same folder in any editor, sync it however you like, back it up with Time Machine.
- **Preferences that stay put.** Theme, fonts, editor behaviour and hotkeys are global. Switching vaults never resets them, and any single preference can still be overridden for one vault.
- **Built for long writing sessions.** A serif page (New York) on a quiet graphite workspace, with comfortable line length and nothing moving while you type.
- **Links are the point.** Wiki links with autocomplete, backlinks with context, unlinked mentions, outgoing links, tags and a live graph. The single mint accent marks connections and nothing else.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/reading.png" alt="Reading view" /><br /><sub><b>Reading view</b>: rendered Markdown, clickable links, tags and task checkboxes.</sub></td>
    <td width="50%"><img src="docs/screenshots/graph.png" alt="Graph view" /><br /><sub><b>Graph</b>: every note and link in the vault. Drag, zoom, click to open.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/search.png" alt="Search" /><br /><sub><b>Search</b> with <code>"phrases"</code>, <code>-exclusions</code>, <code>tag:</code>, <code>path:</code> and <code>file:</code>.</sub></td>
    <td><img src="docs/screenshots/command-palette.png" alt="Command palette" /><br /><sub><b>Command palette</b> (⌘P): every action, with its shortcut.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/settings.png" alt="Settings" /><br /><sub><b>Settings</b>: each preference applies to <i>all vaults</i> or <i>this vault only</i>.</sub></td>
    <td><img src="docs/screenshots/light.png" alt="Light theme" /><br /><sub><b>Light theme</b>, or follow macOS automatically.</sub></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/welcome.png" alt="Vault manager" /><br /><sub><b>Vaults</b>: create, open, switch. Moved or missing folders are detected, never recreated empty.</sub></td>
    <td><img src="docs/screenshots/italian.png" alt="Italian interface" /><br /><sub><b>English and Italian</b>, switchable at any time.</sub></td>
  </tr>
</table>

## Features

| | |
|---|---|
| **Editor** | Live Preview: Markdown syntax hides itself except on the line you are editing; tables are edited as tables; LaTeX math (`$inline$`, `$$block$$`) renders with KaTeX. Built on CodeMirror 6, with `[[` link autocomplete, click a rendered link to open it (⌘-click anywhere in source), find & replace, formatting shortcuts, image paste and drop, autosave |
| **Reading view** | Rendered Markdown with tables, syntax-highlighted code, Mermaid diagrams, math, quotes, embeds (`![[note]]`, `![[image.png]]`) and clickable task lists |
| **Knowledge** | Backlinks with context, unlinked mentions, outgoing and unresolved links, outline, tags (inline and front-matter), graph view |
| **Navigation** | Quick switcher (⌘O), command palette (⌘P), tabs, split panes, per-tab back/forward, recent notes, workspace restored per vault |
| **Files** | File tree with drag-and-drop moves, rename with automatic link updates, delete to the macOS Trash, reveal in Finder |
| **Safety** | Atomic writes, conflict detection when a file changes on disk, path checks that keep every operation inside the vault, sandboxed renderer |
| **Personalisation** | Light / dark / system theme, accent colour, fonts and sizes, rebindable hotkeys, core features that can be switched off globally or per vault |
| **Languages** | English and Italian, following macOS by default |

## Install

1. Download the latest **`Synapse-<version>-arm64.dmg`** (Apple silicon) or **`Synapse-<version>-x64.dmg`** (Intel) from [Releases](https://github.com/Sero3105/Synapse/releases).
2. Open it and drag **Synapse** onto **Applications**.
3. The first time you open Synapse, macOS warns that it cannot verify the app, because builds are not notarized yet. Open **System Settings → Privacy & Security** and click **Open Anyway**. You only need to do this once.

Requirements: macOS 13 Ventura or later, on Apple silicon or Intel.

### Build from source

```sh
git clone https://github.com/Sero3105/Synapse.git
cd Synapse
npm install
npm run package       # builds release/mac-arm64/Synapse.app
npm run install:app   # copies it to /Applications/Synapse.app
```

Requirements for building: Node.js 22 or newer.

`install:app` only replaces an existing Synapse build (bundle id `com.synapse.notes`), refuses while the app is running, and never touches your notes or preferences. The app is ad-hoc signed, not notarized.

**Update:** pull, then run the two commands again.
**Uninstall:** delete `/Applications/Synapse.app`. You can also delete `~/Library/Application Support/Synapse` to remove preferences. Notes are never stored in either place.

## Keyboard shortcuts

| Action | Shortcut | Action | Shortcut |
|---|---|---|---|
| Command palette | ⌘P | New note | ⌘N |
| Jump to note | ⌘O | New tab / close tab | ⌘T / ⌘W |
| Search all notes | ⇧⌘F | Reopen closed tab | ⇧⌘T |
| Find in note | ⌘F | Next / previous tab | ⌃⇥ / ⌃⇧⇥ |
| Reading / editing view | ⌘E | Back / forward | ⌥⌘← / ⌥⌘→ |
| Graph | ⌘G | Bold / italic / link | ⌘B / ⌘I / ⌘K |
| Settings | ⌘, | Toggle checkbox | ⌘L |
| Close vault | ⇧⌘W | | |

Every shortcut can be changed in **Settings → Hotkeys**.

## How settings work

| What | Where it lives | Scope |
|---|---|---|
| Theme, fonts, editor behaviour, language, hotkeys, sidebar layout | `~/Library/Application Support/Synapse/settings.json` | All vaults |
| Recent vaults and window size | `~/Library/Application Support/Synapse/` | App |
| Per-vault overrides, graph settings, attachment folder | `<vault>/.synapse/settings.json` | One vault |
| Open tabs, panes and recent notes | `<vault>/.synapse/workspace.json` | One vault |

Precedence is **defaults → global → vault override**. Changing a preference while a vault overrides it changes only that vault. Removing the override falls back to the global value. Synapse writes nothing else into your vault, and it never modifies an existing `.obsidian/` folder.

## Languages

The interface is available in **English** and **Italiano**. By default it follows the macOS language order; change it in **Settings → General → Language**. The native menu bar and dialogs switch too.

To add a language, add a dictionary to `src/shared/i18n.ts`. The type checker rejects a dictionary that is missing a key, and a unit test checks that placeholders match.

## Privacy

Everything stays on your Mac: no account, no telemetry, no cloud sync. Synapse goes online only in two cases. At launch it asks GitHub Releases whether a newer version exists (no personal data is sent; turn it off in **Settings → General → Check for updates**). And when a note asks it to, for example to load a remote image embedded with an `https://` link, or when you click a web link, which opens in your browser.

## Development

```sh
npm run dev         # Vite + Electron with hot reload
npm run typecheck   # tsc --noEmit
npm test            # unit and integration tests (vitest)
npm run test:e2e    # builds, then drives the real Electron app with Playwright
```

```
src/
  main/       Electron main process: window, menu, IPC, vault filesystem, settings storage
  preload/    the narrow, allow-listed bridge exposed to the UI
  renderer/   React UI: editor, reading view, sidebars, graph, modals, settings
  shared/     settings schema and precedence, Markdown/link index and search, i18n
test/         vitest suites (settings, vault safety, links and search, i18n)
e2e/          Playwright suites against the packaged app
docs/         architecture, design system, testing notes
```

End-to-end tests run against isolated temporary vaults and app-data folders. To test the installed app:

```sh
SYNAPSE_APP=/Applications/Synapse.app/Contents/MacOS/Synapse npx playwright test
```

## Documentation

- [Architecture](docs/architecture.md) and [settings model](docs/settings-architecture.md)
- [Design system](docs/design-system.md)
- [Feature matrix and known limitations](docs/feature-matrix.md)
- [Testing](docs/testing.md) and [UI testing](docs/ui-testing.md)

## Known limitations

- Raw HTML in notes is not rendered, for security.
- Split panes run in one direction, with up to four panes.
- Obsidian community plugins are not supported.
- The build is not notarized. Updates are announced in the app but installed by hand: download the new DMG and replace the app. The Intel build is not yet tested on Intel hardware.
