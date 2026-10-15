# Design system: Signal on graphite

Synapse is a place to think and write for hours, so the interface stays quiet and the page is the brightest, calmest surface.

The colour of one accent, the **signal**, is reserved for *connections*: links, the caret, keyboard focus, the active note in the tree and the graph, live backlink counts, and the scope of a vault override. When something lights up, it is connected to something.

All tokens live at the top of `src/renderer/styles.css`. Components reference tokens only.

## Taste-Skill house rules applied

| Rule | How Synapse applies it |
|---|---|
| No hairlines | Regions are separated by tone: sunk docks, raised rows and fields, the page as the lightest surface. Resizers are invisible until hovered, then show a 2px signal bar. |
| No shadows at rest | Only floating layers have `--shadow-float`: menus, dialogs, palette, autocomplete, notices, graph settings, docks floating over a narrow window. Focus and validation rings are states, not shadows. |
| No gradients, no glass | Flat surfaces only. The app icon is flat. |
| No violet/indigo "assistant palette" | The previous violet accent was replaced by phosphor mint `#4cc9b0`. |
| One accent, under 5% of a screen | The signal appears only on connection-related marks. Headings and icons are ink. |
| Two typefaces | SF Pro for the interface, New York (system serif) for notes. Monospace only for literal code and YAML frontmatter. |
| No tiny tracked caps, no eyebrows | All labels are sentence case at readable sizes. |
| Running text in full ink | Note text uses `--ink`. Grey is for metadata only. |

`node ~/.claude/skills/design-taste-frontend/scripts/lint.mjs src/renderer` reports 0 FAIL, 0 WARN. Each kept exception carries a `taste-skill-ignore` comment with its reason.

## Colour roles

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ground` | #131518 | #ffffff | the page: editor, reading view, status bar |
| `--ground-sunk` | #0e1012 | #f2f3f5 | docks, tab rail, code blocks, frontmatter |
| `--raise-1` | #1a1d21 | #e9ebee | fields, hover, segmented track |
| `--raise-2` | #22262b | #e0e3e7 | selection, active rows, pressed |
| `--float` | #1c1f23 | #ffffff | menus, dialogs, overlays |
| `--ink` | #e4e7eb | #15181c | text |
| `--ink-2` | #a3aab3 | #545b64 | secondary text, metadata |
| `--ink-3` | #7c848e | #656c75 | hints, shortcut keys, placeholders |
| `--signal` | accent | accent mixed 62% with black | links, caret, focus, connections |
| `--danger` | #f2706b | #c93c37 | conflicts, missing vaults, destructive actions |

The accent stays user-configurable (Settings → Appearance), globally or per vault. In light mode the signal is darkened automatically so links keep contrast on white.

## Typography

| Role | Face | Size / weight |
|---|---|---|
| Interface | SF Pro | `--font-ui-size` (13px, configurable), 400/500/600 |
| Shortcut hints | SF Pro, tabular figures | 11px, 500 |
| Note body | New York | `--font-text-size` (16px, configurable), leading 1.72, measure 42rem (about 70 characters) |
| Note title | New York | 2.1× body, 600, tracking −0.02em; wraps instead of scrolling |
| Headings | New York | 1.75 / 1.42 / 1.2 / 1.06em, 600 |
| Code | SF Mono | 0.86em, on `--code-ground` |
| Wordmark and section titles (starter, settings, empty tab, note info) | New York | 600, tight tracking |

## Space, shape, motion

- Spacing on a 4pt grid: `--s-1` … `--s-7` = 4, 8, 12, 16, 24, 32, 48px.
- Radii: 6px controls, 10px floating layers, 12px dialogs, full round for chips and toggles.
- Rows are 28px; the title bar zone is 44px; the status bar is 26px.
- Motion: 110 / 180 / 260ms with `cubic-bezier(0.2, 0.8, 0.2, 1)`. Used for:
  - docks sliding open and closed;
  - floating layers rising in;
  - views and vault switches fading in;
  - chevron rotation;
  - hover and pressed states.

  Nothing moves while typing. `prefers-reduced-motion` sets all durations to zero.

## Components

| Component | Where | Notes |
|---|---|---|
| Navigator | left dock | Vault switcher (monogram + name), jump field (⌘O), views (Files, Search, Tags, Graph) with shortcut hints, panel, footer with New note and Settings |
| Note context | right dock | Note info (title, folder, modified time, length, tags as chips), segmented Backlinks / Outgoing / Outline |
| Tab rail | top of each pane | Sunk rail; the active tab takes the page tone, so the tab and page read as one sheet |
| Status bar | bottom of the workspace | Mode, line and column, words and characters, save state (Saved / Unsaved / Conflict) |
| Empty tab | new tabs | Actions with their shortcuts, plus the vault's real recent notes |
| Vault manager | starter screen and modal | Wordmark and statement, create/open actions, recent vaults with missing-folder handling |
| Settings | modal | Sunk navigation; each row has a scope menu ("All vaults" / "This vault only"), which turns signal-coloured when overridden |

## Responsive behaviour

- Below 960px the note-context dock floats over the page instead of taking width from it.
- Below 720px the navigator floats too.
- Title bar toggles stay reachable above floating docks.
- Long names are truncated in lists, tabs and the graph, and wrap in titles.
