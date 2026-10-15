# project-scope-ledger-server: Stop this repository offering a project-scope ledger MCP server that can never start
Status: active
Updated: 2026-10-15T19:18:59.811Z
Next ids: c7 D2 R7 S4

## Goal

A Claude Code session opened in this repository also loads the repo-root .mcp.json as a project config and tries to start a second server named ledger, which fails every time with MODULE_NOT_FOUND. Investigate and name the root cause(s), then ship a released fix so no checkout of this repository offers that broken server, without disturbing the plugin's own working ledger server (the mcp__plugin_logbook_ledger__* tools).

## Done when

- [ ] c1 The root cause(s) are named and recorded as a decision on this thread, with the fix options that were weighed, before any fix is written.
- [ ] c2 A Claude Code session opened in a fresh clone of this repository neither lists a failing server named ledger nor asks to approve one.
- [ ] c3 After the release is installed, the plugin's own server still connects and still exposes its tools under the mcp__plugin_logbook_ledger__ prefix.
- [ ] c4 The unit, contract and lint suites, the typecheck and the packaging check all pass on the change.
- [ ] c5 The local workaround in this checkout is removed once the release is installed, and this checkout still shows no failing ledger server.
- [ ] c6 The release version is chosen under OR44 for whatever contract the fix changes.

## Where things stand

Converted from the old ledger.

## Next step

Reproduce the failure in a fresh clone before choosing any fix: clone SatanshuMishra/logbook into a scratch directory (this checkout no longer reproduces it, because .claude/settings.local.json now rejects the server), open a Claude Code session there, approve the project server named ledger when asked, and confirm the MODULE_NOT_FOUND line naming the literal ${CLAUDE_PLUGIN_ROOT} in the mcp-logs-ledger folder under ~/Library/Caches/claude-cli-nodejs/, inside the folder named after the clone's path with each slash replaced by a dash.

## Decisions in force

- D1 Give criterion 6 an OR44 check so it can be confirmed: Rewrite criterion 6 with the check: the release decision on this thread says whether any existing pinned contract test was rewritten, and the version in .claude-plugin/plugin.json and package.json is the next major if one was, otherwise the next minor. The human chose this and asked for criterion 6 to be confirmed.

## Open risks

- R1 Moving the server entry from .mcp.json into plugin.json may change the server's registered name or tool prefix (unverified). Every skill, hook and agent tool list names mcp__plugin_logbook_ledger__*, so a changed prefix silently removes logbook from every session. Bears on c3.
- R2 Working-tree edits do not reach the running plugin: it is installed user-scope from GitHub into ~/.claude/plugins/cache/logbook/logbook/U+003Cversion>/. A manifest change that the plugin loader does not honour is only discovered after release and reinstall, and at that point logbook's own tools are gone for the session that would fix it. Exercise the changed layout as a plugin before releasing (for example a local marketplace, or a --plugin-dir style load, unverified in this Claude Code version). Bears on c3.
- R3 Five tracked places pin the root .mcp.json and will fail or go stale if it moves: scripts/check-packaging.mjs (required-file list line 22, SERVER_ARGS line 38, checkMcpDeclaration lines 237-260, forbidden env key scan line 302), test/contract/packaging.test.ts lines 49-73, test/contract/cutover-manifest-commands.test.ts lines 129 and 174, test/lint/cutover-old-tree-absent.test.ts line 19, README.md line 85. Bears on c4.
- R4 A checked-in .claude/settings.json carrying disabledMcpjsonServers would be classified outside-every-declared-root by test/lint/cutover-old-tree-absent.test.ts and fail npm run lint unless the classifier is extended. Bears on c4.
- R5 Making the project-scope server start (for example a ${CLAUDE_PLUGIN_ROOT:-.} default, unverified whether the plugin loader honours default syntax) would not remove the problem: it would run a second logbook server beside the plugin's, under a different tool prefix (mcp__ledger__*), against the same store. Bears on c1.
- R6 scripts/check-packaging.mjs line 246 says the mcp__ledger__* surface depends on the ledger key, but the live tools are mcp__plugin_logbook_ledger__*; that message may be stale and should not be taken as evidence of what depends on the project-scope name. Bears on c1.

## Settled, do not reopen

- S1 Out of scope: The github MCP server failing with HEADERS_HELPER_AUTH_REJECTED at session start; unrelated to this repository.
- S2 Out of scope: The receipts startup notice asking for receipts doctor on a config written by receipts 0.5.2.
- S3 Out of scope: inspector.config.json, which declares a separate server named logbook for the MCP Inspector (npm run inspect) and is not read by Claude Code.

## Where the details live

- Repo-root MCP manifest read in both plugin and project scope: .mcp.json
- Plugin manifest, candidate home for an inline mcpServers entry: .claude-plugin/plugin.json
- Marketplace manifest, where the plugin's source root is declared: .claude-plugin/marketplace.json
- Local workaround: disabledMcpjsonServers rejects ledger (gitignored): .claude/settings.local.json
- Packaging check pinning .mcp.json (file list line 22, SERVER_ARGS line 38, checkMcpDeclaration, forbidden env keys): scripts/check-packaging.mjs
- Packaging contract tests writing a deliberately broken .mcp.json: test/contract/packaging.test.ts
- Manifest command census reading .mcp.json: test/contract/cutover-manifest-commands.test.ts
- Tracked-path classifier listing .mcp.json as repository infrastructure: test/lint/cutover-old-tree-absent.test.ts
- README layout paragraph citing .mcp.json:3 and .mcp.json:5: README.md
- Claude Code plugins reference: MCP servers in .mcp.json or inline in plugin.json, CLAUDE_PLUGIN_ROOT substitution: https://code.claude.com/docs/en/plugins-reference
- Claude Code settings reference: enabledMcpjsonServers, disabledMcpjsonServers, enableAllProjectMcpServers: https://code.claude.com/docs/en/settings-reference
- Claude Code MCP docs: project server approvals and workspace trust: https://code.claude.com/docs/en/mcp
- Old ledger record: thread 01M2NQDWCNBX3PXR6FKMSJNVAN in refs/logbook/archive/ledger
