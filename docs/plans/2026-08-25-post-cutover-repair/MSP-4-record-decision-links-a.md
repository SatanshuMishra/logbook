# MSP-4a — the whole-record cap refusal names the field and the observed byte count

## 0. Identity

- **Closes:** defect D12 — the thread byte cap refuses without naming the field or the number.
- **Depends on:** MSP-0, and nothing else. MSP-0 is the only prerequisite, and it exists for one
  reason: `test/contract/cutover-manifests-agree.test.ts:8` pins the expected version to the
  literal `1.0.0`, which this plan's version bump breaks. MSP-0 de-pins that constant permanently.
  Section 11 gives the exact check.
- **Required by:** MSP-4b, which routes `record_decision`'s cap-boundary policy through the refusal
  this plan repairs. MSP-4b cannot be applied until this branch is merged.
- **Branch name:** `fix/msp-4-record-decision-links-a`
- **Version bump:** Baseline `1.0.4` -> `1.0.5` per orchestrator ruling O1. The step in section 4
  reads the current version and increments the patch, so a shifted ladder does not invalidate it.
  Both `package.json` and `.claude-plugin/plugin.json` move in one commit.
- **SPEC anchors:** section 7 MSP-4, section 6 ruling R1, section 5 defect D12.

### What this plan is, in plain words

A **thread record** is the JSON file holding one unit of work. Two separate limits govern how big
its `spine.key_decisions` list may get. One counts entries and caps them at 200; when it fires it
names the field, the limit, the count it saw and what to do about it. The other measures the whole
record in bytes and caps it at 65536; when it fires it names **nothing** — not the field that grew,
not the size it measured.

The byte cap is the one that fires first in practice, at roughly 130 full-length entries. So the
useful refusal is the one that never arrives, and the caller is told only that "stored-shape
validation" failed.

This change makes the byte-cap refusal measure the record, name the single largest field inside it,
and state both numbers.

---

## 1. Acceptance criteria (the ceiling)

Copied verbatim from SPEC section 7, MSP-4, numbered as there. This plan carries criteria 4 and 8.
The rest belong to MSP-4b and are named here only so the split is explicit.

4. A test asserts the whole-record cap refusal names the offending field and the observed byte
   count.
8. `npm test` green.

**Criteria 1, 2, 3, 5, 6 and 7** are discharged by MSP-4b, not by this plan.

That list is the complete definition of done for this unit of work. Anything discovered above it is
appended to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence. It
is not folded into this plan, and it does not reopen this plan once these two are met.

---

## 2. Ground truth

Every line range below was read in the working tree at `docs/post-cutover-repair-spec`, whose `src/`
and `test/` trees are byte-identical to `main` at `0ade582`.

### 2.1 `src/server/tool-support.ts:49-56` — the refusal that names nothing

```ts
const wholeRecordCapRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a serialised thread record that stays within the whole-record byte cap',
  example: 'split the contribution across multiple calls, or retire an existing entry before retrying',
  retryable: true,
  message: `the thread record after this change failed its stored-shape validation: ${issue}`
})
```

What is wrong with it: `issue` is the message `ThreadRecord.parse` produced, and for the byte cap
that message is derived from a Zod issue whose `path` is the empty array (see 2.3). An empty path
renders as no field name at all, so the caller learns neither which field grew nor by how much. The
function is also used for **every** parse failure, not only the byte cap, so its name is wrong for
most of what reaches it.

### 2.2 `src/server/tool-support.ts:71-81` — the only caller

```ts
export const commitThread = (store: Store, thread: Thread, message: string): Attempt<Thread> => {
  const validated = ThreadRecord.parse(thread)
  if (!validated.ok) {
    return { ok: false, refusal: wholeRecordCapRefusal(validated.message) }
  }
  const result = store.commit([{ kind: 'thread', record: validated.value }], message)
  if (!result.ok) {
    return { ok: false, refusal: commitFailureRefusal(result.detail) }
  }
  return { ok: true, value: validated.value }
}
```

What is wrong with it: it cannot distinguish the byte cap from any other stored-shape failure,
because it only ever sees the parse result. `commitThread` is called from
`src/server/tools/open_thread.ts:135`, `src/server/tools/update_thread.ts:233` and
`src/server/tools/amend_criteria.ts:100,122,142`.

### 2.3 `src/schema/thread.ts:124-137` — where the byte cap is measured

```ts
const ThreadShapeWithByteCap = ThreadShape.superRefine((value, ctx) => {
  const bytes = Buffer.byteLength(JSON.stringify(value), 'utf8')
  if (bytes > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) {
    ctx.addIssue({
      code: 'too_big',
      origin: 'string',
      maximum: caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      inclusive: true,
      path: [],
      message: `serialised thread record exceeds ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes`,
      input: value
    })
  }
})
```

What is wrong with it: `path: []`. `src/schema/refusal.ts:92` derives the refusal's `field` from
`issue.path`, so an empty path is what erases the field name. This plan does **not** change this
file: the cap belongs on the schema, and the repair belongs where the refusal is composed.

### 2.4 `src/domain/spine.ts:39-47` — the refusal shape the byte cap should have copied

```ts
const capRefusal = (field: string, limit: number, observed: number, unit: string, remedy: string): Refusal => ({
  ok: false,
  field,
  accepted: `at most ${limit} ${unit}`,
  example: `a ${field} contribution within ${limit} ${unit}`,
  retryable: true,
  message: `${field} exceeds its cap of ${limit} ${unit}; observed ${observed} ${unit} for this call; remedy: ${remedy}.`
})
```

What is wrong with it: nothing. This is the element-count cap's refusal — the one that already
names the field, the limit, the observed count and a remedy. It is quoted here because it is the
contract the byte-cap refusal fails to meet, and the replacement in step 2 is written to match it.

### 2.5 `src/schema/caps.ts:22-24,39` — the four numbers this plan uses

```ts
export const KEY_DECISIONS_MAX_ELEMENTS = 200
export const KEY_DECISION_TITLE_MAX = 200
export const KEY_DECISION_SCOPE_MAX = 200
```

```ts
export const THREAD_RECORD_SERIALISED_MAX_BYTES = 65536
```

What is wrong with them: nothing. They are quoted because the test in section 5 derives its fixture
from them rather than hard-coding a count, so a later change to any of the four cannot leave the
test silently asserting nothing.

### 2.6 `test/contract/no-path.test.ts:92,422-424` — the census `commitThread` already sits in

```ts
const COMMIT_THREAD_PRODUCER: ProducerId = 'server/tool-support.ts#commitThread'
```

```ts
    const commitThreadFailure = commitThread(store, threadForCommitFailure.record, 'census commitThread failure probe')
    if (commitThreadFailure.ok) throw new Error('expected commitThread to refuse when the ledger commit cannot complete')
    refusals.push({ producer: COMMIT_THREAD_PRODUCER, refusal: commitThreadFailure.refusal })
```

What is wrong with it: nothing, and this plan must keep it that way. `scanRefusalProducers`
(`test/support/refusal-census.ts:193-248`) enumerates every **exported** value under `src/` whose
call signature returns a `Refusal`, and `error.discloses-no-path`
(`test/contract/no-path.test.ts:1145-1157`) halts on any producer the file does not exercise.
`commitThread` is already a producer and already exercised. The two refusal factories this plan adds
are module-private, exactly like the one they replace, so the census population does not change.

---

## 3. Divergences from the SPEC

1. **The ladder lands on `1.1.1`, not `1.1.0`.** SPEC section 7 states the ladder lands on `1.1.0`,
   which cannot hold alongside MSP-9 merging last. Orchestrator ruling O2 settles it: MSP-9 merges
   last and the ladder lands on `1.1.1`. This plan is unaffected beyond the version step being
   written as a read-then-increment.
2. **The pull request tool path.** SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`.
   There is no `.claude/lib` in this repository. The tool is the operator's global one at
   `node ~/.claude/lib/git/pr.mjs pr-create`, which section 10 uses.
3. **MSP-4 is split, so it consumes two patch versions.** SPEC section 7 makes the split conditional
   ("if the diff exceeds 400 lines"); orchestrator ruling O7 forbids passing that condition
   downstream. The measured arithmetic is section 3.1. This half takes the first patch, which shifts
   every MSP below MSP-4 by one. Ruling O6's read-then-increment step absorbs that shift.
4. **The SPEC names `src/server/tool-support.ts:48-56` as the site; the refusal is at `:49-56`.**
   Line 48 is blank. The FIND blocks in section 4 use the real text, so nothing turns on this.
5. **MSP-4a does not depend on MSP-2, though MSP-4 as a whole does.** SPEC section 7 records
   "Depends on: MSP-2" for MSP-4, and section 5 D11 explains why: D1's fix adds a third tool that
   writes more than one record in a single commit, which is what the compare-and-swap hazard bites.
   That is MSP-4b's change. This half adds no writer and touches no commit path, so its only
   prerequisite is MSP-0. MSP-4b carries the MSP-2 stop condition.
6. **MSP-4 gains a dependency on MSP-0 that the SPEC does not record.** SPEC section 7 lists only
   MSP-2. `test/contract/cutover-manifests-agree.test.ts:8` reads
   `const EXPECTED_VERSION = '1.0.0'`, so every MSP's version bump fails it. Orchestrator ruling O15
   settles this ladder-wide — MSP-0 de-pins the constant permanently, and no later MSP edits that
   file. This plan therefore writes no edit to it and carries stop condition 3 in section 11.

### 3.1 The split ruling (orchestrator ruling O7)

MSP-4 **is split**. This is a ruling, not a condition. There is no branch of this plan in which the
implementer decides anything about it.

The changes in both halves were applied mechanically to copies of the files they touch and the
resulting diffs were measured. Every FIND string in both plans matched **exactly once** in that run.

Counted as insertions plus deletions, the convention `git diff --shortstat` uses, by applying
section 4 mechanically to copies of the files it touches and diffing them against the originals.

| Half | `src/` | `test/` | manifests | total |
| --- | --- | --- | --- | --- |
| MSP-4a (this plan) | 43 | 114 | 4 | **161** |
| MSP-4b (sibling) | 99 | 301 | 4 | **404** |
| combined, had it been one pull request | 142 | 415 | 4 | **561** |

561 exceeds the 400-line ceiling SPEC section 7 sets by forty percent, so the SPEC's stated split
triggers. Its stated split content governs which half is which: "PR A carries the cap refusal repair
(D12); PR B carries the linking. PR A first, because PR B's cap path depends on it."

Rejected: one pull request carrying both halves — it exceeds the stated ceiling by forty percent,
and it puts a refusal-message repair and a new two-record write path in one review.

MSP-4b lands at 404 against that same 400-line ceiling, a four-line overshoot its own section 3
discloses. There is no second cut that removes it: this half is already the smaller one, and every
line of the other half is either the linking change itself or one of the six acceptance criteria the
SPEC fixes for it.

---

## 4. The change, step by step

Apply the steps in the order given. Steps 1 through 4 change one file and leave the tree
type-correct. Step 5 creates one new test file. Step 6 is the version bump.

Every FIND string below was copied from the file named, and every one was verified to match
**exactly once** by applying this section mechanically to a copy of the file. If a FIND string does
not match exactly once, stop and read section 11.

### Step 1 — `src/server/tool-support.ts` — REPLACE — import the caps module

FIND:

```ts
import { ThreadRecord, type Thread, type Ulid } from '../schema/thread.ts'
```

REPLACE:

```ts
import { ThreadRecord, type Thread, type Ulid } from '../schema/thread.ts'
import * as caps from '../schema/caps.ts'
```

Rationale: steps 2 and 4 name `caps.THREAD_RECORD_SERIALISED_MAX_BYTES` in the refusal text and in
the guard. Every other module in `src/server/tools/` imports the caps module the same way, for
example `src/server/tools/record_decision.ts:5`.

### Step 2 — `src/server/tool-support.ts` — REPLACE — measure the record, name its largest field

FIND:

```ts
const wholeRecordCapRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a serialised thread record that stays within the whole-record byte cap',
  example: 'split the contribution across multiple calls, or retire an existing entry before retrying',
  retryable: true,
  message: `the thread record after this change failed its stored-shape validation: ${issue}`
})
```

REPLACE:

```ts
const byteSizeOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8')

const heaviestFieldOf = (thread: Thread): { field: string; bytes: number } => {
  const measured = Object.entries(thread as unknown as Record<string, unknown>).flatMap(([key, value]) => {
    if (key !== 'spine' || typeof value !== 'object' || value === null) {
      return [{ field: key, bytes: byteSizeOf(value) }]
    }
    return Object.entries(value as Record<string, unknown>).map(([spineKey, spineValue]) => ({
      field: `spine.${spineKey}`,
      bytes: byteSizeOf(spineValue)
    }))
  })
  return measured.reduce(
    (worst, candidate) => (candidate.bytes > worst.bytes ? candidate : worst),
    { field: 'spine', bytes: 0 }
  )
}

const overByteCapRefusal = (thread: Thread, observed: number): Refusal => {
  const heaviest = heaviestFieldOf(thread)
  return {
    ok: false,
    field: 'thread',
    accepted: `a serialised thread record of at most ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes`,
    example: 'remove an entry from the largest field and retry',
    retryable: true,
    message: `the thread record after this change is ${observed} bytes, over its cap of ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes; its largest field is ${heaviest.field} at ${heaviest.bytes} bytes; remedy: remove or shorten an entry in ${heaviest.field} and retry.`
  }
}

const invalidThreadRecordRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'thread',
  accepted: 'a thread record that matches its stored shape',
  example: 'shorten or remove the entry that failed validation and retry',
  retryable: true,
  message: `the thread record after this change failed its stored-shape validation: ${issue}`
})
```

Rationale: SPEC section 5 D12 — the byte-cap refusal "produces a refusal that names neither
`key_decisions` nor the byte count", against a project contract stated in the server's own
instructions: "A refusal from this server is structured and worth reading. It names the field that
was wrong, what that field accepts, a valid example, and whether a retry can succeed."
(`src/server/instructions.ts:15-17`).

Three choices this step makes, with the rejected option for each:

- **The named field is whichever field is largest, measured at the moment of refusal.** Every
  top-level key of the record is measured, and `spine` is descended one level so the answer can be
  `spine.key_decisions` rather than the useless `spine`. Rejected: naming `key_decisions`
  unconditionally, which is the field that grows in the case D12 was found in but is simply false
  for a record made large by long criteria text.
- **The enumeration is `Object.entries`, not a hard-coded list of field names.** A hard-coded list
  would silently skip a field added later and report the wrong answer while still passing.
  Rejected: a fixed array of the nine `Thread` keys.
- **`field` stays the literal `'thread'`.** The largest field is named in the message, not in the
  `field` slot, because `Refusal.field` names the caller's argument and no caller of `commitThread`
  has an argument called `spine.key_decisions`. Rejected: setting `field` to the largest field's
  name, which would make `field` name something the caller cannot pass.

Both new factories are module-private, matching the one they replace and every other factory in this
file. Ground truth 2.6 gives the reason: `error.discloses-no-path` runs a closed census over
**exported** refusal producers and halts on any it does not exercise, so exporting either one would
require adding an exercise to a census file this change has no other reason to touch.

### Step 3 — `src/server/tool-support.ts` — REPLACE — check the cap before the parse

FIND:

```ts
export const commitThread = (store: Store, thread: Thread, message: string): Attempt<Thread> => {
  const validated = ThreadRecord.parse(thread)
  if (!validated.ok) {
    return { ok: false, refusal: wholeRecordCapRefusal(validated.message) }
  }
```

REPLACE:

```ts
export const commitThread = (store: Store, thread: Thread, message: string): Attempt<Thread> => {
  const bytes = byteSizeOf(thread)
  if (bytes > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) {
    return { ok: false, refusal: overByteCapRefusal(thread, bytes) }
  }
  const validated = ThreadRecord.parse(thread)
  if (!validated.ok) {
    return { ok: false, refusal: invalidThreadRecordRefusal(validated.message) }
  }
```

Rationale: ruling R1's closing sentence — "The cap check happens before the write, never as a
`ThreadRecord.parse` rejection after it." Measuring first is also what lets the two failure modes
carry different messages: over the byte cap, and every other stored-shape violation.

The byte measurement is duplicated between this guard and `src/schema/thread.ts:125`, deliberately.
The schema keeps its own check because the schema is the contract every write path is validated
against, including `store.commit`'s own re-validation at `src/store/records.ts:103-109`; this guard
exists to produce a refusal the caller can act on, and removing either one would leave a gap.

### Step 4 — `src/server/tool-support.ts` — no further edit

There is no step 4 edit. This heading exists so that the numbered steps run unbroken from 1 to 6 and
no reader looks for a missing one; the file is complete after step 3. Run:

```bash
npm run typecheck
```

Expected exit code: 0. Expected output: none.

### Step 5 — `test/store/whole-record-cap.test.ts` — CREATE

Create this file with exactly these contents, first character to last:

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import { commitThread } from '../../src/server/tool-support.ts'
import { toolRefusal } from '../../src/server/errors.ts'
import * as caps from '../../src/schema/caps.ts'
import type { KeyDecision, Thread } from '../../src/schema/thread.ts'

const withStore = (fn: (store: Store, rt: Runtime) => void): void => {
  withRepo((repo) => {
    const pluginData = mkdtempSync(join(tmpdir(), 'logbook-whole-record-cap-data-'))
    try {
      const rt = testRuntime({
        env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData },
        cwd: repo
      })
      const opened = openStore(rt, repo)
      if (!opened.ok) {
        throw new Error(`whole-record-cap fixture: could not open the store: ${opened.message}`)
      }
      fn(opened.value, rt)
    } finally {
      rmSync(pluginData, { recursive: true, force: true })
    }
  })
}

const baseThread = (rt: Runtime): Thread => ({
  id: rt.ulid(),
  slug: 'whole-record-cap-fixture',
  title: 'whole record cap fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [
    { id: rt.ulid(), ordinal: 1, text: 'a criterion for the whole-record cap fixture', done: false, kind: 'planned', struck_by: null }
  ],
  spine: {
    active_goal: 'prove the byte cap refusal names the field and the number',
    next_step: 'read the refusal',
    last_session: 'none',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const maxLengthEntry = (rt: Runtime): KeyDecision => ({
  id: rt.ulid(),
  decision_id: rt.ulid(),
  title: 't'.repeat(caps.KEY_DECISION_TITLE_MAX),
  scope: 'c'.repeat(caps.KEY_DECISION_SCOPE_MAX)
})

const firstTextOf = (result: { content: { type: string }[] }): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the rendered refusal to carry a text content block')
  return (first as { type: 'text'; text: string }).text
}

test('whole-record-cap.refusal-names-the-largest-field-and-the-observed-bytes', () => {
  withStore((store, rt) => {
    const base = baseThread(rt)
    const saturated: Thread = {
      ...base,
      spine: {
        ...base.spine,
        key_decisions: Array.from({ length: caps.KEY_DECISIONS_MAX_ELEMENTS }, () => maxLengthEntry(rt))
      }
    }

    const observed = Buffer.byteLength(JSON.stringify(saturated), 'utf8')
    assert.ok(
      observed > caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      `the fixture must exceed the whole-record byte cap to exercise the refusal; observed ${observed}`
    )
    assert.equal(
      saturated.spine.key_decisions.length,
      caps.KEY_DECISIONS_MAX_ELEMENTS,
      'the fixture must stay within the element cap so the byte cap is the only limit it breaks'
    )

    const attempt = commitThread(store, saturated, 'whole-record cap probe')

    assert.equal(attempt.ok, false, 'committing a thread record over the whole-record byte cap must be refused')
    if (attempt.ok) return

    assert.equal(attempt.refusal.field, 'thread')
    assert.equal(attempt.refusal.retryable, true)

    const rendered = firstTextOf(toolRefusal(attempt.refusal))
    assert.match(rendered, /spine\.key_decisions/, 'the refusal must name the field that grew')
    assert.match(rendered, new RegExp(String(observed)), 'the refusal must state the observed byte count')
    assert.match(
      rendered,
      new RegExp(String(caps.THREAD_RECORD_SERIALISED_MAX_BYTES)),
      'the refusal must state the cap it measured against'
    )
  })
})

test('whole-record-cap.a-record-under-the-cap-still-commits', () => {
  withStore((store, rt) => {
    const attempt = commitThread(store, baseThread(rt), 'whole-record cap control')
    assert.equal(attempt.ok, true, 'a thread record well under the byte cap must still commit')
  })
})
```

Rationale: acceptance criterion 4 — "A test asserts the whole-record cap refusal names the offending
field and the observed byte count."

Three choices this step makes, with the rejected option for each:

- **The file lives under `test/store/`.** It drives a real store in a temporary directory and
  spawns no server, which is what every other file in that directory does. Rejected:
  `test/contract/no-path.test.ts`, whose population is refusal-text path leakage rather than cap
  semantics, and `test/spawn/`, where every file spawns a server this test does not need.
- **The fixture is derived from `src/schema/caps.ts`, not from a hard-coded entry count.** The audit
  probe measured the boundary at 130 full-length entries; writing 130 into a test would make it
  silently stop testing the cap the moment any field of `KeyDecision` changed size. The assertion at
  the top of the test proves the fixture really is over the cap before anything else runs.
- **The assertion is made against the rendered text block, not against `structuredContent`.**
  Ruling R10: "Every acceptance test for a refusal asserts on the `content` text blocks, never on
  `structuredContent`." `toolRefusal` (`src/server/errors.ts:31-37`) is the exact function the
  server uses, and `renderRefusalText` puts `message` on the fifth line of that block. Rejected:
  asserting on `attempt.refusal.message` alone, which would pass even if the rendering dropped it.

The second test is the control: it proves the new guard in step 3 does not refuse an ordinary
record, so a green on the first test cannot come from a guard that refuses everything.

### Step 6 — `package.json` and `.claude-plugin/plugin.json` — RUN — the version bump


This step carries no FIND and no REPLACE block on purpose. The version is read from the file and
incremented, never matched against a hard-coded pair, so that a shifted ladder cannot invalidate it.

Run exactly this, from the repository root:

```bash
node -e '
const fs = require("fs")
const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"))
const pkg = readJson("package.json")
const plugin = readJson(".claude-plugin/plugin.json")
if (pkg.version !== plugin.version) {
  console.error("STOP: package.json and .claude-plugin/plugin.json disagree before the bump")
  process.exit(1)
}
const parts = pkg.version.split(".")
const next = [parts[0], parts[1], String(Number(parts[2]) + 1)].join(".")
for (const p of ["package.json", ".claude-plugin/plugin.json"]) {
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace("\"version\": \"" + pkg.version + "\"", "\"version\": \"" + next + "\""))
}
console.log(next)
'
```

Expected exit code: 0. Expected stdout under the baseline: `1.0.5`.

Then run:

```bash
node scripts/check-packaging.mjs
```

Expected exit code: 0.

Expected `git diff` for the two manifest files under the baseline:

```diff
-  "version": "1.0.4",
+  "version": "1.0.5",
```

in each of `package.json` and `.claude-plugin/plugin.json`.

Rationale: invariant I4 — both manifests move in the same commit and
`node scripts/check-packaging.mjs` passes. The script compares the two versions at
`scripts/check-packaging.mjs:139-149`.

---

## 5. Tests

### 5.1 `test/store/whole-record-cap.test.ts` (new)

Given in full as step 5. Its two test name strings are:

| Test name string | Status | Discharges |
| --- | --- | --- |
| `whole-record-cap.refusal-names-the-largest-field-and-the-observed-bytes` | **new** (step 5) | criterion 4 |
| `whole-record-cap.a-record-under-the-cap-still-commits` | **new** (step 5) | the control for criterion 4's inertness mutation |

Criterion 8 (`npm test` green) is discharged by section 8.

### 5.2 The inherited probes

Orchestrator ruling O10 assigns `repro-f1.ts` to MSP-4, "plus `probe-caps.ts` and
`probe-boundary.ts` for the cap work". `repro-f1.ts` is re-authored by MSP-4b. The two cap probes
are re-authored here, in part.

`probe-caps.ts` printed the four cap constants, then measured two boundaries: the element-count
boundary through `contributeToSpine` (accepted at 200 stored plus one, refused at 201), and the byte
boundary through `ThreadRecord.parse` for short and for maximum-length titles. Its section C showed
the gap that matters — `contributeToSpine` accepting a contribution that `ThreadRecord.parse` then
rejects.

`probe-boundary.ts` committed a thread saturated at the element cap, then measured that 129
maximum-length entries parse and 130 do not, and that `contributeToSpine` is blind to that boundary.

What is carried over: the byte boundary itself, as the fixture in step 5, derived from the caps
module rather than from the measured number 130.

What is deliberately **not** carried over, and why:

- **The printed cap constants.** `test/unit/caps.test.ts` already exists and owns the constants.
- **The element-count boundary through `contributeToSpine`.** It is not defective — SPEC section 5
  D12 says so explicitly: that cap "refuses the whole call, and names the field, the limit, the
  observed count and a remedy". A test asserting correct behaviour that no change touches is a
  change-detector.
- **The exact numbers 129 and 130.** They are a measurement of today's `KeyDecision` shape, not a
  contract. Pinning either into a committed test would make it stop testing the cap the moment the
  shape changed, while still passing.
- **`contributeToSpine`'s blindness to the byte cap.** That is the gap MSP-4b closes, by checking
  the prospective record's bytes before the write rather than routing through `contributeToSpine`.
  Its test belongs there.

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time; `0ade582` at authoring time.

Run, from a worktree at the parent commit with only step 5 applied and none of the `src/` changes:

```bash
node --test test/store/whole-record-cap.test.ts
```

Expected exit code: **1**. This was measured, not predicted: running that command over a copy of the
parent tree carrying only step 5 reports `tests 2`, `pass 1`, `fail 1`.

| Test | Expected outcome on the parent |
| --- | --- |
| `whole-record-cap.refusal-names-the-largest-field-and-the-observed-bytes` | **fails**: `AssertionError [ERR_ASSERTION]: the refusal must name the field that grew`. On the parent the refusal message is `the thread record after this change failed its stored-shape validation: <issue>`, which contains no field name, so the first `assert.match` throws. |
| `whole-record-cap.a-record-under-the-cap-still-commits` | **passes**. It is the control and is green on the parent and after the fix. |

The file compiles on the parent: `commitThread`, `toolRefusal`, `openStore`, `testRuntime` and
`withRepo` all exist there with the signatures the file uses, and none of the identifiers this plan
adds appear in the test. No substitute procedure is needed.

---

## 7. Inertness mutation

Acceptance criterion 4 is the only criterion of this half that names a behaviour the fix adds.

**The exact edit to revert.** In `src/server/tool-support.ts`, delete these four lines from the top
of `commitThread`, so that it begins with `const validated = ThreadRecord.parse(thread)` again:

```ts
  const bytes = byteSizeOf(thread)
  if (bytes > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) {
    return { ok: false, refusal: overByteCapRefusal(thread, bytes) }
  }
```

**The exact command.**

```bash
node --test --test-name-pattern='^whole-record-cap\.refusal-names-the-largest-field-and-the-observed-bytes$' test/store/whole-record-cap.test.ts
```

**The test that must turn red:**
`whole-record-cap.refusal-names-the-largest-field-and-the-observed-bytes`.

**The expected exit code:** **1**.

**The expected failure text:** `AssertionError [ERR_ASSERTION]: the refusal must name the field that
grew`. With the guard gone, `ThreadRecord.parse` rejects the record on its own byte-cap refinement
and `invalidThreadRecordRefusal` composes a message with no field name in it.

**The control that must stay green during the mutation.**

```bash
node --test --test-name-pattern='^whole-record-cap\.a-record-under-the-cap-still-commits$' test/store/whole-record-cap.test.ts
```

Expected exit code: 0, with `fail 0` in the output.

**The exact restore.** Put the four deleted lines back at the top of `commitThread`, then re-run
both commands above; expected exit code 0 and `fail 0` for each.

---

## 8. Full verification

Run all five, from the repository root, in this order.

| # | Command | Expected exit | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | `> tsc -p tsconfig.json --noEmit` and no line after it |
| 2 | `node --test test/store/whole-record-cap.test.ts` | 0 | `fail 0` |
| 3 | `node --test test/contract/no-path.test.ts` | 0 | `fail 0` |
| 4 | `npm test` | 0 | `fail 0` |
| 5 | `node scripts/check-packaging.mjs` | 0 | `check-packaging: ok` |

Command 3 is called out separately because `error.discloses-no-path` runs a closed census over every
exported refusal producer under `src/` and halts on any it does not exercise. This plan renames a
module-private factory and adds two more, all module-private, so that census's population is
unchanged — command 3 is what proves it.

Command 4 is invariant I1 and acceptance criterion 8.

---

## 9. Commits

### Commit 1

```
fix(tool-support): name the field and the byte count in the whole-record cap refusal
```

Files:

- `src/server/tool-support.ts`

Plan steps: 1, 2, 3.

### Commit 2

```
test(store): assert the whole-record cap refusal names its largest field and its size
```

Files:

- `test/store/whole-record-cap.test.ts`

Plan steps: 5.

### Commit 3

```
chore(release): bump the patch version for the whole-record cap refusal repair
```

Files:

- `package.json`
- `.claude-plugin/plugin.json`

Plan steps: 6.

No commit mixes a refactor with a behaviour change. Renaming `wholeRecordCapRefusal` to
`invalidThreadRecordRefusal` travels in commit 1 rather than in a separate refactor commit because
the rename is not behaviour-preserving on its own: the function's `accepted` and `example` strings
change with it, and splitting them would leave one commit shipping a factory whose name contradicts
its text.

---

## 10. Pull request

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head fix/msp-4-record-decision-links-a \
  --base main \
  --title "fix(tool-support): name the field and the size in the record-too-large refusal" \
  --what "A refusal caused by a thread record growing past its size limit now states how many bytes the record is, what the limit is, and which field inside it is the largest." \
  --what "A refusal caused by any other stored-shape problem now carries its own wording instead of borrowing the size-limit one." \
  --why "The size limit fires before the entry-count limit does, and the refusal it produced named neither the field that had grown nor any number, so a caller was told only that validation failed." \
  --risk "The refusal text for this failure changed, so anything matching on the old wording will stop matching." \
  --verified "npm test - 0 failures" \
  --verified "npm run typecheck - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "inertness mutation on the size guard - the named test turned red and the control stayed green" \
  --not-verified "mutation (Stryker) - not run against this diff" \
  --not-verified "coverage - not run"
```

The mutation-scope sentence SPEC section 8.2 requires, included above via `--not-verified`: the
Stryker mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`,
`src/merge/conflict.ts` and `src/render/**`. This change lives in `src/server/` and `test/`, which
fall outside that scope entirely, so the mutation job will report success having mutated nothing in
this diff. No `Verified: mutation` line may be written for this pull request.

---

## 11. Stop conditions

Each of these invalidates this plan. For every one: **STOP and report; do not improvise.**

1. **A FIND string does not match exactly once.** What you see: your editor reports zero matches, or
   more than one, for any FIND block in section 4. STOP and report; do not improvise.

2. **The local verification baseline is red for a missing development dependency.**

       If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
       described by the orchestrator is not yet closed in this checkout. STOP and report.
       Do not edit, skip or delete that test, and do not install anything yourself.

   This is pre-existing and unrelated to this change: `yaml` is declared as a development
   dependency but was never committed into the tracked `node_modules`, and continuous integration
   installs it, so it is green there and red only on a local checkout that has not run an install.
   Closing it is the operator's act.

3. **MSP-0 has not merged, so the manifest-agreement test is still pinned to a literal version.**

       Run: grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts
       If the output contains a quoted version literal such as '1.0.0', MSP-0 has not merged.
       STOP and report; do not improvise, and do not edit this file.

4. **The change is already applied.** Run:

   ```bash
   node -e "const s=require('fs').readFileSync('src/server/tool-support.ts','utf8');process.stdout.write(String(s.includes('overByteCapRefusal')))"
   ```

   Expected output: `false`. If the output is `true`, this change is already in the tree. STOP and
   report; do not improvise.

5. **`test/store/whole-record-cap.test.ts` already exists.** What you see: step 5's CREATE would
   overwrite a file. STOP and report; do not improvise.

6. **`package.json` and `.claude-plugin/plugin.json` disagree before the change.** What you see: the
   step 6 command prints `STOP: package.json and .claude-plugin/plugin.json disagree before the
   bump` and exits 1. STOP and report; do not improvise. A version merely *higher* than `1.0.4` is
   **not** a stop condition — it means the ladder shifted, and the step handles it.

7. **The refusal census halts.** What you see: command 3 of section 8 fails with a message
   containing `census halted on an unclassifiable item`. A refusal factory this plan added has been
   exported, so `scanRefusalProducers` found a producer nothing exercises. STOP and report; do not
   improvise. Do not add an allowlist and do not narrow the population — invariant I8.

8. **The inertness mutation does not turn the named test red.** What you see: the section 7 command
   exits 0 with the four lines deleted. The test is not testing the fix. STOP and report; do not
   improvise.

9. **`npm test` fails in a file this plan does not name.** What you see: command 4 of section 8
   reports a failure outside `test/store/whole-record-cap.test.ts`, and outside
   `workflow-hardening-census`, which stop condition 2 covers. STOP and report; do not improvise.
