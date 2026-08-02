# Logbook Plugin

A Git-native, multi-user session continuity plugin for Claude Code, built from a frozen design spec.

## Ledger protection: what guards it, what doesn't, and what's unverified

The ledger lives in one of two places: for a git project, as commits on a ref inside the host repo's own `.git` (`GitRefDriver`); for a non-git project, as files under `CLAUDE_PLUGIN_DATA` (`LocalDriver`). Two mechanisms defend it — a PreToolUse guard that prompts before commands that look like they target the store, and recoverable history for both backends. Neither is a hard security boundary on its own; this section says exactly where each one stops.

### The PreToolUse guard

`hooks/lib/pre-tool-use.mjs` is a parse-free substring tripwire: it never parses shell syntax, it just checks whether the raw command string contains one of a small set of known-sensitive substrings — the ledger branch name `_ledger`, the `refs/ledger/` ref namespace, `CLAUDE_PLUGIN_DATA`, and every spelling of the resolved ledger root it can construct (absolute, `~`-abbreviated, `$HOME`-abbreviated, project-relative) (`hooks/lib/pre-tool-use.mjs:11`, `hooks/lib/pre-tool-use.mjs:72-83`).

For `Bash` commands, a match returns `ask` — Claude Code prompts before running the command — not `deny` (`hooks/lib/pre-tool-use.mjs:93-105`, `hooks/lib/pre-tool-use.mjs:134-138`). The guard says so in its own reason text: *"this guard prompts for confirmation and is not a security boundary"* (`hooks/lib/pre-tool-use.mjs:16`). Two exceptions to ask-by-default: a command too large for the guard to safely read (over 16 KiB, `hooks/lib/pre-tool-use.mjs:10`) is denied outright if it also matches a trigger, and the four built-in write tools — `Write`, `Edit`, `MultiEdit`, `NotebookEdit` — are hard-denied, not asked, when their target path resolves under a ledger root (`hooks/lib/pre-tool-use.mjs:127-133`).

That design is deliberate, and it is the entire protection: the guard cannot tell a destructive command from a benign one that happens to name the ledger, so it defers to you. Everything below follows from that — if prompts get approved reflexively, the guard stops protecting anything.

### Recoverable history

Both backends keep real, recoverable history rather than a single mutable snapshot.

| Backend | Where history lives | On git failure |
|---|---|---|
| Git projects (`GitRefDriver`) | Commits on the ledger ref inside the host repo's own object store — `refs/heads/_ledger` by default, or `refs/ledger/<branch>` under the `custom-ref` backend (`src/drivers/git-ledger.mjs:46-50`) | Not applicable: the driver only runs when the project is already a git worktree (`src/drivers/select.mjs:39-46`), so `git` is guaranteed present |
| Non-git projects (`LocalDriver`) | A private, hooks-disabled git repo initialized under the ledger data directory, committed once per mutation (`src/drivers/local-driver.mjs:117-135`, `:263-286`) | Degrades safely: every commit call is wrapped in try/catch and falls back to a no-op result instead of throwing (`src/drivers/local-driver.mjs:49-51`, `:270-285`) |

Every ledger-mutating tool call surfaces this in its result as a `recovery_degraded` boolean (`src/tools/shared.mjs:10-18`; e.g. `src/tools/open-thread.mjs:20-21`). `false` means the mutation landed in recoverable history; `true` means it landed on disk but the local recovery repo could not record it — check for `git` on `PATH` and the health of the recovery repo under the ledger data directory. `GitRefDriver` never reports `true`: it always writes into the host repo's already-guaranteed git store (`src/drivers/git-ref-driver.mjs:266-283`).

### Four accepted gaps

None of these are closed by the guard or by recoverable history. Each is a deliberate trade-off, not an oversight.

1. **Prompt fatigue is the real failure mode, and it is security-relevant.** Because the substring match cannot distinguish a destructive command from a read, ordinary read-only commands trigger the same `ask` prompt as destructive ones — for example `grep -rn '_ledger' src` prompts, purely because the literal substring `_ledger` appears in it (`hooks/lib/pre-tool-use.mjs:11`, `:93-105`). The number of previously-silent commands this newly prompts for is `[unverified]` — no test or doc in this repo pins a count — but the mechanism guarantees it is nontrivial. The guard's protection *is* the prompt; enough prompts for harmless commands trains reflexive approval, and reflexive approval defeats the guard on the command that actually matters. This is not a cosmetic annoyance — it is the primary way this control degrades in practice.

2. **Under a non-default `ledger_branch`, the headline protection does not apply.** The guard's fixed substring triggers are the literal branch name `_ledger` and the literal `refs/ledger/` namespace (`hooks/lib/pre-tool-use.mjs:5,11`; `src/drivers/git-ledger.mjs:11`), but `ledger_branch` is user-configurable, wired from `LEDGER_BRANCH` (`.mcp.json:8`, `bin/ledger-server.mjs:10-12`) into driver selection (`src/drivers/select.mjs:44`). Under the default `orphan-branch` backend, a custom branch name resolves to `refs/heads/<branch>` (`src/drivers/git-ledger.mjs:46-50`) — a ref the guard never checks for, so commands that name that branch directly (`git branch -D <branch>`, `git push origin :<branch>`) get no prompt at all. Only the `custom-ref` backend is partially mitigated: every branch under it still resolves inside the fixed `refs/ledger/` namespace, which the guard does check for.

3. **`rm -rf .git && git init` destroys the ledger ref with no prompt.** Neither `.git` nor `git init` is a trigger, and the command names no resolved ledger root path, so it passes through unclassified (`hooks/lib/pre-tool-use.mjs:93-105`). A `.git`-literal trigger was considered and deliberately rejected: it would fire on nearly every ordinary git command in a git project, and that volume would degrade the guard (per gap 1) more than this specific gap costs.

4. **A repository-local content filter or merge driver can still reach ledger data through `.git/info/attributes`.** The ledger stores its data as a branch inside the user's own repository and drives it through a linked worktree, so that repository's local `.git/config` is always loaded and cannot be neutralized — it is the config of the repo the ledger lives in. A `filter.<name>.clean`/`filter.<name>.smudge` or `merge.<name>.driver` defined there is inert on its own; it runs only once some attribute source attaches its name to a ledger path. Every attribute source that can be reached is closed: a local `core.attributesFile` and the per-user default it replaces (`$XDG_CONFIG_HOME/git/attributes`), the system-wide attributes file, and a redefinition of the built-in `union` driver the ledger itself depends on for `sessions/**/*.md` (`src/drivers/git-ref-driver.mjs:26`; `src/util/git-env.mjs:25-27`, `:53`, `:69-78`). The user's own checked-out branch `.gitattributes` is not a vector: the linked worktree checks out the ledger tree, so tree-level attributes from the user's branches are simply absent from it. What stays open is `$GIT_DIR/info/attributes` — it holds the highest precedence of any attribute source ([gitattributes(5)](https://git-scm.com/docs/gitattributes)) and is shared from the common directory, so the main repository's file applies inside the linked worktree ([gitrepository-layout(5)](https://git-scm.com/docs/gitrepository-layout)), and no per-invocation mechanism overrides it (`--attr-source`, `attr.tree` and `core.attributesFile` were each tested against it and each failed). Exposure therefore needs both halves: the definition in the user's local config *and* a `.git/info/attributes` entry binding it to a ledger path. Closing it would require an architectural change — writing ledger content through plumbing that never consults attributes — which still would not cover the merge path. This narrow surface matches the project's threat model of agent accident, not a determined adversary.

### Hard mode: `sandbox.filesystem.denyWrite`

Claude Code's Bash sandbox is an opt-in, OS-enforced alternative to the guard above ([Claude Code sandboxing docs](https://code.claude.com/docs/en/sandboxing)). Verified from that page:

- `sandbox.filesystem.denyWrite` (and its siblings `allowWrite`, `denyRead`, `allowRead`) take an array of path strings, resolved by prefix — `/` for absolute, `~/` for home-relative, `./` or no prefix for project-relative — not shell-command substrings.
- Enforcement is OS-level — Seatbelt on macOS, `bubblewrap` on Linux and WSL2 — applied to "every Bash command and its child processes." Unlike the substring tripwire above, this is spelling-independent: `/bin/rm`, `find -delete`, or a script that shells out indirectly cannot evade a path-based deny rule the way they evade a text match.
- Filesystem arrays **merge** across settings scopes rather than replacing: "when the same filesystem array is defined in multiple settings scopes, the arrays are merged: paths from every scope are combined, not replaced."
- On unsupported platforms or missing dependencies, the default is a warning followed by running **unsandboxed** — sandboxing is not enforced unless `sandbox.failIfUnavailable` is also set.

```json
{
  "sandbox": {
    "enabled": true,
    "filesystem": {
      "denyWrite": ["<ledger-root>"]
    }
  }
}
```

**The critical caveat.** Whether hooks and MCP servers run *inside* the sandbox boundary is `[unverified]`. The documentation states the sandbox isolates "Bash subprocesses," and separately covers where built-in file tools, computer use, and subagents stand relative to it — but it never says which side of the boundary hooks or MCP servers fall on. That matters here specifically: this plugin's recoverable-history writes (the `LocalDriver` recovery repo, the `GitRefDriver` worktree) happen from an MCP server process, not from a sandboxed Bash command. If MCP servers *are* subject to `denyWrite`, a `denyWrite` entry covering the ledger root would stop the plugin from writing its own store — turning a protection into an outage. Do not assume hooks or MCP servers are exempt from this rule.

To settle it before relying on it: enable the sandbox with the ledger root added to `denyWrite`, then confirm the plugin still commits per mutation (check `recovery_degraded` on a tool call, or inspect the ledger ref or recovery repo directly). This is a live-settings change, so it is yours to make, not something this doc can verify for you.
