# Plan: rename the plugin to `logbook`

**Status:** approved, not started. Scoped and hazard-checked 2026-08-02; execution deferred to a fresh session by user instruction.

**Approved scope:** outward-facing names and wording ONLY. Inward-facing identifiers stay as they are, deliberately — they are already clear, and the user requires them to remain so.

## Precondition (blocking)

`fix/hooks-prior-path-self-heal` must merge to `main` first. It is 11 commits ahead of `origin/main` and 1 behind.

Merging `origin/main` into it **conflicts in `hooks/lib/installer.mjs`**. The missing commit is `d91441a`, the squash-merge of PR #23, whose unsquashed originals (`2e91b33` and the `f8a694b` reconcile commit) are already on the branch — so the conflict is the squashed form meeting the original form of the same work. Resolve toward the branch's version where they diverge, then re-run `node --test`.

The branch has no PR. Full suite was green at `5bc19a4` (692 pass, 0 fail) before the merge attempt; it must be re-run after the merge is resolved.

Do not start the rename before this lands: it edits display strings in `hooks/lib/pre-tool-use.mjs`, `hooks/lib/session-start.mjs`, `hooks/lib/hook-io.mjs`, and `hooks/hooks.json` — all four heavily rewritten on that branch.

## What changes

| Surface | From | To |
|---|---|---|
| `.claude-plugin/plugin.json` name | `session-continuity` | `logbook` |
| `.claude-plugin/plugin.json` displayName | `Session Continuity` | `Logbook` |
| `.claude-plugin/plugin.json` description, keywords | | drop `session-continuity`, add `logbook` |
| `.claude-plugin/marketplace.json` name | `continuity-ledger` | `logbook` |
| `.claude-plugin/marketplace.json` plugins[0].name | `session-continuity` | `logbook` |
| `package.json` name, description | `session-continuity` | `logbook` |
| `skills/lift-off/` → | | `skills/preflight/` |
| `skills/ledgerize/` → | | `skills/debrief/` |
| Skill frontmatter `name:` | `lift-off`, `ledgerize` | `preflight`, `debrief` |
| Skill `description:` trigger literal | `/lift-off` | `/preflight` |
| Skill body H1 | `# Lift Off`, `# Ledgerize` | `# Preflight`, `# Debrief` |
| Skill body cross-reference | "the `ledgerize` skill", "the `lift-off` skill" | "the `debrief` skill", "the `preflight` skill" |
| `hooks/lib/roster.mjs:1` + roster header | `Session-continuity...` | `Logbook...` |
| `hooks/lib/pre-tool-use.mjs` (6 reason strings) | "session-continuity guard", "session-continuity ledger store" | "Logbook guard", "Logbook ledger store" |
| `hooks/lib/hook-io.mjs:6` | "the session-continuity guard" | "the Logbook guard" |
| `hooks/lib/session-start.mjs` stderr prefix | `continuity: ` | `logbook: ` |
| `scripts/check-packaging.mjs:191-192` | hard-coded `session-continuity` | `logbook` |
| `README.md` title and prose | | |
| Tests asserting the name | 8 files, see checklist | |

## What explicitly stays

MCP server `ledger`; all 12 tool names (`open_thread`, `bind_branch`, `append_session_event`, `record_decision`, `transition_thread`, `update_thread`, `archive_thread`, `create_successor`, `reopen`, `reconcile`, `rebuild_index`, `get_resume_brief`); every CLI subcommand; `thread` / `binding` / `spine` / `decision`; FSM statuses `active|paused|blocked|done|abandoned`; the five `continuity.*` git config keys; `.continuity-managed-hooks`; `_ledger` branch and `refs/ledger/*`; `LEDGER_*` env vars; the `Thread-Id:` commit trailer; module filenames (`ledger-cli.mjs`, `ledger-server.mjs`, `git-ledger.mjs`).

The layering is intentional: **Logbook** is the product; it is implemented as a ledger of threads.

## Hazard 1 — the MCP tool prefix change is MANDATORY

Claude Code derives plugin-scoped MCP tool names as `mcp__plugin_<plugin>_<server>__<tool>`. Renaming the plugin changes every tool from `mcp__plugin_session-continuity_ledger__*` to `mcp__plugin_logbook_ledger__*` whether or not the server is renamed. This is not optional and not scope creep.

Four locations carry the literal:

1. `hooks/hooks.json:5` — PreToolUse matcher `mcp__(plugin_session-continuity_)?ledger__.*`
2. `hooks/lib/pre-tool-use.mjs:8` — `LEDGER_TOOL = /^mcp__(?:plugin_session-continuity_)?ledger__(.+)$/`
3. `allowed-tools:` frontmatter in BOTH skills
4. The dual-name prose paragraph in BOTH skill bodies

Miss any and `hooks/lib/pre-tool-use.mjs:159` stops auto-approving ledger tool calls, so every ledger write begins prompting — the prompt-fatigue degradation the README names as this control's primary failure mode.

## Hazard 2 — `continuity` must NOT be blind-replaced

The string `continuity` is both user-facing display text and five real git config keys that are staying: `continuity.priorHooksPath`, `continuity.priorHooksPathCaptured`, `continuity.priorHooksPathCorrupt`, `continuity.priorHooksPathDeclined`, `continuity.trailer` (`hooks/lib/prior-hooks-path.mjs:17-20`, `hooks/lib/installer.mjs:71`, `hooks/commit-msg`).

A global find-and-replace renames those keys and breaks prior-hook-chain self-heal in every repo where the plugin has already run — undoing the work of the branch in the precondition above. Scope every replacement to display strings, and keep the warning text naming `continuity.priorHooksPath` verbatim, since that is still the key a user would `git config --get`.

## De-risked

No LocalDriver data root exists on this machine (`~/.claude/plugins/data/session-continuity` and `~/.claude/session-continuity` are both absent), so the `CLAUDE_PLUGIN_DATA` path change orphans nothing. This repo's ledger is on `refs/heads/_ledger` via GitRefDriver and is unaffected by a plugin-name change. The plugin cache at `~/.claude/plugins/cache/continuity-ledger/session-continuity` will need a reinstall/refresh after the marketplace and plugin names change.

## Test checklist

These assert the old name and must move with it:

- `test/unit/packaging/plugin-manifest.test.mjs:12,19`
- `test/unit/packaging/check-packaging.test.mjs:17,21,397,425,431`
- `test/unit/marketplace/marketplace-manifest.test.mjs:34,47`
- `test/unit/hooks/pre-tool-use.test.mjs:21,76,77,210,283,301,352,362,378`
- `test/unit/hooks/hooks-json.test.mjs:38`
- `test/unit/skills/ledgerize.test.mjs:12` (also rename the file)
- `test/unit/skills/lift-off.test.mjs:12` (also rename the file)

Verification: `node --test` full suite green (baseline 692 pass), plus a manual check that a ledger tool call is still auto-approved rather than prompting.

## Out of scope

Tier 3 (MCP server and tool renames, CLI verb renames) and Tier 4 (data model, FSM statuses, trailer, branch, env vars, git config keys) were considered and explicitly rejected by the user. The aviation vocabulary proposed for them — `flight`, `leg`, `airborne`/`holding`/`grounded`/`landed`/`scrubbed`, `cross_check`, `get_briefing` — is recorded here only so the rejection is legible; do not implement it.
