# Continuity Hand-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A fresh session, held by a different person, resumes a thread and knows where the previous session stopped without reading git history.

**Architecture:** Delete the per-session focus mechanism that dies at park. Add a second spine field so the hand-off record carries both what is true now and what to do next. Make the thread's artifact list writable and actually merged, with removals that survive a sync. Put the route-versus-goals rule in the briefing, teach both skills what the record is for, and tighten the Stop gate so it proves the held thread moved.

**Tech Stack:** TypeScript on Node >= 22.19 with native type stripping, `zod` v4 for schemas, `node:test` for tests, git as the durable store.

**Spec:** `docs/specs/2026-09-05-continuity-handoff.md` — read it before starting any unit. This plan argues from it and does not restate its reasoning.

## Global Constraints

- **Parent commit for the ladder:** `3d3148fe`. Suite green 800/800 at that commit.
- **Never author a code comment.** Not explanatory, not a docstring, not a section header. This is absolute.
- **No emojis** anywhere — code, commits, PR bodies, skill text.
- **No AI attribution** in any commit message or PR body.
- **Immutability:** build new objects; never mutate an existing one in place.
- **`node_modules` is vendored and tracked.** Never run `npm install` or `npm ci` — it rewrites tracked files and leaves the suite red.
- **Test command:** `npm test` (runs `node --test` over six globs). Typecheck: `npm run typecheck`.
- **Test naming:** a flat `test('<area>.<behaviour-in-kebab-case>', ...)`. No `describe()`, no spaces in the name.
- **Merge, never rebase.** Integrating a moved parent branch is a merge.
- **Every PR goes through** `node ~/.claude/lib/git/pr.mjs pr-create`. Ad-hoc `gh pr create` is denied at the gate.
- **Field classes:** every new schema field is wrapped in `content(...)`, `structural(...)`, or built with `pointer(max, description)` from `src/schema/field-class.ts`. A field with no class fails the field-class census.
- **Caps refuse, they never truncate.** A new capped field adds its constant to `src/schema/caps.ts`.

---

## The stack

Three units branch from `main` and touch no shared file, so they ship in parallel. The remaining four form a stack.

| Unit | Branch | Base branch | Ships |
|---|---|---|---|
| U1 | `refactor/remove-declared-focus` | `main` | round 1, parallel |
| U2 | `feat/handoff-schema` | `main` | round 1, parallel |
| U7 | `fix/stop-gate-names-the-thread` | `main` | round 1, parallel |
| U3 | `fix/merge-wires-artifacts` | `feat/handoff-schema` | after U2 |
| U4 | `feat/handoff-writers` | `fix/merge-wires-artifacts` | after U3 |
| U5 | `feat/briefing-handoff` | `feat/handoff-writers` | after U4 |
| U6 | `docs/handoff-skills` | `feat/briefing-handoff` | after U5 |

U1, U2 and U7 are file-disjoint: U1 owns the pointer, the briefing, both tools and their tests; U2 owns the two schema files plus `test/unit/thread-schema.test.ts` and `test/unit/field-merge.test.ts`; U7 owns the two hooklib files plus `test/hooks/stop-gate-ledger-presence.test.ts`.

**U5 and U6 also need U1.** Their branches descend from `U2`, not `U1`, so before starting either one, merge `refactor/remove-declared-focus` into the working branch. U5 edits the briefing slot that U1 vacates, and U6 renumbers the preflight steps U1 renumbered first.

When a parent merges to `main`, GitHub retargets its child automatically. Do not rebase a child onto a moved parent; merge the parent in.

---

## Task 1: U1 — Remove declared focus

**Files:**
- Modify: `src/domain/pointer.ts` — delete `focus` from the type, the stored shape, the guard, the parse default, and the write
- Modify: `src/render/briefing.ts` — delete the focus lane, both Focus sentence literals, the byte accounting, and every parameter that carries focus
- Modify: `src/server/tools/resume_thread.ts` — delete the input field, both refusals, the validation block, the output field
- Modify: `src/server/tools/update_thread.ts` — delete the input field, both refusals, the four reason constants, `decideFocusOutcome`, `applyFocusPlan`, both output fields
- Modify: `skills/preflight/SKILL.md` — delete steps 8 and 9's focus argument, renumber
- Modify: `test/support/published.ts` — delete the two `ARGUMENT_GAPS` entries
- Modify: `test/support/optional-argument-recipes.ts` — delete the focus recipes and the two `attributable` extractors
- Modify: `test/contract/skills.test.ts` — delete `skill.preflight-passes-the-declared-focus`
- Modify: `test/unit/briefing.test.ts`, `test/unit/pointer.test.ts`, `test/store/pointer.test.ts`, `test/hooks/*` — drop `focus` from pointer literals
- Delete: `test/unit/briefing-focus.test.ts`, `test/spawn/focus.test.ts`
- Test: `test/unit/briefing.test.ts` (new assertion), `test/unit/pointer.test.ts` (new assertion)

**Interfaces:**
- Consumes: nothing.
- Produces: `Pointer` becomes `{ thread_id: Ulid; written_at: Iso8601; session_id: string }`. `assembleBriefing` loses its `focus` and `criteriaById` parameters. `resumePayloadBytes` loses its fourth parameter. `laneSplit` and `laneFor` lose their `focus` parameter and `type Lane` becomes `'live' | 'settled'`.

- [ ] **Step 1: Write the failing tests**

Add to `test/unit/pointer.test.ts`:

```ts
test('pointer.a-stored-focus-key-is-ignored-rather-than-read', () => {
  const rt = testRuntime()
  const layout = layoutFor(rt, rt.cwd)
  assert.equal(layout.ok, true)
  if (!layout.ok) throw new Error('expected a resolvable layout')
  mkdirSync(layout.value.state, { recursive: true })
  writeFileSync(
    path.join(layout.value.state, 'active-thread.json'),
    JSON.stringify({
      thread_id: ULID_THREAD,
      written_at: '2026-09-05T00:00:00.000Z',
      session_id: 'session-a',
      focus: ['01ARZ3NDEKTSV4RRFFQ69G5FAV']
    })
  )

  const read = readPointer(rt, layout.value)

  assert.equal(read.kind, 'pointer')
  if (read.kind !== 'pointer') throw new Error('expected a readable pointer')
  assert.equal('focus' in read.value, false)
})
```

Add to `test/unit/briefing.test.ts`:

```ts
test('briefing.renders-no-focus-line', () => {
  const thread = baseThread()
  const pointer = { thread_id: thread.id, written_at: '2026-09-05T00:00:00.000Z', session_id: 'session-a' }

  const briefing = renderBriefing(thread, cleanIntegrity(), pointer, null, false, [], 0)

  assert.equal(briefing.includes('**Focus:**'), false)
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test test/unit/pointer.test.ts test/unit/briefing.test.ts
```

Expected: both new tests FAIL. The pointer test fails on `'focus' in read.value` being true; the briefing test fails on the type of the pointer literal, then on the assertion.

- [ ] **Step 3: Delete focus from the pointer**

In `src/domain/pointer.ts`, make these exact changes:

```ts
export type Pointer = { thread_id: Ulid; written_at: Iso8601; session_id: string; focus: Ulid[] }
```
becomes
```ts
export type Pointer = { thread_id: Ulid; written_at: Iso8601; session_id: string }
```

Delete `isUlidArray` (lines 19-20) entirely — it has no other caller.

```ts
type StoredPointerShape = { thread_id: string; written_at: string; session_id: string; focus?: unknown }
```
becomes
```ts
type StoredPointerShape = { thread_id: string; written_at: string; session_id: string }
```

Delete this line from `isValidPointerShape`:
```ts
  if ('focus' in candidate && !isUlidArray(candidate.focus)) return false
```

In the parse return, delete the `focus` line so it reads:
```ts
  return {
    kind: 'pointer',
    value: {
      thread_id: parsed.thread_id,
      written_at: parsed.written_at,
      session_id: parsed.session_id
    }
  }
```

In `writePointer`, delete `focus: p.focus` from the `JSON.stringify` object.

- [ ] **Step 4: Delete focus from the briefing renderer**

In `src/render/briefing.ts`:

Delete the constants `FOCUS_FIELD_DEFAULT_COUNT`, `FOCUS_FIELD_PREFIX_BYTES`, `FOCUS_ID_SERIALISED_BYTES`, `FOCUS_ID_SEPARATOR_BYTES` and the `focusFieldBytes` function.

`resumePayloadBytes` loses its fourth parameter and the `+ focusFieldBytes(focusCount)` term. `fitsBudget` loses its `focusCount` parameter and passes three arguments.

Delete `FOCUS_NOT_SET_LINE`, `focusLabel`, and `renderFocusLine`.

`type Lane = 'focused' | 'live' | 'settled'` becomes `type Lane = 'live' | 'settled'`.

`laneFor` loses its `focus` parameter, and its last line
```ts
  return focus.includes(criterionId) ? 'focused' : 'live'
```
becomes
```ts
  return 'live'
```

`type Laned<T> = { focused: T[]; live: T[]; settled: T[] }` becomes `type Laned<T> = { live: T[]; settled: T[] }`, and `laneSplit` drops both the `focus` parameter and the `focused` key.

The two spread concatenations become plain reads:
```ts
  const riskBlocks = risks.live.map((item) => renderRiskBlock(item, renderClip))
  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
```

Delete `renderFocusLine(focus, criteriaById),` from the emitted array. `assembleBriefing` drops its `focus` and `criteriaById` parameters.

In `renderBriefingWithPasses`, delete the line computing `focus` from the pointer, drop `focus` and `criteriaById` from the `assembleBriefing` call, and drop the fourth argument from all three `fitsBudget` calls. `criteriaById` is still needed by `laneSplit`, so keep its construction.

- [ ] **Step 5: Delete focus from both tools**

In `src/server/tools/resume_thread.ts`: delete the `focus` entry from the input schema, `unknownFocusRefusal`, `duplicateFocusRefusal`, the `focus` entry from the output schema, the validation block, and the `focus: focusIds` fields from both the pointer literal and the structured result. `resumePayloadBytes` in the budget log call loses its fourth argument.

In `src/server/tools/update_thread.ts`: delete the `focus` input entry, `unknownFocusRefusal`, `duplicateFocusRefusal`, `type FocusOutcome`, the four exported reason constants, `type FocusPlan`, `decideFocusOutcome`, `applyFocusPlan`, the handler validation block, both output schema entries, and the `focus_written` / `focus_not_written_reason` fields from both structured returns.

- [ ] **Step 6: Update the skill**

`skills/preflight/SKILL.md` — delete step 8 and renumber. Step 9 becomes step 8 and reads:

```markdown
8. Call `resume_thread` with `resume_thread.thread_id` set to the resolved or chosen thread id.
```

Steps 10 and 11 become 9 and 10.

- [ ] **Step 7: Update the census support files**

`test/support/published.ts` — delete both `ARGUMENT_GAPS` entries whose `address` is `update_thread.focus` and `resume_thread.focus`.

`test/support/optional-argument-recipes.ts` — delete the `focus` entry from `SIMPLE_UPDATE_FIELDS` (fixing the trailing comma on the entry above it), delete `resumeThreadFocusRecipe` and its table registration, delete `focus_written` and `focus_not_written_reason` from the `update_thread` `attributable` extractor, and change the `resume_thread` entry's `attributable` to `() => ({})`.

Delete `test/unit/briefing-focus.test.ts` and `test/spawn/focus.test.ts`. Delete `skill.preflight-passes-the-declared-focus` from `test/contract/skills.test.ts`. Drop `focus` from every pointer literal in `test/unit/briefing.test.ts`, `test/unit/pointer.test.ts`, `test/store/pointer.test.ts` and `test/hooks/`.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, suite green with a lower total than 800 (the deleted focus tests are gone).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(pointer): remove declared focus from the pointer, briefing and tools"
```

- [ ] **Step 10: Open the PR**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head refactor/remove-declared-focus --base main \
  --title "refactor(pointer): remove declared session focus" \
  --what "Resuming a thread no longer asks which goals are being worked, and the briefing renders no Focus line." \
  --why "Focus was recorded on the session pointer and released at park, so it never reached the next session, and preflight demanded it before printing the briefing that would inform the choice." \
  --verified "npm test - <N> pass 0 fail" \
  --verified "npm run typecheck - exit 0"
```

---

## Task 2: U2 — Schema foundations

**Files:**
- Modify: `src/schema/caps.ts` — add `SPINE_LANDED_MAX`
- Modify: `src/schema/thread.ts` — add `spine.landed`, `Artifact.retired`, `Risk.retired`
- Modify: `test/unit/field-merge.test.ts` — add `spine.landed` to the hardcoded path list in `merge.rule-table-is-covered.walk-finds-spine-and-top-level-paths`
- Modify: `src/merge/field-merge.ts` — add the `spine.landed` rule entry only, so the census passes; the wiring is U3's job
- Test: `test/unit/thread-schema.test.ts`

**Interfaces:**
- Consumes: `U1`'s pointer shape (no interaction).
- Produces:
  - `Spine` gains `landed: string` (empty string when unset, matching the other three scalars).
  - `Artifact` becomes `{ id: Ulid; label: string; pointer: string; retired: boolean }`.
  - `Risk` gains `retired: boolean`.
  - `caps.SPINE_LANDED_MAX = 500`.

- [ ] **Step 1: Write the failing test**

Add to `test/unit/thread-schema.test.ts`:

```ts
test('thread-schema.landed.a-spine-carrying-it-round-trips', () => {
  const thread = baseThread()
  thread.spine.landed = 'focus removal shipped; suite green'

  const parsed = ThreadRecord.parse(thread)

  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('expected the record to parse')
  assert.equal(parsed.value.spine.landed, 'focus removal shipped; suite green')
})

test('thread-schema.retired.an-artifact-and-a-risk-both-carry-it', () => {
  const thread = baseThread()
  thread.artifacts = [
    { id: ULID_A, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  ]
  thread.spine.open_risks = [
    { id: ULID_B, scope: 'merge', text: 'a risk', refs: [], retired: true }
  ]

  const parsed = ThreadRecord.parse(thread)

  assert.equal(parsed.ok, true)
  if (!parsed.ok) throw new Error('expected the record to parse')
  assert.equal(parsed.value.artifacts?.[0]?.retired, false)
  assert.equal(parsed.value.spine.open_risks[0]?.retired, true)
})

test('thread-schema.landed.over-its-cap-is-refused', () => {
  const thread = baseThread()
  thread.spine.landed = 'x'.repeat(SPINE_LANDED_MAX + 1)

  const parsed = ThreadRecord.parse(thread)

  assert.equal(parsed.ok, false)
})
```

- [ ] **Step 2: Run it to verify it fails**

```bash
node --test test/unit/thread-schema.test.ts
```

Expected: FAIL — `SPINE_LANDED_MAX` is not exported, and the extra properties are stripped by zod so the round-trip assertions read `undefined`.

- [ ] **Step 3: Add the cap**

In `src/schema/caps.ts`, after `SPINE_LAST_SESSION_MAX`:

```ts
export const SPINE_LANDED_MAX = 500
```

And beside the existing artifact caps:

```ts
export const ARTIFACTS_PER_CALL_MAX_ELEMENTS = 40
```

`U4` consumes this constant. It is added here because `U2` owns `src/schema/caps.ts` and `U4` does not.

- [ ] **Step 4: Add the three fields**

In `src/schema/thread.ts`:

`Spine` type gains one line after `next_step`:
```ts
  landed: string
```

`SpineSchema` gains one entry after `next_step`:
```ts
  landed: content(
    z.string().max(caps.SPINE_LANDED_MAX).describe('what this thread has landed and verified so far, as the previous session left it')
  ),
```

`Artifact` type:
```ts
export type Artifact = { id: Ulid; label: string; pointer: string; retired: boolean }
```

`ArtifactSchema` gains:
```ts
    retired: structural(
      z.boolean().describe('whether this artifact has been removed; a retired artifact renders nowhere and never returns on a sync')
    )
```

`Risk` type:
```ts
export type Risk = { id: Ulid; scope: string; text: string; refs: string[]; criterion_id?: Ulid | undefined; retired: boolean }
```

`RiskSchema` gains the same `retired` entry, worded for a risk.

- [ ] **Step 5: Keep the merge census passing**

`src/merge/field-merge.ts` — add one entry to `THREAD_RULES` after `'spine.next_step'`:

```ts
  'spine.landed': 'conflict-on-divergence',
```

`test/unit/field-merge.test.ts` — add `'spine.landed'` to the array in `merge.rule-table-is-covered.walk-finds-spine-and-top-level-paths`. Add `landed: 'read the spec'` to `baseSpine()`, and `retired: false` to any `Risk` fixture.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

Expected: typecheck clean, suite green. Every fixture that builds a `Spine`, `Risk` or `Artifact` needs the new field; the typecheck names each one.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(schema): add the landed spine field and the artifact and risk tombstones"
```

- [ ] **Step 8: Open the PR**

Base is `main`. Title: `feat(schema): add landed and the removal tombstones`.

---

## Task 3: U3 — Wire the merge

**Files:**
- Modify: `src/merge/field-merge.ts`
- Test: `test/unit/field-merge.test.ts`

**Interfaces:**
- Consumes: `U2`'s `Artifact.retired` and `Risk.retired`.
- Produces: `mergeThreadTraced` emits `artifacts` on the merged record. A new exported census helper `mergedThreadFieldPaths()` returning the keys the merge actually writes.

- [ ] **Step 1: Write the failing tests**

```ts
test('merge.artifacts-survive-the-merge', () => {
  const artifact = { id: ULID_C, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  const base = baseThread({ artifacts: [] })
  const ours = baseThread({ artifacts: [artifact] })
  const theirs = baseThread({ artifacts: [] })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the merge to succeed')
  assert.deepEqual(result.merged.artifacts, [artifact])
})

test('merge.a-one-sided-artifact-removal-conflicts-rather-than-losing', () => {
  const live = { id: ULID_C, label: 'the plan', pointer: 'docs/plans/x.md', retired: false }
  const gone = { ...live, retired: true }
  const base = baseThread({ artifacts: [live] })
  const ours = baseThread({ artifacts: [gone] })
  const theirs = baseThread({ artifacts: [live] })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) throw new Error('expected the merge to refuse')
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, `artifacts[${ULID_C}]`)
})

test('merge.a-one-sided-risk-removal-conflicts-rather-than-losing', () => {
  const live = { id: ULID_C, scope: 'merge', text: 'a risk', refs: [], retired: false }
  const gone = { ...live, retired: true }
  const base = baseThread()
  const ours = baseThread({ spine: { ...baseSpine(), open_risks: [gone] } })
  const theirs = baseThread({ spine: { ...baseSpine(), open_risks: [live] } })

  const result = mergeThread(base, ours, theirs)

  assert.equal(result.ok, false)
  if (result.ok) throw new Error('expected the merge to refuse')
  const found = result.conflicts[0]
  assert.ok(found)
  assert.equal(found.field, `spine.open_risks[${ULID_C}]`)
})

test('merge.every-declared-rule-path-is-written-by-the-merge', () => {
  const declared = Object.keys(THREAD_RULES).filter((path) => !path.startsWith('spine.') && path !== 'spine')
  const written = mergedThreadFieldPaths()

  census(declared, (path) => (written.includes(path) ? 'allowed' : 'unclassifiable'))
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test test/unit/field-merge.test.ts
```

Expected: the first three FAIL because `artifacts` is dropped and because `retired` is not compared as content; the fourth FAILS on `mergedThreadFieldPaths` not existing.

- [ ] **Step 3: Compare the tombstone as content**

`unionByIdWithConflict` already uses `isDeepStrictEqual` on the whole item, so a differing `retired` already produces a conflict once artifacts are merged at all. Nothing changes there.

`unionCriteria`'s `criterionContent` stays as it is — criteria have no `retired` field.

- [ ] **Step 4: Wire artifacts into the merge**

In `mergeThreadTraced`, after the `outOfScopeResolution` block:

```ts
  const artifactsResolution = unionByIdWithConflict(
    recordName,
    'artifacts',
    ours.artifacts ?? [],
    theirs.artifacts ?? []
  )
```

Add `artifactsResolution.dispatchedRule` to `dispatchedRules` and `...artifactsResolution.conflicts` to `conflicts`.

In the merged object literal, after `completion_criteria`:

```ts
    ...(artifactsResolution.merged.length === 0 && ours.artifacts === undefined && theirs.artifacts === undefined
      ? {}
      : { artifacts: artifactsResolution.merged }),
```

- [ ] **Step 5: Add the census helper**

```ts
export const mergedThreadFieldPaths = (): string[] => [
  'id',
  'slug',
  'title',
  'status',
  'blocked_by',
  'predecessor_id',
  'completion_criteria',
  'artifacts',
  'spine',
  'created_at',
  'updated_at'
]
```

This list is asserted against `THREAD_RULES` by the new census test, so a future field declared but not wired fails loudly — which is `I6`.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

- [ ] **Step 7: Commit and open the PR**

```bash
git add -A
git commit -m "fix(merge): merge the artifacts field and prove every declared rule is wired"
```

Base is `feat/handoff-schema`.

---

## Task 4: U4 — The writers

**Files:**
- Modify: `src/server/tools/park_thread.ts` — accept `landed`
- Modify: `src/server/tools/update_thread.ts` — add `artifacts_add` and `artifacts_retire`; convert `risks_retire` to a tombstone
- Modify: `src/server/tools/open_thread.ts` — accept an initial artifact list
- Test: `test/spawn/handoff.test.ts` (new), `test/spawn/artifacts.test.ts` (new)

**Interfaces:**
- Consumes: `U2`'s schema fields, `U3`'s merge.
- Produces:
  - `park_thread` input gains `landed?: string` (max `caps.SPINE_LANDED_MAX`); output's `spine_fields_updated` enum gains `'landed'`.
  - `update_thread` input gains `artifacts_add?: { label: string; pointer: string }[]` and `artifacts_retire?: Ulid[]`; output gains `artifacts_added: string[]` and `artifacts_retired: string[]`.
  - `open_thread` input gains the same `artifacts` array shape as `artifacts_add`.

- [ ] **Step 1: Write the failing tests**

`test/spawn/handoff.test.ts`:

```ts
test('handoff.park-stores-landed-alongside-next-step', async () => {
  const rt = testRuntime()
  const ctx = await openFixtureThread(rt, 'handoff')
  await resumeThreadTool.handler(rt, { thread_id: ctx.threadId })

  const result = await parkThreadTool.handler(rt, {
    outcome: 'shipped the schema unit',
    landed: 'spine.landed exists and parses; nothing reads it yet',
    next_step: 'wire artifacts into mergeThreadTraced'
  })

  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the park to succeed')
  assert.deepEqual(result.structured.spine_fields_updated.sort(), ['landed', 'next_step'])

  const stored = loadThread(rt, ctx.threadId)
  assert.equal(stored.spine.landed, 'spine.landed exists and parses; nothing reads it yet')
})

test('handoff.park-without-landed-leaves-the-stored-value-alone', async () => {
  const rt = testRuntime()
  const ctx = await openFixtureThread(rt, 'handoff-2')
  await resumeThreadTool.handler(rt, { thread_id: ctx.threadId })
  await parkThreadTool.handler(rt, { outcome: 'first', landed: 'the first landing' })
  await resumeThreadTool.handler(rt, { thread_id: ctx.threadId })

  await parkThreadTool.handler(rt, { outcome: 'second', next_step: 'do the next thing' })

  const stored = loadThread(rt, ctx.threadId)
  assert.equal(stored.spine.landed, 'the first landing')
})
```

`test/spawn/artifacts.test.ts`:

```ts
test('artifacts.add-mints-an-id-and-stores-the-pointer', async () => {
  const rt = testRuntime()
  const ctx = await openFixtureThread(rt, 'artifacts')

  const result = await updateThreadTool.handler(rt, {
    thread_id: ctx.threadId,
    artifacts_add: [{ label: 'the plan', pointer: 'docs/plans/2026-09-05-continuity-handoff/PLAN.md' }]
  })

  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected the update to succeed')
  assert.equal(result.structured.artifacts_added.length, 1)

  const stored = loadThread(rt, ctx.threadId)
  assert.equal(stored.artifacts?.[0]?.pointer, 'docs/plans/2026-09-05-continuity-handoff/PLAN.md')
  assert.equal(stored.artifacts?.[0]?.retired, false)
})

test('artifacts.retire-marks-the-entry-and-never-deletes-it', async () => {
  const rt = testRuntime()
  const ctx = await openFixtureThread(rt, 'artifacts-2')
  const added = await updateThreadTool.handler(rt, {
    thread_id: ctx.threadId,
    artifacts_add: [{ label: 'the plan', pointer: 'docs/plans/x.md' }]
  })
  assert.equal(added.ok, true)
  if (!added.ok) throw new Error('expected the add to succeed')
  const artifactId = mustGet(added.structured.artifacts_added, 0, 'the minted artifact id')

  await updateThreadTool.handler(rt, { thread_id: ctx.threadId, artifacts_retire: [artifactId] })

  const stored = loadThread(rt, ctx.threadId)
  assert.equal(stored.artifacts?.length, 1)
  assert.equal(stored.artifacts?.[0]?.retired, true)
})

test('artifacts.risks-retire-marks-the-entry-and-never-deletes-it', async () => {
  const rt = testRuntime()
  const ctx = await openFixtureThread(rt, 'artifacts-3')
  const added = await updateThreadTool.handler(rt, {
    thread_id: ctx.threadId,
    risks_add: [{ text: 'a risk', scope: 'merge' }]
  })
  assert.equal(added.ok, true)
  if (!added.ok) throw new Error('expected the add to succeed')
  const riskId = mustGet(added.structured.risks_added, 0, 'the minted risk id')

  await updateThreadTool.handler(rt, { thread_id: ctx.threadId, risks_retire: [riskId] })

  const stored = loadThread(rt, ctx.threadId)
  assert.equal(stored.spine.open_risks.length, 1)
  assert.equal(stored.spine.open_risks[0]?.retired, true)
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test test/spawn/handoff.test.ts test/spawn/artifacts.test.ts
```

Expected: every test FAILS on an unrecognised input key, because the schemas are `strictObject`.

- [ ] **Step 3: Add `landed` to park_thread**

Input schema gains, after `next_step`:

```ts
  landed: z
    .string()
    .max(caps.SPINE_LANDED_MAX)
    .optional()
    .describe('what this thread has landed and verified, replacing the stored value when supplied; omit to leave it unchanged')
```

The output's `spine_fields_updated` becomes `z.array(z.enum(['next_step', 'landed']))`. The `SpineContribution` gains `landed` when supplied, and `mergeSpine` already leaves an undefined field at its stored value.

- [ ] **Step 4: Add the artifact writers to update_thread**

A new nested schema, modelled on `KeyDecisionAddSchema`:

```ts
const ArtifactAddSchema = z
  .strictObject({
    label: z.string().min(1).max(caps.ARTIFACT_LABEL_MAX).describe('what this artifact is, in a few words'),
    pointer: z.string().min(1).max(caps.ARTIFACT_POINTER_MAX).describe('a path or url naming where this artifact lives')
  })
  .describe('one document this thread needs, stored as a pointer and never as content')
```

Input entries:

```ts
  artifacts_add: z
    .array(ArtifactAddSchema)
    .max(caps.ARTIFACTS_PER_CALL_MAX_ELEMENTS)
    .optional()
    .describe('documents to append to this thread; each one is minted a stable id'),
  artifacts_retire: z
    .array(ulidField('the id of an artifact currently on this thread'))
    .max(caps.ARTIFACTS_PER_CALL_MAX_ELEMENTS)
    .optional()
    .describe('artifact ids to remove; the entry is marked rather than deleted so the removal survives a sync'),
```

`caps.ARTIFACTS_PER_CALL_MAX_ELEMENTS` already exists — `U2` added it.

Output entries:

```ts
  artifacts_added: z.array(z.string()).describe('ids minted for artifacts this call added'),
  artifacts_retired: z.array(z.string()).describe('ids of artifacts this call marked removed'),
```

Retiring sets the flag rather than filtering:

```ts
  const survivingArtifacts = (thread.artifacts ?? []).map((a) =>
    retireArtifactIds.includes(a.id) ? { ...a, retired: true } : a
  )
```

- [ ] **Step 5: Convert risks_retire to a tombstone**

The existing filter
```ts
const survivingRisks = thread.spine.open_risks.filter((r) => !retireIds.includes(r.id))
```
becomes
```ts
const survivingRisks = thread.spine.open_risks.map((r) => (retireIds.includes(r.id) ? { ...r, retired: true } : r))
```

Every `risks_add` path sets `retired: false` on the new risk. The output field `risks_retired` keeps its name; its description becomes `'ids of risks this call marked removed'`.

- [ ] **Step 6: Add artifacts to open_thread**

Input gains an optional `artifacts` array of `ArtifactAddSchema` shape. The handler mints an id per entry and sets `retired: false`, exactly as it does for criteria.

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

- [ ] **Step 8: Commit and open the PR**

```bash
git add -A
git commit -m "feat(tools): store landed, write artifacts, and tombstone both removals"
```

Base is `fix/merge-wires-artifacts`.

---

## Task 5: U5 — The briefing

**Files:**
- Modify: `src/render/briefing.ts`
- Test: `test/unit/briefing.test.ts`

**Interfaces:**
- Consumes: `U4`'s stored `landed`, `Artifact.retired`, `Risk.retired`.
- Produces: nothing later units depend on.

- [ ] **Step 1: Write the failing tests**

```ts
test('briefing.renders-landed-before-the-next-step', () => {
  const thread = baseThread()
  thread.spine.landed = 'focus removal shipped; suite green'
  thread.spine.next_step = 'wire artifacts into the merge'

  const briefing = renderBriefing(thread, cleanIntegrity(), null, null, false, [], 0)

  const landedAt = briefing.indexOf('**Landed:**')
  const nextAt = briefing.indexOf('**Next step:**')
  assert.ok(landedAt > -1)
  assert.ok(nextAt > landedAt)
  assert.ok(briefing.includes('focus removal shipped; suite green'))
})

test('briefing.renders-the-continuation-rule', () => {
  const briefing = renderBriefing(baseThread(), cleanIntegrity(), null, null, false, [], 0)

  assert.ok(
    briefing.includes(
      'Artifacts carry the route this thread is following. The goals are what the work must satisfy: check what lands against them as it lands, not only at the end.'
    )
  )
})

test('briefing.a-retired-artifact-renders-nowhere', () => {
  const thread = baseThread()
  thread.artifacts = [
    { id: ULID_A, label: 'live plan', pointer: 'docs/plans/live.md', retired: false },
    { id: ULID_B, label: 'dropped plan', pointer: 'docs/plans/dropped.md', retired: true }
  ]

  const briefing = renderBriefing(thread, cleanIntegrity(), null, null, false, [], 0)

  assert.ok(briefing.includes('live plan'))
  assert.equal(briefing.includes('dropped plan'), false)
})

test('briefing.a-retired-risk-renders-nowhere', () => {
  const thread = baseThread()
  thread.spine.open_risks = [
    { id: ULID_A, scope: 'merge', text: 'a live risk', refs: [], retired: false },
    { id: ULID_B, scope: 'merge', text: 'a dropped risk', refs: [], retired: true }
  ]

  const briefing = renderBriefing(thread, cleanIntegrity(), null, null, false, [], 0)

  assert.ok(briefing.includes('a live risk'))
  assert.equal(briefing.includes('a dropped risk'), false)
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test test/unit/briefing.test.ts
```

- [ ] **Step 3: Add the continuation rule**

Add the constant near `FOCUS_NOT_SET_LINE`'s former position:

```ts
const CONTINUATION_RULE =
  'Artifacts carry the route this thread is following. The goals are what the work must satisfy: check what lands against them as it lands, not only at the end.'
```

Emit it in the array where `renderFocusLine(...)` used to sit, so it occupies the slot `U1` freed.

- [ ] **Step 4: Filter retired entries**

In `renderBriefingWithPasses`, before `laneSplit`:

```ts
  const liveRisks = thread.spine.open_risks.filter((risk) => !risk.retired)
  const liveArtifacts = (thread.artifacts ?? []).filter((artifact) => !artifact.retired)
```

Pass `liveRisks` to `laneSplit` and `liveArtifacts` through to the artifact render.

- [ ] **Step 5: Render `landed`**

Add the heading constant and the block, immediately before the next-step block:

Read the existing `**Next step:**` block first and copy its exact shape — the same emptiness guard, the same blank-line handling, and the same `renderClip` field it passes. `next_step` and `landed` are both capped spine scalars, so whatever clipping helper the next-step block uses is the one `landed` uses. Do not invent a different helper.

The heading literal is `'**Landed:**'`, and the block sits immediately before the next-step block so the briefing reads state-then-action.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

- [ ] **Step 7: Commit and open the PR**

```bash
git add -A
git commit -m "feat(render): render landed, hide retired entries, carry the continuation rule"
```

Base is `feat/handoff-writers`.

---

## Task 6: U6 — The skills

**Files:**
- Modify: `skills/debrief/SKILL.md`
- Modify: `skills/preflight/SKILL.md`
- Test: `test/contract/skills.test.ts`

**Interfaces:**
- Consumes: `U4`'s `park_thread.landed`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Use whatever helper `test/contract/skills.test.ts` already uses to load a skill file; the existing focus test being deleted in `U1` reads `skills/preflight/SKILL.md`, so copy that call rather than introducing a new reader.

```ts
test('skill.debrief-passes-both-hand-off-fields', () => {
  const skill = readSkillFile('debrief')

  assert.ok(skill.includes('park_thread.landed'))
  assert.ok(skill.includes('park_thread.next_step'))
})

test('skill.preflight-resumes-before-it-asks-anything', () => {
  const skill = readSkillFile('preflight')
  const resumeAt = skill.indexOf('Call `resume_thread`')
  const briefingAt = skill.indexOf('Print the returned `resume_thread.briefing`')

  assert.ok(resumeAt > -1)
  assert.ok(briefingAt > resumeAt)
  assert.equal(skill.includes('Wait for the human to name the completion criteria'), false)
})
```

- [ ] **Step 2: Run them to verify they fail**

```bash
node --test test/contract/skills.test.ts
```

- [ ] **Step 3: Rewrite the debrief sequence**

`skills/debrief/SKILL.md` steps 1 and 2 become:

```markdown
1. Gather what happened in this session as one plain summary.
2. Gather what this session landed, by naming which goals moved and what their checks returned, what was verified rather than assumed, and what was started and where exactly it stopped.
3. Gather the next action a later session takes first, specific enough to begin without re-deriving anything, naming the file and the place in it where one is involved, and never restating a goal or a phase name.
4. Call `park_thread` with `park_thread.outcome` set to the summary, `park_thread.landed` set to what landed, and `park_thread.next_step` set to the next action.
```

Renumber the remaining steps so the sequence runs 1 through 9 with no gaps. The existing steps 4, 5 and 6 become 5, 6 and 7, and step 6's wording extends to cover all three gathered values:

```markdown
7. Print the summary, the landing and the next action alongside that refusal text, so the record of this session survives a refused call.
```

- [ ] **Step 4: Add the record-as-you-go instruction to preflight**

After `U1`'s renumbering, preflight ends at step 9 (`Print the returned resume_thread.briefing verbatim`) followed by step 10 (`Stop.`). Insert a new step 10 and renumber `Stop.` to 11:

```markdown
10. State that this session records as it goes, calling `log_session_event` when a meaningful piece of work is established rather than holding everything until hand-off.
11. Stop.
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -m "docs(skills): teach debrief the hand-off fields and preflight to record as it goes"
```

Base is `feat/briefing-handoff`.

---

## Task 7: U7 — The Stop gate names the thread

**Files:**
- Modify: `src/hooklib/stop-gate.ts`
- Modify: `src/hooklib/ledger-presence.ts` — add a path-diff helper
- Test: `test/hooks/stop-gate-ledger-presence.test.ts`

**Interfaces:**
- Consumes: nothing. Branches from `main`.
- Produces: `ledgerPathsChangedSince(rt, projectRoot, baselineHead): string[]` exported from `ledger-presence.ts`.

- [ ] **Step 1: Write the failing test**

```ts
test('hook.stop-gate-still-blocks-when-only-an-unrelated-thread-moved', async () => {
  const rt = testRuntime()
  const held = await openFixtureThread(rt, 'held')
  await resumeThreadTool.handler(rt, { thread_id: held.threadId })

  await openThreadTool.handler(rt, {
    title: 'An unrelated thread',
    slug: 'unrelated',
    completion_criteria: [{ text: 'something', check: 'npm test' }]
  })

  const verdict = stopGateVerdict(rt, {
    session_id: rt.sessionId,
    cwd: rt.cwd,
    transcript_path: null,
    stop_hook_active: false
  })

  assert.equal(verdict.kind, 'block')
})

test('hook.stop-gate-clears-when-the-held-thread-moves', async () => {
  const rt = testRuntime()
  const held = await openFixtureThread(rt, 'held-2')
  await resumeThreadTool.handler(rt, { thread_id: held.threadId })

  await updateThreadTool.handler(rt, { thread_id: held.threadId, next_step: 'something new' })

  const verdict = stopGateVerdict(rt, {
    session_id: rt.sessionId,
    cwd: rt.cwd,
    transcript_path: null,
    stop_hook_active: false
  })

  assert.equal(verdict.kind, 'silent')
})
```

The first test currently passes for the wrong reason if the verbatim gate fires first — pass `transcript_path: null` so `findLastResumeBriefing` returns null and the verbatim verdict is silent.

- [ ] **Step 2: Run them to verify the first fails**

```bash
node --test test/hooks/stop-gate-ledger-presence.test.ts
```

Expected: `hook.stop-gate-still-blocks-when-only-an-unrelated-thread-moved` FAILS with `silent`, because any ledger movement clears the gate today.

- [ ] **Step 3: Add the path-diff helper**

In `src/hooklib/ledger-presence.ts`:

```ts
export const ledgerPathsChangedSince = (rt: Runtime, projectRoot: string, baselineHead: string): string[] => {
  const result = git(rt, projectRoot, ['diff', '--name-only', baselineHead, LEDGER_REF])
  if (!result.ok) {
    rt.log({ level: 'warn', event: 'stop-gate.ledger-diff-unreadable', code: result.code, detail: result.stderr.trim() })
    return []
  }
  return result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}
```

- [ ] **Step 4: Tighten the verdict**

`ledgerPresenceVerdict`'s tail becomes:

```ts
  const head = readLedgerHead(rt, layout.projectRoot)
  if (head === null) return { kind: 'silent' }
  if (head === baseline.ledger_head) return { kind: 'block', reason: heldThreadReason(pointerRead.value.thread_id) }

  const changed = ledgerPathsChangedSince(rt, layout.projectRoot, baseline.ledger_head)
  if (changed.length === 0) return { kind: 'silent' }

  const threadId = pointerRead.value.thread_id
  const touchesHeldThread = changed.some(
    (path) => path === `threads/${threadId}.json` || path.startsWith(`sessions/${threadId}/`)
  )
  if (touchesHeldThread) return { kind: 'silent' }

  return { kind: 'block', reason: heldThreadReason(threadId) }
```

with the message:

```ts
const heldThreadReason = (threadId: string): string =>
  `Logbook: nothing has reached thread ${threadId} since it was resumed. Records landed on the ledger, but none of ` +
  `them belongs to the thread this session is working. Record what was established with record_decision, note ` +
  `progress with update_thread, or end this session's work on the thread with park_thread. This verdict reports ` +
  `only that something reached this thread; it makes no claim that what is recorded is complete.`
```

Keep `LEDGER_PRESENCE_REASON` exported if any test imports it; otherwise delete it and update the message assertion in `hook.stop-gate-ledger-message-claims-presence-and-never-completeness`.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npm run typecheck && npm test
```

Expected: `hook.stop-gate-clears-the-moment-something-reaches-the-ledger` will need its fixture changed — it currently commits an unrelated thread on purpose. Rename it to `hook.stop-gate-clears-when-the-held-thread-reaches-the-ledger` and point its write at the held thread.

- [ ] **Step 6: Commit and open the PR**

```bash
git add -A
git commit -m "fix(hooks): clear the stop gate only when the held thread reaches the ledger"
```

Base is `main`.

---

## Verification for the whole ladder

Each unit runs `npm run typecheck && npm test` before its commit. The full suite is the only gate; there is no separate diff-scoped runner in this repo.

Every PR's `--verified` lines carry a number or a state, never an adjective. A check that was not run is `--not-verified "<thing> - not run"`.
