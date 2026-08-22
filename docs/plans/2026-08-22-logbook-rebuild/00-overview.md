# Logbook Rebuild Implementation Plan — Overview

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement one unit file at a time. Steps use checkbox (`- [ ]`) syntax for tracking. Execution of the twelve units is routed through the `mitosis` skill, one MSP per unit.

**Goal:** Replace the Logbook plugin with a TypeScript rebuild in which the server enforces every load-bearing rule, the store is a plain directory reaching an orphan git ref through plumbing, and two teammates working offline can merge without losing work.

**Architecture:** A parallel tree at `rebuild/` grows to completion beside the running plugin, which never loads it until the cutover (decision 0066). One zod declaration per record type emits the TypeScript type, the runtime validator, the published wire schema and the text of a refusal. Storage is a plain working copy plus git plumbing writes against `refs/logbook/ledger` with compare-and-swap ref moves and no worktree. The MCP server is stdio, structured-output-first, and every hook is a thin subprocess that translates one answer into one verdict.

**Tech Stack:** TypeScript (Node type stripping in development, `tsc` for the release artifact), `@modelcontextprotocol/sdk`, `zod`, `ulid`, Node's built-in test runner, Stryker for mutation testing, MCP Inspector v2 for the dev loop.

**Spec:** `docs/specs/2026-08-22-logbook-rebuild.md` — the plan argues from the SPEC throughout and never restates a rule the SPEC already binds. Executors read both. Section references below (`§5.3`, `§11.6`) are into the SPEC.

---

## 0. How to use this plan

Twelve unit files, one per MSP, in `docs/plans/2026-08-22-logbook-rebuild/`:

| File | Unit |
|---|---|
| `01-m1-record-model-and-store.md` | M1 Record model and store |
| `02-m2-merge-and-sync.md` | M2 Merge and sync |
| `03-m3-server-skeleton.md` | M3 Server skeleton |
| `04-m4-lifecycle-tools.md` | M4 Lifecycle tools |
| `05-m5-resume-and-park.md` | M5 Resume and park |
| `06-m6-decisions-sessions-sync-tools.md` | M6 Decisions, session logs, sync tools |
| `07-m7-reads.md` | M7 Reads |
| `08-m8-hooks.md` | M8 Hooks |
| `09-m9-skills.md` | M9 Skills |
| `10-m10-trust-boundary.md` | M10 Trust boundary |
| `11-m11-dev-loop-and-ci.md` | M11 Dev loop and CI |
| `12-m12-cutover.md` | M12 Cutover |

**What this plan pins and what it leaves to the implementer.** It pins every interface, every file path, every acceptance command, every test name, every cap value, and every version. It does not pre-write function bodies. Writing the bodies here would be authoring code against a tree that §2.3 requires be re-verified at pickup, which is the exact failure mode of the previous attempt (§1.4). Where a body is subtle — the write path, the merge rules, the escaping classes — the plan gives the algorithm step by step rather than the code.

**Read the unit file top to bottom before writing anything.** Its premise block is a hard gate (§2.3): run the checks, record the results in the unit's pull request, and if a premise no longer holds, re-plan the unit before writing code rather than adapting while writing it.

---

## 1. Global constraints

Every task's requirements implicitly include this section.

### Language and runtime

| Constraint | Value | Source |
|---|---|---|
| Language | TypeScript | §12.1 |
| `tsconfig` `erasableSyntaxOnly` | `true`, mandatory | Node type stripping rejects enums and runtime namespaces — [nodejs.org/api/typescript.html](https://nodejs.org/api/typescript.html) |
| No `enum`, no runtime `namespace`, no parameter properties | anywhere in `rebuild/` | same |
| Type stripping availability | on by default from Node **v22.18.0** and **v23.6.0**, Stability 2 Stable | same |
| Development Node floor | `>= 22.18.0` | derived from the line above |
| CI Node matrix | `22.18.x`, `24.x`, `26.x` | covers the floor, the LTS line and Current |
| Published `engines.node` | `>= 20`, unchanged | the release artifact is compiled JavaScript; `package.json:9` already states this |
| Release build | `tsc` emit, then restore the executable bit the compiler drops | §12.1 |
| Type check | `tsc --noEmit` pre-commit | §12.1 — type stripping performs no type checking |

### Dependencies, pinned exactly

Exact versions, no ranges, matching the existing style at `package.json:11-15`.

| Package | Version | Why |
|---|---|---|
| `@modelcontextprotocol/sdk` | `1.30.0` | current line (0068); verified latest on 2026-08-22 |
| `zod` | `4.4.3` | **the one schema library** (§12.1). It is already the SDK's own: `@modelcontextprotocol/sdk@1.29.0` declares `"zod": "^3.25 \|\| ^4.0"`. v4 emits JSON Schema natively, so one declaration yields type, validator and wire schema |
| `ulid` | `3.0.2` | already a direct dependency, `package.json:14` |
| `typescript` (dev) | `5.9.3` | the last 5.x. **Not** 7.0.2: the native compiler is the current `latest` tag but its emit parity for this project is unverified, and the release artifact depends on emit. Filed as a follow-up for M11 to evaluate for `--noEmit` speed only |
| `@stryker-mutator/core` (dev) | `10.0.0` | mutation gate (§11.4) |
| `@modelcontextprotocol/inspector` (dev) | `2.3.0` | **pinned exactly** — §12.2 requires it, because nearly all published guidance describes v1. Binary name is `mcp-inspector` |

**`ajv` is dropped as a direct dependency** at M1. §12.1 permits exactly one schema library and zod is it. `ajv` remains a transitive dependency of the SDK, which is not this project's concern.

### Repository rules that bind every unit

- **No code comments**, in any language, including docstrings and section headers. Derive understanding from the code.
- **No emojis** anywhere — code, commits, docs, tool output.
- Conventional Commits for every commit and every pull request title, max 72 characters.
- One pull request per unit, opened through `node .claude/lib/git/pr.mjs pr-create`. Never `gh pr create`.
- Branch per unit: `feat/logbook-m<N>-<slug>`, cut from `main`.
- Files stay focused: 200-400 lines typical, 800 hard ceiling.
- Immutability: return new objects, never mutate an input.

### The per-unit contract (§13.1), which every unit file restates concretely

1. **Premises re-verified** against the tree before code is written, results recorded in the pull request body.
2. **Acceptance declared before starting and treated as a ceiling** (§2.4). Anything found above it is filed as a new item, never folded in.
3. **At least one assertion proven red on the parent commit.**
4. **An inertness mutation**: revert the specific mechanism the unit added and the named assertion must turn red.
5. **Fix what you introduce; file what you inherit** (§2.5).

**On rule 3 in a greenfield tree.** Every assertion in `rebuild/` is red on the parent for the trivial reason that the code does not exist yet. That makes rule 3 nearly vacuous here, and rule 4 is what carries the weight. Each unit file therefore names a **surgical** inertness mutation — one mechanism removed, not one file deleted — and the named assertion must turn red under exactly that mutation. A unit whose assertion survives its stated mutation is not done.

---

## 2. File structure

Everything the rebuild adds lives under `rebuild/`. Nothing outside it changes before M12, except `package.json` dependencies and the CI workflow, neither of which the installed plugin loads.

```
rebuild/
  tsconfig.json
  inspector.config.json           separate from .mcp.json by necessity (§12.2)
  src/
    runtime/
      runtime.ts                  the injected Runtime: clock, ulid, env, cwd, log
      logger.ts                   structured single-line records to stderr (§12.4)
    schema/
      declare.ts                  declare(): zod schema -> type + validator + wire schema + refusal
      refusal.ts                  refusal text generated from the schema (§6.1, §10.2)
      example.ts                  valid-example synthesis from a zod schema
      caps.ts                     cap values and count caps (§6.6)
      ids.ts                      ULID, slug and anchored ISO-8601 patterns
      thread.ts                   Thread declaration (§6.2)
      decision.ts                 Decision declaration (§6.3)
      session.ts                  Session-log entry declaration
    store/
      project-key.ts              injective key from the canonical absolute path (§5.1)
      layout.ts                   <plugin-data>/<key>/{records,state}
      single-store.ts             refuse a second store for one project (§5.1)
      durable-write.ts            the four-step durability sequence (§5.5)
      git.ts                      subprocess wrapper enforcing I-1 through I-7 (§5.3)
      ref.ts                      compare-and-swap ref moves (I-4)
      write-path.ts               hash-object -> tree -> commit-tree -> CAS (§5.3)
      read-path.ts                filesystem reads, per-record quarantine (§5.4)
      records.ts                  typed read and write over the working copy
    merge/
      field-merge.ts              per-record-type field rules (§5.6)
      conflict.ts                 the conflict record and its refusal
      sync.ts                     fetch, compare, merge, push with lease
    domain/
      lifecycle.ts                open | done | abandoned (§6.4)
      done-gate.ts                §6.5
      pointer.ts                  the machine-local active pointer (§6.4)
      criteria.ts                 insert, rewrite, strike, each needing a decision reference
      spine.ts                    spine refresh and element-level replacement
    server/
      main.ts                     stdio entry point
      instructions.ts             the server instructions string, under 2 KB (§7.6)
      errors.ts                   the two channels and the refusal shape (§10.1, §10.2)
      register.ts                 tool, resource, prompt and completion registration
      tools/                      one file per tool, twelve files
      resources.ts                logbook:// addresses including the static index (§7.4)
      completions.ts              argument completions (§7.2)
      prompts.ts                  preflight and debrief, human entry points only (§7.5)
    render/
      escape.ts                   the format and blank classes, grapheme clipping (§10.4)
      briefing.ts
      roster.ts
    cli/
      session-start.ts            one fat command (§8.4)
      session-end.ts              one fat command (§8.4)
    hooklib/
      guard.ts                    the write-guard predicate
      resume-intent.ts            the UserPromptSubmit regex gate
      transcript.ts               transcript parsing, plugin-side only
  bin/
    logbook-server.ts             MCP server entry
    logbook-cli.ts                hook-facing entry
  hooks/
    hooks.json
    session-start.ts  session-end.ts  user-prompt-submit.ts
    pre-tool-use.ts   post-tool-use.ts  stop.ts
    lib/io.ts                     stdin JSON in, stdout JSON out, exit codes (§8.3)
  skills/
    preflight/SKILL.md
    debrief/SKILL.md
  test/
    unit/                         ~300 pure logic and property tests
    store/                        ~80 real-git tests
    spawn/                        ~60 real-spawn contract tests
    hooks/                        ~40 subprocess tests
    contract/                     ~10 cross-boundary tests
    sync/                         ~10 two-clone scenarios
    smoke/                        the Inspector step
    support/
      runtime.ts                  a controlled Runtime for tests
      git-fixture.ts              a real git repository, never a bare temp directory
      clone-fixture.ts            a bare remote plus two real clones
      spawn-client.ts             a real stdio MCP client against the built binary
      schema-arbitrary.ts         valid and negated inputs from a published JSON Schema
      store-model.ts              the simplified model for model-based testing
      census.ts                   the halting-census helper used by three gates
```

**Why `rebuild/` and not the final paths.** The plugin's skills and hooks live at conventionally fixed locations relative to the plugin root, so a second set cannot occupy them before cutover. Since some of the tree must move at M12 regardless, all of it moves, and the repository ends with one layout rather than two. M12 owns that move and nothing else owns it.

---

## 3. Cross-unit interfaces

A unit's implementer sees only their own file. These are the names and types every later unit relies on; they are fixed here so no unit has to guess or ask.

### `rebuild/src/runtime/runtime.ts` (M1)

```ts
export type Runtime = {
  now: () => Iso8601
  ulid: () => Ulid
  env: Readonly<Record<string, string | undefined>>
  cwd: string
  log: (record: Record<string, unknown>) => void
}
export const productionRuntime: () => Runtime
```

`Runtime` is threaded as an explicit first argument through every layer. **It is never defaulted to the ambient process** (§11.8). A function that reads `process.env` directly is a defect.

### `rebuild/src/schema/declare.ts` (M1)

```ts
export type Declared<T> = {
  readonly name: string
  readonly schema: z.ZodType<T>
  readonly jsonSchema: Record<string, unknown>
  parse: (input: unknown) => Ok<T> | Refusal
  refuse: (issues: z.core.$ZodIssue[]) => Refusal
}
export const declare: <T>(name: string, schema: z.ZodType<T>) => Declared<T>
```

```ts
export type Ok<T> = { ok: true; value: T }
export type Refusal = {
  ok: false
  field: string
  accepted: string
  example: string
  retryable: boolean
  message: string
}
```

Four consumers from one declaration (§6.1): the type is `z.infer`, the validator is `parse`, the wire schema is `jsonSchema`, and the refusal text is `refuse`. **A refusal is generated, never hand-written.**

### `rebuild/src/schema/thread.ts`, `decision.ts`, `session.ts` (M1)

```ts
export type Ulid = string
export type Iso8601 = string

export type Criterion = {
  id: Ulid
  ordinal: number
  text: string
  done: boolean
  kind: 'planned' | 'detour'
  struck_by: Ulid | null
}
export type Risk = { id: Ulid; scope: string; text: string; refs: string[] }
export type KeyDecision = { id: Ulid; decision_id: Ulid; title: string; scope: string }
export type OutOfScope = { id: Ulid; text: string }

export type Spine = {
  active_goal: string
  next_step: string
  last_session: string
  open_risks: Risk[]
  key_decisions: KeyDecision[]
  out_of_scope: OutOfScope[]
}

export type Thread = {
  id: Ulid
  slug: string
  title: string
  status: 'open' | 'done' | 'abandoned'
  blocked_by: string | null
  completion_criteria: Criterion[]
  spine: Spine
  created_at: Iso8601
  updated_at: Iso8601
}

export type Decision = {
  id: Ulid
  thread_id: Ulid
  title: string
  context: string
  options: string[]
  outcome: string
  commit: string | null
  supersedes: Ulid[]
  created_at: Iso8601
}

export type SessionEntry = {
  id: Ulid
  thread_id: Ulid
  actor: string
  body: string
  created_at: Iso8601
}
```

### `rebuild/src/store/records.ts` (M1)

```ts
export type Quarantined = { quarantined: true; path: string; reason: string }
export type Loaded<T> = { quarantined: false; record: T }
export type Slot<T> = Loaded<T> | Quarantined

export type Store = {
  readThread: (id: Ulid) => Slot<Thread> | null
  readThreads: () => Slot<Thread>[]
  readDecision: (id: Ulid) => Slot<Decision> | null
  readSessionEntry: (threadId: Ulid, entryId: Ulid) => Slot<SessionEntry> | null
  readSessionEntries: (threadId: Ulid) => Slot<SessionEntry>[]
  commit: (changes: RecordChange[], message: string) => CommitResult
}
export type RecordChange =
  | { kind: 'thread'; record: Thread }
  | { kind: 'decision'; record: Decision }
  | { kind: 'session'; record: SessionEntry }
export type CommitResult =
  | { ok: true; ref: string; before: string | null; after: string }
  | { ok: false; reason: 'ref-moved' | 'io'; detail: string }

export const openStore: (rt: Runtime, projectRoot: string) => Ok<Store> | Refusal
```

`readThread` returning `null` means **the record does not exist**. A store that could not be read is a `Refusal` from `openStore`, never an empty list (§10.3).

### `rebuild/src/domain/pointer.ts` (M5, declared here so M8 can call it)

```ts
export type Pointer = { thread_id: Ulid; written_at: Iso8601; session_id: string }
export const readPointer: (rt: Runtime, root: StoreLayout) => Pointer | null
export const writePointer: (rt: Runtime, root: StoreLayout, p: Pointer) => void
export const releasePointer: (rt: Runtime, root: StoreLayout) => void
```

Writing and releasing are both idempotent (§6.4). The pointer lives in `state/` and is never committed.

### `rebuild/src/merge/field-merge.ts` (M2)

```ts
export type Conflict = { record: string; field: string; ours: unknown; theirs: unknown }
export type MergeResult<T> = { ok: true; merged: T } | { ok: false; conflicts: Conflict[] }
export const mergeThread: (base: Thread | null, ours: Thread, theirs: Thread) => MergeResult<Thread>
export const mergeDecision: (ours: Decision, theirs: Decision) => MergeResult<Decision>
export const mergeSession: (ours: SessionEntry[], theirs: SessionEntry[]) => MergeResult<SessionEntry[]>
```

### `rebuild/src/server/errors.ts` (M3)

```ts
export const toolRefusal: (r: Refusal) => CallToolResult
export const toolOk: <T>(text: string, structured: T) => CallToolResult
```

Every validation failure and every business-rule refusal is a **tool error** with `isError: true`, never a protocol error (§10.1). `toolRefusal` strips any absolute filesystem path; the directory travels on a non-emitted property so one call site covers every refusal (§10.4).

### `rebuild/src/render/escape.ts` (M10, stubbed at M1)

```ts
export const escapeStored: (text: string) => string
export const clipGraphemes: (text: string, max: number) => string
```

M1 ships these with the real implementation for the format and blank classes; M10 adds the census that proves no interpolation site bypasses them.

---

## 4. Execution order

```
M1 ──┬── M2 ──────────────────────────────┐
     │                                    │
     └── M3 ──┬── M4 ──┬── M5 ──┬── M7 ───┴── M10
              │        │        │
              │        └── M6 ──┘
              │                 │
              │                 └── M8 ── M9
              └── M11
                                              all ── M12
```

- **M1 → M2 and M1 → M3 are the only hard serialisations at the start.** M2 and M3 then run in parallel (§13.3).
- M4 unlocks M5 and M6. M7 needs both. M8 needs M5. M9 needs M8. M10 needs M7. M11 needs only M3.
- **M5 and M9 must not run in parallel.** Both touch the preflight surface — the same collision that made two units of the previous attempt unsafe (§13.3).
- M12 is last and needs every other unit merged or retired by a recorded decision.

Every unit merges green into `main`, which is free before cutover because the running plugin cannot see `rebuild/` (§13.1).

---

## 5. Three SPEC gaps this plan closes

Found while mapping units to tools and tests. Each is resolved here from the SPEC's own binding decisions rather than left for an implementer to invent, and each is recorded as a numbered decision on the thread: 0078, 0079 and 0080. A fourth, 0081, reconciles invariant I-1 with the decision record's `commit` field and is stated where it applies, in `01-m1-record-model-and-store.md` Task 6.

### 5.1 Criterion identity cannot be a sequential label

§6.2 shows `completion_criteria [ { id: "c1", ... } ]`. §5.6 merges criteria by union on that id and calls the same id with different text a conflict. But a sequential label is exactly the project-wide counter that decision 0075 removed from decisions, and for the same reason: two teammates offline both add a criterion, both mint `c5`, and the merge reports a conflict on two unrelated additions — or worse, unions them into one.

**Resolution.** `Criterion.id` is a **ULID**. The `c1` form is a rendered ordinal derived from position, carried on the record as `ordinal` so a briefing and a refusal can name a criterion the way a human already reads it. The merge keys on `id`; the ordinal is recomputed on render and never merged.

### 5.2 Three of the twelve tools are unassigned

§7.3 specifies twelve tools. §13.2 assigns nine: four to M4, two to M5, two to M6, one to M7. `bind_branch`, `sync_ledger` and `resolve_conflict` are named nowhere in the delivery table.

**Resolution.** `bind_branch` → **M4**, whose acceptance already requires spawn and rejection tests for every tool it ships. `sync_ledger` and `resolve_conflict` → **M6**, the first unit where both the merge engine (M2) and the registered-tool surface (M3) exist.

### 5.3 M2's acceptance test depends on units that do not exist yet

M2's acceptance is `sync.two-clones-offline` passing (§13.2), and §11.6 describes that scenario as two real MCP server processes each recording a decision through a tool call. Those tools arrive at M6, and the server arrives at M3 — which §13.3 explicitly runs *in parallel* with M2.

**Resolution.** The scenario ships twice, at the two honest layers, and the SPEC's language that it "stays green for every later unit" applies to both.

| Test | Unit | Layer |
|---|---|---|
| `sync.two-clones-offline.store` | M2 | Two real clones, two real node processes driving the store library, real git, real offline |
| `sync.two-clones-offline.spawn` | M6 | §11.6 verbatim: two spawned MCP servers, decisions recorded through `record_decision` |

Both assert the same five properties: nothing lost, no collision, no corruption, convergence, order-independence.

---

## 6. Verification commands

Pinned here so every unit file can reference them by name rather than restating them.

| Name | Command |
|---|---|
| `typecheck` | `npx tsc -p rebuild/tsconfig.json --noEmit` |
| `unit` | `node --test rebuild/test/unit/` |
| `store` | `node --test rebuild/test/store/` |
| `spawn` | `node --test rebuild/test/spawn/` |
| `hooks` | `node --test rebuild/test/hooks/` |
| `contract` | `node --test rebuild/test/contract/` |
| `sync` | `node --test rebuild/test/sync/` |
| `full` | `npm run rebuild:test` — every directory above, in that order |
| `build` | `npm run rebuild:build` — `tsc` emit plus the executable-bit restore |
| `mutate` | `npm run rebuild:mutate` — Stryker, diff-scoped, break threshold 70 |
| `inspect` | `npx mcp-inspector --config rebuild/inspector.config.json --cli --method tools/list` |

`npm run rebuild:test` is created in M1 and extended by each unit that adds a directory. **A single test file is run with `node --test <path>`**; the receipts config's `verify.test_command` is updated to match in M11.

---

## 7. Self-review against the SPEC

Coverage check, section by section. Every SPEC section maps to at least one unit.

| SPEC section | Unit |
|---|---|
| §5.1 storage locations, project key, single store | M1 |
| §5.2 no worktree | M1 (`worktree.absent`) |
| §5.3 write path, I-1 through I-7 | M1 |
| §5.4 read path, quarantine | M1 |
| §5.5 durability | M1 |
| §5.6 sync and merge | M2 |
| §6.1 one declaration, four consumers | M1 |
| §6.2 thread record | M1 |
| §6.3 decision record | M1 model, M6 tool |
| §6.4 lifecycle, pointer | M4 states, M5 pointer |
| §6.5 done gate | M4 |
| §6.6 caps | M1 values, M4 enforcement at the tool boundary |
| §7.1-7.3 tools, descriptions, structured output, effect reports | M3 surface, M4-M7 tools |
| §7.4 resources | M7 |
| §7.5 prompts | M7 |
| §7.6 server instructions | M3 |
| §8 hooks | M8 |
| §9 skills | M9 |
| §10.1-10.3 error contract | M3 |
| §10.4 trust boundary | M1 helpers, M10 census |
| §11 testing | every unit; harness in M3, gates in M11 |
| §12.1 language and build | M1 config, M11 release build |
| §12.2 Inspector | M11 |
| §12.3 guard rails | M1 stdout census, M11 the rest |
| §12.4 diagnostics | M1 |
| §13.4 whole-rebuild done | M12 |

No SPEC section is unassigned.
