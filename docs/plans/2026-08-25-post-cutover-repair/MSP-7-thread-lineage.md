# MSP-7 — Lineage returns

## 0. Identity

- **Closes:** defect D3 — no thread-to-thread lineage can be recorded, though the server
  already tells callers to record it. `src/server/tool-support.ts:38` refuses a terminal
  thread with the words *"open a new thread that references this one instead"*, and the
  server ships no field with which to reference it.
- **Depends on:** one precondition, and nothing else. `test/contract/cutover-manifests-agree.test.ts`
  must already derive its expected version from `package.json` rather than pinning a literal.
  The first MSP in this ladder makes that change; MSP-7 does not. Stop condition 11.2 is the
  check. Apart from that precondition, MSP-7 touches files no other MSP in this ladder touches.
- **Required by:** nothing.
- **Branch name:** `feat/msp-7-thread-lineage`, cut from `main`. The pull request targets `main`.
- **Version bump:** Baseline `1.0.8` -> `1.1.0`. This is the only
  MSP in the ladder that bumps the MINOR version, because it adds a schema field. Step 11
  below is written as a read-then-increment, so a ladder that has shifted does not
  invalidate this plan.
- **SPEC anchors:** SPEC section 7, MSP-7 "Lineage returns"; SPEC section 6, ruling R6 "Lineage
  restores exactly one field, optional on both sides, with a render section"; SPEC section 5,
  defect D3; SPEC section 9, risk 3.
- **Diff size:** 256 changed lines — 235 added and 21 removed. Broken down: the eleven existing
  source and test files take +100/-19, the two version manifests take +2/-2, and the one new test
  file is +133. Measured by applying this plan to a scratch copy of the tree at commit `9f66931`
  and diffing. That is under the 400-line ceiling, so **this MSP is NOT split.**

### What this MSP builds, in one paragraph

A "thread" is one unit of work the ledger remembers. When a thread finishes, the server tells
you to open a new thread that *references* the finished one — but there is no field in which
to record that reference. This MSP restores exactly one field, `predecessor_id`, which holds
the id of the earlier thread this one succeeds. It is optional everywhere, it is checked at
write time so it can never name a thread that does not exist, and it renders in a new
`Related:` section of the briefing so that a stored value is actually visible to a reader.

---

## 1. Acceptance criteria (the ceiling)

Verbatim from the SPEC, numbered as there:

1. A test opens thread B naming thread A as predecessor and asserts B's briefing renders a
   `Related:` section naming A. Red on the parent.
2. A test asserts an unresolvable `predecessor_id` is refused at write time.
3. A test asserts a thread record written **before** this change still parses, still appears in
   the roster, and is not quarantined. This is invariant I3's guard and it is not optional.
4. Every render-census obligation is satisfied by classification, never by narrowing
   (invariant I8).
5. `node scripts/check-packaging.mjs` passes and both manifests read `1.1.0`.
6. `npm test` green.

**That list is the complete definition of done.** Anything discovered above it is appended to
`docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence, and is
NOT folded into this plan. Do not widen the change to fix something you notice in passing.

### Two clarifications on criterion 5, so it cannot be misread

- Criterion 5 is written against the baseline ladder. Step 11 reads the current version and
  increments the MINOR, so if the ladder shifted and `package.json` reads something higher
  than `1.0.8`, the correct target is *that* value with its minor incremented and its patch
  set to `0` — not the literal `1.1.0`. A version merely higher than the baseline is NOT a
  stop condition.
- Criterion 6 (`npm test` green) depends on a contract test that pins the version as a literal.
  That repair belongs to MSP-0 and **MSP-7 writes no edit to it.** Section 11.2 carries the stop
  condition that catches the case where MSP-0 has not merged. See section 3, divergence 3.

---

## 2. Ground truth

Every excerpt below was read from the working tree at commit `9f66931`. `src/`, `test/`,
`hooks/`, `skills/` and `scripts/` are byte-identical between `main` (`0ade582`) and `9f66931`,
because the only two commits between them touch nothing outside `docs/`. Confirm that yourself
with `git diff --stat 0ade582..9f66931 -- src test hooks skills scripts`, which prints nothing.
So these line numbers apply unchanged to a branch cut from `main`.

### 2.1 `src/schema/thread.ts:31-41` — the thread record type

```ts
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
```

What is wrong with it: there is no field in which to record which thread this one succeeds,
which is defect D3. `grep -rni "predecessor\|parent_id\|successor\|lineage" src/` returns zero
hits.

### 2.2 `src/schema/thread.ts:100-122` — the runtime validator for that type

```ts
const ThreadShape = z.object({
  id: ulidField('the thread identity, a ULID'),
  slug: z
    .string()
    .min(1)
    .max(caps.THREAD_SLUG_MAX)
    .regex(SLUG_PATTERN)
    .describe('a short lowercase label for the thread'),
  title: z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the thread title'),
  status: z.enum(['open', 'done', 'abandoned']).describe('the thread lifecycle state'),
  blocked_by: z
    .string()
    .max(caps.THREAD_BLOCKED_BY_MAX)
    .nullable()
    .describe('the reason this thread is blocked, or null when it is not blocked'),
  completion_criteria: z
    .array(CriterionSchema)
    .max(caps.CRITERIA_RETENTION_MAX_ELEMENTS)
    .describe('the criteria that define this thread as done, struck criteria retained'),
  spine: SpineSchema.describe('the progressive summary of this thread'),
  created_at: isoField('when this thread was created'),
  updated_at: isoField('when this thread was last updated')
})
```

What is wrong with it: same as 2.1, on the runtime side. This object is what decides whether a
record on disk parses. A record carrying a key this object does not declare has that key
**stripped** — `z.object` drops unknown keys, and `src/schema/declare.ts:28-31` returns
`result.data`. So without a declaration here, a stored `predecessor_id` would be silently
discarded on every read.

### 2.3 `src/merge/field-merge.ts:16-32` — the merge rule table

```ts
export const THREAD_RULES: Record<keyof Thread | `spine.${keyof Spine}`, FieldRule> = {
  id: 'take-present',
  slug: 'conflict-on-divergence',
  title: 'conflict-on-divergence',
  status: 'conflict-on-divergence',
  blocked_by: 'conflict-on-divergence',
  completion_criteria: 'union-by-id',
  spine: 'take-present',
  created_at: 'take-present',
  updated_at: 'take-later',
  'spine.active_goal': 'conflict-on-divergence',
  'spine.next_step': 'conflict-on-divergence',
  'spine.last_session': 'conflict-on-divergence',
  'spine.open_risks': 'union-by-id',
  'spine.key_decisions': 'union-by-id',
  'spine.out_of_scope': 'union-by-id'
}
```

What is wrong with it: nothing yet — but this is **the one construct in the whole of `src/`
that forces a merge rule at compile time.** `Record<K, V>` expands to `{ [P in K]: V }` with no
optional modifier, so every member of `keyof Thread` becomes a required property. The moment
step 1 adds a key to `Thread`, this object literal is missing a property and the build fails.
Verified empirically: applying only the type change and running the project's own
`tsc -p tsconfig.json --noEmit` produced exactly one new error in the entire tree:

```
src/merge/field-merge.ts(16,14): error TS2741: Property 'predecessor_id' is missing in type '{ id: "take-present"; slug: "conflict-on-divergence"; ... }' but required in type 'Record<"spine.active_goal" | ... | keyof Thread, FieldRule>'.
```

### 2.4 `src/merge/field-merge.ts:36-46` — the scalar descriptor list

```ts
const SCALAR_DESCRIPTORS: ScalarDescriptor[] = [
  { path: 'id', rule: THREAD_RULES.id, get: (t) => t.id },
  { path: 'slug', rule: THREAD_RULES.slug, get: (t) => t.slug },
  { path: 'title', rule: THREAD_RULES.title, get: (t) => t.title },
  { path: 'status', rule: THREAD_RULES.status, get: (t) => t.status },
  { path: 'blocked_by', rule: THREAD_RULES.blocked_by, get: (t) => t.blocked_by },
  { path: 'created_at', rule: THREAD_RULES.created_at, get: (t) => t.created_at },
  { path: 'spine.active_goal', rule: THREAD_RULES['spine.active_goal'], get: (t) => t.spine.active_goal },
  { path: 'spine.next_step', rule: THREAD_RULES['spine.next_step'], get: (t) => t.spine.next_step },
  { path: 'spine.last_session', rule: THREAD_RULES['spine.last_session'], get: (t) => t.spine.last_session }
]
```

What is wrong with it: this is a plain array, **not** a mapped type, so nothing forces an entry
for a new field. A rule declared in 2.3 but never given a descriptor here is dead code — the
merge engine never consults it. Verified: after adding only the `THREAD_RULES` entry, the tree
returned to a clean `tsc` exit 0 while the field was still not merged at all.

### 2.5 `src/merge/field-merge.ts:235-254` — the merged record literal

```ts
  const byPath = new Map(scalarResolutions.map((resolution) => [resolution.path, resolution.value] as const))

  const merged: Thread = {
    id: byPath.get('id') as Thread['id'],
    slug: byPath.get('slug') as Thread['slug'],
    title: byPath.get('title') as Thread['title'],
    status: byPath.get('status') as Thread['status'],
    blocked_by: byPath.get('blocked_by') as Thread['blocked_by'],
    completion_criteria: criteriaResolution.merged,
    spine: {
      active_goal: byPath.get('spine.active_goal') as Spine['active_goal'],
      next_step: byPath.get('spine.next_step') as Spine['next_step'],
      last_session: byPath.get('spine.last_session') as Spine['last_session'],
      open_risks: openRisksResolution.merged,
      key_decisions: keyDecisionsResolution.merged,
      out_of_scope: outOfScopeResolution.merged
    },
    created_at: byPath.get('created_at') as Thread['created_at'],
    updated_at: updatedAtResolution.value
  }
```

What is wrong with it: this literal enumerates all nine top-level keys explicitly and uses **no
object spread.** Any key it does not name is absent from every merge output. Because the new
field is optional, TypeScript will not complain — so unless step 5 adds it, the field is
silently destroyed by every sync and merge. This is the single most dangerous line range in
the MSP.

### 2.6 `src/render/briefing.ts:1-55` — the briefing renderer, in full

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../schema/thread.ts'
import type { Decision } from '../schema/decision.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored } from './escape.ts'

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderCriterionLine = (criterion: Criterion, ordinal: number): string =>
  `c${ordinal} [${criterionStatus(criterion)}] ${escapeStored(criterion.text)}`

const renderRiskLine = (risk: Risk): string => `- ${escapeStored(risk.text)}`

const renderKeyDecisionLine = (keyDecision: KeyDecision): string => `- ${escapeStored(keyDecision.title)}`

const renderOutOfScopeLine = (outOfScope: OutOfScope): string => `- ${escapeStored(outOfScope.text)}`

const renderDecisionLine = (decision: Decision): string =>
  `- ${escapeStored(decision.title)}: ${escapeStored(decision.outcome)}`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? 'Blockage: none' : `Blocked: ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? 'Currently being worked: yes' : 'Currently being worked: no'

export const renderBriefing = (thread: Thread, decisions: Decision[], pointer: Pointer | null): string => {
  const criteriaLines = thread.completion_criteria.map((criterion, index) => renderCriterionLine(criterion, index + 1))
  const riskLines = thread.spine.open_risks.map(renderRiskLine)
  const keyDecisionLines = thread.spine.key_decisions.map(renderKeyDecisionLine)
  const outOfScopeLines = thread.spine.out_of_scope.map(renderOutOfScopeLine)
  const decisionLines = decisions.map(renderDecisionLine)

  return [
    `Thread: ${escapeStored(thread.title)}`,
    `Status: ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    `Active goal: ${escapeStored(thread.spine.active_goal)}`,
    `Next step: ${escapeStored(thread.spine.next_step)}`,
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    'Open risks:',
    ...riskLines,
    'Key decisions:',
    ...keyDecisionLines,
    'Out of scope:',
    ...outOfScopeLines,
    'Completion criteria:',
    ...criteriaLines,
    'Decisions:',
    ...decisionLines
  ].join('\n')
}
```

What is wrong with it: there is no section in which lineage could render, and the function
takes no parameter through which a predecessor could reach it. Two facts about this file govern
the design and are load-bearing:

- **Every section label is emitted unconditionally.** `'Open risks:'`, `'Key decisions:'`,
  `'Out of scope:'`, `'Completion criteria:'` and `'Decisions:'` all print even when their list
  is empty. A conditional section would be the first in the file.
- **Every stored value is wrapped in `escapeStored`,** including the enum `thread.status`. The
  file's convention is to escape unconditionally regardless of how constrained a value is.

### 2.7 `src/server/resources.ts:85-109` — the first briefing call site

```ts
const readThreadResourceBody = (rt: Runtime, id: string): string => {
  const store = openStoreForRead(rt, 'logbook://thread')
  const slot = resolveThreadSlot(store, id)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://thread: no thread record matches id or slug '${escapeStored(id)}'`
    )
  }
  if (slot.quarantined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://thread: the record for '${escapeStored(id)}' failed to parse and is quarantined: ${escapeStored(slot.reason)}`
    )
  }

  const thread = slot.record
  const decisions = decisionsForThread(rt, store, thread)

  const layout = layoutFor(rt, rt.cwd)
  const pointerRead = layout.ok ? readPointer(rt, layout.value) : { kind: 'absent' as const }
  const pointer = pointerRead.kind === 'pointer' ? pointerRead.value : null

  return renderBriefing(thread, decisions, pointer)
}
```

What is wrong with it: it has `rt`, `store` and `thread` in scope — everything needed to resolve
a predecessor — but passes none of it to the renderer. The call is at line 108 as read.

### 2.8 `src/server/tools/resume_thread.ts:83` — the second briefing call site

The call sits inside the `resumeThreadTool` handler. Its immediate context, lines 76-94:

```ts
    const decisions: Decision[] = decisionOutcomes
      .filter(
        (outcome): outcome is { decisionId: string; slot: { quarantined: false; record: Decision } } =>
          outcome.slot !== null && !outcome.slot.quarantined
      )
      .map((outcome) => outcome.slot.record)

    const briefing = renderBriefing(thread, decisions, writtenPointer)

    return {
      ok: true,
      text: briefing,
      structured: {
        thread_id: thread.id,
        briefing,
        previous_session: previousSession
      }
    }
  }
```

What is wrong with it: same as 2.7 — `rt`, `store` and `thread` are all in scope and unused by
the renderer. The call is at line 83 as read. A repository-wide search confirms exactly two
production call sites; the only other callers are eight in `test/unit/briefing.test.ts`.

### 2.9 `src/server/tool-support.ts:41-47` — the existing thread loader, and why it cannot be reused

```ts
export const loadThread = (store: Store, field: string, id: Ulid): Attempt<Thread> => {
  const slot = store.readThread(id)
  if (slot === null) return { ok: false, refusal: threadNotFoundRefusal(field, id) }
  if (slot.quarantined) return { ok: false, refusal: threadQuarantinedRefusal(field, id) }
  if (slot.record.status !== 'open') return { ok: false, refusal: threadClosedRefusal(field, id, slot.record.status) }
  return { ok: true, value: slot.record }
}
```

What is wrong with it **for this purpose**: line 45 refuses any thread whose status is not
`'open'`. A predecessor is, by the definition of defect D3, usually a thread that has just
been closed — `src/server/tool-support.ts:38` tells the caller to reference a thread that is
`done` or `abandoned`. Using `loadThread` to validate `predecessor_id` would therefore refuse
precisely the case the feature exists to serve. This is why step 6 adds a second loader rather
than reusing this one.

### 2.10 `test/contract/render-census.test.ts:16-24` and `:371-375` — the render census

```ts
const CENSUSED_FILES = [
  'src/render/briefing.ts',
  'src/render/roster.ts',
  'src/server/resource-render.ts',
  'src/server/resources.ts',
  'src/cli/session-start.ts',
  'src/domain/lifecycle.ts',
  'src/server/prompts.ts'
] as const
```

```ts
export const classifySite = (site: Site): Classified<Site>['verdict'] | 'unclassifiable' => {
  if (site.classification === 'escaped') return 'allowed'
  if (site.classification === 'server-authored') return 'allowed'
  return 'unclassifiable'
}
```

What is wrong with it: nothing — but this is the census acceptance criterion 4 is about.
`src/render/briefing.ts` is in its population. It walks the file's syntax tree and classifies
every string interpolation as `escaped`, `server-authored`, or `unclassifiable`, and
`test/support/census.ts:15-23` **throws** on `unclassifiable`. Criterion 4 says this obligation
is met by classifying the new item — that is, by writing the new render code so the census can
see it is escaped — and never by removing `briefing.ts` from `CENSUSED_FILES` or adding any
exclusion.

### 2.11 `test/unit/field-merge.test.ts:348-370` — the merge path census

```ts
test('merge.rule-table-is-covered.walk-finds-spine-and-top-level-paths', () => {
  const paths = walkThreadRulePaths(ThreadRecord.jsonSchema)
  assert.deepEqual(
    [...paths].sort(),
    [
      'blocked_by',
      'completion_criteria',
      'created_at',
      'id',
      'slug',
      'spine',
      'spine.active_goal',
      'spine.key_decisions',
      'spine.last_session',
      'spine.next_step',
      'spine.out_of_scope',
      'spine.open_risks',
      'status',
      'title',
      'updated_at'
    ].sort()
  )
})
```

What is wrong with it: the 15-path list is hard-coded and derived from the record's JSON schema,
so it grows by exactly one entry when the record gains a field. Line 348 still opens this test,
confirmed by reading it.

### 2.12 `test/unit/briefing.test.ts:127` and `:154` — the two whole-output pins

Line 127 opens the 18-line expected block of `briefing.renders-exact-output-for-a-full-thread`,
closed at 146 and asserted at 148:

```ts
  const expected = [
    'Thread: Ship the renderer',
    'Status: open',
    'Blockage: none',
    'Currently being worked: yes',
    'Active goal: ship the renderer',
    'Next step: add tests',
    'Last session: wrote the first draft',
    'Open risks:',
    '- escaping might be incomplete',
    'Key decisions:',
    '- use postgres',
    'Out of scope:',
    '- does not cover the CLI',
    'Completion criteria:',
    'c1 [done] first criterion',
    'c2 [struck] second criterion',
    'Decisions:',
    '- use postgres: chose postgres for durability'
  ].join('\n')

  assert.equal(rendered, expected)
```

Line 154 opens the 12-line expected block of
`briefing.renders-headers-only-when-lists-are-empty`, closed at 167 and asserted at 168:

```ts
  const expected = [
    'Thread: Empty Thread',
    'Status: done',
    'Blocked: still finishing docs',
    'Currently being worked: no',
    'Active goal: ship the thing',
    'Next step: write the tests',
    'Last session: wrote the renderer',
    'Open risks:',
    'Key decisions:',
    'Out of scope:',
    'Completion criteria:',
    'Decisions:'
  ].join('\n')
  assert.equal(rendered, expected)
```

What is wrong with them: both compare the renderer's **entire** output with `assert.equal`, so
any inserted line breaks both, wherever it is inserted.

### 2.12b `src/server/tools/open_thread.ts` — the five edit sites step 10 changes

Lines 5 and 8, the two imports:

```ts
import { SLUG_PATTERN } from '../../schema/ids.ts'
```

```ts
import { commitThread, openProjectStore } from '../tool-support.ts'
```

Lines 10-29, the tool input schema:

```ts
const OpenThreadInputSchema = z.strictObject({
  title: z.string().min(1).max(caps.THREAD_TITLE_MAX).describe('the one-line thread title'),
  slug: z
    .string()
    .min(1)
    .max(caps.THREAD_SLUG_MAX)
    .regex(SLUG_PATTERN)
    .describe('a short lowercase label unique in this project, letters digits and hyphens, for example merge-and-sync'),
  completion_criteria: z
    .array(
      z
        .string()
        .min(1)
        .max(caps.CRITERION_TEXT_MAX)
        .describe('one completion criterion as plain text; the server mints its id and display ordinal')
    )
    .min(1)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .describe('what finishing looks like; at least one criterion is required or the thread can never be closed')
})
```

Line 106, where the handler stops validating and starts minting:

```ts
    const now = rt.now()
```

Lines 116-133, the thread record literal:

```ts
    const thread: Thread = {
      id: rt.ulid(),
      slug: input.slug,
      title: escapedTitle,
      status: 'open',
      blocked_by: null,
      completion_criteria: completionCriteria,
      spine: {
        active_goal: '',
        next_step: '',
        last_session: '',
        open_risks: [],
        key_decisions: [],
        out_of_scope: []
      },
      created_at: now,
      updated_at: now
    }
```

What is wrong with them: the input schema accepts exactly three properties and offers no way to
name a predecessor; the handler validates a slug collision and two character caps but performs no
referential check; and the record literal enumerates every key explicitly with no spread, so a
field it does not name is never written. The schema is a `z.strictObject`, which matters: the
tool registry refuses to publish any tool taking arguments whose schema does not carry
`additionalProperties: false`, so the new property must be added inside this object rather than
by wrapping or extending it.

### 2.12c `package.json:3` and `.claude-plugin/plugin.json:3` — the two version manifests

```json
  "version": "1.0.0",
```

Both files carry that identical line 3 at commit `9f66931`. What is wrong with them: nothing —
they are recorded because step 11 edits both, and because the packaging check fails if they ever
disagree with each other. They read `1.0.0` here rather than the `1.0.8` baseline this MSP plans
against, because the eight MSPs that precede MSP-7 in the ladder had not merged when this plan
was authored. Step 11 is written as a read-then-increment for exactly that reason.

### 2.13 `test/unit/declare.test.ts:163-183` and `:217-222` — the refusal-example property test

```ts
const deriveCandidates = (schema: ZodAny, sample: unknown, path: PathSegment[]): MutationCandidate[] => {
  const unwrapped = zodUnwrap(schema)
  const type = zodDefType(unwrapped)

  if (type === 'object') {
    const shape = zodShape(unwrapped)
    const record = isNode(sample) ? sample : {}
    return Object.keys(shape).flatMap((key) => {
      const fieldSchema = shape[key]
      if (fieldSchema === undefined) {
        return []
      }
      const fieldPath = [...path, key]
      const fieldUnwrapped = zodUnwrap(fieldSchema)
      const leaf: MutationCandidate = {
        path: fieldPath,
        cap: isStringLikeZodType(fieldUnwrapped) ? zodMaxLength(fieldUnwrapped) : null
      }
      return [leaf, ...deriveCandidates(fieldSchema, record[key], fieldPath)]
    })
  }
```

```ts
    const mutated = useOverLength
      ? overLengthAtPath(validRecord, candidate.path, candidate.cap as number)
      : deleteAtPath(validRecord, candidate.path)

    const result = declaration.parse(mutated)
    assert.equal(result.ok, false, `mutation at ${candidate.path.join('.')} unexpectedly validated`)
```

What is wrong with it: `deriveCandidates` makes **every** field a delete-candidate, and the
assertion then requires every deletion to be refused. That assumption holds only for required
fields. Deleting an optional field leaves a valid record, so the assertion fires. Verified: with
the field added and nothing else changed, this test fails with
`mutation at predecessor_id unexpectedly validated`. **This obligation was not in the audit
worksheet this plan inherited; it was found by applying the change.** See section 3, divergence 2.

### 2.14 `test/contract/no-path.test.ts:91-92`, `:275-277` and `:1145` — the refusal-producer census

```ts
const LOAD_THREAD_PRODUCER: ProducerId = 'server/tool-support.ts#loadThread'
const COMMIT_THREAD_PRODUCER: ProducerId = 'server/tool-support.ts#commitThread'
```

```ts
    const unknownThreadLoad = loadThread(store, 'thread_id', rt.ulid())
    if (unknownThreadLoad.ok) throw new Error('expected loadThread to refuse against an unknown thread id')
    refusals.push({ producer: LOAD_THREAD_PRODUCER, refusal: unknownThreadLoad.refusal })
```

What is wrong with it: nothing — but it is a **closed census over every exported function in
`src/` that produces a refusal**, keyed `path#exportName`, and it halts on any producer it has
no sample for. Step 6 adds such a producer. Verified: with the new export present and this file
untouched, the test fails with
`census halted on an unclassifiable item: "server/tool-support.ts#loadThreadForReference"`.
**This obligation was not in the audit worksheet this plan inherited; it was found by applying
the change.** See section 3, divergence 2.

### 2.15 `test/contract/cutover-manifests-agree.test.ts:8` — the version pin

```ts
const EXPECTED_VERSION = '1.0.0'
```

What is wrong with it: the version is a hard-coded literal, so **any** version bump fails this
test. Verified: after bumping both manifests to `1.1.0` in a scratch copy, the test failed with
`.../package.json version is 1.1.0, expected 1.0.0`.

**This is MSP-0's to repair, not MSP-7's.** It is recorded here because MSP-7's version bump
depends on the repair having landed, and section 11.2's stop condition checks exactly that.
MSP-7 makes no edit to this file. See section 3, divergence 3.

### 2.16 `tsconfig.json:6-11` — two compiler settings that constrain the code you may write

```json
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "erasableSyntaxOnly": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true,
```

`exactOptionalPropertyTypes: true` is the one that matters. Under it, a property declared
`predecessor_id?: Ulid` may be **absent**, but may not be explicitly assigned `undefined`. Zod's
`.optional()` infers `string | undefined`, which does not match `?: Ulid`. Steps 1 and 5 are
written to satisfy this exactly; section 3, divergence 4 records the failure it causes if you
deviate.

---

## 3. Divergences from the SPEC

Five, all evidence-backed. Where this section and the SPEC disagree, this section governs and
the plan below is already written to match it.

### Divergence 1 — `test/unit/records.test.ts:14` needs NO edit

The SPEC lists `test/unit/records.test.ts:14` among "the four hard-coded assertions that must
be hand-edited". Reading it, it does not require an edit for this change:

```ts
const EXPECTED_COLLECTION_PATHS = ['completion_criteria', 'spine.key_decisions', 'spine.open_risks', 'spine.out_of_scope']
```

`collectArrayOfObjectNodes` (`test/unit/records.test.ts:16-53`) pushes a path only when
`node.type === 'array'` **and** the resolved `items` node has `type === 'object'`
(lines 30-34). `predecessor_id` is a scalar string, so it never enters that population. This
is exactly the distinction the SPEC's own ruling R6 clause 1 draws when it excludes
`external_refs` — an array-of-objects field whose element `id` was an external ticket
identifier — from the restoration. The census that `external_refs` would have collided with is
this one, and a scalar `predecessor_id` does not collide with it.

**Ruling applied:** this file is a confirmed NEGATIVE and appears in the checklist at item N1.
Verified: with the full change applied, `test/unit/records.test.ts` passes untouched.

### Divergence 2 — the SPEC's hand-edit list is incomplete; there are FIVE, not four

The SPEC names four hand-edited assertions. One of them (divergence 1) is not needed, and three
tests it does not name do need hand edits. The empirically derived list is:

| SPEC named it? | File | Needed? |
| --- | --- | --- |
| yes | `test/unit/field-merge.test.ts:348` | **yes** |
| yes | `test/unit/briefing.test.ts:127` | **yes** |
| yes | `test/unit/briefing.test.ts:154` | **yes** |
| yes | `test/unit/records.test.ts:14` | **no** — divergence 1 |
| **no** | `test/unit/declare.test.ts:163-222` | **yes** — ground truth 2.13 |
| **no** | `test/contract/no-path.test.ts:91-277` | **yes** — ground truth 2.14 |
| **no** | `test/contract/cutover-manifests-agree.test.ts:8` | **not by MSP-7** — MSP-0 owns it, divergence 3 |

**Ruling applied:** ruling O9 states that where a reconstruction differs, the reconstructed
list governs and the SPEC's number does not. Section 4's numbered checklist is that list.

### Divergence 3 — a version pin the SPEC never mentions breaks criterion 6 for EVERY MSP

`test/contract/cutover-manifests-agree.test.ts:8` hard-codes `const EXPECTED_VERSION = '1.0.0'`.
Because orchestrator ruling O1 gives all ten MSPs a version bump, this test fails for every one
of them, not only MSP-7. MSP-7 acceptance criterion 6 requires `npm test` green, and criterion 5
requires the bump, so the pin makes criterion 6 unreachable until it is removed.

**Ruling applied:** this was surfaced from MSP-7 planning as filed item `F7a` and settled
centrally. **MSP-0 de-pins the test permanently, and no later MSP re-pins it.** The test will
derive the expected version by reading `package.json` and assert that
`.claude-plugin/plugin.json` agrees with it, which is the two-manifest invariant its own name
already claims and the one invariant I4 cares about.

**MSP-7 therefore writes NO edit to that file.** Section 11.2 carries the stop condition that
detects an unmerged MSP-0. The rejected alternative — each MSP re-pinning the constant to its own
number — is a change-detector test edited ten times, and it breaks the moment the ladder order
shifts.

### Divergence 4 — the record field is `.optional()`, and it must NOT be `.nullable()`

The SPEC's ruling R6 clause 3 is correct and this plan follows it, but the reasoning deserves
recording because the opposite choice is superficially attractive and is catastrophic.

`z.string().nullable()` produces a **required** key that merely permits `null`. Every thread
record already on disk lacks the key entirely, so a nullable encoding rejects all of them.
Verified with the repository's own Zod 4.4.3:

```
legacy record (no predecessor_id key): {"id":"x","slug":"s"}
  .nullable() schema accepts it : false
  .optional() schema accepts it : true
  .nullable() rejection reason  : invalid_type ["predecessor_id"]
```

A rejected record is quarantined, and quarantine is silent at `src/store/read-path.ts:101-122`
and filtered out at `src/server/resources.ts:151`, `src/server/completions.ts:33` and
`src/server/tools/open_thread.ts:89`. That is precisely the "a required field would silently
empty every ledger" failure the SPEC's risk 3 names, and it is what invariant I3 forbids.

**Ruling applied:** `.optional()` on the record and on the tool input. Section 7's mutation C
proves the choice is load-bearing rather than decorative.

### Divergence 6 — the reconstructed checklist has 28 items, not the 33 recorded elsewhere

The SPEC records that "Audit A5 produced a 33-item closed checklist" for this MSP. That worksheet
did not survive, so section 4 reconstructs the checklist by census over the real code and by
applying the whole change to a scratch copy and reading what actually broke.

**The reconstruction yields 28 items: 13 obligations and 15 confirmed negatives.** It also differs
in composition, not only in count — it drops one item the SPEC named as a hand-edit
(`test/unit/records.test.ts:14`, divergence 1) and adds three the SPEC never named
(`test/unit/declare.test.ts`, `test/contract/no-path.test.ts`, and the manifest version pin,
divergences 2 and 3).

**Ruling applied:** the reconstructed list in section 4 governs. The number 33 is not carried into
this plan, because a count nobody can reproduce is not a checklist.

### Divergence 5 — the ladder lands on `1.1.1`, not `1.1.0`

SPEC section 7 states the ladder lands on `1.1.0`. Orchestrator ruling O2 supersedes that:
MSP-9 merges last and the ladder lands on `1.1.1`, because MSP-9's own acceptance requires every
claim in its document to be true of the shipped code, and a document merged before MSP-7 would
be stale on arrival. This does not change anything MSP-7 does; MSP-7 still bumps the minor.

---

## 4. The change, step by step

Apply the steps in the order given. Steps 1 through 11 leave the tree with eight known
typecheck errors — the eight `renderBriefing` call sites in `test/unit/briefing.test.ts`, which
step 12 fixes. **The tree is type-correct and green only after step 12.** Commit 1 in section 9
contains steps 1-10 together with the test edits, so no commit ever ends type-incorrect.

### The reconstructed census checklist

The SPEC states that "Audit A5 produced a 33-item closed checklist". That worksheet did not
survive, so the list below was reconstructed by census over the real code and by applying the
whole change to a scratch copy of the tree and reading what broke. **It has 28 items: 13
obligations that must be discharged, and 15 confirmed negatives that impose nothing.** Where
this differs from any count quoted elsewhere, THIS list governs, because it was produced by
applying the change and reading what actually broke.

Discharge the thirteen obligations item by item:

| # | Obligation | Discharged by |
| --- | --- | --- |
| 1 | The record type declares the field, optional | Step 1 |
| 2 | The runtime validator declares the field, optional | Step 2 |
| 3 | `THREAD_RULES` gains a rule — **compile-forced**, `TS2741` | Step 3 |
| 4 | `SCALAR_DESCRIPTORS` gains a descriptor — NOT forced, silent if skipped | Step 4 |
| 5 | The merged record literal carries the field — NOT forced, silent if skipped | Step 5 |
| 6 | A reference loader exists that does not refuse a terminal thread | Step 6 |
| 7 | The briefing renders a `Related:` section that the render census can classify | Step 7 |
| 8 | Both briefing call sites resolve and pass a predecessor — **compile-forced**, `TS2554` | Steps 8, 9 |
| 9 | `open_thread` accepts and validates the input | Step 10 |
| 10 | `test/unit/briefing.test.ts` — 8 call sites and 2 whole-output pins | Section 5.2 |
| 11 | `test/unit/field-merge.test.ts:348` — the path list | Section 5.3 |
| 12 | `test/unit/declare.test.ts` — the delete-mutation assumption | Section 5.4 |
| 13 | `test/contract/no-path.test.ts` — the refusal-producer census | Section 5.5 |

The fifteen confirmed negatives. **Budget no work for these.** Each was checked and imposes
nothing; several are listed because they look as though they should:

| # | Not affected | Why |
| --- | --- | --- |
| N1 | `test/unit/records.test.ts:14` | enumerates array-of-object paths only; a scalar never enters (divergence 1) |
| N2 | `src/server/completions.ts` | reads only `id` and `slug`; completions are wired to resource templates, never to tool inputs |
| N3 | `src/server/instructions.ts` | one template literal with no field names; only bound by a 2048-byte budget |
| N4 | `src/schema/example.ts` | already special-cases `ULID_PATTERN.source`, which is why step 2 must reuse that constant rather than write a fresh regex |
| N5 | `src/server/no-arguments.ts` | the sentinel for zero-argument tools; `open_thread` never touches that path |
| N6 | `src/server/tools/resolve_conflict.ts` | its field switches end in `default: break`, and step 3's `take-present` rule means this field never produces a conflict to resolve |
| N7 | `src/domain/spine.ts` | its `Record<...>` types are keyed by hand-written spine unions, not by `keyof Thread` |
| N8 | `src/render/roster.ts` | `RosterRow` is a projection, not the `Thread` type |
| N9 | `src/server/tools/update_thread.ts`, `park_thread.ts`, `src/domain/criteria.ts`, `src/domain/lifecycle.ts` | all build threads with `{ ...thread }` spread, which preserves the field automatically |
| N10 | `test/contract/described.test.ts` | passes because the input is `.optional()` with a description over 10 characters; it would halt only on `.nullable()` |
| N11 | `test/contract/published-schema.test.ts` | derives its expected key list from the schema itself; both sides grow together |
| N12 | `test/contract/skills.test.ts` | neither `SKILL.md` mentions `open_thread` or any of its fields |
| N13 | `test/spawn/install.test.ts` | pins tool **names**, not properties |
| N14 | `test/spawn/lifecycle.test.ts` | `open_thread.rejects-invalid` derives its cases from the schema |
| N15 | `docs/audits/.../probe-caps.ts` | outside `tsconfig.json`'s include set and outside the test glob; neither compiled nor run |

One further file is deliberately absent from both tables:
`test/contract/cutover-manifests-agree.test.ts` is neither an MSP-7 obligation nor an MSP-7
negative. Repairing it belongs to the first MSP in this ladder, which de-pins it permanently,
and MSP-7 depends on that having landed. That dependency is expressed as the stop condition in
section 11.2 and nowhere else.

---

### Step 1 — declare the field on the thread record type

**File:** `src/schema/thread.ts` — REPLACE

FIND:

```ts
  status: 'open' | 'done' | 'abandoned'
  blocked_by: string | null
  completion_criteria: Criterion[]
```

REPLACE:

```ts
  status: 'open' | 'done' | 'abandoned'
  blocked_by: string | null
  predecessor_id?: Ulid | undefined
  completion_criteria: Criterion[]
```

Rationale: invariant I3 requires that a new thread-record field be `.optional()` or carry a
`.default()`, never required, because a required field quarantines every existing record. The
`| undefined` is required by `exactOptionalPropertyTypes: true` (ground truth 2.16) so that the
declared type matches what Zod's `.optional()` infers; without it, step 2's `declare<Thread>`
call fails with `TS2379`.

**Rejected:** `predecessor_id?: Ulid` without `| undefined`, which fails to compile where
`ThreadShape` is handed to `declare<Thread>`.

---

### Step 2 — declare the field on the runtime validator

**File:** `src/schema/thread.ts` — REPLACE

FIND:

```ts
    .describe('the reason this thread is blocked, or null when it is not blocked'),
  completion_criteria: z
```

REPLACE:

```ts
    .describe('the reason this thread is blocked, or null when it is not blocked'),
  predecessor_id: z
    .string()
    .regex(ULID_PATTERN)
    .optional()
    .describe('the id of the thread this one succeeds, absent when this thread succeeds no earlier thread'),
  completion_criteria: z
```

Rationale: without a declaration here the key is stripped on every read (ground truth 2.2).
`ULID_PATTERN` is already imported at `src/schema/thread.ts:3`; reusing it rather than writing a
fresh regex is load-bearing, because `src/schema/example.ts:38-40` special-cases exactly
`ULID_PATTERN.source` when synthesising the repair example that `test/unit/declare.test.ts`
re-validates.

**Rejected:** `.nullable()`, for the reason recorded in section 3, divergence 4.

---

### Step 3 — declare the merge rule (this is compile-forced)

**File:** `src/merge/field-merge.ts` — REPLACE

FIND:

```ts
  blocked_by: 'conflict-on-divergence',
  completion_criteria: 'union-by-id',
```

REPLACE:

```ts
  blocked_by: 'conflict-on-divergence',
  predecessor_id: 'take-present',
  completion_criteria: 'union-by-id',
```

Rationale: `take-present` is chosen because `predecessor_id` is written once by `open_thread`
and no tool ever mutates it, so a genuine divergence between two clones cannot arise. It also
routes an absent-versus-present pair through `resolveScalarField`'s absence arm
(`src/merge/field-merge.ts:73-80`), which keeps whichever side carries the lineage.

**Rejected:** `conflict-on-divergence`. It skips that absence arm, so an absent-versus-present
pair would raise a conflict — and `resolve_conflict`'s field switch ends in `default: break`
(`src/server/tools/resolve_conflict.ts:385-425`), so that conflict could never be resolved and
the merge would be permanently stuck. Choosing `take-present` means no conflict is ever produced
for this field, which is why this MSP does not touch `resolve_conflict.ts` at all.

---

### Step 4 — give the rule a descriptor so it is not dead code

**File:** `src/merge/field-merge.ts` — REPLACE

FIND:

```ts
  { path: 'blocked_by', rule: THREAD_RULES.blocked_by, get: (t) => t.blocked_by },
  { path: 'created_at', rule: THREAD_RULES.created_at, get: (t) => t.created_at },
```

REPLACE:

```ts
  { path: 'blocked_by', rule: THREAD_RULES.blocked_by, get: (t) => t.blocked_by },
  { path: 'predecessor_id', rule: THREAD_RULES.predecessor_id, get: (t) => t.predecessor_id },
  { path: 'created_at', rule: THREAD_RULES.created_at, get: (t) => t.created_at },
```

Rationale: nothing forces this entry (ground truth 2.4). Without it the rule declared in step 3
is never consulted and the field is never merged.

---

### Step 5 — carry the merged value into the merged record

**File:** `src/merge/field-merge.ts` — REPLACE

FIND:

```ts
  const byPath = new Map(scalarResolutions.map((resolution) => [resolution.path, resolution.value] as const))

  const merged: Thread = {
```

REPLACE:

```ts
  const byPath = new Map(scalarResolutions.map((resolution) => [resolution.path, resolution.value] as const))

  const mergedPredecessorId = byPath.get('predecessor_id') as Thread['predecessor_id']

  const merged: Thread = {
```

Then, **File:** `src/merge/field-merge.ts` — REPLACE

FIND:

```ts
    blocked_by: byPath.get('blocked_by') as Thread['blocked_by'],
    completion_criteria: criteriaResolution.merged,
```

REPLACE:

```ts
    blocked_by: byPath.get('blocked_by') as Thread['blocked_by'],
    ...(mergedPredecessorId === undefined ? {} : { predecessor_id: mergedPredecessorId }),
    completion_criteria: criteriaResolution.merged,
```

Rationale: the merged literal names every key explicitly and uses no spread, so an unnamed
optional key is silently dropped by every merge (ground truth 2.5). The conditional spread is
used rather than a plain assignment so that the in-memory object has the key genuinely
**absent** when there is no predecessor, matching exactly what a record round-tripped through
JSON looks like. Verified: `ThreadRecord.parse` on a record carrying an explicit
`predecessor_id: undefined` returns a value for which `'predecessor_id' in value` is `true`,
whereas a record without the key returns one where it is `false` — and `isDeepStrictEqual`,
which the merge engine uses throughout, distinguishes those two.

**Rejected:** `predecessor_id: mergedPredecessorId`, which compiles but leaves the key present
with an `undefined` value, making an in-memory merged record unequal under `deepStrictEqual` to
the same record read back from disk.

---

### Step 6 — add a reference loader and a predecessor resolver

**File:** `src/server/tool-support.ts` — REPLACE

FIND:

```ts
export const loadThread = (store: Store, field: string, id: Ulid): Attempt<Thread> => {
```

REPLACE:

```ts
export const loadThreadForReference = (store: Store, field: string, id: Ulid): Attempt<Thread> => {
  const slot = store.readThread(id)
  if (slot === null) return { ok: false, refusal: threadNotFoundRefusal(field, id) }
  if (slot.quarantined) return { ok: false, refusal: threadQuarantinedRefusal(field, id) }
  return { ok: true, value: slot.record }
}

export const resolvePredecessor = (rt: Runtime, store: Store, thread: Thread): Thread | null => {
  const predecessorId = thread.predecessor_id
  if (predecessorId === undefined) return null
  const slot = store.readThread(predecessorId)
  if (slot === null) {
    rt.log({ level: 'error', event: 'briefing.predecessor-dangling', thread_id: thread.id, predecessor_id: predecessorId })
    return null
  }
  if (slot.quarantined) {
    rt.log({ level: 'error', event: 'briefing.predecessor-quarantined', thread_id: thread.id, predecessor_id: predecessorId })
    return null
  }
  return slot.record
}

export const loadThread = (store: Store, field: string, id: Ulid): Attempt<Thread> => {
```

Rationale for two functions rather than one:

- `loadThreadForReference` is the **write-time** check behind acceptance criterion 2. It differs
  from `loadThread` only in that it does not refuse a terminal thread, which is required because
  a predecessor is normally terminal (ground truth 2.9). It reuses the two existing refusal
  builders, so it introduces no new refusal shape.
- `resolvePredecessor` is the **read-time** lookup used by both briefing call sites. It returns
  `null` rather than refusing when the record is missing or unparseable, and logs the fact. That
  mirrors exactly how `decisionsForThread` (`src/server/resources.ts:63-83`) already handles a
  dangling or quarantined spine link, so a thread whose predecessor was later deleted still
  renders instead of failing.

`Runtime` is already imported as a type at `src/server/tool-support.ts:1` and `Thread` at line 3,
so no import changes are needed in this file.

**Rejected:** widening `loadThread` with a flag parameter. That would change the meaning of
every one of its existing call sites' refusals at a distance, and the terminal-thread refusal it
carries is correct for those callers.

---

### Step 7 — render the `Related:` section

**File:** `src/render/briefing.ts` — REPLACE

FIND:

```ts
const renderBlockage = (blockedBy: string | null): string =>
```

REPLACE:

```ts
const renderRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${escapeStored(predecessor.title)} (${escapeStored(predecessor.slug)})`

const renderBlockage = (blockedBy: string | null): string =>
```

Then, **File:** `src/render/briefing.ts` — REPLACE

FIND:

```ts
export const renderBriefing = (thread: Thread, decisions: Decision[], pointer: Pointer | null): string => {
```

REPLACE:

```ts
export const renderBriefing = (
  thread: Thread,
  decisions: Decision[],
  pointer: Pointer | null,
  predecessor: Thread | null
): string => {
```

Then, **File:** `src/render/briefing.ts` — REPLACE

FIND:

```ts
  const decisionLines = decisions.map(renderDecisionLine)
```

REPLACE:

```ts
  const decisionLines = decisions.map(renderDecisionLine)
  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderRelatedLine)
```

Then, **File:** `src/render/briefing.ts` — REPLACE

FIND:

```ts
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    'Open risks:',
```

REPLACE:

```ts
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    'Related:',
    ...relatedLines,
    'Open risks:',
```

Rationale, four decisions, each with its rejected alternative:

1. **The line is built by a named helper mapped over an array, not by an inline conditional
   spread.** This is what satisfies acceptance criterion 4 by classification. The render census
   resolves `...relatedLines` by following the identifier to its `.map(...)` initializer and then
   into the callback body, where it finds the `escapeStored` calls and classifies the site
   `escaped`. **Rejected:** `...(predecessor === null ? [] : [renderRelatedLine(predecessor)])`.
   The census's array resolver does not handle a conditional expression, falls back to the spread
   element itself, and halts. Verified: that form fails with
   `census halted on an unclassifiable item: {"file":"src/render/briefing.ts","line":54,"expression":"...relatedLines","classification":"unclassifiable"}`.
   The form given above passes. Note carefully that the fix is to make the new code
   **classifiable**, never to exclude the file from `CENSUSED_FILES`.
2. **The `Related:` label is unconditional.** Every other section label in the file prints even
   when its list is empty (ground truth 2.6), and matching that keeps the renderer's one uniform
   rule intact. **Rejected:** omitting the whole section when there is no predecessor, which
   would make it the only conditional section in the file.
3. **The section sits between `Last session:` and `Open risks:`.** That is the boundary between
   the inline `Label: value` block and the `Label:` plus `- item` list block, and `Related:` is a
   list. **Rejected:** appending after `Decisions:`, which buries lineage below two
   variable-length lists.
4. **The line renders title and slug, both escaped.** The slug is the handle the roster and the
   `logbook://thread` resource already accept, so it is actionable. **Rejected:** including the
   26-character raw id, which adds length without adding an action the slug cannot serve, since
   `resolveThreadSlot` (`src/server/resources.ts:56-61`) resolves by id **or** slug.

---

### Step 8 — resolve the predecessor at the resources call site

**File:** `src/server/resources.ts` — REPLACE

FIND:

```ts
import { openProjectStore } from './tool-support.ts'
```

REPLACE:

```ts
import { openProjectStore, resolvePredecessor } from './tool-support.ts'
```

Then, **File:** `src/server/resources.ts` — REPLACE

FIND:

```ts
  return renderBriefing(thread, decisions, pointer)
```

REPLACE:

```ts
  return renderBriefing(thread, decisions, pointer, resolvePredecessor(rt, store, thread))
```

Rationale: `renderBriefing` cannot see other threads, so the predecessor is resolved where a
store handle exists and passed in.

---

### Step 9 — resolve the predecessor at the resume_thread call site

**File:** `src/server/tools/resume_thread.ts` — REPLACE

FIND:

```ts
import { openProjectStore, loadThread } from '../tool-support.ts'
```

REPLACE:

```ts
import { openProjectStore, loadThread, resolvePredecessor } from '../tool-support.ts'
```

Then, **File:** `src/server/tools/resume_thread.ts` — REPLACE

FIND:

```ts
    const briefing = renderBriefing(thread, decisions, writtenPointer)
```

REPLACE:

```ts
    const briefing = renderBriefing(thread, decisions, writtenPointer, resolvePredecessor(rt, store, thread))
```

Rationale: same as step 8. Making the fourth parameter **required** rather than defaulted is
deliberate — it is the second compile-time forcing, and it is what guarantees both call sites
are updated rather than one being silently forgotten.

**Rejected:** `predecessor: Thread | null = null`. A default would let a call site omit the
argument and render an empty `Related:` section forever. A field that is stored but renders
nowhere is the exact defect this MSP exists to avoid creating: the project's standing rule is
that any field worth showing belongs in a render section, never in a sidecar object.

---

### Step 10 — accept and validate the input on `open_thread`

**File:** `src/server/tools/open_thread.ts` — REPLACE

FIND:

```ts
import { SLUG_PATTERN } from '../../schema/ids.ts'
```

REPLACE:

```ts
import { SLUG_PATTERN, ULID_PATTERN } from '../../schema/ids.ts'
```

Then, **File:** `src/server/tools/open_thread.ts` — REPLACE

FIND:

```ts
import { commitThread, openProjectStore } from '../tool-support.ts'
```

REPLACE:

```ts
import { commitThread, loadThreadForReference, openProjectStore } from '../tool-support.ts'
```

Then, **File:** `src/server/tools/open_thread.ts` — REPLACE

FIND:

```ts
    .describe('a short lowercase label unique in this project, letters digits and hyphens, for example merge-and-sync'),
  completion_criteria: z
```

REPLACE:

```ts
    .describe('a short lowercase label unique in this project, letters digits and hyphens, for example merge-and-sync'),
  predecessor_id: z
    .string()
    .regex(ULID_PATTERN)
    .optional()
    .describe('the id of an existing thread this new thread succeeds, a 26-character ULID such as 01M0NDPM0ACCR9CD68PMHYWGGD; omit it when this thread succeeds no earlier thread'),
  completion_criteria: z
```

Then, **File:** `src/server/tools/open_thread.ts` — REPLACE

FIND:

```ts
    const now = rt.now()
```

REPLACE:

```ts
    const predecessorId = input.predecessor_id
    if (predecessorId !== undefined) {
      const predecessor = loadThreadForReference(store, 'predecessor_id', predecessorId)
      if (!predecessor.ok) return { ok: false, refusal: predecessor.refusal }
    }

    const now = rt.now()
```

Then, **File:** `src/server/tools/open_thread.ts` — REPLACE

FIND:

```ts
      blocked_by: null,
      completion_criteria: completionCriteria,
```

REPLACE:

```ts
      blocked_by: null,
      ...(predecessorId === undefined ? {} : { predecessor_id: predecessorId }),
      completion_criteria: completionCriteria,
```

Rationale, four points:

1. **The property is added inside the existing `z.strictObject({...})`.** `src/server/register.ts:66`
   rejects any tool taking arguments whose schema does not publish
   `additionalProperties: false`, so the object must not be wrapped, extended or made partial.
2. **`.optional()`, never `.nullable()`.** Verified against real Zod 4.4.3 output on both the
   local and the published surface. `.optional()` emits
   `{"type":"string","pattern":...,"description":...}` and classifies `allowed`; `.nullable()`
   emits `{"anyOf":[{"type":"string"},{"type":"null"}]}` with no top-level `type`, which
   `test/contract/described.test.ts:50-57` classifies `unclassifiable`, halting the census. A
   description does not rescue it, because the `anyOf` key is tested for presence before the
   description is read.
3. **The description must be at least 10 trimmed characters** — `described.test.ts:13,61` — or the
   census returns `forbidden`. The text above is well over that.
4. **The referential check runs before anything is minted,** so a refusal leaves no partial
   thread behind. The conditional spread on the record literal is required by
   `exactOptionalPropertyTypes`, for the same reason as step 5.

---

### Step 11 — bump both manifests

**File:** `package.json` and `.claude-plugin/plugin.json` — REPLACE

This is a read-then-increment, not a hard-coded pair. Perform it exactly as follows.

1. Read the current version:

```
node -p "require('./package.json').version"
```

2. Compute the target: keep the MAJOR, add one to the MINOR, set the PATCH to `0`. Under the
   baseline ladder the current value is `1.0.8` and the target is `1.1.0`.
3. Edit `package.json` line 3, replacing only the version string. Under the baseline:

FIND:

```json
  "version": "1.0.8",
```

REPLACE:

```json
  "version": "1.1.0",
```

4. Edit `.claude-plugin/plugin.json` line 3 the same way, to the same value:

FIND:

```json
  "version": "1.0.8",
```

REPLACE:

```json
  "version": "1.1.0",
```

5. Confirm both files now read the same value and nothing else in them changed:

```
git diff --stat package.json .claude-plugin/plugin.json
```

Expected output, exactly two files with one insertion and one deletion each:

```
 .claude-plugin/plugin.json | 2 +-
 package.json               | 2 +-
 2 files changed, 2 insertions(+), 2 deletions(-)
```

6. Run the packaging check:

```
node scripts/check-packaging.mjs
```

Expected exit code `0` and stdout exactly `check-packaging: ok`.

Rationale: invariant I4 requires both manifests to move in the same commit, and
`scripts/check-packaging.mjs:134-150` fails if they disagree. Writing the step as a
read-then-increment means a ladder that shifted by one patch does not invalidate this plan.

---

### Step 12 — apply the test changes

Apply sections 5.1 through 5.5. They are given there in full rather than repeated here.

---

## 5. Tests

Five files change and one is created. Every test name below is the exact string.

### 5.1 `test/store/lineage.test.ts` — NEW FILE, given in full

This file discharges acceptance criteria 1, 2 and 3. Create it with exactly these contents,
first character to last:

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { resumeThreadTool } from '../../src/server/tools/resume_thread.ts'
import { openStore } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { selectRosterThreads, toRosterRow } from '../../src/render/roster.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit } from '../support/git-fixture.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const withLineageFixture = async (fn: (rt: Runtime) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-lineage-repo-'))
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-lineage-plugin-data-'))
  try {
    rawGit(repo, ['init', '--initial-branch=main'])
    rawGit(repo, ['config', 'user.name', 'Logbook Lineage Fixture'])
    rawGit(repo, ['config', 'user.email', 'lineage@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook lineage fixture repository\n')
    rawGit(repo, ['add', 'README.md'])
    rawGit(repo, ['commit', '-m', 'fixture: initial commit'])
    await fn(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo }))
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

test('lineage.briefing-renders-the-predecessor-it-was-opened-with', async () => {
  await withLineageFixture(async (rt) => {
    const first = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'The thread that came first',
      slug: 'came-first',
      completion_criteria: ['the first criterion']
    })
    assert.equal(first.ok, true)
    if (!first.ok) throw new Error('expected the predecessor thread to open')

    const second = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'The thread that succeeds it',
      slug: 'succeeds-it',
      completion_criteria: ['the second criterion'],
      predecessor_id: first.structured.thread_id
    })
    assert.equal(second.ok, true)
    if (!second.ok) throw new Error('expected the successor thread to open')

    const resumed = await resumeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: second.structured.thread_id
    })
    assert.equal(resumed.ok, true)
    if (!resumed.ok) throw new Error('expected the successor thread to resume')

    const lines = resumed.structured.briefing.split('\n')
    const relatedIndex = lines.indexOf('Related:')
    assert.notEqual(relatedIndex, -1)
    assert.equal(lines[relatedIndex + 1], '- succeeds: The thread that came first (came-first)')
  })
})

test('lineage.unresolvable-predecessor-is-refused-at-write-time', async () => {
  await withLineageFixture(async (rt) => {
    const refused = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'A thread naming a predecessor that does not exist',
      slug: 'dangling-predecessor',
      completion_criteria: ['the only criterion'],
      predecessor_id: rt.ulid()
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected open_thread to refuse an unresolvable predecessor_id')
    assert.equal(refused.refusal.field, 'predecessor_id')

    const opened = openStore(rt, rt.cwd)
    assert.equal(opened.ok, true)
    if (!opened.ok) throw new Error('expected the lineage fixture store to open')
    assert.equal(opened.value.readThreads().length, 0)
  })
})

test('lineage.a-record-written-before-this-change-still-parses-and-rosters', async () => {
  await withLineageFixture(async (rt) => {
    const opened = openStore(rt, rt.cwd)
    assert.equal(opened.ok, true)
    if (!opened.ok) throw new Error('expected the lineage fixture store to open')
    const store = opened.value

    const legacyId = rt.ulid()
    const legacy: Extract<RecordChange, { kind: 'thread' }> = {
      kind: 'thread',
      record: {
        id: legacyId,
        slug: 'written-before-lineage',
        title: 'A thread written before lineage existed',
        status: 'open',
        blocked_by: null,
        completion_criteria: [],
        spine: {
          active_goal: 'the goal',
          next_step: 'the next step',
          last_session: 'the last session',
          open_risks: [],
          key_decisions: [],
          out_of_scope: []
        },
        created_at: rt.now(),
        updated_at: rt.now()
      }
    }

    assert.equal(JSON.stringify(legacy.record).includes('predecessor_id'), false)

    const committed = store.commit([legacy], 'fixture: a thread written before lineage')
    assert.equal(committed.ok, true)

    const slot = store.readThread(legacyId)
    assert.notEqual(slot, null)
    assert.equal(slot === null ? true : slot.quarantined, false)

    const rows = selectRosterThreads(store.readThreads().flatMap((s) => (s.quarantined ? [] : [s.record]))).map(
      toRosterRow
    )
    assert.equal(
      rows.some((row) => row.slug === 'written-before-lineage'),
      true
    )
  })
})
```

Notes on why the file is shaped this way:

- Every test drives a **fixture store in a temp directory** created with `mkdtempSync`, per
  invariant I7. Nothing observes this session's own ledger.
- The fixture is written inline rather than using `withRepo` from `test/support/git-fixture.ts`,
  because `withRepo` is synchronous: given an async callback it would delete the temp directory
  before the promise resolved.
- No ULID appears as a string literal anywhere; ids come from `rt.ulid()` or from a tool result.
  `test/contract/no-literal-identifiers.test.ts` forbids ULID-shaped literals inside assertions.

### 5.2 `test/unit/briefing.test.ts` — MODIFIED, ten exact edits

Eight call sites gain a fourth argument, and the two whole-output pins gain the new line.
Apply edits 1 through 8 before edits 9 and 10. Edits 1 and 6 both contain the substring
`renderBriefing(thread, [], null)` and are disambiguated by the assertion line that follows,
which is why each FIND block carries it.

Edit 1, in `briefing.blocked-renders-its-reason` — FIND:

```ts
  const rendered = renderBriefing(thread, [], null)
  assert.ok(rendered.split('\n').some(
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [], null, null)
  assert.ok(rendered.split('\n').some(
```

Edit 2, in `briefing.blockage-none-when-not-blocked` — FIND:

```ts
  const rendered = renderBriefing(thread, [], null)
  assert.ok(rendered.split('\n').includes('Blockage: none'))
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [], null, null)
  assert.ok(rendered.split('\n').includes('Blockage: none'))
```

Edit 3, in `briefing.renders-exact-output-for-a-full-thread` — FIND:

```ts
  const rendered = renderBriefing(thread, [decisionOne], pointer)
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [decisionOne], pointer, null)
```

Edit 4, in `briefing.renders-headers-only-when-lists-are-empty` — FIND:

```ts
  const rendered = renderBriefing(thread, [], null)
  const expected = [
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [], null, null)
  const expected = [
```

Edit 5, in `briefing.pointer-status-is-no-for-a-different-thread` — FIND:

```ts
  const rendered = renderBriefing(thread, [], pointer)
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [], pointer, null)
```

Edit 6, in `briefing.criterion-status-is-open-when-undone-and-unstruck` — FIND:

```ts
  const rendered = renderBriefing(thread, [], null)
  assert.ok(rendered.split('\n').includes('c1 [open] not started yet'))
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [], null, null)
  assert.ok(rendered.split('\n').includes('c1 [open] not started yet'))
```

Edit 7, in `briefing.renders-multiple-decisions-in-order` — FIND:

```ts
  const rendered = renderBriefing(thread, [first, second], null)
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [first, second], null, null)
```

Edit 8, in `briefing.escapes-every-free-text-field` — FIND:

```ts
  const rendered = renderBriefing(thread, [decision], null)
```

REPLACE:

```ts
  const rendered = renderBriefing(thread, [decision], null, null)
```

Edit 9, the full-thread output pin — FIND:

```ts
    'Last session: wrote the first draft',
    'Open risks:',
```

REPLACE:

```ts
    'Last session: wrote the first draft',
    'Related:',
    'Open risks:',
```

Edit 10, the empty-lists output pin — FIND:

```ts
    'Last session: wrote the renderer',
    'Open risks:',
```

REPLACE:

```ts
    'Last session: wrote the renderer',
    'Related:',
    'Open risks:',
```

### 5.3 `test/unit/field-merge.test.ts` — MODIFIED, one exact edit

In `merge.rule-table-is-covered.walk-finds-spine-and-top-level-paths` — FIND:

```ts
      'created_at',
      'id',
      'slug',
```

REPLACE:

```ts
      'created_at',
      'id',
      'predecessor_id',
      'slug',
```

Without this edit the test fails with a diff whose only line is `+   'predecessor_id',`.

### 5.4 `test/unit/declare.test.ts` — MODIFIED, four exact edits

The property test must learn that deleting an optional field is legal. This is classification,
not narrowing: every field remains a candidate, and an optional field is simply given a mutation
that genuinely invalidates the record instead of one that does not.

Edit 1 — FIND:

```ts
type MutationCandidate = { path: PathSegment[]; cap: number | null }
```

REPLACE:

```ts
type MutationCandidate = { path: PathSegment[]; cap: number | null; optional: boolean }
```

Edit 2 — FIND:

```ts
const overLengthAtPath = (record: Record<string, unknown>, path: PathSegment[], cap: number): Record<string, unknown> => {
```

REPLACE:

```ts
const UNACCEPTABLE_VALUE = { unacceptable: true }

const setUnacceptableAtPath = (record: Record<string, unknown>, path: PathSegment[]): Record<string, unknown> => {
  const clone = deepClone(record)
  const parent = cursorTo(clone, path)
  const lastSegment = path[path.length - 1]
  if (lastSegment === undefined) {
    throw new Error('setUnacceptableAtPath requires a non-empty path')
  }
  parent[String(lastSegment)] = UNACCEPTABLE_VALUE
  return clone
}

const overLengthAtPath = (record: Record<string, unknown>, path: PathSegment[], cap: number): Record<string, unknown> => {
```

Edit 3 — FIND:

```ts
      const leaf: MutationCandidate = {
        path: fieldPath,
        cap: isStringLikeZodType(fieldUnwrapped) ? zodMaxLength(fieldUnwrapped) : null
      }
```

REPLACE:

```ts
      const leaf: MutationCandidate = {
        path: fieldPath,
        cap: isStringLikeZodType(fieldUnwrapped) ? zodMaxLength(fieldUnwrapped) : null,
        optional: zodDefType(fieldSchema) === 'optional'
      }
```

Edit 4 — FIND:

```ts
    const mutated = useOverLength
      ? overLengthAtPath(validRecord, candidate.path, candidate.cap as number)
      : deleteAtPath(validRecord, candidate.path)
```

REPLACE:

```ts
    const mutated = useOverLength
      ? overLengthAtPath(validRecord, candidate.path, candidate.cap as number)
      : candidate.optional
        ? setUnacceptableAtPath(validRecord, candidate.path)
        : deleteAtPath(validRecord, candidate.path)
```

Why this is not a weakening: the assertion that every mutation must be refused is untouched, so
an optional field's mutation must still produce a refusal. If a future optional field ever
accepts `{ unacceptable: true }`, the test halts with the same
`mutation at <path> unexpectedly validated` message rather than passing silently.
`zodDefType` is already defined in this file at line 109, and `zodUnwrap` at lines 111-117
already treats `'optional'` as a wrapper type, so the discriminator is read from the schema
itself rather than from a list of field names.

### 5.5 `test/contract/no-path.test.ts` — MODIFIED, three exact edits

The refusal-producer census must be given a sample for the new exported producer.

Edit 1 — FIND:

```ts
import { commitThread, loadThread, openProjectStore } from '../../src/server/tool-support.ts'
```

REPLACE:

```ts
import { commitThread, loadThread, loadThreadForReference, openProjectStore } from '../../src/server/tool-support.ts'
```

Edit 2 — FIND:

```ts
const COMMIT_THREAD_PRODUCER: ProducerId = 'server/tool-support.ts#commitThread'
```

REPLACE:

```ts
const LOAD_THREAD_FOR_REFERENCE_PRODUCER: ProducerId = 'server/tool-support.ts#loadThreadForReference'
const COMMIT_THREAD_PRODUCER: ProducerId = 'server/tool-support.ts#commitThread'
```

Edit 3 — FIND:

```ts
    refusals.push({ producer: LOAD_THREAD_PRODUCER, refusal: unknownThreadLoad.refusal })
```

REPLACE:

```ts
    refusals.push({ producer: LOAD_THREAD_PRODUCER, refusal: unknownThreadLoad.refusal })

    const unknownReferenceLoad = loadThreadForReference(store, 'predecessor_id', rt.ulid())
    if (unknownReferenceLoad.ok) throw new Error('expected loadThreadForReference to refuse against an unknown thread id')
    refusals.push({ producer: LOAD_THREAD_FOR_REFERENCE_PRODUCER, refusal: unknownReferenceLoad.refusal })
```

This satisfies the census by **classifying** the new producer — giving it a real refusal sample
that the path-disclosure scan then inspects. It is not added to any exclusion list.

### 5.6 Which test discharges which acceptance criterion

| Criterion | Discharged by |
| --- | --- |
| 1 | `lineage.briefing-renders-the-predecessor-it-was-opened-with` |
| 2 | `lineage.unresolvable-predecessor-is-refused-at-write-time` |
| 3 | `lineage.a-record-written-before-this-change-still-parses-and-rosters` |
| 4 | `render.no-unescaped-site` passing with `src/render/briefing.ts` still in `CENSUSED_FILES` and no exclusion added; plus `contract.every-property-described`, `merge.rule-table-is-covered.walk-finds-spine-and-top-level-paths`, `schema.refusal-example-always-revalidates` and `error.discloses-no-path` all passing by classification |
| 5 | `node scripts/check-packaging.mjs` exit 0, plus `cutover.manifests-agree` |
| 6 | `npm test` |

---

## 6. Red on the parent

"The parent" means the commit the MSP branch was cut from: the tip of `main` at branch-cut
time, `0ade582` at authoring time.

### 6.1 Procedure

1. Set aside every source and test change while keeping the new test file, with exactly this
   command:

```
git stash push -- src test/unit/briefing.test.ts test/unit/field-merge.test.ts test/unit/declare.test.ts test/contract/no-path.test.ts package.json .claude-plugin/plugin.json
```

Expected exit code `0`. Expected output contains `Saved working directory`.

2. Run the acceptance tests against the untouched parent:

```
node --test "test/store/lineage.test.ts"
```

Expected exit code **`1`** — this run is supposed to fail.

3. Restore the change:

```
git stash pop
```

Expected exit code `0`.

### 6.2 Expected result on the parent — two red, one green

```
✖ lineage.briefing-renders-the-predecessor-it-was-opened-with
✖ lineage.unresolvable-predecessor-is-refused-at-write-time
✔ lineage.a-record-written-before-this-change-still-parses-and-rosters
pass 1
fail 2
```

- `lineage.briefing-renders-the-predecessor-it-was-opened-with` fails at
  `assert.notEqual(relatedIndex, -1)` with `actual: -1, expected: -1, operator: 'notStrictEqual'`,
  because the parent's briefing has no `Related:` line.
- `lineage.unresolvable-predecessor-is-refused-at-write-time` fails at
  `assert.equal(refused.ok, false)` with `true !== false`, because the parent's `open_thread`
  ignores the extra argument entirely and opens the thread.

### 6.3 The third test cannot be red on the parent, and must not be

`lineage.a-record-written-before-this-change-still-parses-and-rosters` passes on the parent by
design. It is invariant I3's **guard**, not a red-green test: it asserts a property that is true
before the change and must remain true after it. A guard that failed on the parent would be
asserting something the parent gets wrong, which is not what criterion 3 asks for.

**Substitute procedure**, which is what actually proves this test has teeth: it must turn red
when the field is made required. That is mutation C in section 7, and it is verified there.

### 6.4 A note on typecheck during the red run

On the parent, `npx tsc -p tsconfig.json --noEmit` reports two errors in the new test file:

```
test/store/lineage.test.ts(49,7): error TS2353: Object literal may only specify known properties, and 'predecessor_id' does not exist in type '{ title: string; slug: string; completion_criteria: string[]; }'.
test/store/lineage.test.ts(73,7): error TS2353: Object literal may only specify known properties, and 'predecessor_id' does not exist in type '{ title: string; slug: string; completion_criteria: string[]; }'.
```

That is expected and is itself evidence the input field does not exist yet. The Node test runner
strips types rather than checking them, so the tests still execute and produce the two runtime
reds above.

---

## 7. Inertness mutation

Each mutation is applied to the **finished** change, one at a time, with the tree restored
between them. Each names the exact test that must turn red. All three were verified.

Run after each mutation:

```
node --test "test/store/lineage.test.ts"
```

Expected exit code **`1`** after every mutation — each run is supposed to fail. After each
restore, the same command must return to exit code `0` with `pass 3` and `fail 0`.

### Mutation A — for acceptance criterion 1

**Revert:** in `src/render/briefing.ts`, delete these two lines from the returned array:

```ts
    'Related:',
    ...relatedLines,
```

**Must turn red:** `lineage.briefing-renders-the-predecessor-it-was-opened-with`.
**Expected failure text:** `assert.notEqual(relatedIndex, -1)` fails with `actual: -1`.
**Also expected:** the other two tests stay green.
**Restore:** re-insert the two lines exactly as step 7's fourth edit gives them.

### Mutation B — for acceptance criterion 2

**Revert:** in `src/server/tools/open_thread.ts`, delete this block:

```ts
    if (predecessorId !== undefined) {
      const predecessor = loadThreadForReference(store, 'predecessor_id', predecessorId)
      if (!predecessor.ok) return { ok: false, refusal: predecessor.refusal }
    }
```

**Must turn red:** `lineage.unresolvable-predecessor-is-refused-at-write-time`.
**Expected failure text:** `assert.equal(refused.ok, false)` fails with `true !== false`.
**Also expected:** the other two tests stay green.
**Restore:** re-insert the block exactly as step 10's fourth edit gives it.

### Mutation C — for acceptance criterion 3

**Revert:** in `src/schema/thread.ts`, change the new field's `.optional()` to `.nullable()`,
which converts it from an optional key into a required one:

```ts
    .regex(ULID_PATTERN)
    .nullable()
```

**Must turn red:** `lineage.a-record-written-before-this-change-still-parses-and-rosters`.
**Expected failure text:** `assert.equal(slot === null ? true : slot.quarantined, false)` fails,
because the pre-change record no longer parses and is quarantined.
**Also expected:** `lineage.briefing-renders-the-predecessor-it-was-opened-with` turns red too,
because newly written records cannot be read back either. That double failure is the point: it
shows how wide the blast radius of a required field is.
**Restore:** change `.nullable()` back to `.optional()`.

---

## 8. Full verification

Run in this order. Every command is given verbatim with its expected exit code and the output
substring that proves the result.

### 8.1 Typecheck

```
npm run typecheck
```

Expected exit code `0`. Expected output: the two npm banner lines and **nothing else** — no line
containing `error TS`.

### 8.2 The acceptance tests alone

```
node --test "test/store/lineage.test.ts"
```

Expected exit code `0`. Expected output contains `pass 3` and `fail 0`.

### 8.3 The four censuses this change touches

```
node --test "test/contract/render-census.test.ts" "test/unit/field-merge.test.ts" "test/unit/declare.test.ts" "test/contract/no-path.test.ts"
```

Expected exit code `0`. Expected output contains `fail 0`, and contains the line
`✔ render.no-unescaped-site` — that specific line is the evidence for acceptance criterion 4.

### 8.4 The packaging check

```
node scripts/check-packaging.mjs
```

Expected exit code `0`. Expected stdout exactly `check-packaging: ok`.

### 8.5 Both manifests read the bumped version

```
node -e "const p=require('./package.json').version,q=require('./.claude-plugin/plugin.json').version;console.log(p,q,p===q)"
```

Expected exit code `0`. Expected stdout under the baseline ladder: `1.1.0 1.1.0 true`.

### 8.6 The manifest-agreement test, which MSP-7 does not edit

```
node --test "test/contract/cutover-manifests-agree.test.ts"
```

Expected exit code `0`. Expected output contains `✔ cutover.manifests-agree`.

This test is **not** modified by MSP-7. It passes because the first MSP in this ladder already
replaced its pinned version literal with one derived from `package.json`. If it fails here, do
not edit it — go to section 11.2.

### 8.7 The full suite

```
npm test
```

Expected exit code `0`. Expected output contains `fail 0` and `pass 346`.

The count is `346` because the parent's `343` gains the three tests in
`test/store/lineage.test.ts`. If the ladder shifted and an earlier MSP added tests, the count is
higher; only `fail 0` is load-bearing.

### 8.8 The mutation gate, and what it does and does not prove

```
npm run mutate
```

This step is optional locally and is **not** an acceptance criterion, so its exit code does not
gate the MSP; record whatever it returns. If it is run, note honestly
what it covers: `stryker.config.json` scopes mutation to `src/store/**`, `src/schema/**`,
`src/merge/field-merge.ts`, `src/merge/conflict.ts` and `src/render/**`. Of this MSP's changed
source files, `src/schema/thread.ts`, `src/merge/field-merge.ts` and `src/render/briefing.ts`
fall **inside** that scope; `src/server/tool-support.ts`, `src/server/resources.ts`,
`src/server/tools/open_thread.ts` and `src/server/tools/resume_thread.ts` fall **outside** it and
are mutated by nothing. Section 10's pull request body states this.

---

## 9. Commits

Two commits. No refactor shares a commit with a behaviour change.

### Commit 1 — the behaviour change

Subject line, exactly:

```
feat(lineage): record and render the thread a thread succeeds
```

Files:

```
src/schema/thread.ts
src/merge/field-merge.ts
src/server/tool-support.ts
src/render/briefing.ts
src/server/resources.ts
src/server/tools/resume_thread.ts
src/server/tools/open_thread.ts
test/store/lineage.test.ts
test/unit/briefing.test.ts
test/unit/field-merge.test.ts
test/unit/declare.test.ts
test/contract/no-path.test.ts
```

Contains plan steps 1 through 10, and sections 5.1 through 5.5.

### Commit 2 — the version bump

Subject line, exactly:

```
chore(release): bump the minor version for the lineage field
```

Files:

```
package.json
.claude-plugin/plugin.json
```

Contains plan step 11. Invariant I4 requires both manifests to move in the same commit, and this
commit does exactly that and nothing else.

**There is no third commit.** An earlier draft of this plan carried one that modified
`test/contract/cutover-manifests-agree.test.ts`. That repair belongs to the first MSP in this
ladder and is permanent, so MSP-7 does not touch that file and produces no such commit. Section
11.2 is the check that it has landed.

---

## 10. Pull request

Open it with the centralized tool and no other path. Ad-hoc `gh pr create`, `gh api` POSTs to the
pulls endpoint and the GitHub MCP create tool are all denied at the gate.

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/msp-7-thread-lineage --base main \
  --title "feat(lineage): record and render the thread a thread succeeds" \
  --what "A new thread can name an earlier thread it succeeds, and the briefing shows that link in a Related section." \
  --what "Naming a thread that does not exist is refused when the thread is created, instead of storing a link that goes nowhere." \
  --why "The server told callers to open a new thread that references a finished one, but shipped no field in which to record the reference." \
  --risk "This is the first change to the stored thread record since the cutover; the field is optional so records written earlier keep parsing." \
  --verified "npm test - 346 passed, 0 failed" \
  --verified "npm run typecheck - exit 0, no diagnostics" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --verified "render.no-unescaped-site census - passed with the renderer still in the censused set" \
  --verified "acceptance test on the parent commit - 2 of 3 failed as expected" \
  --verified "inertness mutation, three reverts - each turned its own test red" \
  --not-verified "stryker mutation run - not run" \
  --not-verified "mutation coverage of the four changed server files - out of the configured mutate scope"
```

### The mutation-scope sentence this pull request owes

The `--not-verified` line above is the honest form. Stated in full for the record: the per-pull-request mutation job's configured scope is `src/store/**`,
`src/schema/**`, `src/merge/field-merge.ts`, `src/merge/conflict.ts` and `src/render/**`. Three
of this change's seven source files fall inside it and four fall outside it, so a green mutation
job would not mean this diff was mutated. Do not write a `Verified: mutation` line unless the
job actually mutated a file in this diff.

### The honesty rule

Every `--verified` line above describes a check the implementer will actually have run by the
time the pull request is opened, following section 8. If any of them was not run, replace it with
`--not-verified "<thing> - not run"`. Never write a `Verified:` line for a check you did not run,
including on the grounds that the exit code was zero.

---

## 11. Stop conditions

Each condition names what the implementer sees and what to do. In every case: **STOP and report;
do not improvise.**

### 11.1 The two manifests already disagree before you change anything

Run:

```
node -e "const p=require('./package.json').version,q=require('./.claude-plugin/plugin.json').version;console.log(p===q?'agree':'DISAGREE '+p+' '+q)"
```

If the output is not `agree`, STOP and report; do not improvise. A version merely **higher** than
the `1.0.8` baseline is NOT a stop condition — the ladder shifted, and step 11's
read-then-increment handles it.

### 11.2 MSP-0 has not merged, so the manifest test is still pinned

Run: grep -n "EXPECTED_VERSION" test/contract/cutover-manifests-agree.test.ts
If the output contains a quoted version literal such as '1.0.0', MSP-0 has not merged.
STOP and report; do not improvise, and do not edit this file.

### 11.3 The compile-time forcing does not fire

After applying step 1 only, run `npx tsc -p tsconfig.json --noEmit`. If it does **not** report:

```
src/merge/field-merge.ts(16,14): error TS2741: Property 'predecessor_id' is missing
```

then `THREAD_RULES` is no longer a `Record<keyof Thread | ...>` mapped type and the safety net
this plan relies on is gone. STOP and report; do not improvise.

### 11.4 A FIND block does not match exactly once

Every FIND block in sections 4 and 5 **except the two version literals in step 11** was verified
to occur exactly once in its file at commit `9f66931`. If any of those FIND strings is absent,
or occurs more than once, the file has changed since this plan was authored. STOP and report the
file and the FIND block; do not improvise a replacement, and do not widen the FIND to make it
unique.

**Step 11's two version literals are the deliberate exception and are NOT covered by this stop
condition.** They read `  "version": "1.0.8",` because that is the baseline this MSP was planned
against, and they will not match if the ladder shifted. Step 11 tells you to read the current
version and increment it; follow that instruction rather than the literal, and do not stop.

### 11.5 The render census halts on the new code

If `test/contract/render-census.test.ts` fails with a message naming `src/render/briefing.ts`
and an expression whose classification is `unclassifiable`, the new render code was written in a
form the census cannot resolve. STOP and report.

**Do not** resolve it by removing `src/render/briefing.ts` from `CENSUSED_FILES`, by adding an
allowlist, or by pinning a count. All three are forbidden: acceptance criterion 4 in section 1
requires every render-census obligation to be satisfied by classifying the new item, never by
narrowing the population. The correct shape is the one step 7 gives: a named helper wrapping its inputs in `escapeStored`,
mapped over an array.

### 11.6 A test outside this plan's list turns red

Sections 5.2 through 5.5 name every existing test this change is expected to break. If `npm test`
reports a failure in any other test, STOP and report which one; do not improvise a fix and do not
edit that test.

### 11.7 The checkout is missing a dependency the suite needs

If `npm test` reports a failure in `workflow-hardening-census`, the dependency gap
described by the orchestrator is not yet closed in this checkout. STOP and report.
Do not edit, skip or delete that test, and do not install anything yourself.
