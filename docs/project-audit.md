# Project audit (2026-10-15)

## Starting state

- The project folder was **empty**: no files, no git repository, no README, no package manifest, no existing app bundle.
- There was no existing implementation to extend, so the project was scaffolded from scratch. `git init` was run so changes are tracked. No commits were made.
- `/Applications/Synapse.app` did not exist before installation.

## Environment

| Tool | Status |
|---|---|
| macOS 27.0.1, arm64 | ✓ |
| Node 24.14.1, npm | ✓ |
| Rust/cargo | ✗ (rules out Tauri) |
| Xcode CLT | ✓ (codesign, ditto, PlistBuddy) |
| REA 6.5.0 | ✓ CLI; not registered as an MCP server; Hopper, Ghidra, IDA and JADX missing (not needed) |
| Obsidian | `/Applications/Obsidian.app` 1.12.7, with updated 1.13.7 asar in userData |

## Skills

| Skill | Available | Use |
|---|---|---|
| REA | CLI | Investigation (see `obsidian-analysis.md`) |
| caveman | ✓ plugin | Concise reporting |
| ponytail | ✓ `~/.claude/skills/ponytail` | Minimal-complete implementation. Unused settings (excluded folders) were removed rather than left as a dead control. |
| taste-skill (`design-taste-frontend` v2 and variants) | ✓ | Not applied. Its own description says "Not for dashboards or app screens". The visual design follows reference measurements instead. |
| Loop Engineer | ✗ not installed | Replaced by bounded build → test → screenshot → fix cycles (unit and E2E suites as exit criteria) |
| `/loop` (Claude Code) | ✓ | Not used: it schedules recurring prompts and does not fit this task |
