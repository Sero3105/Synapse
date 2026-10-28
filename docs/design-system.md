# Design system: Future Minimal

Synapse is a place to think and write for hours. The page stays the calmest, brightest surface; everything around it is quiet, softly rounded and precise. Deep graphite in dark mode, warm paper in light mode, one accent.

The accent, the **signal** (electric violet by default, configurable in Settings → Appearance), marks connections, focus and selection: links, the caret, keyboard focus, the active note, live counts, the scope of a vault override. Errors and conflicts keep their own semantic red.

All tokens live at the top of `src/renderer/styles.css`. Components reference tokens only.

## Principles

| Rule | How Synapse applies it |
|---|---|
| Tone and space first | Regions are told apart by tone (sunk docks, raised rows, the page) and spacing. A 1px `--line` is used only on floating layers, real separators (settings rows, palette input) and as the faint guide under list details. |
| Shadows only on floating layers | `--shadow-float` (hairline + soft tinted shadow) on dialogs, palette, menus, notices, graph controls and docks floating over a narrow window. The selected segment of a segmented control is the one lifted chip. |
| No decorative gradients, glow or glass | Focus is a thin accent line plus a soft halo; nothing else glows. |
| One accent | `--signal` for marks and text, `--cta` (accent darkened) for filled buttons and switches so white text stays at least 4.5:1. |
| No cards in lists | Result lists (search, tasks, backlinks, related, reports) show the note title aligned with the section header and details as quiet text on a guide line; a surface appears only on hover. |
| One dropdown | Every choice list is `Select.tsx`: a field that opens the app's own menu (tick on the current choice, arrow keys), never the native macOS pop-up. A quiet text variant serves secondary choices (sort order, setting scope). |
| Two typefaces | SF Pro for the interface, New York for notes. Monospace only for code and syntax examples. |

## Colour roles

| Token | Dark | Light | Use |
|---|---|---|---|
| `--ground` | #16171c | #fdfcfa | the page: editor, reading view, status bar |
| `--ground-sunk` | #111217 | #f6f5f2 | docks, tab rail |
| `--raise-1` | #1c1d24 | #efeeea | fields, hover, segmented track |
| `--raise-2` | #262731 | #e7e5e0 | selection, active rows, pressed |
| `--float` | #202129 | #ffffff | menus, dialogs, overlays |
| `--line` | white 7% | ink 8% | hairlines on floating layers and separators |
| `--ink` / `--ink-2` / `--ink-3` | #ebebf0 / #a6a7b4 / #7f818e | #1b1b21 / #55565f / #666771 | text, secondary text, hints |
| `--signal` | accent, slightly lifted | accent mixed 66% with black | links, caret, focus, connections |
| `--cta` | accent mixed 76% with black | same | filled buttons, switches (white text) |
| `--danger` | #f2706b | #c93c37 | conflicts, missing vaults, destructive actions |

The default accent is `#8b7cff`. Installations that still had the previous default (`#4cc9b0`) on disk follow the new default; any other chosen colour is kept.

## Shape

| Token | Value | Use |
|---|---|---|
| `--r-ctl` | 8px | buttons, fields, rows, menu items |
| `--r-panel` | 12px | code blocks, images, history preview |
| `--r-float` | 14px | menus, notices, popovers, graph settings |
| `--r-overlay` | 20px | dialogs, palette, settings, vault manager |
| `--r-pill` | full | chips, toggles |

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
- Radii: see Shape above.
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
