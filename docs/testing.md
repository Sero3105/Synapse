# Testing

| Suite | Command | What |
|---|---|---|
| Typecheck | `npm run typecheck` | `tsc --noEmit` over main, preload, renderer, tests |
| Unit / integration | `npm test` | vitest: settings layers, migrations, corruption, vault switching, moved/copied vaults, failed writes, concurrency (`test/settings.test.ts`); path confinement, symlinks, conflicts, unicode, rename, trash (`test/vault.test.ts`); link parsing and resolution, backlinks, graph edges, tags, search, rename rewriting (`test/markdown.test.ts`) |
| E2E (dev build) | `npm run test:e2e` | Playwright drives Electron with an isolated `SYNAPSE_USER_DATA` and temp vaults. CI runs it on `macos-latest` on every push (`ci.yml`, job `e2e`) |
| E2E (packaged app) | `npm run build && npm run notices && npx electron-builder --mac --dir -c.electronFuses.enableNodeCliInspectArguments=true`, then `SYNAPSE_APP=release/mac-arm64/Synapse.app/Contents/MacOS/Synapse npx playwright test` | Same suite against a production bundle. Release builds turn the `--inspect` fuse off, so Playwright can only drive a bundle built with this override |

E2E windows are never shown and the app takes no focus or Dock icon (`SYNAPSE_HIDDEN=1`, set by the specs), so you can keep working while the suite runs.

All tests use temp directories. None touch real notes or the real `~/Library/Application Support/Synapse`.

## E2E scenarios

1. Mandatory 20-step settings acceptance scenario via the UI, including two real app restarts.
2. Create a note, edit it, rename it with link rewriting (unicode names), restart, and check that tabs and content are restored.
3. External changes: a clean buffer reloads; a dirty buffer gets a conflict banner and the disk file is not overwritten.
4. A missing last vault is listed as unavailable and its folder is not created.
5. Search, quick switcher, command palette, reading view link click, graph.
6. Security: no `require` or `process` in the renderer, out-of-vault and config paths refused, unknown IPC channels blocked.

## Reliability check (2026-10-25)

- Vault moved, deleted or recreated while open: `e2e/reliability.spec.ts`. The folder is never recreated, the typed text is kept, saving resumes when the folder returns, and a recreated empty folder gets a "deleted" conflict instead of a silent write.
- Crash during a save: `test/vault.test.ts`. The original stays intact and the new text stays in a visible `.tmp` file, which is never removed automatically.
- PDF export with a remote image that never answers: confirmed to hang (nothing written after 60 s). Now limited to 15 s: `e2e/export.spec.ts`.
- Intermittent Mermaid E2E failure (one run): not reproduced in about 40 runs. Cause unknown, test unchanged.

## Security audit (2026-10-25)

- Electron 44.7.2 → 44.9.3 and markdown-it 15.0.2 → 15.0.3, inside the existing `package.json` ranges; only `package-lock.json` changed. `npm audit` still lists `undici` and `fast-uri`, which are used only by build tooling (electron-builder, node-gyp, the Electron downloader) and are not in the app.
- `npm test`: 205/205. E2E: 32/32 in two full runs. One earlier full run had a single intermittent failure in the Mermaid test, which passed when repeated alone (3/3).

## Last results (2026-10-28, 1.5.x)

- `npm run typecheck`: pass
- `npm test`: 284/284 pass, 23 files (adds `merge`, `graph-layout`, `layout`, `file-sort`, `update` suites)
- `npm run test:e2e`: 69/69 pass, including `e2e/{autocomplete,preview-tabs,panes,pdf,windows,graph,merge}.spec.ts`
- CI (GitHub Actions, `ci.yml`): typecheck, build and unit tests on every push — green on `main` and on the `v1.5.1` tag
- Release (`release.yml` from a version tag): builds, signs and publishes DMG + zip + `.sig` for arm64 and x64

## Last results (2026-10-25, second feature set)

- `npm run typecheck`: pass
- `npm test`: 190/190 pass, 17 files. New: `related`, `graph-filter`, `attachments`, `tasks`, `export`, `migrate`, `start`
- `npm run test:e2e`: 31/31 pass, with the new specs `e2e/{related,attachments,tasks,export,start}.spec.ts` (shared setup in `e2e/helpers.ts`). The new specs also passed 3 runs in a row (27/27).

## Earlier results (2026-10-25)

- `npm run typecheck`: pass
- `npm test`: 149/149 pass. New suites: `test/code.test.ts` (fence languages for both views, unknown languages, Mermaid config), `test/templates.test.ts` (daily note paths, duplicates, placeholders), `test/history.test.ts` (snapshots, dedupe, retention, interrupted writes, external edits, restore conflicts, renames)
- `npm run test:e2e` (dev build): 22/22 pass, including code highlighting and Mermaid (invalid, empty, injection attempt, theme switch), daily notes, templates and version history restore
- E2E on a production bundle built with `npx electron-builder --mac --dir --arm64` into a temp folder (no DMG, `release/` untouched): 22/22 pass; `codesign --verify --deep` ok

## Earlier results (2026-10-15)

- `npm run typecheck`: pass
- `npm test`: 67/67 pass
- E2E on the dev build: 6/6 pass, run twice each with `--repeat-each 2` (12/12)
- E2E on `release/mac-arm64/Synapse.app`: 6/6 pass
- E2E on `/Applications/Synapse.app`: 6/6 pass
- Manual launch with `open -a /Applications/Synapse.app`: window "Synapse" present; AppleScript `quit` exits cleanly
- `npm run dev`: Vite serves on :5173 and Electron starts (smoke test only)

## Not covered automatically

- Native folder pickers (Open folder, Create vault location, Locate…): OS dialogs cannot be driven by Playwright. The logic behind them is unit-tested.
- Deleting to the system Trash in E2E: skipped to avoid filling the user's Trash. Covered by a unit test with an injected trash function.
- Drag and drop, pane resizing, and image paste: checked only from screenshots.
- No linter is configured.
