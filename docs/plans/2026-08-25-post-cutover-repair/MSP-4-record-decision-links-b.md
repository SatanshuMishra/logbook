# MSP-4b — `record_decision` links the decision it records

## 0. Identity

- **Closes:** defect D1 — `record_decision` records a decision that is invisible on its own thread.
- **Depends on:** MSP-4a (`fix/msp-4-record-decision-links-a`), MSP-2
  (`fix/msp-2-cas-retry-reread`) and MSP-0. All three must already be merged into `main`. Section 11
  gives an exact, runnable check for each.
- **Required by:** nothing in this ladder.
- **Branch name:** `fix/msp-4-record-decision-links-b`
- **Version bump:** Baseline `1.0.5` -> `1.0.6` per orchestrator ruling O1 as adjusted by ruling O7
  (a split MSP consumes one extra patch). The step in section 4 reads the current version and
  increments the patch, so a shifted ladder does not invalidate it.
- **SPEC anchors:** section 7 MSP-4, section 6 ruling R1, section 5 defects D1 and D11.

### What this plan is, in plain words

A **thread** is one unit of work the project tracks. A **decision** is a write-once record of a
choice that was made. The thread carries a running summary called the **spine**, and one of its
fields, `key_decisions`, is a list of links from the thread to decisions.

Today `record_decision` writes the decision file and nothing else. Nothing links it to its thread.
The briefing a later session reads is built entirely from `key_decisions`, so a decision recorded
this way is absent from both of the briefing's decision sections and is retrievable only by someone
who already knows its 26-character identifier. Linking is possible, but only through a second,
separate call that nothing tells the caller to make.

This change writes the link in the same commit as the decision. It also settles what the link's
`scope` field says, and what happens when the thread record has no room left for another link.

---

## 1. Acceptance criteria (the ceiling)

Copied verbatim from SPEC section 7, MSP-4, numbered as there. This plan carries criteria 1, 2, 3,
5, 6, 7 and 8. Criterion 4 was discharged by MSP-4a and is named here only so the split is explicit.

1. A test records a decision and asserts it appears in **both** the `Key decisions:` and
   `Decisions:` sections of the rendered briefing, with no intervening `update_thread`. Red on the
   parent — the audit's `repro-f1.ts` becomes this test.
2. A test asserts `scope` derives to `criterion <ordinal>` of the lowest-ordinal open criterion;
   a second asserts an explicit `scope` overrides it; a third asserts the call refuses, naming
   `scope`, when no open criterion remains.
3. A test saturates the thread to the byte cap and asserts the decision is still recorded, the
   result carries `linked: false` with a populated reason, and the call returns `ok: true`.
5. `test/spawn/decisions.test.ts`'s `concurrent.distinct-ids` stays green, including its retry
   guard.
6. `test/sync/two-clones-spawn.test.ts` stays green; both clones now write the thread record
   offline, so its divergence assertion is re-derived rather than assumed.
7. Inertness: removing the thread record from the commit array turns criterion 1 red.
8. `npm test` green.

**Criterion 4** (the whole-record cap refusal names the offending field and the observed byte count)
is discharged by MSP-4a, not by this plan.

That list is the complete definition of done for this unit of work. Anything discovered above it is
appended to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence. It
is not folded into this plan, and it does not reopen this plan once these seven are met.

---

## 2. Ground truth

Line numbers are those of the tree with MSP-4a already merged, which changes only
`src/server/tool-support.ts` and adds one test file; nothing below moved.

### 2.1 `src/server/tools/record_decision.ts:14-28` — the input schema

```ts
const RecordDecisionInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread this decision belongs to; the thread must currently be open'),
  title: z.string().min(1).max(caps.DECISION_TITLE_MAX).describe('a one-line title for the decision'),
  context: z.string().max(caps.DECISION_CONTEXT_MAX).describe('the situation that forced this choice'),
  options: z
    .array(z.string().max(caps.DECISION_OPTION_MAX).describe('one option that was on the table'))
    .max(caps.DECISION_OPTIONS_MAX_ELEMENTS)
    .describe('the options that were on the table, for example ["ship the fast path", "keep the safe default"]'),
  outcome: z.string().max(caps.DECISION_OUTCOME_MAX).describe('the outcome that was chosen and why'),
  supersedes: z
    .array(ulidField('the id of a decision this new one reverses or replaces'))
    .max(caps.DECISION_SUPERSEDES_MAX_ELEMENTS)
    .optional()
    .describe('decision ids this new decision supersedes; omit or send an empty array when this decision supersedes nothing')
})
```

What is wrong with it: there is no `scope`. The spine link this tool must now write requires one —
`KeyDecisionSchema.scope` (`src/schema/thread.ts:77`) is a required, capped string — and 1.0.0 has
no notion of a "current criterion" to fall back on.

### 2.2 `src/server/tools/record_decision.ts:30-34` — the output schema

```ts
const RecordDecisionOutputSchema = z.object({
  decision_id: z.string().describe('the id minted for the new decision record'),
  thread_id: z.string().describe('the id of the thread the decision was recorded against'),
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read')
})
```

What is wrong with it: nothing today, but once the link can be skipped there is no field in which
the result could say so, and a success that silently did less than it promised is exactly what
invariant I2 forbids.

### 2.3 `src/server/tools/record_decision.ts:110-112,155` — the thread is read and never written

```ts
    const loaded = loadThread(store, 'thread_id', input.thread_id)
    if (!loaded.ok) return { ok: false, refusal: loaded.refusal }
    const thread = loaded.value
```

```ts
    const committed = store.commit([{ kind: 'decision', record: validated.value }], `record decision ${validated.value.id} on thread ${thread.slug}`)
```

What is wrong with it: the thread is loaded at `:110` only to prove it exists and is open, and is
never written back. The commit array carries exactly one change. The decision file lands on disk and
`thread.updated_at` is not even bumped.

### 2.4 `src/server/tools/close_thread.ts:105-111` — the two-record commit shape to copy

```ts
    const committed = store.commit(
      [
        { kind: 'thread', record: validated.value },
        { kind: 'session', record: sessionEntry }
      ],
      `close thread ${thread.slug} as ${input.outcome}`
    )
```

What is wrong with it: nothing. SPEC section 7 names it as the shape MSP-4 copies: one
`store.commit` call carrying two changes, so the two records land in one commit or neither does.

### 2.5 `src/server/tools/resume_thread.ts:63-83` — why the link is what the briefing reads

```ts
    const decisionOutcomes = thread.spine.key_decisions.map((keyDecision) => ({
      decisionId: keyDecision.decision_id,
      slot: store.readDecision(keyDecision.decision_id)
    }))
```

```ts
    const briefing = renderBriefing(thread, decisions, writtenPointer)
```

What is wrong with it: nothing, and this plan does not change it. It is quoted because it is the
proof that the defect is not cosmetic — the briefing's decision list is built by mapping over
`key_decisions`, and `src/store/records.ts:23-29` exposes `readDecision(id)` with no plural, so
there is no directory scan anywhere that could find an unlinked decision.

### 2.6 `src/render/briefing.ts:16,20-21,46,52` — the two sections criterion 1 names

```ts
const renderKeyDecisionLine = (keyDecision: KeyDecision): string => `- ${escapeStored(keyDecision.title)}`
```

```ts
const renderDecisionLine = (decision: Decision): string =>
  `- ${escapeStored(decision.title)}: ${escapeStored(decision.outcome)}`
```

```ts
    'Key decisions:',
```

```ts
    'Decisions:',
```

What is wrong with them: nothing. They are quoted because the test in section 5 asserts the exact
line that follows each heading, and those two renderers define it: `- <title>` under
`Key decisions:`, and `- <title>: <outcome>` under `Decisions:`.

### 2.7 `src/schema/thread.ts:9-16,19` — the shapes the derivation reads and writes

```ts
export type Criterion = {
  id: Ulid
  ordinal: number
  text: string
  done: boolean
  kind: 'planned' | 'detour'
  struck_by: Ulid | null
}
```

```ts
export type KeyDecision = { id: Ulid; decision_id: Ulid; title: string; scope: string }
```

What is wrong with them: nothing. They are quoted because "neither done nor struck" is two
independent tests against two differently-typed fields — `done` is a boolean, and "struck" is
`struck_by !== null`, not a boolean — and getting that wrong would write a scope nobody can amend.

### 2.8 `src/domain/spine.ts:21-37` — why `contributeToSpine` must not be used here

```ts
const CALLER_FIELD: Record<CollectionField, string> = {
  open_risks: 'risks_add',
  key_decisions: 'key_decisions_add',
  out_of_scope: 'out_of_scope_add'
}
```

What is wrong with it: nothing, for its own caller. It maps the stored field name onto the argument
name that `update_thread` publishes, so a refusal from `contributeToSpine` names
`key_decisions_add`. `record_decision` has no such argument, so routing the link through it would
produce a refusal naming a parameter that does not exist. SPEC section 7 states the prohibition
outright: "**Do not** route the link through `contributeToSpine` and `commitThread` unmodified."

### 2.9 `test/spawn/decisions.test.ts:420` — the retry guard the prohibition protects

```js
const isContentionRefusal = (refusal) => refusal.retryable === true && refusal.field === 'decision' && 'detail' in refusal
```

What is wrong with it: nothing, and this plan must not break it. This line is inside the template
literal at `:392-450` that `buildConcurrentRecorderScript` writes out as a standalone `.mjs` child
process. Eight of those children race to record a decision on one thread; each retries up to twenty
times while the refusal it gets back is a contention refusal. It identifies contention by
`refusal.field === 'decision'`. Routing the commit through `commitThread` would change that field to
`'thread'`, the children would stop retrying, and they would exit 1.

### 2.10 `test/spawn/decisions.test.ts:78-83,105` — the fixture that cannot reach the store

```ts
type SpawnFixture = {
  spawned: SpawnedServer
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
}
```

```ts
    await fn({ spawned, published, outputSchemas })
```

What is wrong with it: `withSpawnFixture` creates `repo` and `pluginData` at `:92-93` and then
discards both. `scope` is not rendered anywhere in the briefing — `renderKeyDecisionLine` prints
only the title — so criterion 2 cannot be asserted through the briefing and needs the stored record.

### 2.11 `test/sync/two-clones-spawn.test.ts:176-263` — the divergence scenario

```ts
    const secondDecisionSlots = decisionSlotsOf(second)
    const secondLive = secondDecisionSlots.filter((slot) => !slot.quarantined)
    assert.equal(secondLive.length, 2, 'nothing lost: the second teammate must hold both decisions')
```

```ts
    assert.notEqual(firstDecisionId, secondDecisionId, 'no collision: the two identifiers must be distinct')
```

What is wrong with it: nothing yet, but its premise changes. Today the two clones go offline and
each records a decision, which writes two *different* files, so the merge has no shared record to
reconcile. After this change both clones also write *the same* thread record, so the merge has to
reconcile `spine.key_decisions` from both sides. `THREAD_RULES['spine.key_decisions']` is
`'union-by-id'` (`src/merge/field-merge.ts:30`) and `unionByIdGeneric` (`:103-114`) keeps both
sides, so the existing assertions still hold — but nothing in the file asserts the spine survived,
which is what criterion 6 means by re-derived rather than assumed.

### 2.12 `test/contract/no-path.test.ts:28,110-116,353-396` — the census the new refusals join

```ts
import { recordDecisionTool, invalidDecisionRefusal } from '../../src/server/tools/record_decision.ts'
```

```ts
const RECORD_DECISION_OPTION_CAP_PRODUCER: ProducerId = 'server/tools/record_decision.ts#optionCapRefusal'
```

What is wrong with it: nothing, and this plan must keep it that way. `scanRefusalProducers`
enumerates every **exported** value under `src/` whose call signature returns a `Refusal`, and
`error.discloses-no-path` halts on any producer the file does not exercise. `record_decision.ts`
exports all six of its refusal factories, so the two this plan adds are exported too, and step 10
adds the two exercises that keep the census whole.

### 2.13 `test/contract/no-path.test.ts:817-834,927-934` — the fixture with no criteria

```ts
const syncFixtureThread = (rt: Runtime, slug: string, title: string): Thread => ({
  id: rt.ulid(),
  slug,
  title,
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
```

```ts
    const anaDecision = await recordDecisionTool.handler(ana.rt, STUB_TOOL_CTX, {
      thread_id: original.id,
      title: 'a divergence fixture decision',
      context: 'a divergence fixture context',
      options: ['a divergence fixture option'],
      outcome: 'a divergence fixture outcome'
    })
```

What is wrong with it: nothing today, and it is not a defect after this change either — but it is
the one place in the suite that records a decision against a thread with **no completion criteria at
all**. `open_thread` refuses to mint a thread without at least one, so this shape exists only as a
synthetic fixture; the schema permits it because `completion_criteria` carries a `.max()` and no
`.min()` (`src/schema/thread.ts:115-118`). After step 6 there is nothing to derive a scope from, so
the call refuses and the fixture throws. Step 14's fourth pair supplies the explicit `scope` that
the refusal itself tells a caller to send.

This was found by applying section 4 mechanically and running the suite, not by reading.

---

## 3. Divergences from the SPEC

1. **The ladder lands on `1.1.1`, not `1.1.0`.** SPEC section 7 states the ladder lands on `1.1.0`,
   which cannot hold alongside MSP-9 merging last. Orchestrator ruling O2 settles it: MSP-9 merges
   last and the ladder lands on `1.1.1`.
2. **The pull request tool path.** SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`.
   There is no `.claude/lib` in this repository. The tool is the operator's global one at
   `node ~/.claude/lib/git/pr.mjs pr-create`, which section 10 uses.
3. **MSP-4 is split, so it consumes two patch versions.** SPEC section 7 makes the split conditional;
   orchestrator ruling O7 forbids passing that condition downstream. The measured arithmetic is in
   divergence 4 below. This half takes the second patch, which shifts every MSP below MSP-4 by one.
   Ruling O6's read-then-increment step absorbs that shift.
4. **This half measures 404 changed lines against SPEC section 7's 400-line ceiling.** The number was
   measured, not estimated: section 4 was applied mechanically to copies of the four files it touches
   and the resulting diff counted, as 99 lines in `src/server/tools/record_decision.ts`, 258 in
   `test/spawn/decisions.test.ts`, 20 in `test/sync/two-clones-spawn.test.ts`, 23 in
   `test/contract/no-path.test.ts` and 4 across the two manifests. The four-line overshoot is
   disclosed rather than removed, because both ways to remove it cost more than they save.
   Rejected: dropping one of the five tests step 11 adds — each discharges a numbered acceptance
   criterion the SPEC fixed before this work started, and acceptance is a ceiling, not a menu.
   Rejected: exercising `scopeCapRefusal` in step 14 by calling the factory directly instead of
   driving it through the real handler, which would save ten lines and stop proving the new refusal
   is reachable through the tool at all.
   **The orchestrator has accepted this overshoot as authored.** It is settled, not open: do not
   re-split this plan and do not spend effort shaving lines off it.
5. **Ruling R1 does not say `scope` is escaped; this plan escapes it.** R1 says an explicit `scope`
   "is used verbatim". Every string this project stores is passed through `escapeStored` first, and
   `contributeToSpine` escapes exactly this field at `src/domain/spine.ts:216`. "Verbatim" is read as
   "not replaced by a derived value", not as "not escaped". Because escaping can lengthen a string
   past its cap, step 5 adds a cap refusal for `scope` that R1 does not mention.
6. **MSP-4 gains a dependency on MSP-0 that the SPEC does not record.** SPEC section 7 lists only
   MSP-2. `test/contract/cutover-manifests-agree.test.ts:8` reads
   `const EXPECTED_VERSION = '1.0.0'`, so every MSP's version bump fails it. Orchestrator ruling O15
   settles this ladder-wide — MSP-0 de-pins the constant permanently, and no later MSP edits that
   file. This plan therefore writes no edit to it and carries stop condition 5 in section 11.
7. **`record_decision`'s published description is not touched here.** It still describes a tool that
   writes one record and returns its id, which understates what it now does. SPEC section 5 D14
   lists four published descriptions that state behaviour the code does not implement, and
   `record_decision`'s is not among them, so MSP-8 does not inherit it either. It is filed as `F4a`
   rather than folded in.
8. **A thread whose criteria are all done, struck, or absent can no longer record a decision
   without an explicit `scope`.** This follows directly from ruling R1 clause 3 and is intended —
   R1 rejects "writing a value nobody chose into a write-once ledger". It is recorded here because
   it is a real behavioural narrowing that the SPEC states as a rule rather than as a consequence,
   and because it is what makes step 14's fourth pair necessary. A caller that hits it is told the
   exact remedy by the refusal.
9. **`src/server/tools/park_thread.ts` and `src/server/tools/close_thread.ts` keep their own
   byte-cap refusals.** Both carry a private `wholeRecordCapRefusal` that MSP-4a did not touch,
   because MSP-4a's declared surface is `src/server/tool-support.ts` alone. Both therefore still
   refuse without naming a field or a number. Filed as `F4b`.

---

## 4. The change, step by step

Apply the steps in the order given. Steps 1 through 8 change one file and leave the tree
type-correct; run `npm run typecheck` after step 8 before continuing. Steps 9 through 14 change three
test files. Step 15 is the version bump.

Every FIND string below was copied from the file named, and every one was verified to match
**exactly once** by applying this section mechanically to copies of the four files. If a FIND string
does not match exactly once, stop and read section 11.

### Step 1 — `src/server/tools/record_decision.ts` — REPLACE — the imports the link needs

FIND:

```ts
import { DecisionRecord, type Decision } from '../../schema/decision.ts'
```

REPLACE:

```ts
import { DecisionRecord, type Decision } from '../../schema/decision.ts'
import { ThreadRecord, type Criterion, type KeyDecision, type Thread } from '../../schema/thread.ts'
import type { RecordChange } from '../../store/write-path.ts'
```

Rationale: step 7 constructs a `KeyDecision`, builds a prospective `Thread`, validates it with
`ThreadRecord.parse`, and annotates the commit array as `RecordChange[]` so its two `kind` strings
are not widened to `string`. `Criterion` is the return type of the reducer in step 4.

### Step 2 — `src/server/tools/record_decision.ts` — REPLACE — the optional `scope` input

FIND:

```ts
  outcome: z.string().max(caps.DECISION_OUTCOME_MAX).describe('the outcome that was chosen and why'),
  supersedes: z
```

REPLACE:

```ts
  outcome: z.string().max(caps.DECISION_OUTCOME_MAX).describe('the outcome that was chosen and why'),
  scope: z
    .string()
    .min(1)
    .max(caps.KEY_DECISION_SCOPE_MAX)
    .optional()
    .describe(
      'the criterion or area of the thread this decision resolved, stored on the spine link; omit it and the lowest-numbered completion criterion that is neither done nor struck is used'
    ),
  supersedes: z
```

Rationale: ruling R1 clause 1 — "`record_decision` gains an **optional** `scope` input. When
supplied, it is used verbatim."

### Step 3 — `src/server/tools/record_decision.ts` — REPLACE — the two new output fields

FIND:

```ts
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read')
})
```

REPLACE:

```ts
  commit: z.string().nullable().describe('the project HEAD sha recorded on the decision, or null when it could not be read'),
  linked: z.boolean().describe('whether this call also linked the decision into the thread running summary'),
  link_skipped_reason: z
    .string()
    .nullable()
    .describe('why the spine link was not written, or null when it was written')
})
```

Rationale: ruling R1 — "`RecordDecisionOutputSchema` gains `linked: boolean` and
`link_skipped_reason: string | null`." Ruling R10 makes these the load-bearing carriers: on a
success Claude Code replaces the text blocks with the structured result, so anything the model must
act on has to live here rather than in the prose.

### Step 4 — `src/server/tools/record_decision.ts` — INSERT-AFTER — the derivation

FIND:

```ts
type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>
type RecordDecisionOutput = z.infer<typeof RecordDecisionOutputSchema>
```

REPLACE:

```ts
type RecordDecisionInput = z.infer<typeof RecordDecisionInputSchema>
type RecordDecisionOutput = z.infer<typeof RecordDecisionOutputSchema>

const deriveScope = (thread: Thread): string | null => {
  const open = thread.completion_criteria.filter((criterion) => !criterion.done && criterion.struck_by === null)
  const lowest = open.reduce<Criterion | null>(
    (best, candidate) => (best === null || candidate.ordinal < best.ordinal ? candidate : best),
    null
  )
  return lowest === null ? null : `criterion ${lowest.ordinal}`
}
```

Rationale: ruling R1 clause 2 — "When omitted, `scope` is derived as the **lowest-`ordinal`
criterion that is neither `done` nor struck**, rendered as the fixed short form `criterion
<ordinal>`. Deterministic, <= 200 characters by construction, and meaningful to a reader."

"Neither done nor struck" is two tests against two differently-typed fields, per ground truth 2.7:
`!criterion.done` and `criterion.struck_by === null`. The reducer takes the lowest `ordinal` rather
than the first array element, because `ordinal` is the recorded display position and array order is
not guaranteed to match it.

### Step 5 — `src/server/tools/record_decision.ts` — INSERT-AFTER — the two new refusals

FIND:

```ts
export const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'decision',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for this decision did not complete; retry the call.'
    },
    detail
  )
```

REPLACE:

```ts
export const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'decision',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for this decision did not complete; retry the call.'
    },
    detail
  )

export const scopeCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'scope',
  accepted: `at most ${caps.KEY_DECISION_SCOPE_MAX} characters after escaping`,
  example: 'the merge queue fast path',
  retryable: true,
  message: `scope exceeds its cap of ${caps.KEY_DECISION_SCOPE_MAX} characters after escaping; observed ${observed}; remedy: shorten the scope and retry.`
})

export const noOpenCriterionRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'scope',
  accepted: 'an explicit scope, when no completion criterion is left open to derive one from',
  example: 'the merge queue fast path',
  retryable: true,
  message: `every completion criterion on thread ${threadId} is done or struck, so scope cannot be derived; the decision was not recorded; remedy: send scope explicitly and retry.`
})
```

Rationale: `noOpenCriterionRefusal` is ruling R1 clause 3 — "When no such criterion exists — every
criterion done or struck — the call **refuses**, naming `scope`, stating that no open criterion
remains to derive it from, and giving the explicit form to re-send. It does not invent a value."

`scopeCapRefusal` is not in R1 and is added here because escaping can lengthen a string past its cap;
divergence 5 in section 3 records that. Without it, an over-long explicit `scope` would fall through
to the prospective-record validation in step 7 and be reported as a *skipped link* on an `ok: true`
result — turning a caller error into a silent partial success, which is what invariant I2 forbids.

Both are **exported**, matching the six factories already exported from this file, and step 10 adds
the two exercises `error.discloses-no-path` needs. Rejected: making them module-private, which would
keep that census green without ever checking either message for a leaked path.

### Step 6 — `src/server/tools/record_decision.ts` — REPLACE — resolve `scope` before anything is minted

FIND:

```ts
    const commit = readProjectHead(rt, rt.cwd)
```

REPLACE:

```ts
    const escapedScope = input.scope === undefined ? deriveScope(thread) : escapeStored(input.scope)
    if (escapedScope === null) {
      return { ok: false, refusal: noOpenCriterionRefusal(thread.id) }
    }
    if (escapedScope.length > caps.KEY_DECISION_SCOPE_MAX) {
      return { ok: false, refusal: scopeCapRefusal(escapedScope.length) }
    }

    const commit = readProjectHead(rt, rt.cwd)
```

Rationale: ruling R1 clauses 1 to 3. Placing this before `readProjectHead` and before `rt.ulid()` is
what keeps the refusal path free of side effects — no identifier is minted and no clock is read for
a call that is about to refuse.

### Step 7 — `src/server/tools/record_decision.ts` — REPLACE — the two-record commit

FIND:

```ts
    const committed = store.commit([{ kind: 'decision', record: validated.value }], `record decision ${validated.value.id} on thread ${thread.slug}`)
    if (!committed.ok) {
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    return {
      ok: true,
      text: `recorded decision ${validated.value.id} on thread ${thread.slug}.`,
      structured: { decision_id: validated.value.id, thread_id: thread.id, commit: validated.value.commit }
    }
```

REPLACE:

```ts
    const keyDecision: KeyDecision = {
      id: rt.ulid(),
      decision_id: validated.value.id,
      title: validated.value.title,
      scope: escapedScope
    }

    const prospective: Thread = {
      ...thread,
      spine: { ...thread.spine, key_decisions: [...thread.spine.key_decisions, keyDecision] },
      updated_at: rt.now()
    }

    const prospectiveBytes = Buffer.byteLength(JSON.stringify(prospective), 'utf8')
    const prospectiveValidated =
      prospectiveBytes > caps.THREAD_RECORD_SERIALISED_MAX_BYTES ? null : ThreadRecord.parse(prospective)

    const linkSkippedReason =
      prospectiveValidated === null
        ? `linking this decision would take the thread record to ${prospectiveBytes} bytes, over its cap of ${caps.THREAD_RECORD_SERIALISED_MAX_BYTES} bytes; the decision was recorded and the spine link was not written; remedy: strike an entry from the thread running summary, then link this decision with update_thread key_decisions_add.`
        : prospectiveValidated.ok
          ? null
          : `the thread record carrying this link failed its stored-shape validation, so the decision was recorded and the spine link was not written: ${prospectiveValidated.message}`

    const changes: RecordChange[] =
      prospectiveValidated !== null && prospectiveValidated.ok
        ? [
            { kind: 'decision', record: validated.value },
            { kind: 'thread', record: prospectiveValidated.value }
          ]
        : [{ kind: 'decision', record: validated.value }]

    const committed = store.commit(changes, `record decision ${validated.value.id} on thread ${thread.slug}`)
    if (!committed.ok) {
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    return {
      ok: true,
      text:
        linkSkippedReason === null
          ? `recorded decision ${validated.value.id} on thread ${thread.slug} and linked it into the running summary.`
          : `recorded decision ${validated.value.id} on thread ${thread.slug}; the running-summary link was not written.`,
      structured: {
        decision_id: validated.value.id,
        thread_id: thread.id,
        commit: validated.value.commit,
        linked: linkSkippedReason === null,
        link_skipped_reason: linkSkippedReason
      }
    }
```

Rationale: ruling R1's opening — "**The link is written by `record_decision`, in the same commit as
the decision.** A design where the caller must remember a second call is the defect, not the
remedy." The commit array copies the shape at `src/server/tools/close_thread.ts:105-111` that SPEC
section 7 names.

The cap half is ruling R1's third clause: "**At the cap, the decision is written and the link is
not, and the result says so.** [...] The implementation constructs the prospective thread record,
validates it, and on failure commits the decision alone", and "The cap check happens before the
write, never as a `ThreadRecord.parse` rejection after it." The byte measurement runs first and by
itself, so the reason can quote the size it actually saw; `ThreadRecord.parse` still runs behind it
for every other stored-shape violation.

Four choices this step makes, with the rejected option for each:

- **`store.commit` is called directly, not through `commitThread`.** SPEC section 7: "**Do not**
  route the link through `contributeToSpine` and `commitThread` unmodified. Doing so produces a
  refusal naming `key_decisions_add`, a parameter this tool does not have, and changes the refusal
  field from `decision` to `thread`, which breaks the retry guard at
  `test/spawn/decisions.test.ts:419`." Rejected: `commitThread`, for those two reasons.
- **The commit failure keeps `commitFailureRefusal`, whose `field` is `'decision'`.** Ground truth
  2.9 shows eight racing child processes identifying contention by that exact field name. Rejected:
  any refusal whose field changes on this path.
- **The key-decision identifier is minted after the decision's.** `rt.ulid()` is called for the
  decision at `:139` and for the link here, in that order, so the decision keeps the first
  identifier a deterministic runtime hands out. Rejected: minting the link first, which would shift
  every identifier an existing test reads back.
- **A skipped link still returns `ok: true`.** Ruling R1: "On the skip path the call still returns
  `ok: true`, because the decision **was** recorded, and `linked: false` with a populated reason is a
  faithful report of what happened. This satisfies invariant I2 through its second clause, not its
  first." Rejected: refusing the whole call at the cap, which "converts a call that succeeds today
  into a failure, and the thing the caller most needs — the decision on the record — is the thing it
  would throw away"; and rejected: silently skipping the link, which is defect D1 again.

### Step 8 — `src/server/tools/record_decision.ts` — no further edit

There is no step 8 edit. This heading exists so that the numbered steps run unbroken from 1 to 15 and
no reader looks for a missing one; the file is complete after step 7. Run:

```bash
npm run typecheck
```

Expected exit code: 0. Expected output: none.

### Step 9 — `test/spawn/decisions.test.ts` — REPLACE — let the fixture reach the store

FIND:

```ts
type SpawnFixture = {
  spawned: SpawnedServer
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
}
```

REPLACE:

```ts
type SpawnFixture = {
  spawned: SpawnedServer
  published: PublishedTool[]
  outputSchemas: Map<string, Record<string, unknown>>
  repo: string
  pluginData: string
}
```

FIND:

```ts
    await fn({ spawned, published, outputSchemas })
```

REPLACE:

```ts
    await fn({ spawned, published, outputSchemas, repo, pluginData })
```

FIND:

```ts
import { openStore, type Store } from '../../src/store/records.ts'
```

REPLACE:

```ts
import { openStore, type Store } from '../../src/store/records.ts'
import type { KeyDecision, Thread } from '../../src/schema/thread.ts'
```

Rationale: ground truth 2.10 — `withSpawnFixture` already creates both paths and discards them, and
`scope` is not rendered in the briefing, so criterion 2 can only be asserted against the stored
thread record. `test/spawn/resume.test.ts:271-280` reads the store the same way from the same two
paths.

### Step 10 — `test/spawn/decisions.test.ts` — INSERT-AFTER — a helper that reads the stored thread

FIND:

```ts
const runRejectsInvalid = async (
  fx: SpawnFixture,
  toolName: string,
```

REPLACE:

```ts
const readStoredThread = (fx: SpawnFixture, threadId: string): Thread => {
  const rt = testRuntime({
    env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
    cwd: fx.repo
  })
  const opened = openStore(rt, fx.repo)
  if (!opened.ok) throw new Error(`decisions fixture: could not open the store to re-read a thread: ${opened.message}`)
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) {
    throw new Error(`decisions fixture: thread "${threadId}" could not be re-read from the store`)
  }
  return slot.record
}

const openThreadWithCriteria = async (
  fx: SpawnFixture,
  slug: string,
  criteria: string[]
): Promise<{ threadId: string; criteria: { id: string; ordinal: number }[] }> => {
  const opened = (await fx.spawned.client.callTool({
    name: 'open_thread',
    arguments: { title: `${slug} fixture`, slug, completion_criteria: criteria }
  })) as CallToolResult
  assertOkResult(`open_thread (${slug})`, opened)
  const structured = opened.structuredContent as {
    thread_id: string
    completion_criteria: { id: string; ordinal: number }[]
  }
  return { threadId: structured.thread_id, criteria: structured.completion_criteria }
}

const markCriterionDone = async (fx: SpawnFixture, threadId: string, criterionId: string): Promise<void> => {
  const marked = (await fx.spawned.client.callTool({
    name: 'update_thread',
    arguments: { thread_id: threadId, criteria_done: [criterionId] }
  })) as CallToolResult
  assertOkResult('update_thread (mark a criterion done)', marked)
}

const runRejectsInvalid = async (
  fx: SpawnFixture,
  toolName: string,
```

Rationale: as step 9. `readStoredThread` is a copy of the one at
`test/spawn/resume.test.ts:271-280`, with the fixture object substituted for its three loose path
arguments. `openThreadWithCriteria` and `markCriterionDone` exist because two of the tests step 11
adds need the same eleven-line arrange — open a thread with named criteria, then mark one done — and
duplicating it in both would put the fixture's shape in two places.

### Step 11 — `test/spawn/decisions.test.ts` — INSERT-AFTER — the five new tests

FIND:

```ts
test('log_session_event.spawn.contract', async () => {
```

REPLACE:

```ts
test('decision.appears-in-both-briefing-sections-without-a-second-call', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'link decisions into the spine automatically',
        context: 'a decision recorded alone never reaches the briefing',
        options: ['auto-link in record_decision', 'require a follow-up update_thread'],
        outcome: 'auto-link, because the follow-up is silently optional'
      }
    })) as CallToolResult
    assertOkResult('record_decision (auto-link)', recorded)
    const recordedStructured = recorded.structuredContent as { linked: boolean; link_skipped_reason: string | null }
    assert.equal(recordedStructured.linked, true, 'a decision on an ordinary thread must be linked by the same call')
    assert.equal(recordedStructured.link_skipped_reason, null)

    const resumed = (await fx.spawned.client.callTool({
      name: 'resume_thread',
      arguments: { thread_id: threadId }
    })) as CallToolResult
    assertOkResult('resume_thread (briefing)', resumed)
    const lines = (resumed.structuredContent as { briefing: string }).briefing.split('\n')

    const keyDecisionsAt = lines.indexOf('Key decisions:')
    const decisionsAt = lines.indexOf('Decisions:')
    assert.notEqual(keyDecisionsAt, -1, 'the briefing must carry a Key decisions section')
    assert.notEqual(decisionsAt, -1, 'the briefing must carry a Decisions section')
    assert.equal(
      lines[keyDecisionsAt + 1],
      '- link decisions into the spine automatically',
      'the Key decisions section must carry the decision title with no intervening update_thread call'
    )
    assert.equal(
      lines[decisionsAt + 1],
      '- link decisions into the spine automatically: auto-link, because the follow-up is silently optional',
      'the Decisions section must carry the decision title and its outcome'
    )
  })
})

test('decision.scope-derives-to-the-lowest-open-criterion', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-derivation-fixture', [
      'the first criterion',
      'the second criterion',
      'the third criterion'
    ])
    const first = fixture.criteria[0]
    assert.ok(first !== undefined, 'open_thread must mint the completion criteria it was given')
    assert.equal(first.ordinal, 1, 'the first minted criterion must carry ordinal 1')
    await markCriterionDone(fx, fixture.threadId, first.id)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with a derived scope',
        context: 'the first criterion is already done',
        options: ['derive the scope', 'demand an explicit one'],
        outcome: 'derive it from the lowest criterion still open'
      }
    })) as CallToolResult
    assertOkResult('record_decision (derived scope)', recorded)

    const stored = readStoredThread(fx, fixture.threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      'criterion 2',
      'scope must derive to the lowest-ordinal criterion that is neither done nor struck'
    )
  })
})

test('decision.scope-uses-an-explicit-value-in-place-of-the-derived-one', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 'a decision with an explicit scope',
        context: 'the caller knows the area better than the derivation does',
        options: ['use the derived scope', 'send an explicit one'],
        outcome: 'send an explicit one',
        scope: 'the merge queue fast path'
      }
    })) as CallToolResult
    assertOkResult('record_decision (explicit scope)', recorded)

    const stored = readStoredThread(fx, threadId)
    assert.equal(stored.spine.key_decisions.length, 1)
    assert.equal(
      stored.spine.key_decisions[0]?.scope,
      'the merge queue fast path',
      'an explicit scope must be stored in place of the derived one'
    )
  })
})

test('decision.refuses-naming-scope-when-no-open-criterion-remains', async () => {
  await withSpawnFixture(async (fx) => {
    const fixture = await openThreadWithCriteria(fx, 'scope-refusal-fixture', ['the only criterion'])
    const only = fixture.criteria[0]
    assert.ok(only !== undefined, 'open_thread must mint the one criterion it was given')
    await markCriterionDone(fx, fixture.threadId, only.id)

    const refused = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: fixture.threadId,
        title: 'a decision with nothing to derive a scope from',
        context: 'every criterion is done',
        options: ['invent a scope', 'refuse and say so'],
        outcome: 'refuse and say so'
      }
    })) as CallToolResult

    assert.equal(refused.isError, true, 'record_decision must refuse when scope cannot be derived')
    const text = firstTextOf(refused)
    assert.equal(text.split('\n')[0], 'field: scope')
    assert.match(text, /is done or struck/)
    assert.match(text, /the decision was not recorded/)
  })
})

test('decision.records-the-decision-and-reports-the-skipped-link-at-the-byte-cap', async () => {
  await withSpawnFixture(async (fx) => {
    const threadId = await createFixtureThread(fx.spawned, fx.published)

    const rt = testRuntime({
      env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: fx.pluginData },
      cwd: fx.repo
    })
    const opened = openStore(rt, fx.repo)
    assert.equal(opened.ok, true, 'the byte-cap fixture must be able to open the store')
    if (!opened.ok) return
    const store = opened.value

    const maxLengthEntry = (): KeyDecision => ({
      id: rt.ulid(),
      decision_id: rt.ulid(),
      title: 't'.repeat(caps.KEY_DECISION_TITLE_MAX),
      scope: 'c'.repeat(caps.KEY_DECISION_SCOPE_MAX)
    })
    const planned = maxLengthEntry()
    const withEntry = (thread: Thread, entry: KeyDecision): Thread => ({
      ...thread,
      spine: { ...thread.spine, key_decisions: [...thread.spine.key_decisions, entry] }
    })
    const bytesOf = (thread: Thread): number => Buffer.byteLength(JSON.stringify(thread), 'utf8')
    const grow = (thread: Thread): Thread => {
      if (bytesOf(withEntry(thread, planned)) > caps.THREAD_RECORD_SERIALISED_MAX_BYTES) return thread
      if (thread.spine.key_decisions.length >= caps.KEY_DECISIONS_MAX_ELEMENTS - 1) return thread
      return grow(withEntry(thread, maxLengthEntry()))
    }

    const saturated = grow(readStoredThread(fx, threadId))
    assert.ok(
      bytesOf(saturated) <= caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      'the saturated fixture must itself still fit inside the byte cap'
    )
    assert.ok(
      bytesOf(withEntry(saturated, planned)) > caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      'the saturated fixture must leave no room for one more maximum-length link'
    )
    const seeded = store.commit([{ kind: 'thread', record: saturated }], 'saturate the thread to the byte cap')
    assert.equal(seeded.ok, true, 'the saturated fixture must commit before the tool is called')

    const recorded = (await fx.spawned.client.callTool({
      name: 'record_decision',
      arguments: {
        thread_id: threadId,
        title: 't'.repeat(caps.KEY_DECISION_TITLE_MAX),
        context: 'the thread record has no room left for another link',
        options: ['refuse the whole call', 'record the decision and skip the link'],
        outcome: 'record the decision and skip the link',
        scope: 'c'.repeat(caps.KEY_DECISION_SCOPE_MAX)
      }
    })) as CallToolResult

    assertOkResult('record_decision (at the byte cap)', recorded)
    const structured = recorded.structuredContent as {
      decision_id: string
      linked: boolean
      link_skipped_reason: string | null
    }
    assert.equal(structured.linked, false, 'the link must be reported as not written')
    assert.notEqual(structured.link_skipped_reason, null, 'a skipped link must carry a populated reason')
    assert.match(String(structured.link_skipped_reason), /over its cap of/)

    const afterStore = openStore(rt, fx.repo)
    assert.equal(afterStore.ok, true, 'the store must reopen after the tool call')
    if (!afterStore.ok) return
    const decisionSlot = afterStore.value.readDecision(structured.decision_id)
    assert.ok(
      decisionSlot !== null && !decisionSlot.quarantined,
      'the decision itself must be on disk even though the link was skipped'
    )

    const afterThread = readStoredThread(fx, threadId)
    assert.equal(
      afterThread.spine.key_decisions.length,
      saturated.spine.key_decisions.length,
      'the running summary must be unchanged when the link is skipped'
    )
  })
})

test('log_session_event.spawn.contract', async () => {
```

Rationale: acceptance criteria 1, 2 and 3. The first test is the audit's `repro-f1.ts` re-authored;
section 5.2 gives what was and was not carried over.

The byte-cap fixture derives its size from `src/schema/caps.ts` rather than from the audit's
measured count of 130 entries: `grow` adds maximum-length links while the record plus **the exact
link the tool will build** still fits, and stops the moment it would not. The two assertions after
it are what make the fixture self-checking — if either the record or the headroom ever stops being
what the test needs, the test fails loudly instead of passing while asserting nothing.

The refusal test asserts on `firstTextOf(refused)`, which reads `content[0].text`, never on
`structuredContent`. Ruling R10: "Every acceptance test for a refusal asserts on the `content` text
blocks, never on `structuredContent`."

### Step 12 — `test/spawn/decisions.test.ts` — REPLACE — the caps import the byte-cap test needs

FIND:

```ts
import { census, type Classified } from '../support/census.ts'
```

REPLACE:

```ts
import { census, type Classified } from '../support/census.ts'
import * as caps from '../../src/schema/caps.ts'
```

Rationale: step 11's byte-cap test reads four constants from the caps module.

### Step 13 — `test/sync/two-clones-spawn.test.ts` — REPLACE — re-derive the divergence assertion

FIND:

```ts
const decisionSlotsOf = (teammate: SpawnedTeammate) =>
  readAllRecordFiles<Decision>(path.join(layoutOf(teammate).records, 'decisions'), DecisionRecord)
```

REPLACE:

```ts
const decisionSlotsOf = (teammate: SpawnedTeammate) =>
  readAllRecordFiles<Decision>(path.join(layoutOf(teammate).records, 'decisions'), DecisionRecord)

const threadRecordOf = (teammate: SpawnedTeammate, threadId: string): Thread => {
  const slots = readAllRecordFiles<Thread>(path.join(layoutOf(teammate).records, 'threads'), ThreadRecord)
  for (const slot of slots) {
    if (!slot.quarantined && slot.record.id === threadId) return slot.record
  }
  throw new Error(`two-clones-spawn: thread ${threadId} could not be read back for ${teammate.name}`)
}
```

FIND:

```ts
    assert.notEqual(firstDecisionId, secondDecisionId, 'no collision: the two identifiers must be distinct')
```

REPLACE:

```ts
    assert.notEqual(firstDecisionId, secondDecisionId, 'no collision: the two identifiers must be distinct')

    const mergedThread = threadRecordOf(second, threadId)
    assert.equal(
      mergedThread.spine.key_decisions.length,
      2,
      'nothing lost: both clones now write the thread record offline, so the merged running summary must carry both links'
    )
    assert.deepEqual(
      new Set(mergedThread.spine.key_decisions.map((entry) => entry.decision_id)),
      new Set([firstDecisionId, secondDecisionId]),
      'nothing lost: the merged running summary must link exactly the two decisions by id'
    )
```

Rationale: acceptance criterion 6 — "`test/sync/two-clones-spawn.test.ts` stays green; both clones
now write the thread record offline, so its divergence assertion is re-derived rather than assumed."

Ground truth 2.11 gives the re-derivation. Before this change the two clones wrote two different
decision files and shared no record, so the merge had nothing to reconcile. Now they both write
`threads/<id>.json`. `THREAD_RULES['spine.key_decisions']` is `'union-by-id'`
(`src/merge/field-merge.ts:30`), and `unionByIdGeneric` (`:103-114`) keeps every entry from both
sides keyed on `id`, so the merge resolves without a conflict and the existing
`assertRecordsAreClean` call still passes. The two new assertions are what turn that reasoning into
a check. `Thread` and `ThreadRecord` are already imported by this file at `:12`.

### Step 14 — `test/contract/no-path.test.ts` — REPLACE — keep the refusal census whole

FIND:

```ts
import { recordDecisionTool, invalidDecisionRefusal } from '../../src/server/tools/record_decision.ts'
```

REPLACE:

```ts
import {
  recordDecisionTool,
  invalidDecisionRefusal,
  noOpenCriterionRefusal
} from '../../src/server/tools/record_decision.ts'
```

FIND:

```ts
const RECORD_DECISION_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/record_decision.ts#commitFailureRefusal'
```

REPLACE:

```ts
const RECORD_DECISION_COMMIT_FAILURE_PRODUCER: ProducerId = 'server/tools/record_decision.ts#commitFailureRefusal'
const RECORD_DECISION_SCOPE_CAP_PRODUCER: ProducerId = 'server/tools/record_decision.ts#scopeCapRefusal'
const RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER: ProducerId = 'server/tools/record_decision.ts#noOpenCriterionRefusal'
```

FIND:

```ts
    if (optionOverflow.ok) throw new Error('expected recordDecisionTool to refuse an option that overflows its cap once escaped')
    refusals.push({ producer: RECORD_DECISION_OPTION_CAP_PRODUCER, refusal: optionOverflow.refusal })
```

REPLACE:

```ts
    if (optionOverflow.ok) throw new Error('expected recordDecisionTool to refuse an option that overflows its cap once escaped')
    refusals.push({ producer: RECORD_DECISION_OPTION_CAP_PRODUCER, refusal: optionOverflow.refusal })

    const scopeOverflow = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      title: 'a census title',
      context: 'a census context',
      options: ['a census option'],
      outcome: 'a census outcome',
      scope: CONTROL_CHAR_OVERFLOW(34)
    })
    if (scopeOverflow.ok) throw new Error('expected recordDecisionTool to refuse a scope that overflows its cap once escaped')
    refusals.push({ producer: RECORD_DECISION_SCOPE_CAP_PRODUCER, refusal: scopeOverflow.refusal })
    refusals.push({ producer: RECORD_DECISION_NO_OPEN_CRITERION_PRODUCER, refusal: noOpenCriterionRefusal(threadId) })
```

Rationale: ground truth 2.12. `error.discloses-no-path` (`test/contract/no-path.test.ts:1145-1157`)
classifies every producer `scanRefusalProducers` finds and **halts** on any it does not exercise, so
the two exported factories step 5 adds must each be exercised or `npm test` fails. `scopeCapRefusal`
is driven through the real handler, matching the four cap probes immediately above it;
`noOpenCriterionRefusal` is called directly, matching `invalidDecisionRefusal` at `:518-519`.
`CONTROL_CHAR_OVERFLOW(34)` is the same argument the title probe uses at `:355`, and `scope` and
`title` share the same cap of 200.

The fourth pair repairs a fixture this change breaks. `syncFixtureThread`
(`test/contract/no-path.test.ts:817-834`) builds a synthetic thread with
`completion_criteria: []`, and `collectResolveConflictUnsafeDivergenceRefusal` records a decision
against it at `:927-934`. With no criterion to derive a scope from, step 6 refuses that call and the
fixture throws `expected ana to record a decision unrelated to the title conflict`. Supplying an
explicit `scope` is exactly the remedy `noOpenCriterionRefusal` names, so the fixture is corrected
rather than the rule relaxed.

FIND:

```ts
    const anaDecision = await recordDecisionTool.handler(ana.rt, STUB_TOOL_CTX, {
      thread_id: original.id,
      title: 'a divergence fixture decision',
      context: 'a divergence fixture context',
      options: ['a divergence fixture option'],
      outcome: 'a divergence fixture outcome'
    })
```

REPLACE:

```ts
    const anaDecision = await recordDecisionTool.handler(ana.rt, STUB_TOOL_CTX, {
      thread_id: original.id,
      title: 'a divergence fixture decision',
      context: 'a divergence fixture context',
      options: ['a divergence fixture option'],
      outcome: 'a divergence fixture outcome',
      scope: 'the divergence fixture'
    })
```

### Step 15 — `package.json` and `.claude-plugin/plugin.json` — RUN — the version bump


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

Expected exit code: 0. Expected stdout under the baseline: `1.0.6`.

Then run:

```bash
node scripts/check-packaging.mjs
```

Expected exit code: 0.

Expected `git diff` for the two manifest files under the baseline:

```diff
-  "version": "1.0.5",
+  "version": "1.0.6",
```

in each of `package.json` and `.claude-plugin/plugin.json`.

Rationale: invariant I4 — both manifests move in the same commit and
`node scripts/check-packaging.mjs` passes.

---

## 5. Tests

### 5.1 `test/spawn/decisions.test.ts`

| Test name string | Status | Discharges |
| --- | --- | --- |
| `decision.appears-in-both-briefing-sections-without-a-second-call` | **new** (step 11) | criterion 1 |
| `decision.scope-derives-to-the-lowest-open-criterion` | **new** (step 11) | criterion 2, first clause |
| `decision.scope-uses-an-explicit-value-in-place-of-the-derived-one` | **new** (step 11) | criterion 2, second clause |
| `decision.refuses-naming-scope-when-no-open-criterion-remains` | **new** (step 11) | criterion 2, third clause |
| `decision.records-the-decision-and-reports-the-skipped-link-at-the-byte-cap` | **new** (step 11) | criterion 3 |
| `concurrent.distinct-ids` | unchanged | criterion 5 |
| `record_decision.spawn.contract` | unchanged | proves the two new output fields conform to the published schema |
| `record_decision.rejects-invalid` | unchanged | proves the new `scope` property refuses its own mutations |

Two helpers are added to the same file and are not tests: `readStoredThread` (step 10) and the
`caps` import (step 12). `SpawnFixture` gains two fields (step 9).

`concurrent.distinct-ids` is listed as unchanged deliberately. Criterion 5 requires it to stay
green, including its retry guard, and step 7's third choice is what keeps it so: the commit failure
on this path still carries `field: 'decision'`.

`record_decision.rejects-invalid` is also unchanged. Its expected-missing constraint-class set is
`['minItems']`, and adding an optional string property changes neither the `required` array nor any
array constraint, so the set is unaffected.

### 5.2 `test/sync/two-clones-spawn.test.ts`

| Test name string | Status | Discharges |
| --- | --- | --- |
| `sync.two-clones-offline.spawn` | modified through the shared driver (step 13) | criterion 6 |
| `sync.two-clones-offline.spawn.ben-pushes-first` | modified through the shared driver (step 13) | criterion 6 |

Both tests are one-line wrappers around `runSpawnOfflineMergeScenario`, so step 13's two assertions
run in both directions of the push order.

### 5.3 `test/contract/no-path.test.ts`

| Test name string | Status | Discharges |
| --- | --- | --- |
| `error.discloses-no-path` | modified (step 14) | keeps the closed refusal census whole after two exported factories are added |

### 5.4 The inherited probe, re-authored as a committed test

Orchestrator ruling O10 assigns `repro-f1.ts` to MSP-4. It is re-authored here.
`probe-caps.ts` and `probe-boundary.ts` are not re-authored here; they belong to the cap work that
landed before this branch was cut.

`repro-f1.ts` opened a thread, recorded one decision through the real handler, then printed four
observations: that `record_decision` returned `ok: true` with a `decision_id`, that the decision file
existed on disk, that `thread.spine.key_decisions` was empty and `thread.updated_at` unmoved, and
that the rendered briefing showed both decision sections empty. It exited 1 if the title appeared in
the briefing and 0 if it did not — an inverted exit code, because at the time a passing run meant the
defect reproduced.

`decision.appears-in-both-briefing-sections-without-a-second-call` (step 11) is that probe with the
verdict turned the right way up: the same single `record_decision` call, followed by the same
`resume_thread`, asserting that the title now appears under **both** headings.

What is deliberately **not** carried over, and why:

- **The direct filesystem check that `decisions/` is non-empty.** The briefing's `Decisions:` section
  is rendered by resolving each linked `decision_id` through `store.readDecision`
  (`src/server/tools/resume_thread.ts:63-66`), so a title appearing there already proves the file is
  on disk and readable. A second assertion on the directory listing would pin an implementation
  detail the public surface already covers.
- **The `thread.updated_at` observation.** It moves as a side effect of writing the thread record,
  and asserting on it would be a change-detector: any future change that writes the thread for a
  different reason would satisfy it without linking anything.
- **The inverted exit code.** A committed test asserts the fixed behaviour; the probe's convention
  existed only so a reproduction script could signal "the defect is still here".

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time, which for this branch is the merge commit
of MSP-4a.

Run, from a worktree at that parent with only the section 4 test steps applied (steps 9 through 13)
and none of the `src/` changes:

```bash
node --test test/spawn/decisions.test.ts
```

Expected exit code: **1**. This was measured, not predicted: running that command over a copy of the
parent tree carrying only steps 9 through 13 reports `fail 7` across
`test/spawn/decisions.test.ts` and `test/sync/two-clones-spawn.test.ts`, with
`concurrent.distinct-ids` among the passes.

| Test | Expected failure on the parent |
| --- | --- |
| `decision.appears-in-both-briefing-sections-without-a-second-call` | `AssertionError [ERR_ASSERTION]: a decision on an ordinary thread must be linked by the same call` — on the parent `structuredContent` carries no `linked` field at all, so the value read is `undefined`, not `true` |
| `decision.scope-derives-to-the-lowest-open-criterion` | `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 0 !== 1` at the `key_decisions.length` assertion — nothing was linked |
| `decision.scope-uses-an-explicit-value-in-place-of-the-derived-one` | the call is refused before that: `scope` is not a property of the published input schema and the schema is a `z.strictObject`, so `assertOkResult` throws with the unknown-key refusal in its message |
| `decision.refuses-naming-scope-when-no-open-criterion-remains` | `AssertionError [ERR_ASSERTION]: record_decision must refuse when scope cannot be derived` — on the parent the call succeeds |
| `decision.records-the-decision-and-reports-the-skipped-link-at-the-byte-cap` | the call is refused for the same unknown-key reason as above, so `assertOkResult` throws |

The remaining tests in the file, `concurrent.distinct-ids` among them, pass on the parent and must
still pass after the fix.

Two of the five fail on the parent for a reason that is real but blunt — `scope` does not exist
there, so the whole call is refused as an unknown key rather than reaching the behaviour under test.
To confirm the other three fail for the behaviour D1 names rather than for a compile or schema
error, run them alone:

```bash
node --test --test-name-pattern='^decision\.appears-in-both-briefing-sections-without-a-second-call$' test/spawn/decisions.test.ts
```

Expected exit code **1**, with the failure named in the table above.

`test/sync/two-clones-spawn.test.ts` is **also** red on the parent once step 13 is applied:

```bash
node --test test/sync/two-clones-spawn.test.ts
```

Expected exit code **1** — measured — with
`AssertionError [ERR_ASSERTION]: nothing lost: both clones now write the thread record offline, so
the merged running summary must carry both links` — on the parent neither clone writes the thread
record, so the merged running summary carries zero links, not two.

`test/contract/no-path.test.ts` does **not** compile on the parent once step 14 is applied, because
`noOpenCriterionRefusal` does not exist there to import. That is expected and is not a substitute
red: step 14 is census maintenance, not an acceptance test, and it is applied together with step 5
in commit 1. Its evidence is command 4 of section 8 passing after the fix.

---

## 7. Inertness mutation

Acceptance criterion 7 names the mutation exactly: "removing the thread record from the commit array
turns criterion 1 red".

**The exact edit to revert.** In `src/server/tools/record_decision.ts`, replace the whole `changes`
declaration from step 7 with the single-record form:

```ts
    const changes: RecordChange[] = [{ kind: 'decision', record: validated.value }]
```

**The exact command.**

```bash
node --test --test-name-pattern='^decision\.appears-in-both-briefing-sections-without-a-second-call$' test/spawn/decisions.test.ts
```

**The test that must turn red:**
`decision.appears-in-both-briefing-sections-without-a-second-call`.

**The expected exit code:** **1**.

**The expected failure text:** `AssertionError [ERR_ASSERTION]: the Key decisions section must carry
the decision title with no intervening update_thread call`. The result still reports `linked: true`,
because `linkSkippedReason` is computed from the prospective record and not from what was committed,
so the mutation is invisible in the structured reply and visible only in the briefing — which is
exactly why criterion 1 asserts on the briefing.

**The control that must stay green during the mutation.**

```bash
node --test --test-name-pattern='^concurrent\.distinct-ids$' test/spawn/decisions.test.ts
```

Expected exit code: 0, with `fail 0` in the output. Eight racing children still record eight distinct
decisions, which proves the mutation removed the link and nothing else.

**The exact restore.** Put back the `changes` declaration given as part of step 7's REPLACE block,
then re-run both commands above; expected exit code 0 and `fail 0` for each.

---

## 8. Full verification

Run all seven, from the repository root, in this order.

| # | Command | Expected exit | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | `> tsc -p tsconfig.json --noEmit` and no line after it |
| 2 | `node --test test/spawn/decisions.test.ts` | 0 | `fail 0` |
| 3 | `node --test test/sync/two-clones-spawn.test.ts` | 0 | `fail 0` |
| 4 | `node --test test/contract/no-path.test.ts` | 0 | `fail 0` |
| 5 | `node --test "test/contract/**/*.test.ts"` | 0 | `fail 0` |
| 6 | `npm test` | 0 | `fail 0` |
| 7 | `node scripts/check-packaging.mjs` | 0 | `check-packaging: ok` |

Command 2 covers acceptance criteria 1, 2, 3 and 5 in one run; `concurrent.distinct-ids` is in that
file and forks eight child processes, so it is the slowest test in the suite.

Command 3 is acceptance criterion 6.

Command 4 is the closed refusal census step 14 maintains.

Command 5 is called out separately because three further contract censuses read this tool's
published surface: `contract.every-property-described`
(`test/contract/described.test.ts:64`) requires the new `scope` description to be at least ten
characters, `criteria.no-other-tool-writes-criteria` (`test/contract/criteria-writers.test.ts:68`)
walks every published input property and classifies any string property whose top-level name matches
`/criteri/i` on a thread-bearing tool as forbidden — `scope` does not match that pattern and is
allowed — and `contract.every-tool-has-mandatory-tests`
(`test/contract/mandatory-tests.test.ts:93`) requires the test names `record_decision.spawn.contract`
and `record_decision.rejects-invalid` to still exist.

Command 6 is invariant I1 and acceptance criterion 8.

---

## 9. Commits

### Commit 1

```
fix(record-decision): link the decision into the thread in the same commit
```

Files:

- `src/server/tools/record_decision.ts`
- `test/contract/no-path.test.ts`

Plan steps: 1, 2, 3, 4, 5, 6, 7, 14.

Step 14 travels with commit 1 rather than with the test commit because `error.discloses-no-path`
halts the moment an exported refusal factory exists that nothing exercises. Splitting them would
leave commit 1 red on its own, which breaks the green-branch invariant at the commit level.

### Commit 2

```
test(decisions): assert the decision reaches both briefing sections and the scope rules hold
```

Files:

- `test/spawn/decisions.test.ts`

Plan steps: 9, 10, 11, 12.

### Commit 3

```
test(sync): re-derive the offline divergence assertion now both clones write the thread
```

Files:

- `test/sync/two-clones-spawn.test.ts`

Plan steps: 13.

### Commit 4

```
chore(release): bump the patch version for the record_decision spine link
```

Files:

- `package.json`
- `.claude-plugin/plugin.json`

Plan steps: 15.

No commit mixes a refactor with a behaviour change.

---

## 10. Pull request

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head fix/msp-4-record-decision-links-b \
  --base main \
  --title "fix(record-decision): link the decision into its thread in the same commit" \
  --what "Recording a decision now also writes the link that puts it on its thread, in the same commit, so the next session's briefing shows it without any follow-up call." \
  --what "The link carries an area label the caller may supply, and which is otherwise taken from the lowest-numbered outstanding item on the thread; when there is none left the call refuses and says which value to send." \
  --what "When the thread record has no room left for another link, the decision is still recorded and the reply states that the link was not written and why." \
  --why "A decision recorded on its own was invisible on its own thread: the briefing builds both of its decision sections from the thread's links, so a decision with no link could only be retrieved by someone who already knew its 26-character identifier." \
  --why "Linking was possible only through a second, separate call that nothing told the caller to make." \
  --risk "Recording a decision now writes two records instead of one, so it contends with other writers where it previously did not." \
  --verified "npm test - 0 failures" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/sync/two-clones-spawn.test.ts - 0 failures" \
  --verified "node --test test/contract/no-path.test.ts - 0 failures" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "inertness mutation removing the thread record from the commit array - the named test turned red and the control stayed green" \
  --not-verified "mutation (Stryker) - not run against this diff" \
  --not-verified "coverage - not run"
```

The mutation-scope sentence SPEC section 8.2 requires, included above via `--not-verified`: the
Stryker mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`,
`src/merge/conflict.ts` and `src/render/**`. This change lives in `src/server/tools/` and `test/`,
which fall outside that scope entirely, so the mutation job will report success having mutated
nothing in this diff. No `Verified: mutation` line may be written for this pull request.

---

## 11. Stop conditions

Each of these invalidates this plan. For every one: **STOP and report; do not improvise.**

1. **A FIND string does not match exactly once.** What you see: your editor reports zero matches, or
   more than one, for any FIND block in section 4. STOP and report; do not improvise.

2. **MSP-4a has not merged.** Run:

   ```bash
   node -e "const s=require('fs').readFileSync('src/server/tool-support.ts','utf8');process.stdout.write(String(s.includes('overByteCapRefusal')))"
   ```

   Expected output: `true`. If the output is `false`, `fix/msp-4-record-decision-links-a` has not
   been merged into `main`, and this plan's cap path would report a skipped link through a refusal
   that names neither the field nor the number. STOP and report; do not improvise.

3. **MSP-2 has not merged.** Run:

   ```bash
   node -e "const s=require('fs').readFileSync('src/store/write-path.ts','utf8');const m=s.match(/if \(cas\.cause === 'ref-moved'\) \{([\s\S]*?)\n    \}/);process.stdout.write(m===null?'PATTERN-NOT-FOUND':String(m[1].trim().split('\n').length))"
   ```

   Expected output: a number **greater than 2**. Both readings were measured during planning: the
   command prints `2` against the tree as it stands today, and `21` against a copy carrying the
   change that closes the compare-and-swap defect. If the output is `2`, the compare-and-swap retry
   still re-reads only the reference and reuses the caller's stale in-memory records, and this plan
   makes `record_decision` a two-record writer, which is exactly what that hazard destroys. If the
   output is `PATTERN-NOT-FOUND`, the retry branch has moved and this check can no longer answer the
   question. Either way: STOP and report; do not improvise.

4. **The local verification baseline is red for a missing development dependency.**

       If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
       described by the orchestrator is not yet closed in this checkout. STOP and report.
       Do not edit, skip or delete that test, and do not install anything yourself.

   This is pre-existing and unrelated to this change: `yaml` is declared as a development
   dependency but was never committed into the tracked `node_modules`, and continuous integration
   installs it, so it is green there and red only on a local checkout that has not run an install.
   Closing it is the operator's act.

5. **MSP-0 has not merged, so the manifest-agreement test is still pinned to a literal version.**

       Run: grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts
       If the output contains a quoted version literal such as '1.0.0', MSP-0 has not merged.
       STOP and report; do not improvise, and do not edit this file.

6. **`package.json` and `.claude-plugin/plugin.json` disagree before the change.** What you see: the
   step 15 command prints `STOP: package.json and .claude-plugin/plugin.json disagree before the
   bump` and exits 1. STOP and report; do not improvise. A version merely *higher* than `1.0.5` is
   **not** a stop condition — it means the ladder shifted, and the step handles it.

7. **The refusal census halts.** What you see: command 4 of section 8 fails with a message
   containing `census halted on an unclassifiable item`. An exported refusal factory exists that
   nothing exercises. STOP and report; do not improvise. Do not add an allowlist, do not pin a count,
   and do not narrow the population — invariant I8.

8. **`concurrent.distinct-ids` fails with a child exiting non-zero.** What you see: command 2 of
   section 8 fails with `a concurrent record_decision child exited non-zero:` followed by a
   serialised refusal. The refusal's `field` is no longer `decision`, so the children stopped
   retrying under contention. STOP and report; do not improvise.

9. **`test/sync/two-clones-spawn.test.ts` fails on a conflict rather than on a count.** What you
   see: command 3 of section 8 fails inside `assertRecordsAreClean`, or with
   `the second teammate to sync after an offline divergence must merge, not clobber`. The thread
   record is no longer merging cleanly on `spine.key_decisions`. STOP and report; do not improvise.

10. **The byte-cap fixture cannot be built.** What you see: command 2 of section 8 fails with
   `the saturated fixture must leave no room for one more maximum-length link` or
   `the saturated fixture must itself still fit inside the byte cap`. The relationship between the
   element cap and the byte cap has changed. STOP and report; do not improvise.

11. **The inertness mutation does not turn the named test red.** What you see: the section 7 command
    exits 0 with the single-record `changes` declaration in place. The test is not testing the fix.
    STOP and report; do not improvise.

12. **`npm test` fails in a file this plan does not name.** What you see: command 6 of section 8
    reports a failure outside `test/spawn/decisions.test.ts`, `test/sync/two-clones-spawn.test.ts`
    and `test/contract/no-path.test.ts`, and outside `workflow-hardening-census`, which stop
    condition 4 covers. STOP and report; do not improvise.
