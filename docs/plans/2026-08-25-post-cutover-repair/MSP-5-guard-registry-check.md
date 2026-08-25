# MSP-5 — The write guard checks the registry

## 0. Identity

| Field | Value |
| --- | --- |
| **Closes** | Defect D9 — the write guard auto-approves on a name shape, not registry membership. Also closes criterion 4 of the post-cutover repair. |
| **Depends on** | MSP-0. That pull request does two things this one needs. It removes a zero byte from `src/server/tools/resolve_conflict.ts`, without which that file is binary to search tools while this pull request adds a census axis over the tool source directory; and it removes the version literal from `test/contract/cutover-manifests-agree.test.ts`, without which this pull request's version bump turns `npm test` red. Section 11 stop conditions 1 and 12 are the concrete checks, one per fact. |
| **Required by** | Nothing. |
| **Branch name** | `fix/msp-5-guard-registry-check`, cut from `main`. The pull request targets `main`. |
| **Version bump** | Baseline `1.0.5` -> `1.0.6` per orchestrator ruling O1. The step in section 4 is written as a read-then-increment, so a shifted ladder does not invalidate it. It moves exactly two files; no test file carries a version literal, and this pull request must not add one back. |
| **Diff size** | 211 changed or added lines of source and tests, plus 17 lines of documentation and 2 version lines. Under the 400-line ceiling, so this MSP is **not** split. |
| **SPEC anchors** | Section 7 MSP-5; section 6 ruling R7; section 5 defect D9; section 4 invariants I1, I4, I5, I7, I8, I9. Provenance only — you do not need to open the SPEC. Everything from it that binds this work is quoted verbatim below. |

**Definitions, because this plan assumes no prior knowledge.**

- **MCP.** Model Context Protocol. A way for an editor to talk to a separate tool server. Each
  server is registered in the editor under a short key; this repository's server is registered
  under the key `ledger`.
- **Tool name on the wire.** When the editor calls a tool it composes a name from the server key
  and the tool: `mcp__ledger__open_thread`, or `mcp__plugin_logbook_ledger__open_thread` when
  the server arrives through a plugin. The part after the last `ledger__` is the bare tool name.
- **PreToolUse hook.** A program the editor runs before a tool call, which can answer `allow`
  (skip the confirmation prompt), `deny`, `ask`, or say nothing at all. This repository's is
  `hooks/pre-tool-use.ts`, and its decision logic is `src/hooklib/guard.ts`.
- **The registry.** The list of tools this server actually publishes, built in
  `src/server/tools/index.ts` and re-exported as `ALL_TOOLS` from `src/server/register.ts`.
- **Census.** A test that enumerates a complete population, classifies every member, and fails
  if any member is *forbidden* or *unclassifiable*. It halts on anything it has no rule for
  rather than ignoring it. The helper is `test/support/census.ts`.
- **Spawn.** Starting a separate operating-system process. The guard runs once per guarded tool
  call, so it must start no process and read no file at import time.

---

## 1. Acceptance criteria (the ceiling)

Verbatim from SPEC section 7, MSP-5:

> **Acceptance:**
> 1. A test drives every name in the **live** registry, in both prefix forms, and asserts `allow`;
>    then drives a set of prefixed non-registered names — including `read_decision`,
>    `get_resume_brief`, `rebuild_index`, `reconcile` and the names from the deleted `d57d9ee` test —
>    and asserts none is allowed. The second block is red on the parent.
> 2. `test/hooks/guard-in-process.test.ts` stays green, including its zero-spawn assertion.
> 3. The registry census halts when a name is registered but not guard-approved, and when a name is
>    guard-approved but not registered. Both directions carry a control proving the census
>    discriminates.
> 4. Inertness: reverting to the bare pattern test turns criterion 1's second block red.
> 5. The PR body states that this narrows the surface and does not close it, because the PreToolUse
>    event carries no server identity.
> 6. `npm test` green.

These six criteria are the complete definition of done for this pull request. Anything you
discover above them goes to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item
with its evidence, and is **not** folded into this change.

Which step discharges which criterion:

| Criterion | Discharged by |
| --- | --- |
| 1 | Section 5.1, tests `hook.guard.registry.every-registered-tool-is-auto-approved-in-both-prefix-forms` and `hook.guard.registry.a-prefixed-name-that-is-not-registered-is-not-approved`. Red on the parent is proved in section 6. |
| 2 | Section 8, command V3. That file is not modified by this plan. |
| 3 | Section 5.2, the two new control tests `...registry-census-halts-on-a-name-registered-but-not-guard-approved` and `...registry-census-halts-on-a-name-guard-approved-but-not-registered`, plus the existing positive control. |
| 4 | Section 7. |
| 5 | Section 4 step 5 (the README) and section 10 (the pull request body). |
| 6 | Section 8, command V5. Reaching it requires the prerequisite in section 0 to have merged; section 11 stop condition 12 is the check. |

---

## 2. Ground truth

### 2.1 `src/hooklib/guard.ts:14` and `:86-92` — the defect

Current file, lines 1-20 and 86-98, verbatim:

```ts
import { realpathSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { LEDGER_REF } from '../store/ref.ts'
import { errnoCode } from '../store/detail.ts'

export type GuardVerdict =
  | { kind: 'allow'; reason: string }
  | { kind: 'ask'; reason: string }
  | { kind: 'deny'; reason: string }
  | { kind: 'silent' }

export const LEDGER_TOOL_PATTERN = /^mcp__(?:plugin_logbook_)?ledger__[A-Za-z][A-Za-z0-9_]*$/

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const NOT_A_BOUNDARY = 'this guard prompts for confirmation and is not a security boundary'
const USE_TOOLS = 'to write the ledger, use the ledger MCP tools (mcp__ledger__* or mcp__plugin_logbook_ledger__*)'
const CLAUDE_PLUGIN_DATA_TOKEN = /(?<![A-Za-z0-9_])CLAUDE_PLUGIN_DATA(?![A-Za-z0-9_])/
const PATH_TOKEN_PATTERN = /[^\s"'`]*\/[^\s"'`]*/g
```

```ts
export const guardDecision = (rt: Runtime, raw: unknown): GuardVerdict => {
  const event = parsePreToolUseEvent(raw, rt.cwd)
  if (event === null) return { kind: 'silent' }

  if (LEDGER_TOOL_PATTERN.test(event.tool_name)) {
    return { kind: 'allow', reason: 'a logbook ledger tool call, auto-approved' }
  }

  const isWriteTool = WRITE_TOOLS.has(event.tool_name)
  const isBash = event.tool_name === 'Bash'
  if (!isWriteTool && !isBash) return { kind: 'silent' }

  const storeRoot = resolveStoreRoot(rt, event.cwd)
```

**What is wrong with it.** The branch at line 90 tests only the *shape* of the name. Any name
matching `mcp__ledger__<something>` or `mcp__plugin_logbook_ledger__<something>` is auto-approved
without the guard ever resolving the store root at line 98 and without reading a single
argument. Observed, running the shipped module against a temp fixture store with
`CLAUDE_PLUGIN_DATA` unset entirely:

```
allow   | CLAUDE_PLUGIN_DATA unset + prefixed unregistered name
```

The name driven there was `mcp__ledger__totally_made_up`, which this server does not register.

### 2.2 `src/server/tools/index.ts` — the registry barrel

Current file, all 28 lines, verbatim:

```ts
import type { ToolSpec } from '../register.ts'
import { openThreadTool } from './open_thread.ts'
import { updateThreadTool } from './update_thread.ts'
import { closeThreadTool } from './close_thread.ts'
import { amendCriteriaTool } from './amend_criteria.ts'
import { bindBranchTool } from './bind_branch.ts'
import { resumeThreadTool } from './resume_thread.ts'
import { parkThreadTool } from './park_thread.ts'
import { recordDecisionTool } from './record_decision.ts'
import { logSessionEventTool } from './log_session_event.ts'
import { syncLedgerTool } from './sync_ledger.ts'
import { resolveConflictTool } from './resolve_conflict.ts'
import { listThreadsTool } from './list_threads.ts'

export const TOOL_SPECS: ToolSpec<never, never>[] = [
  openThreadTool,
  updateThreadTool,
  closeThreadTool,
  amendCriteriaTool,
  bindBranchTool,
  resumeThreadTool,
  parkThreadTool,
  recordDecisionTool,
  logSessionEventTool,
  syncLedgerTool,
  resolveConflictTool,
  listThreadsTool
] as unknown as ToolSpec<never, never>[]
```

**What is wrong with it.** Nothing is wrong with this file's behaviour. It is listed here
because it is the single place the twelve tool names exist, and ruling R7 requires it to import
the same names-only module the guard imports, so that the two lists cannot silently diverge.

### 2.3 `test/hooks/guard-in-process.test.ts:40-44` — the zero-spawn constraint

Verbatim, lines 40-45:

```ts
test('guard.is-in-process', async () => {
  const { counts, restore } = installSpawnCounters()
  try {
    const { guardDecision } = await import('../../src/hooklib/guard.ts')
    const { layoutFor, createStoreDirectories } = await import('../../src/store/layout.ts')
    const { testRuntime } = await import('../support/runtime.ts')
```

and its two assertions, lines 72-73:

```ts
    assert.equal(counts.gitSpawns, 0, 'expected guardDecision to spawn a "git" subprocess zero times')
    assert.equal(counts.totalSpawns, 0, 'expected guardDecision to spawn any subprocess zero times')
```

**What this constrains.** The counters are installed *before* the guard is imported, so anything
the guard's import graph does at load time is counted. Whatever the guard imports to learn the
tool names must therefore start no process. Measured: importing the guard costs about 37 ms with
zero spawns, and importing `src/server/tools/index.ts` costs a further 44 ms, because the barrel
pulls in `zod` and the MCP SDK for what is, to the guard, a list of twelve strings. That is why
the names live in their own module rather than being read from the barrel — it makes the
zero-spawn property structural rather than measured. This file is **not modified** by this plan.

### 2.4 `test/support/published.ts:72-99` — the three-way census this plan extends

Verbatim, lines 72-99:

```ts
export type RegistryCensus = { files: readonly string[]; registered: readonly string[]; published: readonly string[] }

const TOOLS_BARREL_PATH = join(TOOLS_DIR, `${BARREL_BASENAME}.ts`)

const importToolBarrel = async (): Promise<void> => {
  if (!existsSync(TOOLS_BARREL_PATH)) return
  await import(pathToFileURL(TOOLS_BARREL_PATH).href)
}

export const readRegistryCensus = async (s: SpawnedServer): Promise<RegistryCensus> => {
  await importToolBarrel()
  const listed = await s.client.listTools()
  return {
    files: toolFileBasenames(TOOLS_DIR),
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: listed.tools.map((tool) => tool.name)
  }
}

export const classifyRegistryName = (name: string, c: RegistryCensus): Verdict => {
  const inFiles = c.files.includes(name)
  const inRegistered = c.registered.includes(name)
  const inPublished = c.published.includes(name)
  return inFiles && inRegistered && inPublished ? 'allowed' : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published])]
```

**How this census works, in plain terms.** It builds three lists of names for the same twelve
tools, from three independent places:

| Axis | Source | Built by |
| --- | --- | --- |
| `files` | the file names in `src/server/tools/`, minus `index` | `toolFileBasenames`, `test/support/published.ts:64-70` |
| `registered` | the `name` field of each entry in `ALL_TOOLS` | `src/server/register.ts:32` |
| `published` | the names a freshly spawned server answers `listTools` with | the MCP client |

`registryPopulation` unions all three, so a name present on **any** axis enters the population.
`classifyRegistryName` returns `allowed` only when the name is on **every** axis, and
`unclassifiable` otherwise — so a name on some axes but not others halts the census. There is no
allowlist and no pinned count anywhere in it.

**What is missing.** There is no axis for what the guard approves. Adding a fourth axis is what
closes the drift this pull request would otherwise introduce: a tool registered but not
guard-approved would quietly lose auto-approval, and nothing would say so.

### 2.5 `test/contract/published-schema.test.ts:348-372` — the census's existing controls

Verbatim, lines 348-372:

```ts
test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-missing-from-one-side', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population].sort(), ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-all-three-sides', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['real_tool'])
  assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, syntheticCensus)))
})
```

**What is wrong with them.** Nothing, except that both construct a `RegistryCensus` literal.
Adding a required fourth field to that type makes both stop compiling, so both must be updated
in the same change. The second one's name also says "three sides", which stops being true.

### 2.6 The deleted membership check, at commit `d57d9ee`

This check existed once and was deleted by the cutover commit `a375f85`. It is quoted because
SPEC section 7 MSP-5 names its tests as the source of the negative-case names. The module was
`hooks/lib/pre-tool-use.mjs`, in the JavaScript tree that no longer exists:

```js
let registeredToolNames = null;

async function isRegisteredLedgerTool(toolName) {
  const match = LEDGER_TOOL.exec(toolName);
  if (match === null) {
    return false;
  }
  if (registeredToolNames === null) {
    const { TOOLS } = await import(TOOL_REGISTRY);
    registeredToolNames = new Set(TOOLS.map((tool) => tool.name));
  }
  return registeredToolNames.has(match[1]);
}
```

Its negative-case test, verbatim:

```js
test('handlePreToolUse does not auto-approve a foreign tool on a ledger-named server', async () => {
  const foreign = [
    'mcp__ledger__drop_database',
    'mcp__ledger__exec',
    'mcp__plugin_session-continuity_ledger__exec',
    'mcp__ledger__',
    'mcp__ledger__open_thread_extra',
  ];
  for (const toolName of foreign) {
    const ctx = { input: { tool_name: toolName }, env: {}, projectDir: PROJECT_DIR };
    assert.deepEqual(await handlePreToolUse(ctx), {}, toolName);
  }
});
```

All five of those literals appear in the new test in section 5.1. The load-bearing one is
`mcp__ledger__open_thread_extra`: it is a real tool name with a suffix appended, and it is the
single case that fails if the restored check uses a prefix comparison instead of exact
membership.

### 2.7 The two version manifests

`package.json`, line 3, and `.claude-plugin/plugin.json`, line 3, both read, in the tree this
plan was written against:

```json
  "version": "1.0.0",
```

**What is wrong with them.** Nothing. They are listed because invariant I4 requires them to move
together in one commit, which section 4 step 6 does.

**Note.** Those `1.0.0` values are the baseline of the repair ladder. By the time this pull
request runs, the earlier rungs will have raised them. Section 4 step 6 reads whatever is there
and increments it, so a higher starting version is expected and is not an error.

**`test/contract/cutover-manifests-agree.test.ts` is NOT touched by this pull request.** That
file once carried a hard-pinned version literal on line 8, and every version bump broke it. It
was de-pinned once and permanently by the pull request that removes the zero byte from
`src/server/tools/resolve_conflict.ts` — the same prerequisite named in section 0. This pull
request writes no edit to that file, and section 11 carries a runnable check that the de-pin
already landed.

---

## 3. Divergences from the SPEC

### 3.1 The names-only module goes at `src/server/tool-names.ts`, not inside `src/server/tools/`

SPEC section 7 MSP-5 describes the change as *"a names-only module under `src/server/tools/`"*.
Putting it there breaks the very census this pull request extends.

`toolFileBasenames` (`test/support/published.ts:64-70`) enumerates **every** `.ts` file in
`src/server/tools/` and excludes exactly one basename, `index`. A file `names.ts` in that
directory therefore enters the `files` axis as the name `names`, which is on no other axis, so
`classifyRegistryName` returns `unclassifiable` and the census halts.

This was measured, not reasoned. With the module placed at `src/server/tools/names.ts`, the
production census test fails:

```
✖ contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent
  AssertionError [ERR_ASSERTION]: Got unwanted exception.
  Actual message: "census halted on an unclassifiable item: "names""
```

**Ruling applied.** The module goes at `src/server/tool-names.ts` — a sibling of the `tools/`
directory, not inside it. Ruling R7's own words are location-agnostic: *"A dedicated module
exports the tool names, imported by both `src/server/tools/index.ts` and
`src/hooklib/guard.ts`."* Both of those imports still hold, and none of the six acceptance
criteria mentions the module's path.

Rejected alternative: keep the module at `src/server/tools/names.ts` and add `names` to the
basename exclusion beside `index`. Rejected in one line — invariant I8 states *"A census that
halts is answered by classifying the new item, never by excluding it from the population,
pinning a count, or adding it to an allowlist,"* and a second excluded basename is exactly that
allowlist.

### 3.2 The negative-case list carries both namespace spellings

SPEC section 7 MSP-5 says the negative block includes *"the names from the deleted `d57d9ee`
test"*. At `d57d9ee` the third literal was `mcp__plugin_session-continuity_ledger__exec`, under
the plugin's former name. By the deletion commit `a375f85` it had become
`mcp__plugin_logbook_ledger__exec`.

**Ruling applied.** The new test drives **both** spellings. The `d57d9ee` one is the SPEC's
named source; the `a375f85` one is the live namespace and the only one of the two that the
current pattern matches, so it is the one that is actually red on the parent. Including both
costs one line and loses nothing.

### 3.3 A non-registered ledger-prefixed name falls through to `silent`, not to `ask`

Neither ruling R7 nor any acceptance criterion says what verdict replaces `allow`. Criterion 1
requires only that "none is allowed".

**Ruling applied.** The name simply stops matching the auto-approve branch and falls through the
rest of `guardDecision` unchanged. Since such a name is not in `WRITE_TOOLS` and is not `Bash`,
it reaches `if (!isWriteTool && !isBash) return { kind: 'silent' }` and the guard says nothing,
leaving the editor's ordinary permission flow to handle it. That is the correct meaning of "this
hook has no opinion".

Rejected alternative: return `ask` for a ledger-prefixed name that is not registered. Rejected
in one line — it would raise a confirmation prompt for every tool of every unrelated MCP server
a user happens to key `ledger`, which is a behaviour change nobody asked for and which is above
this MSP's ceiling.

### 3.4 The ladder lands on 1.1.1, not 1.1.0

SPEC section 7 states the ladder lands on `1.1.0`. Per orchestrator ruling O2 the documentation
MSP merges last and the ladder lands on `1.1.1`. This changes nothing in this plan; it is
restated so no reader reconciles the two numbers themselves.

### 3.5 The pull request tool path

SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`. There is no `.claude/lib`
directory in this repository. The tool is the operator's global one at
`node ~/.claude/lib/git/pr.mjs pr-create`, and section 10 uses that path.

### 3.6 The version bump moves exactly the two files invariant I4 names

Invariant I4 names `package.json` and `.claude-plugin/plugin.json`, and section 4 step 6 moves
exactly those two. Earlier drafts of the repair ladder also had every pull request re-type a
version literal into `test/contract/cutover-manifests-agree.test.ts`; that literal is removed
once, permanently, by the prerequisite pull request named in section 0, so this one does not
touch that file. Section 11 carries the check that it is gone.

### 3.7 The README edit also refreshes the line citations in the block it replaces

SPEC section 7 MSP-5 lists "the README gap list" among the changes. The guard edit in step 3
inserts one import line and a five-line function, which moves every line in `src/hooklib/guard.ts`
after line 6 down by seven and changes the shape of the auto-approve branch. Every citation in
the README's "Protection and its limits" section — the verdict table, the disclaimer sentence
and all five gaps — would then point at the wrong lines.

**Ruling applied.** Step 5 replaces that block as one unit with every citation corrected. Fixing
citations this change itself invalidates is not scope creep; leaving them would be shipping a
document known to be wrong about the file in this diff. Citations **outside** that block are not
touched, and none of them refers to `src/hooklib/guard.ts`.

---

## 4. The change, step by step

Apply these in order. After each step the tree is type-correct, except that steps 2, 3 and 4
each depend on step 1 having created the new module — so run 1 through 4 before typechecking.

Every command in this plan is run from the repository root,
`/Users/satanshumishra/Documents/DevLabs/logbook`.

### Step 0 — cut the branch

File: none. Command:

```
git switch -c fix/msp-5-guard-registry-check main
```

Expected: exit code `0`, and stdout or stderr contains
`Switched to a new branch 'fix/msp-5-guard-registry-check'`.

### Step 1 — create the names-only module

File: `src/server/tool-names.ts`. Operation: **CREATE**.

This file does not exist. Create it with exactly these contents, first character to last:

```ts
export const LEDGER_TOOL_NAMES = [
  'open_thread',
  'update_thread',
  'close_thread',
  'amend_criteria',
  'bind_branch',
  'resume_thread',
  'park_thread',
  'record_decision',
  'log_session_event',
  'sync_ledger',
  'resolve_conflict',
  'list_threads'
] as const

export type LedgerToolName = (typeof LEDGER_TOOL_NAMES)[number]

export const isLedgerToolName = (candidate: string): candidate is LedgerToolName =>
  (LEDGER_TOOL_NAMES as readonly string[]).includes(candidate)
```

Rationale: ruling R7 states *"A dedicated module exports the tool names, imported by both
`src/server/tools/index.ts` and `src/hooklib/guard.ts`. Importing `ALL_TOOLS` directly was
measured to work at ~37 ms with zero spawns, but couples the hook's import graph to `zod` and
the MCP SDK for a list of twelve strings. The names-only module makes the guard's zero-spawn
property structural rather than measured."* This file imports nothing at all, so no import of it
can start a process.

The names are in the same order as the entries of `TOOL_SPECS` in `src/server/tools/index.ts`
today, because step 2 makes this array drive the registration order.

`isLedgerToolName` is written as a type guard so the guard module gets a boolean and the barrel
gets exhaustiveness, from one declaration. The cast `(LEDGER_TOOL_NAMES as readonly string[])`
is required because `.includes` on a tuple of string literals will not accept an arbitrary
`string` argument.

No comments anywhere. Invariant I5.

### Step 2 — make the barrel import the names module

File: `src/server/tools/index.ts`. Operation: **REPLACE**.

FIND (exact, and the only occurrence in the file):

```ts
import type { ToolSpec } from '../register.ts'
import { openThreadTool } from './open_thread.ts'
```

REPLACE (exact):

```ts
import type { ToolSpec } from '../register.ts'
import { LEDGER_TOOL_NAMES, type LedgerToolName } from '../tool-names.ts'
import { openThreadTool } from './open_thread.ts'
```

Then, in the same file:

FIND (exact, and the only occurrence in the file):

```ts
export const TOOL_SPECS: ToolSpec<never, never>[] = [
  openThreadTool,
  updateThreadTool,
  closeThreadTool,
  amendCriteriaTool,
  bindBranchTool,
  resumeThreadTool,
  parkThreadTool,
  recordDecisionTool,
  logSessionEventTool,
  syncLedgerTool,
  resolveConflictTool,
  listThreadsTool
] as unknown as ToolSpec<never, never>[]
```

REPLACE (exact):

```ts
const SPEC_BY_NAME = {
  open_thread: openThreadTool,
  update_thread: updateThreadTool,
  close_thread: closeThreadTool,
  amend_criteria: amendCriteriaTool,
  bind_branch: bindBranchTool,
  resume_thread: resumeThreadTool,
  park_thread: parkThreadTool,
  record_decision: recordDecisionTool,
  log_session_event: logSessionEventTool,
  sync_ledger: syncLedgerTool,
  resolve_conflict: resolveConflictTool,
  list_threads: listThreadsTool
} satisfies Record<LedgerToolName, { name: string }>

export const TOOL_SPECS: ToolSpec<never, never>[] = LEDGER_TOOL_NAMES.map(
  (name) => SPEC_BY_NAME[name]
) as unknown as ToolSpec<never, never>[]
```

After both replacements the whole file must read exactly:

```ts
import type { ToolSpec } from '../register.ts'
import { LEDGER_TOOL_NAMES, type LedgerToolName } from '../tool-names.ts'
import { openThreadTool } from './open_thread.ts'
import { updateThreadTool } from './update_thread.ts'
import { closeThreadTool } from './close_thread.ts'
import { amendCriteriaTool } from './amend_criteria.ts'
import { bindBranchTool } from './bind_branch.ts'
import { resumeThreadTool } from './resume_thread.ts'
import { parkThreadTool } from './park_thread.ts'
import { recordDecisionTool } from './record_decision.ts'
import { logSessionEventTool } from './log_session_event.ts'
import { syncLedgerTool } from './sync_ledger.ts'
import { resolveConflictTool } from './resolve_conflict.ts'
import { listThreadsTool } from './list_threads.ts'

const SPEC_BY_NAME = {
  open_thread: openThreadTool,
  update_thread: updateThreadTool,
  close_thread: closeThreadTool,
  amend_criteria: amendCriteriaTool,
  bind_branch: bindBranchTool,
  resume_thread: resumeThreadTool,
  park_thread: parkThreadTool,
  record_decision: recordDecisionTool,
  log_session_event: logSessionEventTool,
  sync_ledger: syncLedgerTool,
  resolve_conflict: resolveConflictTool,
  list_threads: listThreadsTool
} satisfies Record<LedgerToolName, { name: string }>

export const TOOL_SPECS: ToolSpec<never, never>[] = LEDGER_TOOL_NAMES.map(
  (name) => SPEC_BY_NAME[name]
) as unknown as ToolSpec<never, never>[]
```

Rationale: this satisfies the half of ruling R7 that says the names module is *"imported by
both `src/server/tools/index.ts` and `src/hooklib/guard.ts`"*, and the import is load-bearing
rather than decorative — `LEDGER_TOOL_NAMES` now determines the registration order.

`satisfies Record<LedgerToolName, { name: string }>` is a compile-time check in both directions,
at no run-time cost. Both directions were measured:

- Remove a key from `SPEC_BY_NAME` and `npm run typecheck` reports
  `error TS1360: Type '{...}' does not satisfy the expected type 'Record<"open_thread" | ... | "list_threads", {...}>'`.
- Add a key that is not in `LEDGER_TOOL_NAMES` and it reports
  `error TS2353: Object literal may only specify known properties, and 'ghost_tool' does not exist in type 'Record<...>'`.

`satisfies` and `as const` are type-only syntax, so they are erased by Node's type stripping and
satisfy `tsconfig.json`'s `erasableSyntaxOnly: true`.

Rejected alternative: have the barrel throw at import time when the two lists disagree.
Rejected in one line — ruling R7 already assigns drift detection to the census, and a second
mechanism for the same thing is above this MSP's ceiling.

### Step 3 — make the guard check registry membership

File: `src/hooklib/guard.ts`. Operation: **REPLACE**, three edits.

**Edit 3a.** FIND (exact, and the only occurrence in the file):

```ts
import { errnoCode } from '../store/detail.ts'
```

REPLACE (exact):

```ts
import { errnoCode } from '../store/detail.ts'
import { isLedgerToolName } from '../server/tool-names.ts'
```

**Edit 3b.** FIND (exact, and the only occurrence in the file):

```ts
export const LEDGER_TOOL_PATTERN = /^mcp__(?:plugin_logbook_)?ledger__[A-Za-z][A-Za-z0-9_]*$/
```

REPLACE (exact):

```ts
export const LEDGER_TOOL_PATTERN = /^mcp__(?:plugin_logbook_)?ledger__([A-Za-z][A-Za-z0-9_]*)$/

const isRegisteredLedgerTool = (toolName: string): boolean => {
  const matched = LEDGER_TOOL_PATTERN.exec(toolName)
  const suffix = matched?.[1]
  return suffix !== undefined && isLedgerToolName(suffix)
}
```

**Edit 3c.** FIND (exact, and the only occurrence in the file):

```ts
  if (LEDGER_TOOL_PATTERN.test(event.tool_name)) {
    return { kind: 'allow', reason: 'a logbook ledger tool call, auto-approved' }
  }
```

REPLACE (exact):

```ts
  if (isRegisteredLedgerTool(event.tool_name)) {
    return { kind: 'allow', reason: 'a registered logbook ledger tool call, auto-approved' }
  }
```

Rationale: SPEC section 5 D9 states *"`src/hooklib/guard.ts:14` defines a pattern whose suffix
class is `[A-Za-z][A-Za-z0-9_]*`, and `:90-92` returns `allow` on a match. The branch returns
before `resolveStoreRoot` is called at `:98` and reads zero arguments."* The only change to the
regular expression is a capture group around the existing character class, so every name shape
the pattern accepted or rejected before is accepted or rejected identically; what changes is
that the captured suffix is now checked against the registered names.

`LEDGER_TOOL_PATTERN` carries no `g` flag, so `.exec` holds no position between calls and the
function is safe to call repeatedly. `LEDGER_TOOL_PATTERN` stays exported: nothing else in the
repository imports it, and removing an export is an unrelated change.

After these three edits `src/hooklib/guard.ts` is 130 lines. Confirm with:

```
wc -l src/hooklib/guard.ts
```

Expected stdout to contain `130`, exit code `0`. The README citations written in step 5 depend
on this exact layout; if the count differs, follow section 11.

### Step 4 — add the fourth census axis

File: `test/support/published.ts`. Operation: **REPLACE**, four edits.

**Edit 4a.** FIND (exact, and the only occurrence in the file):

```ts
import { ALL_TOOLS } from '../../src/server/register.ts'
```

REPLACE (exact):

```ts
import { ALL_TOOLS } from '../../src/server/register.ts'
import { LEDGER_TOOL_NAMES } from '../../src/server/tool-names.ts'
```

**Edit 4b.** FIND (exact, and the only occurrence in the file):

```ts
export type RegistryCensus = { files: readonly string[]; registered: readonly string[]; published: readonly string[] }
```

REPLACE (exact):

```ts
export type RegistryCensus = {
  files: readonly string[]
  registered: readonly string[]
  published: readonly string[]
  guardApproved: readonly string[]
}
```

**Edit 4c.** FIND (exact, and the only occurrence in the file):

```ts
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: listed.tools.map((tool) => tool.name)
  }
```

REPLACE (exact):

```ts
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: listed.tools.map((tool) => tool.name),
    guardApproved: [...LEDGER_TOOL_NAMES]
  }
```

**Edit 4d.** FIND (exact, and the only occurrence in the file):

```ts
  const inPublished = c.published.includes(name)
  return inFiles && inRegistered && inPublished ? 'allowed' : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published])]
```

REPLACE (exact):

```ts
  const inPublished = c.published.includes(name)
  const inGuardApproved = c.guardApproved.includes(name)
  return inFiles && inRegistered && inPublished && inGuardApproved ? 'allowed' : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published, ...c.guardApproved])]
```

Rationale: ruling R7 states *"The drift risk the fix introduces — a tool registered but not
guard-approved, losing auto-approval as a quiet permission prompt — is closed by the mechanism
this repo already has. `test/support/published.ts:81-99` runs a three-way census over files,
registry and published list, halting on `unclassifiable`. A fourth axis, `guardApproved`, is
added to that same census. Not a new test, not a pinned count, not an allowlist."*

Because `registryPopulation` now also unions `guardApproved`, a name that is guard-approved but
not registered enters the population and is classified `unclassifiable`, so the census halts in
that direction too. Because `classifyRegistryName` now also requires `inGuardApproved`, a name
that is registered but not guard-approved is classified `unclassifiable`, so it halts in the
other direction. Both directions are required by acceptance criterion 3.

The axis reads `LEDGER_TOOL_NAMES`, which is exactly the list `src/hooklib/guard.ts` consults —
so the axis measures what the guard approves, not a restatement of it. That the guard really
consults this list is proved separately, by the behavioural test in section 5.1.

**This axis is not inert.** Measured: changing one key in `SPEC_BY_NAME` to point at the wrong
tool object — the one drift the compile-time check in step 2 cannot see — turns the production
census red:

```
✖ contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent
```

### Step 5 — correct the README's guard section

File: `README.md`. Operation: **REPLACE**, one edit covering lines 65 to 81.

FIND (exact, and the only occurrence in the file):

```
| Situation | Verdict | Where |
|---|---|---|
| Tool name matches the ledger MCP pattern (`mcp__ledger__*` / `mcp__plugin_logbook_ledger__*`) | `allow` — auto-approved | `src/hooklib/guard.ts:14,90-92` |
| A write tool's target path resolves inside the store root | `deny` | `src/hooklib/guard.ts:16,106-110` |
| A `Bash` command's text names the ledger ref, `CLAUDE_PLUGIN_DATA`, or a path inside the store root | `ask` — Claude Code prompts before running it | `src/hooklib/guard.ts:68-69,120-122` |
| The store root can't be verified on disk | `deny` for a write tool, `ask` for `Bash` | `src/hooklib/guard.ts:100-104` |
| Anything else | `silent` — no verdict, the tool proceeds | `src/hooklib/guard.ts:96,99,109,121` |

The guard says what it is, in its own text: *"this guard prompts for confirmation and is not a security boundary"* (`src/hooklib/guard.ts:17`, repeated in every `ask`/`deny` message it returns, e.g. `:103,117,122`).

Confirmed gaps, each grounded in the current guard:

1. **The plugin's own MCP tools are trusted completely.** A tool name matching the ledger pattern is `allow`ed with no inspection of its arguments (`src/hooklib/guard.ts:14,90-92`). This hook is not a second check on the plugin's own writes — only on everything else that might touch the store.
2. **An unresolvable store is a silent store.** If `CLAUDE_PLUGIN_DATA` can't be resolved to a real root, the guard goes fully silent for every write tool and every `Bash` command — no prompt, no denial (`src/hooklib/guard.ts:47-48,98-99`). It cannot protect a store it cannot locate.
3. **Bash detection reads text, not shell syntax.** It looks for path-shaped substrings in the raw command and resolves each one (`src/hooklib/guard.ts:20,71-74`); a path built through a shell variable, command substitution, or other indirection is invisible to it.
4. **A command naming a strict ancestor of the store root passes with no prompt.** The containment check only matches a resolved path equal to, or nested under, the store root (`src/hooklib/guard.ts:38-42`); a command naming the whole plugin-data directory, for example, is shorter than that check and evades it.
5. **No distinction between a read and a write.** Every `Bash` command that touches the store gets the same `ask`, destructive or not (`src/hooklib/guard.ts:120-122`). The prompt is the entire protection; a prompt approved out of habit protects nothing.
```

REPLACE (exact):

```
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
```

Rationale: ruling R7 states *"The SPEC claims narrowing, not closure. The PreToolUse event
carries no server identity, so a hostile server keyed `ledger` exposing a tool named
`open_thread` still auto-approves. This is stated in the PR body and in the README's existing
gap list, not omitted."* Gap 1 above carries that statement in these exact words:

> Checking the name against the registry narrows the surface and does not close it, because the
> PreToolUse event carries no server identity: a hostile server keyed `ledger` exposing a tool
> named `open_thread` still auto-approves.

Every `src/hooklib/guard.ts:NN` citation in the replacement block was read against the file as
it stands after step 3. The README is 95 lines before this edit and 95 lines after it; the block
is 17 lines in both directions.

### Step 6 — bump the version in both manifests

Files: `package.json`, `.claude-plugin/plugin.json`. Operation: **REPLACE**, one line in each.

Read the current version, increment the patch component, and write the same value into both.
Run this command exactly as written:

```
node -e "const fs=require('node:fs');const cur=JSON.parse(fs.readFileSync('package.json','utf8')).version;const p=cur.split('.').map(Number);if(p.length!==3||p.some(Number.isNaN)){console.error('STOP: package.json version is not a three-part semver: '+cur);process.exit(1)}const next=[p[0],p[1],p[2]+1].join('.');for(const f of ['package.json','.claude-plugin/plugin.json']){const raw=fs.readFileSync(f,'utf8');const needle='\"version\": \"'+cur+'\"';if(!raw.includes(needle)){console.error('STOP: '+f+' does not carry '+needle);process.exit(1)}fs.writeFileSync(f,raw.replace(needle,'\"version\": \"'+next+'\"'))}console.log(cur+' -> '+next)"
```

Expected exit code `0`. Expected stdout under the baseline ladder, exactly:

```
1.0.5 -> 1.0.6
```

If the printed starting version is not `1.0.5`, the ladder shifted and that is **not** an error
— the command increments whatever it read. If the command exits `1`, stop and follow section 11.

Expected `git diff` for the two files, with `<from>` the version read and `<to>` the version
written:

```
diff --git a/.claude-plugin/plugin.json b/.claude-plugin/plugin.json
--- a/.claude-plugin/plugin.json
+++ b/.claude-plugin/plugin.json
@@
-  "version": "<from>",
+  "version": "<to>",
diff --git a/package.json b/package.json
--- a/package.json
+++ b/package.json
@@
-  "version": "<from>",
+  "version": "<to>",
```

This step touches no test file. Confirm that with `git status --porcelain` before committing:
the only two paths listed must be `package.json` and `.claude-plugin/plugin.json`.

Rationale: invariant I4 requires both manifests to move in the same commit. A targeted
string replacement is used rather than a JSON parse-and-rewrite because
`JSON.stringify(value, null, 2)` reflows `.claude-plugin/plugin.json`'s inline `author` object
and `keywords` array onto separate lines, producing a fourteen-line diff for a one-character
change. Rejected: the JSON round-trip, for exactly that reason.

---

## 5. Tests

### 5.1 `test/hooks/guard-registry.test.ts` — NEW

This file does not exist. Create it with exactly these contents, first character to last:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardDecision } from '../../src/hooklib/guard.ts'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'
import { freshTmpDir } from './hook-process.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'

const LEDGER_TOOL_PREFIXES = ['mcp__ledger__', 'mcp__plugin_logbook_ledger__'] as const

const LEDGER_SUFFIX_SEPARATOR = 'ledger__'

const NON_REGISTERED_LEDGER_TOOL_NAMES = [
  'mcp__ledger__read_decision',
  'mcp__plugin_logbook_ledger__read_decision',
  'mcp__ledger__get_resume_brief',
  'mcp__plugin_logbook_ledger__get_resume_brief',
  'mcp__ledger__rebuild_index',
  'mcp__plugin_logbook_ledger__rebuild_index',
  'mcp__ledger__reconcile',
  'mcp__plugin_logbook_ledger__reconcile',
  'mcp__ledger__drop_database',
  'mcp__ledger__exec',
  'mcp__plugin_logbook_ledger__exec',
  'mcp__plugin_session-continuity_ledger__exec',
  'mcp__ledger__',
  'mcp__ledger__open_thread_extra'
] as const

const storedRuntime = (label: string): { rt: Runtime; projectRoot: string } => {
  const projectRoot = freshTmpDir(`logbook-guard-registry-${label}-project-`)
  const pluginDataRoot = freshTmpDir(`logbook-guard-registry-${label}-plugin-data-`)
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })
  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)
  return { rt, projectRoot }
}

const suffixOf = (toolName: string): string =>
  toolName.slice(toolName.lastIndexOf(LEDGER_SUFFIX_SEPARATOR) + LEDGER_SUFFIX_SEPARATOR.length)

test('hook.guard.registry.every-registered-tool-is-auto-approved-in-both-prefix-forms', () => {
  const { rt, projectRoot } = storedRuntime('approved')
  assert.ok(ALL_TOOLS.length > 0, 'expected the production registry to carry at least one tool')

  for (const tool of ALL_TOOLS) {
    for (const prefix of LEDGER_TOOL_PREFIXES) {
      const toolName = `${prefix}${tool.name}`
      const verdict = guardDecision(rt, { tool_name: toolName, tool_input: {}, cwd: projectRoot })
      assert.equal(
        verdict.kind,
        'allow',
        `expected the registered ledger tool ${toolName} to be auto-approved, got ${JSON.stringify(verdict)}`
      )
    }
  }
})

test('hook.guard.registry.a-prefixed-name-that-is-not-registered-is-not-approved', () => {
  const { rt, projectRoot } = storedRuntime('unregistered')
  const registeredNames = ALL_TOOLS.map((tool) => tool.name)
  assert.ok(NON_REGISTERED_LEDGER_TOOL_NAMES.length > 0, 'expected a non-empty set of non-registered names to drive')

  for (const toolName of NON_REGISTERED_LEDGER_TOOL_NAMES) {
    assert.ok(
      !registeredNames.includes(suffixOf(toolName)),
      `expected ${toolName} to name no registered tool, but ${suffixOf(toolName)} is registered; this list no longer censuses what it claims`
    )
    const verdict = guardDecision(rt, { tool_name: toolName, tool_input: {}, cwd: projectRoot })
    assert.notEqual(
      verdict.kind,
      'allow',
      `expected the unregistered ledger-prefixed name ${toolName} not to be auto-approved, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.registry.an-unresolvable-store-does-not-auto-approve-an-unregistered-name', () => {
  const projectRoot = freshTmpDir('logbook-guard-registry-unset-project-')
  const rt = testRuntime({ env: {}, cwd: projectRoot })
  const verdict = guardDecision(rt, {
    tool_name: 'mcp__ledger__totally_made_up',
    tool_input: {},
    cwd: projectRoot
  })
  assert.notEqual(
    verdict.kind,
    'allow',
    `expected an unregistered ledger-prefixed name to be refused auto-approval with no store configured, got ${JSON.stringify(verdict)}`
  )
})
```

It is picked up by `npm test`, whose glob includes `"test/hooks/**/*.test.ts"`
(`package.json:12`).

Exact test name strings, in file order:

1. `hook.guard.registry.every-registered-tool-is-auto-approved-in-both-prefix-forms`
2. `hook.guard.registry.a-prefixed-name-that-is-not-registered-is-not-approved`
3. `hook.guard.registry.an-unresolvable-store-does-not-auto-approve-an-unregistered-name`

There are no `describe` blocks. The repository uses flat top-level `test(...)` calls throughout,
and this file matches that.

What each test is for:

| Test | Purpose |
| --- | --- |
| 1 | The positive half of acceptance criterion 1. Drives every name the **live** registry carries, in both prefix forms, and asserts `allow` for each. It reads `ALL_TOOLS`, not the names module, so it fails if the two ever disagree. |
| 2 | The negative half of acceptance criterion 1, and the block that is red on the parent. Drives fourteen ledger-prefixed names that name no registered tool and asserts none is allowed. |
| 3 | Drives the exact case the audit recorded as `allow` on the shipped module: an invented ledger-prefixed name with `CLAUDE_PLUGIN_DATA` unset, so no store exists at all. |

Three details of test 2 that are load-bearing and must not be simplified away:

- It first asserts, for every literal in the list, that the literal's suffix is **not** a
  registered tool name. If someone later registers a tool called `reconcile`, this test halts
  and says so rather than quietly asserting the wrong thing about a real tool. That makes the
  negative list self-checking instead of a frozen assumption.
- `mcp__ledger__open_thread_extra` is a registered name with a suffix appended. It is the single
  case that fails if the membership check is written as a prefix comparison instead of exact
  set membership.
- `mcp__ledger__` has an empty suffix. It does not match the pattern today either, so it is
  green on the parent; it is kept because it was in the deleted test and it pins that an empty
  suffix never reaches the registry lookup.

Every fixture is a temp directory created by `freshTmpDir`, which is `mkdtempSync` under the OS
temp directory (`test/hooks/hook-process.ts:193`). Invariant I7 — this repository *is* the
installed plugin, and no test may observe the running plugin's own store.

No comments anywhere. Invariant I5.

### 5.2 `test/contract/published-schema.test.ts` — MODIFIED

Two existing tests stop compiling once `RegistryCensus` requires a fourth field, and two new
controls are added. One replacement covers all four.

FIND (exact, and the only occurrence in the file):

```ts
test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-missing-from-one-side', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population].sort(), ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-all-three-sides', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['real_tool'])
  assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, syntheticCensus)))
})
```

REPLACE (exact):

```ts
test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-missing-from-one-side', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: [],
    guardApproved: ['ghost_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population].sort(), ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-every-axis', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['real_tool'],
    registered: ['real_tool'],
    published: ['real_tool'],
    guardApproved: ['real_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['real_tool'])
  assert.doesNotThrow(() => census([...population], (name) => classifyRegistryName(name, syntheticCensus)))
})

test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-registered-but-not-guard-approved', () => {
  const syntheticCensus: RegistryCensus = {
    files: ['ghost_tool'],
    registered: ['ghost_tool'],
    published: ['ghost_tool'],
    guardApproved: []
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})

test('contract.published-schema-matches-enforced.registry-census-halts-on-a-name-guard-approved-but-not-registered', () => {
  const syntheticCensus: RegistryCensus = {
    files: [],
    registered: [],
    published: [],
    guardApproved: ['ghost_tool']
  }
  const population = registryPopulation(syntheticCensus)
  assert.deepEqual([...population], ['ghost_tool'])
  assert.equal(classifyRegistryName('ghost_tool', syntheticCensus), 'unclassifiable')
  assert.throws(
    () => census([...population], (name) => classifyRegistryName(name, syntheticCensus)),
    (error: unknown) => error instanceof Error && error.message.includes('ghost_tool')
  )
})
```

The exact test names after this edit, in file order for the block above:

1. `contract.published-schema-matches-enforced.registry-census-halts-on-a-name-missing-from-one-side` — unchanged name, gains `guardApproved: ['ghost_tool']` so it still isolates the `published` axis it was written to isolate.
2. `contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-every-axis` — renamed from `...-on-all-three-sides`, which stopped being true at four axes. This name appears nowhere else in the repository.
3. `contract.published-schema-matches-enforced.registry-census-halts-on-a-name-registered-but-not-guard-approved` — NEW. The first direction acceptance criterion 3 requires.
4. `contract.published-schema-matches-enforced.registry-census-halts-on-a-name-guard-approved-but-not-registered` — NEW. The second direction.

Tests 3 and 4 are the controls acceptance criterion 3 calls for. Each isolates exactly one axis
disagreement with all others held equal, so a passing result cannot come from any other axis.
Test 2 is the matching positive control: with all four axes agreeing the census does **not**
throw, which is what proves tests 3 and 4 are detecting the disagreement rather than always
throwing.

### 5.3 Files deliberately NOT modified

`test/contract/cutover-manifests-agree.test.ts` is not touched. It once carried a version
literal that every version bump had to re-type; that literal was removed permanently by the
prerequisite pull request named in section 0, and this pull request must not put one back.
Section 11 stop condition 12 is the runnable check.

`test/hooks/guard-in-process.test.ts` is not touched. Acceptance criterion 2 requires it to stay
green including its zero-spawn assertion, and it does: the two ledger names it drives,
`mcp__ledger__open_thread` and `mcp__plugin_logbook_ledger__resume_thread`, are both registered,
and `src/server/tool-names.ts` imports nothing, so no import of it can start a process.

### 5.4 Which test discharges which acceptance criterion

| Acceptance criterion | Discharged by |
| --- | --- |
| 1. A test drives every name in the live registry, in both prefix forms, and asserts `allow`; then drives prefixed non-registered names and asserts none is allowed. | `hook.guard.registry.every-registered-tool-is-auto-approved-in-both-prefix-forms` for the first block, `hook.guard.registry.a-prefixed-name-that-is-not-registered-is-not-approved` for the second, both in `test/hooks/guard-registry.test.ts`. `hook.guard.registry.an-unresolvable-store-does-not-auto-approve-an-unregistered-name` drives the same second block with no store configured at all. Section 6 runs the second block red at the parent. |
| 2. `test/hooks/guard-in-process.test.ts` stays green, including its zero-spawn assertion. | `guard.is-in-process` and `guard.is-in-process.control.the-counter-detects-a-real-spawn`, unmodified, run by section 8 command V3. |
| 3. The registry census halts in both directions, each with a control. | `contract.published-schema-matches-enforced.registry-census-halts-on-a-name-registered-but-not-guard-approved` and `contract.published-schema-matches-enforced.registry-census-halts-on-a-name-guard-approved-but-not-registered`, with `contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-every-axis` as the positive control that stops the other two from passing by always throwing. The live census is `contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent`. |
| 4. Inertness: reverting to the bare pattern test turns criterion 1's second block red. | Section 7. |
| 5. The PR body states that this narrows the surface and does not close it. | No test. Section 4 step 5 puts the sentence in the README; section 10 puts it in the `--risk` value. |
| 6. `npm test` green. | Every test in the suite, run by section 8 command V5. |

---

## 6. Red on the parent

The parent is the tip of `main` at branch-cut time — `0ade582` at authoring time, plus whichever
earlier rungs of the ladder have merged by then.

`test/hooks/guard-registry.test.ts` compiles and runs unchanged at the parent: its repository
imports are `src/hooklib/guard.ts`, `src/server/register.ts`, `src/store/layout.ts`,
`test/support/runtime.ts`, `test/hooks/hook-process.ts` and `src/runtime/runtime.ts`, all of
which exist there. It does **not** import `src/server/tool-names.ts`. So it can be run red
directly, with no substitute procedure.

Run this sequence exactly, from the repository root, after the commits in section 9 exist:

```
git switch --detach main
git restore --source=fix/msp-5-guard-registry-check -- test/hooks/guard-registry.test.ts
node --test "test/hooks/guard-registry.test.ts"
```

Expected exit code of the third command: **`1`**.

Expected output, containing all of these substrings:

```
✔ hook.guard.registry.every-registered-tool-is-auto-approved-in-both-prefix-forms
```

```
✖ hook.guard.registry.a-prefixed-name-that-is-not-registered-is-not-approved
```

```
ℹ pass 1
```

```
ℹ fail 2
```

```
AssertionError [ERR_ASSERTION]: expected the unregistered ledger-prefixed name mcp__ledger__read_decision not to be auto-approved, got {"kind":"allow","reason":"a logbook ledger tool call, auto-approved"}
```

```
AssertionError [ERR_ASSERTION]: expected an unregistered ledger-prefixed name to be refused auto-approval with no store configured, got {"kind":"allow","reason":"a logbook ledger tool call, auto-approved"}
```

The first test passes at the parent, which is correct and is part of the evidence: the bare
pattern already allows every registered name, so the positive block proves nothing new. Only the
second and third tests are red, and they are the ones acceptance criterion 1 calls "the second
block".

**The census controls in section 5.2 cannot be run red at the parent**, because `RegistryCensus`
has no `guardApproved` field there and the file does not compile. That is expected: they are
controls for a classifier that does not exist at the parent, not a reproduction of a defect. The
substitute procedure that proves they are not inert is the section 4 step 4 measurement — pointing
one key of `SPEC_BY_NAME` at the wrong tool object turns
`contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent`
red — and the inertness mutation in section 7.

Clean up and return to the branch:

```
rm -f test/hooks/guard-registry.test.ts
git switch fix/msp-5-guard-registry-check
git status --porcelain
```

Expected: `git status --porcelain` prints nothing at all, and exits `0`.

---

## 7. Inertness mutation

One mutation, for acceptance criterion 4, which states: *"Inertness: reverting to the bare
pattern test turns criterion 1's second block red."*

**The exact edit to revert.** On the branch, in `src/hooklib/guard.ts`:

FIND (exact):

```ts
  if (isRegisteredLedgerTool(event.tool_name)) {
```

REPLACE (exact):

```ts
  if (LEDGER_TOOL_PATTERN.test(event.tool_name)) {
```

Change nothing else. In particular leave the reason string and the new module alone, so that the
only difference is the membership check itself.

**The test that must turn red:**

```
node --test "test/hooks/guard-registry.test.ts"
```

Expected exit code **`1`**. Expected output containing:

```
ℹ pass 1
```

```
ℹ fail 2
```

```
AssertionError [ERR_ASSERTION]: expected the unregistered ledger-prefixed name mcp__ledger__read_decision not to be auto-approved, got {"kind":"allow","reason":"a registered logbook ledger tool call, auto-approved"}
```

**The exact restore.**

FIND (exact):

```ts
  if (LEDGER_TOOL_PATTERN.test(event.tool_name)) {
```

REPLACE (exact):

```ts
  if (isRegisteredLedgerTool(event.tool_name)) {
```

Then confirm the working tree is back to the committed state:

```
git status --porcelain
```

Expected: no output, exit `0`.

---

## 8. Full verification

Run all six, from the repository root, on the branch with every commit applied.

**V1 — the type checker is clean.**

```
npm run typecheck
```

Expected exit code `0`. Expected output to contain `tsc -p tsconfig.json --noEmit` and no line
containing `error TS`.

**V2 — the new acceptance test is green.** This is acceptance criterion 1.

```
node --test "test/hooks/guard-registry.test.ts"
```

Expected exit code `0`. Expected output to contain:

```
ℹ pass 3
```

```
ℹ fail 0
```

and all three names from section 5.1, each prefixed with `✔`.

**V3 — the zero-spawn test is still green.** This is acceptance criterion 2.

```
node --test "test/hooks/guard-in-process.test.ts"
```

Expected exit code `0`. Expected output to contain:

```
✔ guard.is-in-process
```

```
✔ guard.is-in-process.control.the-counter-detects-a-real-spawn
```

```
ℹ fail 0
```

**V4 — the census and its four controls are green.** This is acceptance criterion 3.

```
node --test "test/contract/published-schema.test.ts"
```

Expected exit code `0`. Expected output to contain:

```
✔ contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent
```

```
✔ contract.published-schema-matches-enforced.registry-census-halts-on-a-name-registered-but-not-guard-approved
```

```
✔ contract.published-schema-matches-enforced.registry-census-halts-on-a-name-guard-approved-but-not-registered
```

```
✔ contract.published-schema-matches-enforced.registry-census-allows-a-name-present-on-every-axis
```

```
ℹ fail 0
```

**V5 — the whole suite is green.** This is acceptance criterion 6.

```
npm test
```

Expected exit code `0`. Expected output to contain the substring:

```
ℹ fail 0
```

**V6 — packaging agrees.**

```
node scripts/check-packaging.mjs
```

Expected exit code `0`. Expected stdout, exactly: `check-packaging: ok`.

---

## 9. Commits

Three commits. The refactor, the behaviour change and the release bump do not share one.

### Commit 1

Subject line, exactly:

```
refactor(tools): give the tool names their own module and register from it
```

Files:

- `src/server/tool-names.ts`
- `src/server/tools/index.ts`

Plan steps contained: section 4 steps 1 and 2.

This commit changes no behaviour: the same twelve specs are registered in the same order, and
`node --test "test/contract/published-schema.test.ts"` passes both before and after it. It is
separated from commit 2 because a refactor and a behaviour change never share a commit.

### Commit 2

Subject line, exactly:

```
fix(guard): auto-approve only ledger tool names this server registers
```

Files:

- `src/hooklib/guard.ts`
- `test/hooks/guard-registry.test.ts`
- `test/support/published.ts`
- `test/contract/published-schema.test.ts`
- `README.md`

Plan steps contained: section 4 steps 3, 4 and 5.

### Commit 3

Subject line, exactly:

```
chore(release): bump the patch version across both manifests
```

Files:

- `package.json`
- `.claude-plugin/plugin.json`

Plan steps contained: section 4 step 6.

No test file belongs in this commit. The check that compares the two manifests derives its
expected value from `package.json`, so raising the version needs no matching test edit.

---

## 10. Pull request

Push the branch, then run this exactly. Do not use `gh pr create`, `gh api` against the pulls
endpoint, or the GitHub MCP create tool — all three are denied at the gate.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head fix/msp-5-guard-registry-check \
  --base main \
  --title "fix(guard): auto-approve only ledger tool names this server registers" \
  --what "The confirmation-skip that this plugin's own tool calls receive now applies only to tool names this server actually publishes." \
  --what "A tool name that has the right shape but names no published tool no longer skips confirmation; it goes through the editor's normal permission flow instead." \
  --what "The test that compares this server's tool lists against each other gained a fourth list, so a tool that gains or loses the confirmation skip without the others changing now fails the build." \
  --why "The check only looked at the shape of the tool name, so any name with the right prefix skipped the confirmation prompt without the plugin ever looking at what was being asked." \
  --why "Four tool names from a deleted earlier version of this plugin still skipped confirmation, even though nothing here publishes them any more." \
  --risk "This narrows the surface and does not close it: the event carries no server identity, so another server under the same short key exposing a published tool name still skips confirmation." \
  --verified "node --test test/hooks/guard-registry.test.ts on the branch - 3 passed, 0 failed" \
  --verified "node --test test/hooks/guard-registry.test.ts on the parent commit - 1 passed, 2 failed" \
  --verified "node --test test/hooks/guard-in-process.test.ts including its zero-subprocess assertion - 2 passed, 0 failed" \
  --verified "node --test test/contract/published-schema.test.ts - 0 failed, both new halt directions covered" \
  --verified "npm test - 0 failed" \
  --verified "npm run typecheck - exit 0, no error output" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --not-verified "the project mutation job - not run" \
  --not-verified "the coverage job - not run"
```

**The narrowing statement acceptance criterion 5 requires** is the `--risk` value above, written
out here in full so it cannot be paraphrased away:

> This narrows the surface and does not close it: the event carries no server identity, so
> another server under the same short key exposing a published tool name still skips
> confirmation.

That value is 181 characters. The tool rejects any field value over 200, and rejects the whole
invocation rather than truncating, so do not lengthen it.

The same statement appears in the README in the words given in section 4 step 5.

**The mutation-scope sentence this pull request owes.** SPEC section 8.2 states that the
project's mutation job has a scope of `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`,
`src/merge/conflict.ts` and `src/render/**`, and that MSP-5 *"falls outside it entirely"* — its
changes are in `src/server/tools/` and `src/hooklib/`, and the job will report success having
mutated nothing in this diff. That is why the mutation line above is `--not-verified` and not
`--verified`. The same section states plainly: *"No PR in this ladder may write a
`Verified: mutation` line unless the job actually mutated a file in that PR's diff."*

Every `--verified` line above describes a check section 8 tells you to run and read. If you did
not run one, change that line to `--not-verified "<thing> - not run"`. Never write a `Verified:`
line for a check you did not run, for any reason including that an exit code was zero.

---

## 11. Stop conditions

Each of these means the tree is not what this plan was written against. For every one:
**STOP and report; do not improvise.**

1. **MSP-0 has not merged.** Run:
   ```
   node -e "const b=require('node:fs').readFileSync('src/server/tools/resolve_conflict.ts');const o=[];for(let i=0;i<b.length;i+=1)if(b[i]===0)o.push(i);if(o.length===0){console.log('no NUL byte present');process.exit(0)}console.error('NUL byte present at offset(s): '+o.join(','));process.exit(1)"
   ```
   If the output is not exactly `no NUL byte present`, the prerequisite pull request is not in
   this branch's history. STOP and report; do not improvise.

2. **`src/server/tool-names.ts` already exists before step 1.** A file of that name is not
   supposed to be in the tree. STOP and report; do not improvise.

3. **A FIND block in step 2, 3, 4 or 5 does not match, or matches more than once.** Every FIND
   block in this plan was copied from the file as it stands and checked for uniqueness. A miss
   means the file changed since this plan was written. STOP and report; do not improvise.

4. **`wc -l src/hooklib/guard.ts` does not print `130` after step 3.** Every
   `src/hooklib/guard.ts:NN` citation written into the README in step 5 depends on that exact
   layout. STOP and report; do not improvise.

5. **`src/server/tools/` contains a `.ts` file that is neither `index.ts` nor one of the twelve
   tool modules.** Run:
   ```
   ls -1 src/server/tools/
   ```
   Expected exactly these thirteen names: `amend_criteria.ts`, `bind_branch.ts`,
   `close_thread.ts`, `index.ts`, `list_threads.ts`, `log_session_event.ts`, `open_thread.ts`,
   `park_thread.ts`, `record_decision.ts`, `resolve_conflict.ts`, `resume_thread.ts`,
   `sync_ledger.ts`, `update_thread.ts`. Any other file enters the census's `files` axis and
   halts it. STOP and report; do not improvise.

6. **`ALL_TOOLS` carries a name that is not in `LEDGER_TOOL_NAMES`, or the reverse.** You will
   see it as a `npm run typecheck` failure in `src/server/tools/index.ts` naming
   `Record<"open_thread" | ...>`, or as
   `census halted on an unclassifiable item: "<name>"` from
   `contract.published-schema-matches-enforced.production-registry-census-is-populated-and-consistent`.
   A tool was added or removed since this plan was written. STOP and report; do not improvise.

7. **`test/hooks/guard-in-process.test.ts` fails at section 8 V3.** Its zero-subprocess
   assertion is acceptance criterion 2 and something in the guard's import graph now starts a
   process. STOP and report; do not improvise.

8. **The new test is green at the parent commit** in section 6. Expected exit code `1` with two
   failures; if you get `0`, the defect this pull request fixes is not present at the parent and
   the receipt is worthless. STOP and report; do not improvise.

9. **`package.json` and `.claude-plugin/plugin.json` disagree with each other before step 6.**
   Run:
   ```
   node -e "const fs=require('node:fs');const a=JSON.parse(fs.readFileSync('package.json','utf8')).version;const b=JSON.parse(fs.readFileSync('.claude-plugin/plugin.json','utf8')).version;console.log(a===b?'agree '+a:'DISAGREE '+a+' vs '+b)"
   ```
   If the output starts with `DISAGREE`, STOP and report; do not improvise.
   A version that is merely *higher* than `1.0.5` is **not** a stop condition — the ladder
   shifted, and step 6 increments whatever it reads.

10. **The version-bump command in step 6 exits `1`.** You will see a line beginning `STOP:`
    naming the file and the string it could not find. STOP and report; do not improvise.

11. **`npm test` fails on the branch** at section 8 V5, on any test other than the ones this
    plan adds or renames. Read the failing test's name and the assertion text. STOP and report;
    do not improvise.

12. **The manifest-agreement test still carries a version literal.**

        Run: grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts
        If the output contains a quoted version literal such as '1.0.0', MSP-0 has not merged.
        STOP and report; do not improvise, and do not edit this file.

    Run this instead of judging that output by eye, because it has one exact expected result:

    ```
    grep -c EXPECTED_VERSION test/contract/cutover-manifests-agree.test.ts
    ```

    Expected: stdout is exactly `0` and the exit code is `1`. That is what `grep -c` does when a
    file contains no match, and it is only true once the prerequisite pull request has removed
    the identifier and every use of it.

    Any other result means the prerequisite has not merged. On the tree this plan was written
    against, before that pull request, the same command prints `6` and exits `0`. STOP and
    report; do not improvise, and do not edit this file.
