# Testing

| Suite | Command | What |
|---|---|---|
| Typecheck | `npm run typecheck` | `tsc --noEmit` over main, preload, renderer, tests |
| Unit / integration | `npm test` | vitest: settings layers, migrations, corruption, vault switching, moved/copied vaults, failed writes, concurrency (`test/settings.test.ts`); path confinement, symlinks, conflicts, unicode, rename, trash (`test/vault.test.ts`); link parsing and resolution, backlinks, graph edges, tags, search, rename rewriting (`test/markdown.test.ts`) |
| E2E (dev build) | `npm run test:e2e` | Playwright drives Electron with an isolated `SYNAPSE_USER_DATA` and temp vaults |
| E2E (installed app) | `SYNAPSE_APP=/Applications/Synapse.app/Contents/MacOS/Synapse npx playwright test` | Same suite against the production bundle |

All tests use temp directories. None touch real notes or the real `~/Library/Application Support/Synapse`.

## E2E scenarios

1. Mandatory 20-step settings acceptance scenario via the UI, including two real app restarts.
2. Create a note, edit it, rename it with link rewriting (unicode names), restart, and check that tabs and content are restored.
3. External changes: a clean buffer reloads; a dirty buffer gets a conflict banner and the disk file is not overwritten.
4. A missing last vault is listed as unavailable and its folder is not created.
5. Search, quick switcher, command palette, reading view link click, graph.
6. Security: no `require` or `process` in the renderer, out-of-vault and config paths refused, unknown IPC channels blocked.

## Last results (2026-10-15)

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
