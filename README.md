# Logbook

Logbook is a Claude Code plugin that keeps a durable "ledger" of what happened across coding sessions in a project — threads of work opened and closed, decisions made along the way, and a log of session events — so a later session, yours or someone else's, can pick up the right context instead of re-deriving it. Claude reads and writes that ledger through the Model Context Protocol (MCP), the standard way Claude Code talks to an external tool server; this plugin ships its own MCP server for that purpose.

The current version lives in `package.json:3` and `.claude-plugin/plugin.json:3`; a test checks that both match the version the running server reports at startup.

## What Logbook promises

These are the promises Logbook publishes. Each carries the identifier the goal model gives it (`docs/specs/2026-08-28-continuity-goal-model.md`, section 4.1), and a test fails the build if any of those identifiers stops appearing here or if this file names one the goal model does not declare (`test/contract/readme-promises-census.test.ts`). The two documents cannot drift apart in silence.

The case for Logbook is **continuity and auditability** — that a later session picks up where an earlier one stopped, and that you can always see how a record came to be there. Logbook makes no claim about making any model perform better.

| ID | Promise |
|---|---|
| **LG1** | **You can work your goals in any order.** Nothing in Logbook behaves differently because you finished the third one first |
| **LG2** | **However you work, you can record.** Anything holding a thread's identifier can write to it. No kind of record is reachable only through one working style, and for the same recorded content no style reaches a limit sooner than another |
| **LG3** | **Logbook never invents a value you did not give it.** Anything you left out — including which goal an item belongs to — is stored as absent and reported back as absent, and no stored link points at something that does not resolve |
| **LG4** | **Your code is never stored.** No file contents, no diffs, no source. Git already holds those, and Logbook hands you back to git rather than copying it |
| **LG5** | **What you write is what is stored, or the write is refused.** Where a value has to be transformed on the way in, the transform is declared and can be undone. **One exception, which this build does not yet close:** a line break, and certain other characters, are stored as a written-out token such as `U+000A` — and text that already contained that token as ordinary characters is stored in exactly the same way, so when the value is read back the two cannot be told apart. That overlap is known and tracked |
| **LG6** | **When you read a record you see all of it.** No piece of text is stored that no surface ever shows you |
| **LG7** | **You can find any record without guessing.** Every kind of record has an identifier you can list and then ask for directly |
| **LG8** | **No display rule drops an item in silence.** Where something is left out, the output says how many were left out and gives the address that fetches them |
| **LG9** | **Anything that shortens text says that it shortened it**, and shortens only as far as its budget forces |
| **LG10** | **Logbook never scores, ranks or prioritises your records.** What you recorded is what you get back |
| **LG11** | **A crash puts at most one step's work at risk.** Everything recorded before it has already landed as a commit |
| **LG12** | **You never have to remember to close the session.** Logbook does not depend on a tidy-up step you might forget |
| **LG13** | **Reading one record never gets slower as your history grows** |
| **LG14** | **What Logbook loads is bounded by the work still open, not by everything ever recorded** — and nothing is deleted to keep it that way |
| **LG15** | **Nothing recorded is ever rewritten or deleted.** Correcting a decision means recording a new one that names the old; the old one stays readable |
| **LG16** | **Logbook never runs anything it stores.** Records can arrive from a shared remote, and none of them can execute on your machine |
| **LG17** | **A goal counts as finished only when you record how you know.** Marking one done asks what was observed, and whether the check behind it was actually run |

## What Logbook does not do

These are non-goals — things deliberately not built, each with its reason. They are held by decision records and review, not by an automated check. The grounds are recorded in full in `docs/specs/2026-08-28-continuity-goal-model.md`, section 3.2.

| Not a goal | Why |
|---|---|
| **Two sessions on one project at the same time** | Deliberate. Logbook is single-session-per-project by design. That is a limit, stated here rather than left for you to discover |
| A search, vector or embedding layer | Less accurate than the plain record set at this scale, it fails the simplicity constraint, and it was measured to reduce how much an agent used material it had already been handed |
| A multi-level index over the records | Measured worse than the flat one it would replace |
| Event sourcing, or projections over the ledger | Hard in ways that are well documented, and it fails the simplicity constraint outright |
| Automatic capture of file edits, diffs, tool calls or test runs | Duplicates what git already holds; records actions rather than reasons, so it cannot supply the why; and it widens what leaves your machine |
| Summarising or consolidating stored records with a model | Measured to lose compliance with recorded constraints, and to corrupt records that had been correct |
| Pruning, archiving or deleting records to control growth | Growth is bounded by leaving settled work out of the surfaces that load it, never by destroying history |
| An importance scorer or ranking system | The forcing function is the existing refusal when a cap is reached; a coarse scorer propagates its own errors |
| A model that judges whether a goal is genuinely complete | An agent assessing its own work makes false completion claims, and a second model checking that claim scores at or near chance. Ground truth comes from state, never testimony — and this plugin's server has no model access at all |
| Enforcement machinery over the content of a gated record | Measured and withdrawn: an inert gate and an enforced gate produced a runnable check equally often |

## Requirements

Node.js **22.19 or newer** (`package.json:8-9`).

That floor is one minor above the lowest Node version that can actually load this plugin's TypeScript source, because it is driven by a **developer-only** constraint, not by anything an installed plugin user hits:

1. `.npmrc:1` sets `engine-strict=true`. This guards the **developer** workflow: cloning the repository and running `npm install` yourself. A plugin user installed through Claude Code's marketplace flow (see Installation below) never runs `npm install`, so this check never runs for them. The 22.19 figure itself comes from two `devDependencies` that only a developer ever installs — `@modelcontextprotocol/inspector` and its transitive dependency `undici` — which each declare `engines.node: ">=22.19.0"`; `engine-strict` turns that into a hard failure on anything older when a developer or CI runs `npm ci`/`npm install`.
2. A runtime guard, `nodeFloorFailure` (`src/runtime/node-floor.ts:30-34`), runs at the top of the MCP server entrypoint (`bin/logbook-server.ts:24-28`) and inside every hook's stdin-reading helper (`hooks/lib/io.ts:39-43`), and where it does run, it writes a clear message to stderr and exits with code 1. Its reach is narrower than that description implies: below Node 22.18.0, loading a `.ts` entry point fails during module resolution — before any code in that file, including this guard, has a chance to run. In practice the guard fires in two bands below the declared 22.19 floor: Node 22.6 through 22.17.x with `--experimental-strip-types` passed explicitly, and — because this plugin's declared floor sits one minor above what Node itself requires — flag-free Node 22.18.0 through 22.18.x as well, a version where Node can already load the `.ts` entry point on its own. Outside those two bands, it is Node itself that refuses the file, with Node's own error rather than this plugin's.

This plugin ships TypeScript source directly — everything under `src/`, `bin/`, and `hooks/` is a `.ts` file, and there is no compiled JavaScript output (`tsconfig.json:12` sets `noEmit: true`; no `dist/` directory exists anywhere in the tree). Node runs `.ts` files itself through "type stripping" — erasing TypeScript's type syntax without compiling it — and that became available without a command-line flag in Node 22.18.0 (and separately in 23.6.0) ([Node.js TypeScript docs](https://nodejs.org/api/typescript.html)). A plugin user on Node 22.18.x can therefore already load and run this plugin's entry points at the interpreter level; the runtime guard rejects that version anyway, so its threshold tracks the same 22.19 figure declared in `package.json:8-9` rather than the lower value Node itself would tolerate. `tsconfig.json:9` further restricts the source to syntax that stripping alone can erase (`erasableSyntaxOnly: true`), matching what Node's stripper actually supports.

## Installation

This repository is itself a Claude Code plugin marketplace. `.claude-plugin/marketplace.json:1-12` declares a marketplace named `logbook`, owned by `SatanshuMishra`, listing exactly one plugin — also named `logbook` — sourced from the repository root (`"source": "./"`).

Installing from a marketplace is two separate steps in Claude Code, per Anthropic's own documentation ([Discover and install plugins](https://code.claude.com/docs/en/discover-plugins)):

1. Register the marketplace: `/plugin marketplace add <path-to-a-clone-of-this-repo>`. A local path works; a hosted git repository works too, as `owner/repo` on GitHub or a full git URL elsewhere.
2. Install the plugin it lists: `/plugin install logbook@logbook`.

What the repository does not state: neither `.claude-plugin/plugin.json:1-9` nor `.claude-plugin/marketplace.json:1-12` declares a canonical hosted URL for this project (no `repository` or `homepage` field). The exact `owner/repo` form of step 1 is **[unverified]** from the repository's own tracked content — install from the path to your own clone.

## What ships

| Path | Holds |
|---|---|
| `bin/` | The two entry points: the MCP server (`bin/logbook-server.ts`) and a CLI (`bin/logbook-cli.ts`) |
| `hooks/` | Six lifecycle hooks — `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionEnd`, `Stop` — wired in `hooks/hooks.json:1-28`, plus their shared helpers under `hooks/lib/`. There is deliberately no `PreCompact` hook; a dedicated test enforces its absence (`test/hooks/precompact-absent.test.ts:7-18`). |
| `src/` | The TypeScript source, organized by feature: `schema/` (validated record shapes), `domain/` (thread-lifecycle rules), `store/` (the storage engine), `server/` (the MCP server and its tools), `hooklib/` (hook support code, including the write guard), `merge/` (multi-clone sync and conflict resolution), `render/` (text rendering for briefings and rosters), `runtime/` (process-level helpers, including the Node floor check), `cli/` (session-start/session-end helpers) |
| `skills/` | Two Claude Code skills, `preflight` and `debrief`, each one `SKILL.md` (`skills/preflight/SKILL.md`, `skills/debrief/SKILL.md`) |
| `test/` | The automated suite, split by concern: `unit/`, `store/`, `contract/`, `sync/`, `spawn/`, `hooks/` |
| `scripts/` | Development-time scripts: git-hook installation, a packaging check, an audit-markdown generator |
| `docs/` | Development documentation. Includes `docs/specs/`, `docs/audits/`, and `docs/rules/` — the last of these holding the standing continuity rule this repository authors for an operator to install |
| `.claude-plugin/` | The plugin manifest (`plugin.json`) and the marketplace manifest (`marketplace.json`) |

At the repository root: `package.json`, `tsconfig.json`, `.npmrc`, `.mcp.json` (declares the MCP server under the server key `ledger`, `.mcp.json:3`, pointing at `bin/logbook-server.ts`, `.mcp.json:5`), `stryker.config.json`, `inspector.config.json`.

The MCP server registers twelve tools, listed in one place: `src/server/tools/index.ts:15-28` (`open_thread`, `update_thread`, `close_thread`, `amend_criteria`, `bind_branch`, `resume_thread`, `park_thread`, `record_decision`, `log_session_event`, `sync_ledger`, `resolve_conflict`, `list_threads`).

## How the ledger is stored

Everything lives under one root: `<CLAUDE_PLUGIN_DATA>/<projectKey>`, where `projectKey` is the first 32 hex characters of a SHA-256 hash of the project's canonicalized absolute path (`src/store/project-key.ts:3-4`, used at `src/store/layout.ts:77-78`).

Two things sit under that root:

- **`records/`** — a plain directory of JSON files: `threads/<id>.json`, `decisions/<id>.json`, `sessions/<thread-id>/<id>.json` (`src/store/layout.ts:79`; paths built at `src/store/records.ts:51-55`). This is the readable working copy.
- **`state/`** — small pointer and bookkeeping files, including `origin.json`, which records the real project path (`src/store/layout.ts:80,88-91`).

The durable half is git-native. Every write to the working copy also lands as a commit on a dedicated ref, `refs/logbook/ledger` (`src/store/ref.ts:6`) — and that ref lives directly inside the **host project's own `.git`**, not a separate repository. Every git call in the write path runs `git -C <project-root> ...` (`src/store/git.ts:68`), with the project root passed as `layout.projectRoot` (`src/store/write-path.ts:77,85,97,106,195,206`); the host project must already be a git repository for this to work.

There is **no worktree**. Building a commit uses raw git plumbing against a throwaway index file rather than checking anything out: `read-tree`, `hash-object`, `update-index`, and `write-tree` build a tree object, then `commit-tree` and `update-ref` land it (`src/store/write-path.ts:75-111,190-208`). Nothing is ever checked out to a working directory for this ref.

Concurrent writers are handled with compare-and-swap: `update-ref` is called with the previous commit it expects to be replacing. A write that loses the race re-reads both the ref and the record it is about to rewrite before retrying, and refuses rather than retrying when that record changed underneath it; it retries up to 5 times (`src/store/ref.ts:15-23`; `src/store/write-path.ts:29,175-221`).

## Protection and its limits

Writes are guarded on the way in. `src/hooklib/guard.ts` is called by the `PreToolUse` hook (`hooks/pre-tool-use.ts:1-23`), which only ever fires for `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, and the ledger's own MCP tools — every other tool is outside its matcher (`hooks/hooks.json:9-14`).

| Situation | Verdict | Where |
|---|---|---|
| Tool name matches the ledger MCP pattern (`mcp__ledger__*` / `mcp__plugin_logbook_ledger__*`) **and** its suffix is a registered tool name | `allow` — auto-approved | `src/hooklib/guard.ts:15,17-21,97-99` |
| A write tool's target path resolves inside the store root | `deny` | `src/hooklib/guard.ts:23,113-117` |
| A `Bash` command's text names the ledger ref, `CLAUDE_PLUGIN_DATA`, or a path inside the store root | `ask` — Claude Code prompts before running it | `src/hooklib/guard.ts:75-76,127-129` |
| The store root can't be verified on disk | `deny` for a write tool, `ask` for `Bash` | `src/hooklib/guard.ts:107-111` |
| Anything else | `silent` — no verdict, the tool proceeds | `src/hooklib/guard.ts:103,106,116,128` |

The guard says what it is, in its own text: *"this guard prompts for confirmation and is not a security boundary"* (`src/hooklib/guard.ts:24`, repeated in every `ask`/`deny` message it returns, e.g. `:110,124,129`).

Confirmed gaps, each grounded in the current guard:

1. **The plugin's own registered MCP tools are trusted completely, and the server they came from is not checked.** A tool name whose prefix matches the ledger pattern and whose suffix is a name this server actually registers is `allow`ed with no inspection of its arguments (`src/hooklib/guard.ts:15,17-21,97-99`). Checking the name against the registry narrows the surface and does not close it, because the PreToolUse event carries no server identity: a hostile server keyed `ledger` exposing a tool named `open_thread` still auto-approves. This hook is not a second check on the plugin's own writes — only on everything else that might touch the store.
2. **An unresolvable store is a silent store.** If `CLAUDE_PLUGIN_DATA` can't be resolved to a real root, the guard goes fully silent for every write tool and every `Bash` command — no prompt, no denial (`src/hooklib/guard.ts:54-55,105-106`). It cannot protect a store it cannot locate.
3. **Bash detection reads text, not shell syntax.** It looks for path-shaped substrings in the raw command and resolves each one (`src/hooklib/guard.ts:27,78-81`); a path built through a shell variable, command substitution, or other indirection is invisible to it.
4. **A command naming a strict ancestor of the store root passes with no prompt.** The containment check only matches a resolved path equal to, or nested under, the store root (`src/hooklib/guard.ts:45-49`); a command naming the whole plugin-data directory, for example, is shorter than that check and evades it.
5. **No distinction between a read and a write.** Every `Bash` command that touches the store gets the same `ask`, destructive or not (`src/hooklib/guard.ts:127-129`). The prompt is the entire protection; a prompt approved out of habit protects nothing.

## Development

There is no build script. Nothing here compiles the TypeScript — `npm test` and the server itself both run the `.ts` files directly (see Requirements above).

| Script | Command | What it does |
|---|---|---|
| `npm test` | `node --test "test/unit/**/*.test.ts" "test/store/**/*.test.ts" "test/contract/**/*.test.ts" "test/sync/**/*.test.ts" "test/spawn/**/*.test.ts" "test/hooks/**/*.test.ts"` | Runs the suite with Node's built-in test runner, against the TypeScript sources directly (`package.json:12`) |
| `npm run prepare` | `node scripts/install-githooks.mjs` | Installs this repository's local git hooks — npm's `prepare` lifecycle script (`package.json:13`) |
| `npm run typecheck` | `tsc -p tsconfig.json --noEmit` | Type-checks the whole tree without emitting output (`package.json:14`) |
| `npm run inspect` | `mcp-inspector --config inspector.config.json --server logbook` | Opens the MCP Inspector against this server (`package.json:15`) |
| `npm run inspect:cli` | `mcp-inspector --cli --config inspector.config.json --server logbook --method tools/list` | Lists the server's tools from the command line (`package.json:16`) |
| `npm run mutate` | `stryker run stryker.config.json` | Runs mutation testing (`package.json:17`) |
| `npm run coverage` | `node --experimental-test-coverage --test "test/unit/**/*.test.ts"` | Runs the unit suite with coverage instrumentation (`package.json:18`) |
