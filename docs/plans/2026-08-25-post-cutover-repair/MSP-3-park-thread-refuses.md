# MSP-3 — `park_thread` refuses instead of destroying, and the pointer gains its missing exit

## 0. Identity

- **Closes:** defects D2 (`park_thread` destroys the caller's session log on six branches) and D10
  (the active-thread pointer has an exit no tool can reach). Closes **criterion 7** in combination
  with the SPEC's recorded dissolution of that criterion's status axis.
- **Depends on:** MSP-0, and nothing else. MSP-0 is the only prerequisite, and it exists for one
  reason: `test/contract/cutover-manifests-agree.test.ts:8` pins the expected version to the
  literal `1.0.0`, which this plan's version bump breaks. MSP-0 de-pins that constant permanently.
  Section 11 gives the exact check. Nothing in this plan's own surface depends on any other MSP.
- **Required by:** MSP-8, which repairs `park_thread`'s published description against the code this
  plan leaves behind.
- **Branch name:** `fix/msp-3-park-thread-refuses`
- **Version bump:** Baseline `1.0.3` -> `1.0.4` per orchestrator ruling O1. The step in section 4
  reads the current version and increments the patch, so a shifted ladder does not invalidate it.
  Both `package.json` and `.claude-plugin/plugin.json` move in one commit.
- **SPEC anchors:** section 7 MSP-3, section 6 ruling R2, section 5 defects D2 and D10.

### What this plan is, in plain words

`park_thread` is the tool a session calls when it stops working on a thread. A **thread** is one
unit of work the project is tracking. The **pointer** is a small file that records which thread is
being worked right now. `outcome` is the text the caller sends describing what happened this
session; it is meant to be written into the thread's session log. A **thread record** is the JSON
file holding one thread; when that file fails to parse the store does not delete it, it marks it
**quarantined**, meaning "present but unreadable".

Two things are wrong today. Six code paths inside `park_thread` return success while silently
throwing the caller's text away. And when the pointer names a quarantined record, no tool call
releases it — the only escape is picking up an unrelated thread, which overwrites the pointer as a
side effect.

This change makes each of those six paths **refuse** when `outcome` was supplied, makes `outcome`
optional so a caller who only wants to release the pointer can say so, and makes that
`outcome`-omitted call the designed exit for the stuck pointer. It also corrects two sentences of
shipped prose and one skill that still tell callers parking always succeeds.

---

## 1. Acceptance criteria (the ceiling)

Copied verbatim from SPEC section 7, MSP-3, numbered as there.

1. For each of the six branches, a test supplies a non-empty `outcome`, asserts the call refuses,
   asserts the refusal **text block** names the precondition and states the text was not stored,
   and asserts the pointer is unchanged. Red on the parent, where all six return `ok: true`. Per
   ruling R10 these assert on `content`, never on `structuredContent`.
2. A control test: the same payload with a held pointer still parks and the log persists. This is
   the inertness discriminator — it must stay green throughout.
3. For each release branch, a test with `outcome` **omitted** asserts the pointer is released and
   the existing status is returned unchanged.
4. A test asserts a pointer naming a quarantined record can be released, and that it cannot be
   today. Red on the parent.
5. The seven tests in `test/spawn/resume.test.ts` listed in the audit are updated, and
   `:388`'s design message is rewritten to say what clause 3 of R2 preserves and what it does not.
6. `test/contract/skills.test.ts` stays green with the debrief skill's new failure step.
7. `npm test` green.

That list is the complete definition of done for this unit of work. Anything discovered above it is
appended to `docs/plans/2026-08-25-post-cutover-repair/FILED.md` as a new item with its evidence. It
is not folded into this plan, and it does not reopen this plan once these seven are met.

---

## 2. Ground truth

Every line range below was read in the working tree at `docs/post-cutover-repair-spec`, whose
`src/`, `test/` and `skills/` trees are byte-identical to `main` at `0ade582`.

### 2.1 `src/server/tools/park_thread.ts:20-39` — the input schema

```ts
const ParkThreadInputSchema = z.strictObject({
  outcome: z
    .string()
    .min(1)
    .max(caps.SESSION_BODY_MAX)
    .describe('what happened in this session, written to the session log as-is'),
  thread_id: ulidField(
    'the id of the thread being worked; omit it and the machine resolves it from what is currently marked as being worked'
  ).optional(),
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  next_step: z
    .string()
    .max(caps.SPINE_NEXT_STEP_MAX)
    .optional()
    .describe('replaces the spine next_step field when supplied; omit to leave it unchanged')
})
```

What is wrong with it: `outcome` is required and `.min(1)`, so every single call carries a
non-empty session log, and all six branches below always destroy one. There is no way for a caller
to ask for a pointer release without also handing over text that six branches will discard.

### 2.2 `src/server/tools/park_thread.ts:90-97` — the one cap refusal that already protects the caller

```ts
const sessionBodyCapRefusal = (observed: number): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: `at most ${caps.SESSION_BODY_MAX} characters after escaping`,
  example: 'shipped the health check and left the merge order test for next session',
  retryable: true,
  message: `outcome exceeds its cap of ${caps.SESSION_BODY_MAX} characters after escaping; observed ${observed}; remedy: shorten the outcome and retry.`
})
```

What is wrong with it: nothing. It is the shape every new refusal in this plan copies. It is quoted
here because at 8001 characters this refusal protects the caller and at 8000 characters the six
branches below destroy the log and report success.

### 2.3 `src/server/tools/park_thread.ts:41-50` — the output status enum

```ts
const ParkThreadOutputSchema = z.object({
  status: z
    .enum([
      'parked',
      'not-the-worked-thread',
      'nothing-to-park',
      'stale-pointer-released',
      'terminal-pointer-released'
    ])
    .describe('what this call actually did'),
```

What is wrong with it: there is no value that names "the pointer was released because the record it
named could not be parsed". `stale-pointer-released` means the record is **gone**; a quarantined
record is present and unreadable, which is a different fact.

### 2.4 `src/server/tools/park_thread.ts:99-106` — the refusal that has no escape behind it

```ts
const quarantinedPointerRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'a thread record that parses cleanly',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `the thread currently marked as being worked (${threadId}) has a stored record that failed to parse and was quarantined.`
})
```

What is wrong with it: it names `thread_id` as the offending field even on the common call where the
caller supplied no `thread_id` at all, and its message offers no remedy, so a caller has nothing to
do next.

### 2.5 `src/server/tools/park_thread.ts:139-175` — branches 4 and 5, and the branch with no exit

```ts
const parkResolvedThread = (
  rt: Runtime,
  store: Store,
  layout: StoreLayout,
  threadId: string,
  input: ParkThreadInput
): ToolReply<ParkThreadOutput> => {
  const slot = store.readThread(threadId)

  if (slot === null) {
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'stale-pointer-released',
      'the thread marked as being worked no longer has a record; the stale pointer was released.',
      released === 'released'
    )
  }

  if (slot.quarantined) {
    return { ok: false, refusal: quarantinedPointerRefusal(threadId) }
  }

  const thread = slot.record

  if (thread.status !== 'open') {
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'terminal-pointer-released',
      `the thread marked as being worked is already ${thread.status}, which is terminal; the pointer was released.`,
      released === 'released'
    )
  }

  const escapedOutcome = escapeStored(input.outcome)
  if (escapedOutcome.length > caps.SESSION_BODY_MAX) {
    return { ok: false, refusal: sessionBodyCapRefusal(escapedOutcome.length) }
  }
```

What is wrong with it: at `:148` (record gone) and at `:163` (thread already `done` or `abandoned`)
the function returns `ok: true`, deletes the pointer, and never reads `input.outcome`.
`releasedStatusReply` takes only a status, a text and a boolean; `input` is not in its parameter
list, so the supplied text is unreachable from that reply and is discarded.

At `:157` the quarantined branch refuses whether or not the caller supplied an `outcome`. With
`outcome` omitted there is nothing to lose and nothing to protect, and the pointer stays stuck. SPEC
section 5 D10 states that `resume_thread` refuses the same record at `resume_thread.ts:47-49`, so no
tool call reaches the pointer, and the audit's `repro-c7.ts` observed exactly that: the pointer
survives both calls, and the only escape is resuming an unrelated healthy thread.

### 2.6 `src/server/tools/park_thread.ts:202-233` — the only path that writes the log

```ts
  const sessionEntry: SessionEntry = {
    id: rt.ulid(),
    thread_id: thread.id,
    actor: 'logbook:park_thread',
    body: escapedOutcome,
    created_at: rt.now()
  }

  const committed = store.commit(
    [
      { kind: 'thread', record: validated.value },
      { kind: 'session', record: sessionEntry }
    ],
    `park thread ${thread.slug}`
  )
  if (!committed.ok) {
    return { ok: false, refusal: commitFailureRefusal(committed.detail) }
  }

  const released = releasePointerIfOwned(rt, layout, thread.id)

  return {
    ok: true,
    text: `parked thread ${thread.slug}.`,
    structured: {
      status: 'parked',
      parked_thread_ids: [thread.id],
      session_entry_ids: [sessionEntry.id],
      spine_fields_updated: spineFieldsUpdated,
      pointer_released: released === 'released'
    }
  }
}
```

What is wrong with it: nothing today, but it assumes `input.outcome` is always a string. Once
`outcome` is optional this block must build no session entry when none was supplied.

### 2.7 `src/server/tools/park_thread.ts:243-274` — the annotation and branches 1, 2, 3, 6

```ts
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const pointerRead = readPointer(rt, layout.value)

    if (pointerRead.kind === 'corrupt') {
      releasePointer(rt, layout.value)
      return releasedStatusReply(
        'stale-pointer-released',
        'the record of what is being worked failed to parse; the stale pointer was released.',
        true
      )
    }

    if (pointerRead.kind === 'absent') return emptyStatusReply('nothing-to-park')

    const pointer = pointerRead.value

    if (input.thread_id !== undefined) {
      if (pointer.thread_id !== input.thread_id) return emptyStatusReply('not-the-worked-thread')
      return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
    }

    if (pointer.session_id !== rt.sessionId) return emptyStatusReply('not-the-worked-thread')
    return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
  }
}
```

What is wrong with it: `:254` (pointer file corrupt), `:263` (no pointer at all), `:268` (supplied
`thread_id` is not the pointed-at thread) and `:272` (pointer owned by another session) each return
`ok: true` and never read `input.outcome`. `idempotentHint: true` is also false: the normal form of
this call writes a new session entry every time, so a second identical call does not leave the store
in the same state as the first.

### 2.8 `src/server/prompts.ts:28-39` — the debrief prompt

```ts
const debriefMessage = (): GetPromptResult => ({
  description: "Gather this session's outcome and record it before parking the thread.",
  messages: [
    {
      role: 'user',
      content: {
        type: 'text',
        text: 'Ask me what this session accomplished, what changed, and what the next step is, then call park_thread with that outcome.'
      }
    }
  ]
})
```

What is wrong with it: line 35 tells the model to call `park_thread` with the outcome and stops
there. After this change that call can refuse, and this prompt gives the model no reason to read the
reply.

### 2.9 `src/server/instructions.ts:5-7` — the server's standing instructions

```
Resuming is one call and parking is one call. resume_thread reconciles, marks the thread as
being worked, and returns the finished briefing. park_thread writes the session log, refreshes
the running summary, and releases the thread. Neither needs a preparatory call.
```

What is wrong with it: "park_thread writes the session log, refreshes the running summary, and
releases the thread" is stated unconditionally. After this change there are six preconditions under
which it does none of those things and refuses instead.

The whole `INSTRUCTIONS` template literal currently measures **1080 bytes**, against the 2048-byte
budget `test/contract/budget.test.ts:30` enforces through `test/support/published.ts:42`. The
replacement in step 14 adds roughly 280 bytes.

### 2.10 `skills/debrief/SKILL.md` — the whole file, 11 lines, no trailing newline

```
---
name: debrief
description: Use at session hand-off to wrap up the work of this session.
---

## Sequence

1. Gather what happened in this session as one plain summary.
2. Call `park_thread` with `park_thread.outcome` set to that summary.
3. Print the returned `park_thread.status`.
4. Stop.
```

What is wrong with it: step 3 prints a status and step 4 stops. After this change a refusal arrives
instead of a status, carrying the summary's only remaining copy in its text, and the sequence has
nowhere to put it.

This file is governed by three censuses in `test/contract/skills.test.ts` that any edit must
satisfy. They are restated here because they are what makes step 16's wording look strange:

- `classifySkillLine` (`:214-227`) classifies **every non-blank line**. A line that is neither a
  frontmatter delimiter, a frontmatter entry, a heading, nor a numbered step is `unclassifiable`
  and **halts** the census. So the file may hold only headings and numbered steps.
- `classifyBodySentence` (`:150-155`) rejects any step whose text matches
  `/\b(?:must|never|only|unless|cannot|always|should|may|require|requires|if|when|at\s+most|at\s+least)\b/i`
  and requires the first word to be one of `Call`, `Present`, `Wait`, `Gather`, `Print`, `Stop`.
  **The word "if" is banned, so this file cannot express a conditional.**
- `driveCallSequence` (`:316-329`) actually calls every step whose first word is `Call` against a
  live server and asserts the result is not an error. A second `Call park_thread` step would run
  after the pointer is already released, would carry an `outcome`, and after this change would
  refuse — failing `skill.cannot-strand`. **So the new step must not be a `Call` step.**

### 2.11 `test/spawn/resume.test.ts:219-227` — the helper every park test goes through

```ts
const callPark = async (
  spawned: EitherServer,
  published: PublishedTool[],
  overrides: Record<string, unknown>
): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'park_thread')
  const { valid } = generateSchemaCases('park_thread', schema, overrides)
  return (await spawned.client.callTool({ name: 'park_thread', arguments: valid })) as CallToolResult
}
```

What is wrong with it: nothing, but its behaviour changes silently. `generateSchemaCases` builds its
valid instance through `synthesise`, and `synthesiseObject` (`src/schema/example.ts:67-81`) fills
**only the properties named in the schema's `required` array**. So today `callPark(..., {})` sends
an `outcome`; the moment `outcome` becomes optional the same call sends `{}`. Every existing test
that calls `callPark(..., {})` therefore flips from the supplied form to the omitted form, with
nothing in the test saying so. Step 17 makes that explicit.

### 2.12 `test/spawn/resume.test.ts:372-376` — the schema-class census for this tool

```ts
test('park_thread.rejects-invalid', async () => {
  await withFixture(async (fx) => {
    await runRejectsInvalid(fx, 'park_thread', ['minItems'])
  })
})
```

What is wrong with it: `runRejectsInvalid` (`test/spawn/resume.test.ts:251-269`) asserts that the
set of constraint classes the published schema carries **no** mutation for is exactly the set passed
in. Once `outcome` is optional, `park_thread` has no required properties at all, so
`generateSchemaCases` emits no `required` mutation and `missing` gains `required`. The assertion at
`:259-263` then fails. This is a census whose population changed; it is answered by classifying the
new item, never by widening the assertion to a superset.

### 2.13 `test/spawn/resume.test.ts:378-409` — the design statement R2 explicitly overrules

```ts
test('resume.round-trip', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)

    const firstPark = await callPark(fx.spawned, fx.published, {})
    assertOkResult('park_thread (before any resume)', firstPark)
    const firstStructured = firstPark.structuredContent as { status: string }
    assert.equal(
      firstStructured.status,
      'nothing-to-park',
      'parking before any resume in this session must be a no-op, not a park of the freshly opened thread'
    )
```

What is wrong with it: the message at `:388` is correct about the **pointer** and wrong about the
**log**. Clause 3 of ruling R2 preserves the no-op; it does not preserve the right to discard text.

### 2.14 `test/spawn/resume.test.ts:596-614` and `:721-753` — the two pre-existing mislabels

```ts
test('park.refuses-a-different-thread-id-and-keeps-the-pointer', async () => {
```

```ts
test('park.refuses-when-another-session-took-the-pointer', async () => {
```

What is wrong with them: both are named `park.refuses-...` and both assert a **success**
(`assertOkResult` at `:603` and `:742`). Nothing in either test refuses anything.

### 2.15 `test/spawn/resume.test.ts:632-646` — the test that asserts the stuck state

```ts
test('park.refuses-a-quarantined-thread-record', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    writeFileSync(threadRecordPath(layout, threadId), '{not-json', 'utf8')

    const park = await callPark(fx.spawned, fx.published, {})
    assert.equal(park.isError, true, 'parking a thread whose stored record is quarantined must be refused')
    const text = firstTextOf(park)
    assert.equal(text.split('\n')[0], 'field: thread_id')
    assert.match(text, new RegExp(threadId), 'the refusal must name the thread id that could not be resolved')
  })
})
```

What is wrong with it: once `outcome` is optional, `callPark(fx.spawned, fx.published, {})` sends no
`outcome`, so this test would assert that the **omitted** form refuses — which is precisely the
stuck state D10 names. Its name is right; the call it makes becomes the wrong one.

---

## 3. Divergences from the SPEC

1. **The ladder lands on `1.1.1`, not `1.1.0`.** SPEC section 7 states the ladder lands on `1.1.0`,
   which cannot hold alongside MSP-9 merging last. Orchestrator ruling O2 settles it: MSP-9 merges
   last and the ladder lands on `1.1.1`. This plan is unaffected beyond the version step being
   written as a read-then-increment.
2. **The pull request tool path.** SPEC section 8.3 writes `node .claude/lib/git/pr.mjs pr-create`.
   There is no `.claude/lib` in this repository. The tool is the operator's global one at
   `node ~/.claude/lib/git/pr.mjs pr-create`, which section 10 uses.
3. **MSP-3 is NOT split.** SPEC section 7 makes the split conditional ("if the diff exceeds 400
   lines"); orchestrator ruling O7 forbids passing that condition downstream. The measured ruling is
   section 3.1 below.
4. **All five clauses of ruling R2 are carried here.** Clause 4 (`annotations.idempotentHint`
   becomes `false`) is step 13, and no test in this repository asserts this tool's annotations.
5. **The SPEC gives the quarantined exit no status name.** SPEC section 7 lists "the output status
   enum" among MSP-3's changes but does not say what the new value is. This plan chooses
   `quarantined-pointer-released` (step 4) and states the rejected option there.
6. **The skill cannot state a condition, so the new step is unconditional.** Ruling R2 clause 5
   asks for "an explicit failure step". Ground truth 2.10 shows the shipped census bans the word
   "if" from every skill step, so the step is written as two unconditional `Print` steps rather
   than a conditional branch. This is a constraint the shipped tests impose, not a choice.
7. **The SPEC's D2 table names six branches by line number; all six are still at those lines.**
   `:263`, `:268`, `:272`, `:149`, `:164` and `:254` all carry the conditions SPEC section 5 states,
   and the quarantined branch is still at `:157-159`. No divergence, recorded so this section is not
   silently empty on a plan that read every one of them.
8. **MSP-3 gains a dependency on MSP-0 that the SPEC does not record.** SPEC section 7 states MSP-3
   "Depends on: nothing", and that is true of its own surface. It is not true of its acceptance
   criterion 7 (`npm test` green): `test/contract/cutover-manifests-agree.test.ts:8` reads
   `const EXPECTED_VERSION = '1.0.0'`, so every MSP's version bump fails it. Orchestrator ruling
   O15 settles this ladder-wide — MSP-0 de-pins the constant permanently, and no later MSP edits
   that file. This plan therefore writes no edit to it and carries stop condition 3 in section 11
   instead.
9. **`park_thread`'s published description is not touched here.** It still reads "Takes the outcome
   as text plus whichever summary fields changed" and "Parking a thread that is already parked is
   not an error", both of which understate the post-change behaviour. SPEC section 5 D14 owns those
   sentences and assigns them to MSP-8. They are not folded in.

### 3.1 The split ruling (orchestrator ruling O7)

MSP-3 is **not split**. This is a ruling, not a condition. There is no branch of this plan in which
the implementer decides anything about it.

The change in section 4 was applied mechanically to copies of the five files it touches and the
resulting diff was measured. Every FIND string in section 4 matched **exactly once** in that run.

Counted as insertions plus deletions, the convention `git diff --shortstat` uses, by applying
section 4 mechanically to copies of the files it touches and diffing them against the originals.

| File | Changed lines |
| --- | --- |
| `src/server/tools/park_thread.ts` | 161 |
| `test/spawn/resume.test.ts` | 206 |
| `src/server/instructions.ts` | 5 |
| `src/server/prompts.ts` | 2 |
| `skills/debrief/SKILL.md` | 4 |
| `package.json` and `.claude-plugin/plugin.json` | 4 |
| **total** | **382** |

382 is under the 400-line ceiling SPEC section 7 sets, so the SPEC's stated split does not trigger
and this ships as one pull request.

Rejected: splitting anyway into a six-branches half and a quarantined-exit-plus-prose half. Measured
at 309 and 77 changed lines, both halves are well formed, but splitting a change that already clears
the ceiling buys nothing and costs an extra merge, an extra version, and a cross-branch dependency
for the next planner to honour.

---

## 4. The change, step by step

Apply the steps in the order given. Steps 1 through 13 change one file and leave the tree
type-correct; run `npm run typecheck` after step 13 before continuing. Steps 14 through 16 change
prose only. Steps 17 through 31 change one test file. Step 32 is the version bump.

Every FIND string below was copied from the file named, and every one was verified to match
**exactly once** by applying this whole section mechanically to copies of the five files. If a FIND
string does not match exactly once, stop and read section 11.

### Step 1 — `src/server/tools/park_thread.ts` — REPLACE — make `outcome` optional

FIND:

```ts
  outcome: z
    .string()
    .min(1)
    .max(caps.SESSION_BODY_MAX)
    .describe('what happened in this session, written to the session log as-is'),
```

REPLACE:

```ts
  outcome: z
    .string()
    .min(1)
    .max(caps.SESSION_BODY_MAX)
    .optional()
    .describe(
      'what happened in this session, written to the session log as-is; omit it to release the record of what is being worked without writing any session log entry'
    ),
```

Rationale: ruling R2 clause 1 — "`outcome` becomes `.optional()`. This is a widening and breaks no
existing caller."

### Step 2 — `src/server/tools/park_thread.ts` — INSERT-AFTER — the six refusals

FIND:

```ts
  message: `outcome exceeds its cap of ${caps.SESSION_BODY_MAX} characters after escaping; observed ${observed}; remedy: shorten the outcome and retry.`
})
```

REPLACE (the FIND text, then a blank line, then the six new factories):

```ts
  message: `outcome exceeds its cap of ${caps.SESSION_BODY_MAX} characters after escaping; observed ${observed}; remedy: shorten the outcome and retry.`
})

const noWorkedThreadRefusal = (): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied while some thread is marked as being worked',
  example: 'call resume_thread first, then send this same outcome to park_thread',
  retryable: true,
  message:
    'no thread is currently marked as being worked, so this outcome has nowhere to be written; the supplied text was NOT stored and must be re-sent; remedy: call resume_thread on the thread this session worked and then call park_thread again with the same outcome, or call park_thread with outcome omitted to confirm there is nothing to park.'
})

const notTheWorkedThreadRefusal = (pointerThreadId: string, suppliedThreadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied together with the thread that is actually marked as being worked',
  example: 'send the same outcome with thread_id set to the thread this message names',
  retryable: true,
  message: `thread_id ${suppliedThreadId} is not the thread currently marked as being worked (${pointerThreadId}), so this outcome has nowhere to be written; the supplied text was NOT stored and must be re-sent; the pointer was left untouched; remedy: call park_thread again with thread_id ${pointerThreadId} and the same outcome.`
})

const otherSessionRefusal = (pointerThreadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied by the session that holds the record of what is being worked',
  example: 'call resume_thread in this session, then send this same outcome to park_thread',
  retryable: true,
  message: `the record of what is being worked names thread ${pointerThreadId} and belongs to a different session, so this outcome has nowhere to be written; the supplied text was NOT stored and must be re-sent; the pointer was left untouched; remedy: call resume_thread in this session and then call park_thread again with the same outcome.`
})

const missingThreadRecordRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied for a thread whose stored record still exists',
  example: 'call park_thread with outcome omitted to release the stale pointer, then record this text elsewhere',
  retryable: false,
  message: `the thread marked as being worked (${threadId}) no longer has a stored record, so this outcome has nowhere to be written; the supplied text was NOT stored and must be re-sent; the pointer was left in place so this call can be retried; remedy: call park_thread with outcome omitted to release the stale pointer, then record this text on a thread that still exists.`
})

const terminalThreadRefusal = (threadId: string, status: Thread['status']): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied for a thread that is still open',
  example: 'call park_thread with outcome omitted to release the pointer, then record this text on a new thread',
  retryable: false,
  message: `the thread marked as being worked (${threadId}) is already ${status}, which is terminal, so this outcome cannot be written to it; the supplied text was NOT stored and must be re-sent; the pointer was left in place so this call can be retried; remedy: call park_thread with outcome omitted to release the pointer, then open a new thread that references this one and record this text there.`
})

const corruptPointerRefusal = (): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied while the record of what is being worked parses cleanly',
  example: 'call park_thread with outcome omitted to release the unreadable pointer, then resume the thread again',
  retryable: true,
  message:
    'the record of what is being worked does not parse, so the thread this outcome belongs to cannot be resolved; the supplied text was NOT stored and must be re-sent; the unreadable pointer was left in place so this call can be retried; remedy: call park_thread with outcome omitted to release it, call resume_thread on the intended thread, then call park_thread again with the same outcome.'
})
```

Rationale: ruling R2 clause 2 — the refusal "names the precondition, the remedy, `retryable`, and
[...] states in words that the supplied text was not stored and must be re-sent".

Two choices this step makes, with the rejected option for each:

- **Every one of the six carries `field: 'outcome'`.** `Refusal.field` names the argument the caller
  must change for the call to succeed, and in all six the argument that cannot be honoured — and
  that must be re-sent — is `outcome`; omitting it is exactly what makes each call succeed.
  Rejected: a per-branch field name (`thread_id` for the mismatch, none for the rest), which would
  name a field the caller did not supply on four of the six.
- **All six are module-private, not exported.** Every refusal factory already in this file is
  module-private, and `test/contract/no-path.test.ts:1149-1157` runs a closed census over
  **exported** refusal producers that halts on any producer it does not exercise. Following this
  file's own convention adds no producer to that population and narrows nothing.
  Rejected: exporting them, which would halt that census until six exercises were added to a file
  this change has no other reason to touch.

### Step 3 — `src/server/tools/park_thread.ts` — REPLACE — give the refusal a field, a remedy, and the missing sentence

FIND:

```ts
const quarantinedPointerRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'a thread record that parses cleanly',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `the thread currently marked as being worked (${threadId}) has a stored record that failed to parse and was quarantined.`
})
```

REPLACE:

```ts
const quarantinedPointerRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'outcome',
  accepted: 'an outcome supplied for a thread whose stored record parses cleanly',
  example: 'call park_thread with outcome omitted to release the pointer, then record this text elsewhere',
  retryable: false,
  message: `the thread currently marked as being worked (${threadId}) has a stored record that failed to parse and was quarantined, so this outcome cannot be written to it; the supplied text was NOT stored and must be re-sent; the pointer was left in place so this call can be retried; remedy: call park_thread with outcome omitted to release the pointer, then record this text on a thread whose record parses.`
})
```

Rationale: ruling R2 clause 2 requires every refusal that could not write a supplied outcome to
state "the supplied text was not stored and must be re-sent". Of the seven refusals this tool
will carry, this is the only one that did not, and it was the only one naming a field the caller may
not have supplied. `field: 'outcome'` matches the six step 2 adds, and omitting `outcome` is exactly what makes this
call succeed.

### Step 4 — `src/server/tools/park_thread.ts` — REPLACE — name the new exit in the output schema

FIND:

```ts
      'stale-pointer-released',
      'terminal-pointer-released'
    ])
```

REPLACE:

```ts
      'stale-pointer-released',
      'terminal-pointer-released',
      'quarantined-pointer-released'
    ])
```

Rationale: SPEC section 7 lists the output status enum among MSP-3's changes, and defect D10
requires a releasable exit whose result the caller can tell apart from the others.

This step makes one choice: **the new exit gets its own status value rather than reusing
`stale-pointer-released`.** `stale-pointer-released` states that the record is gone; a quarantined
record is present and unreadable, and reporting one as the other is the kind of near-miss
invariant I2 exists to prevent. Rejected: reusing `stale-pointer-released`, which needs no schema
change but tells the caller a record was deleted when it was not.

### Step 5 — `src/server/tools/park_thread.ts` — REPLACE — widen the reply helper

FIND:

```ts
const releasedStatusReply = (
  status: 'stale-pointer-released' | 'terminal-pointer-released',
```

REPLACE:

```ts
const releasedStatusReply = (
  status: 'stale-pointer-released' | 'terminal-pointer-released' | 'quarantined-pointer-released',
```

Rationale: step 7 returns the new status through this helper, and the helper's parameter type is
what keeps the returned object assignable to `ParkThreadOutput`.

### Step 6 — `src/server/tools/park_thread.ts` — REPLACE — branch 4, the record is gone

FIND:

```ts
  if (slot === null) {
    const released = releasePointerIfOwned(rt, layout, threadId)
```

REPLACE:

```ts
  if (slot === null) {
    if (input.outcome !== undefined) {
      return { ok: false, refusal: missingThreadRecordRefusal(threadId) }
    }
    const released = releasePointerIfOwned(rt, layout, threadId)
```

Rationale: ruling R2 clause 2 — a branch that cannot write the outcome refuses and does **not**
release the pointer, "because releasing would delete the state a retry needs".

### Step 7 — `src/server/tools/park_thread.ts` — REPLACE — the stuck exit

FIND:

```ts
  if (slot.quarantined) {
    return { ok: false, refusal: quarantinedPointerRefusal(threadId) }
  }
```

REPLACE:

```ts
  if (slot.quarantined) {
    if (input.outcome !== undefined) {
      return { ok: false, refusal: quarantinedPointerRefusal(threadId) }
    }
    const released = releasePointerIfOwned(rt, layout, threadId)
    return releasedStatusReply(
      'quarantined-pointer-released',
      'the thread marked as being worked has a stored record that failed to parse; the pointer was released so another thread can be resumed.',
      released === 'released'
    )
  }
```

Rationale: SPEC section 7, MSP-3 — "For D10: a pointer naming a quarantined record must be
releasable. The `outcome`-omitted form of `park_thread` releases it, which gives the stuck exit a
designed route without widening `loadThread`'s contract." Nothing in `src/server/tool-support.ts`
changes; `park_thread` reads the slot itself and never routes this branch through `loadThread`.

### Step 8 — `src/server/tools/park_thread.ts` — REPLACE — branch 5, the thread is terminal

FIND:

```ts
  if (thread.status !== 'open') {
    const released = releasePointerIfOwned(rt, layout, threadId)
```

REPLACE:

```ts
  if (thread.status !== 'open') {
    if (input.outcome !== undefined) {
      return { ok: false, refusal: terminalThreadRefusal(threadId, thread.status) }
    }
    const released = releasePointerIfOwned(rt, layout, threadId)
```

Rationale: as step 6.

### Step 9 — `src/server/tools/park_thread.ts` — REPLACE — build no session entry when none was supplied

FIND:

```ts
  const escapedOutcome = escapeStored(input.outcome)
  if (escapedOutcome.length > caps.SESSION_BODY_MAX) {
    return { ok: false, refusal: sessionBodyCapRefusal(escapedOutcome.length) }
  }
```

REPLACE:

```ts
  const escapedOutcome = input.outcome === undefined ? null : escapeStored(input.outcome)
  if (escapedOutcome !== null && escapedOutcome.length > caps.SESSION_BODY_MAX) {
    return { ok: false, refusal: sessionBodyCapRefusal(escapedOutcome.length) }
  }
```

Rationale: ruling R2 clause 3 — with `outcome` omitted, `park_thread` is a pure pointer release, so
there is no text to escape and no cap to check.

### Step 10 — `src/server/tools/park_thread.ts` — REPLACE — the commit and the success reply

FIND:

```ts
  const sessionEntry: SessionEntry = {
    id: rt.ulid(),
    thread_id: thread.id,
    actor: 'logbook:park_thread',
    body: escapedOutcome,
    created_at: rt.now()
  }

  const committed = store.commit(
    [
      { kind: 'thread', record: validated.value },
      { kind: 'session', record: sessionEntry }
    ],
    `park thread ${thread.slug}`
  )
  if (!committed.ok) {
    return { ok: false, refusal: commitFailureRefusal(committed.detail) }
  }

  const released = releasePointerIfOwned(rt, layout, thread.id)

  return {
    ok: true,
    text: `parked thread ${thread.slug}.`,
    structured: {
      status: 'parked',
      parked_thread_ids: [thread.id],
      session_entry_ids: [sessionEntry.id],
      spine_fields_updated: spineFieldsUpdated,
      pointer_released: released === 'released'
    }
  }
}
```

REPLACE:

```ts
  const sessionEntry: SessionEntry | null =
    escapedOutcome === null
      ? null
      : {
          id: rt.ulid(),
          thread_id: thread.id,
          actor: 'logbook:park_thread',
          body: escapedOutcome,
          created_at: rt.now()
        }

  const changes: RecordChange[] =
    sessionEntry === null
      ? [{ kind: 'thread', record: validated.value }]
      : [
          { kind: 'thread', record: validated.value },
          { kind: 'session', record: sessionEntry }
        ]

  const committed = store.commit(changes, `park thread ${thread.slug}`)
  if (!committed.ok) {
    return { ok: false, refusal: commitFailureRefusal(committed.detail) }
  }

  const released = releasePointerIfOwned(rt, layout, thread.id)

  return {
    ok: true,
    text:
      sessionEntry === null
        ? `parked thread ${thread.slug} without a session log entry.`
        : `parked thread ${thread.slug}.`,
    structured: {
      status: 'parked',
      parked_thread_ids: [thread.id],
      session_entry_ids: sessionEntry === null ? [] : [sessionEntry.id],
      spine_fields_updated: spineFieldsUpdated,
      pointer_released: released === 'released'
    }
  }
}
```

Rationale: ruling R2 clause 3 — the omitted form releases the pointer and writes no log. The
existing output schema already documents `session_entry_ids` as "empty when none was written", so
the honest empty array needs no schema change (invariant I2's second clause).

This step makes one choice: **the healthy path with `outcome` omitted still commits the thread
record and still returns `parked`.** The thread was touched — `updated_at` moves and any supplied
`last_session` or `next_step` is applied — so the commit is what makes `updated_at` true.
Rejected: skipping the commit entirely when only `updated_at` would change, which adds a branch
whose only gain is one smaller commit and which leaves `spine_fields_updated` claiming a change the
store does not carry.

### Step 11 — `src/server/tools/park_thread.ts` — REPLACE — import the commit-change type

FIND:

```ts
import type { Store } from '../../store/records.ts'
```

REPLACE:

```ts
import type { Store } from '../../store/records.ts'
import type { RecordChange } from '../../store/write-path.ts'
```

Rationale: step 10 annotates `changes` as `RecordChange[]` so the array literal is contextually typed
and the two `kind` strings are not widened to `string`. `RecordChange` is exported from
`src/store/write-path.ts:13-17`.

Run `npm run typecheck` (expected exit 0) after step 13 before continuing to the prose steps.

### Step 12 — `src/server/tools/park_thread.ts` — REPLACE — branches 1, 2, 3 and 6, inside the handler

FIND:

```ts
    if (pointerRead.kind === 'corrupt') {
      releasePointer(rt, layout.value)
      return releasedStatusReply(
        'stale-pointer-released',
        'the record of what is being worked failed to parse; the stale pointer was released.',
        true
      )
    }

    if (pointerRead.kind === 'absent') return emptyStatusReply('nothing-to-park')

    const pointer = pointerRead.value

    if (input.thread_id !== undefined) {
      if (pointer.thread_id !== input.thread_id) return emptyStatusReply('not-the-worked-thread')
      return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
    }

    if (pointer.session_id !== rt.sessionId) return emptyStatusReply('not-the-worked-thread')
    return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
```

REPLACE:

```ts
    if (pointerRead.kind === 'corrupt') {
      if (input.outcome !== undefined) {
        return { ok: false, refusal: corruptPointerRefusal() }
      }
      releasePointer(rt, layout.value)
      return releasedStatusReply(
        'stale-pointer-released',
        'the record of what is being worked failed to parse; the stale pointer was released.',
        true
      )
    }

    if (pointerRead.kind === 'absent') {
      if (input.outcome !== undefined) {
        return { ok: false, refusal: noWorkedThreadRefusal() }
      }
      return emptyStatusReply('nothing-to-park')
    }

    const pointer = pointerRead.value

    if (input.thread_id !== undefined) {
      if (pointer.thread_id !== input.thread_id) {
        if (input.outcome !== undefined) {
          return { ok: false, refusal: notTheWorkedThreadRefusal(pointer.thread_id, input.thread_id) }
        }
        return emptyStatusReply('not-the-worked-thread')
      }
      return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
    }

    if (pointer.session_id !== rt.sessionId) {
      if (input.outcome !== undefined) {
        return { ok: false, refusal: otherSessionRefusal(pointer.thread_id) }
      }
      return emptyStatusReply('not-the-worked-thread')
    }
    return parkResolvedThread(rt, store, layout.value, pointer.thread_id, input)
```

Rationale: ruling R2 clause 2 for the four branches that live in the handler rather than in
`parkResolvedThread` — `:254` (the pointer file does not parse), `:263` (there is no pointer),
`:268` (the supplied `thread_id` is not the pointed-at thread) and `:272` (the pointer belongs to
another session). Each refuses when `outcome` was supplied and is left exactly as it is today when
`outcome` was omitted, which is clause 3.

The corrupt branch is the one where refusing also stops a deletion: today it calls `releasePointer`
unconditionally, which removes the only record of which thread the caller was working on. The
refusal is placed before that call so a retry still has something to resolve.

### Step 13 — `src/server/tools/park_thread.ts` — REPLACE — the annotation stops claiming idempotence

FIND:

```ts
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
```

REPLACE:

```ts
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
```

Rationale: ruling R2 clause 4 — "`annotations.idempotentHint` (`park_thread.ts:243`) becomes
`false`. It was already wrong: the normal form writes a new session entry on every call."

No test in this repository asserts `park_thread`'s annotations. The four `idempotentHint` literals
under `test/` (`test/contract/published-schema.test.ts:97,112,122,338`,
`test/support/probe-server.ts:144`, `test/spawn/errors.test.ts:50,60`) all belong to synthetic probe
tool specs, not to this tool.

### Step 14 — `src/server/instructions.ts` — REPLACE — stop promising parking always succeeds

FIND:

```
the running summary, and releases the thread. Neither needs a preparatory call.
```

REPLACE:

```
the running summary, and releases the thread. Neither needs a preparatory call. park_thread
refuses instead of parking when the thread it would write to is gone, terminal, quarantined, or
held by another session; the refusal says the outcome text was not stored and has to be re-sent.
Omit outcome and park_thread only releases the record of what is being worked.
```

Rationale: SPEC section 7, MSP-3 names "the prose in `src/server/prompts.ts:35` and
`src/server/instructions.ts:6` that promises parking always succeeds". Ruling R10 applies: this
text reaches the model through the server's instructions, which is where it will actually be read.

Byte budget check, from ground truth 2.9: the literal grows from 1080 bytes to roughly 1360, against
the 2048-byte ceiling. Command 3 of section 8 measures it.

### Step 15 — `src/server/prompts.ts` — REPLACE — make the debrief prompt read the reply

FIND:

```ts
        text: 'Ask me what this session accomplished, what changed, and what the next step is, then call park_thread with that outcome.'
```

REPLACE:

```ts
        text: 'Ask me what this session accomplished, what changed, and what the next step is, then call park_thread with that outcome. Read the reply before moving on: park_thread refuses and stores nothing when the thread it would write to is gone, terminal, quarantined, or held by another session, and the outcome text has to be re-sent.'
```

Rationale: as step 14. This is the second of the two prose sites SPEC section 7 names.

### Step 16 — `skills/debrief/SKILL.md` — REPLACE — the explicit failure step

FIND:

```
3. Print the returned `park_thread.status`.
4. Stop.
```

REPLACE:

```
3. Print the returned `park_thread.status`.
4. Print the refusal text `park_thread` returns in place of a status.
5. Print the summary from step 1 alongside that refusal text, so the record of this session survives a refused call.
6. Stop.
```

Rationale: ruling R2 clause 5 — "`skills/debrief/SKILL.md` gains an explicit failure step. Today it
prints `park_thread.status` and stops, with no path for a refusal."

Both new steps are `Print` steps, not `Call` steps, and neither contains a banned rule-marker word.
Ground truth 2.10 gives the three shipped censuses that force exactly this shape. Rejected: a second
`Call park_thread` step to re-send the outcome — `driveCallSequence` would run it after the pointer
is already released, it would carry an outcome, and it would refuse, failing `skill.cannot-strand`.

### Step 17 — `test/spawn/resume.test.ts` — INSERT-AFTER — a helper that proves the omission

FIND:

```ts
const callClose = async (
```

REPLACE:

```ts
const callParkWithoutOutcome = async (
  spawned: EitherServer,
  published: PublishedTool[],
  overrides: Record<string, unknown>
): Promise<CallToolResult> => {
  const schema = schemaFor(published, 'park_thread')
  const { valid } = generateSchemaCases('park_thread', schema, overrides)
  assert.equal(
    'outcome' in valid,
    false,
    'a pointer-release call must carry no outcome; park_thread.outcome is still a required property of the published schema'
  )
  return (await spawned.client.callTool({ name: 'park_thread', arguments: valid })) as CallToolResult
}

const callClose = async (
```

Rationale: ground truth 2.11 — `callPark(..., {})` changes meaning silently when `outcome` becomes
optional. This helper turns the silent change into a stated, self-checking one, and it is red on the
parent commit for exactly that reason.

### Step 18 — `test/spawn/resume.test.ts` — INSERT-AFTER — a helper that reads the stored log

FIND:

```ts
const isPointerShaped = (value: unknown): value is { thread_id: string; written_at: string; session_id: string } => {
```

REPLACE:

```ts
const readSessionBodies = (repo: string, pluginData: string, homeDir: string, threadId: string): string[] => {
  const rt = testRuntime({ env: { HOME: homeDir, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
  const opened = openStore(rt, repo)
  if (!opened.ok) throw new Error(`resume fixture: could not open the store to read session entries: ${opened.message}`)
  return opened.value.readSessionEntries(threadId).flatMap((slot) => (slot.quarantined ? [] : [slot.record.body]))
}

const isPointerShaped = (value: unknown): value is { thread_id: string; written_at: string; session_id: string } => {
```

Rationale: acceptance criterion 2 requires the control test to assert the log **persists**, which
means reading it back off disk rather than trusting the returned status.

### Step 19 — `test/spawn/resume.test.ts` — REPLACE — the schema-class census gains `required`

FIND:

```ts
    await runRejectsInvalid(fx, 'park_thread', ['minItems'])
```

REPLACE:

```ts
    await runRejectsInvalid(fx, 'park_thread', ['minItems', 'required'])
```

Rationale: ground truth 2.12 — with no required property left, `generateSchemaCases` emits no
`required` mutation and the census's `missing` set gains that class. Classifying the new item is
what invariant I8 requires; the assertion stays an exact set equality and is not widened.

### Step 20 — `test/spawn/resume.test.ts` — REPLACE — keep the contract test on the full park

FIND:

```ts
    const result = await callPark(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread', result)
```

REPLACE:

```ts
    const result = await callPark(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: 'the contract fixture session outcome'
    })
    assertOkResult('park_thread', result)
```

Rationale: `park_thread.spawn.contract` is the mandatory contract test named by
`test/contract/mandatory-tests.test.ts:88`. Without an explicit `outcome` it would stop exercising
the session-entry path, so the structured result it validates would no longer cover
`session_entry_ids` being populated.

### Step 21 — `test/spawn/resume.test.ts` — REPLACE — rewrite the overruled design message

FIND:

```ts
    const firstPark = await callPark(fx.spawned, fx.published, {})
    assertOkResult('park_thread (before any resume)', firstPark)
    const firstStructured = firstPark.structuredContent as { status: string }
    assert.equal(
      firstStructured.status,
      'nothing-to-park',
      'parking before any resume in this session must be a no-op, not a park of the freshly opened thread'
    )
```

REPLACE:

```ts
    const firstPark = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (before any resume)', firstPark)
    const firstStructured = firstPark.structuredContent as { status: string }
    assert.equal(
      firstStructured.status,
      'nothing-to-park',
      'parking with no outcome before any resume in this session must be a no-op, not a park of the freshly opened thread; the no-op is preserved only because nothing was supplied to lose, and the same call carrying an outcome must refuse instead of discarding it'
    )
```

Rationale: ruling R2 — "`test/spawn/resume.test.ts:388` is **explicitly overruled**. Its message
[...] remains correct about the *pointer*, and is preserved by clause 3. It is wrong that the log
may be discarded." This is acceptance criterion 5's named rewrite.

### Step 22 — `test/spawn/resume.test.ts` — REPLACE — branch 1, no pointer at all

FIND:

```ts
test('park.is-one-call', async () => {
```

REPLACE:

```ts
test('park.refuses-an-outcome-when-nothing-is-marked-as-being-worked', async () => {
  await withFixture(async (fx) => {
    await createFixtureThread(fx.spawned, fx.published)

    const park = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-NOTHING-TO-PARK this text must survive the refusal'
    })

    assert.equal(park.isError, true, 'park_thread must refuse an outcome when no thread is marked as being worked')
    const text = firstTextOf(park)
    assert.equal(text.split('\n')[0], 'field: outcome')
    assert.match(text, /no thread is currently marked as being worked/)
    assert.match(text, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      0,
      'a refusal on the no-pointer branch must leave the state directory exactly as it found it'
    )
  })
})

test('park.is-one-call', async () => {
```

Rationale: acceptance criterion 1 for branch `:263`. It asserts on `firstTextOf(park)`, which reads
`park.content[0].text`, never on `structuredContent` — ruling R10: "Every acceptance test for a
refusal asserts on the `content` text blocks."

### Step 23 — `test/spawn/resume.test.ts` — REPLACE — the control test (acceptance criterion 2)

FIND:

```ts
test('handoff.detects-crash', async () => {
```

REPLACE:

```ts
test('park.control-a-held-pointer-still-stores-the-outcome', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const marker = 'MARKER-HAPPY-PATH-PARKED this text must be on disk afterwards'
    const park = await callPark(fx.spawned, fx.published, { thread_id: threadId, outcome: marker })

    assertOkResult('park_thread (control, pointer held)', park)
    const structured = park.structuredContent as { status: string; session_entry_ids: string[] }
    assert.equal(structured.status, 'parked')
    assert.equal(structured.session_entry_ids.length, 1, 'a park with an outcome must write exactly one session entry')

    const bodies = readSessionBodies(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(
      bodies.some((body) => body.includes(marker)),
      true,
      'the outcome supplied to a park with a held pointer must be readable from the stored session log'
    )
  })
})

test('handoff.detects-crash', async () => {
```

Rationale: acceptance criterion 2 — "the same payload with a held pointer still parks and the log
persists. This is the inertness discriminator." It reads the body back off disk rather than
trusting the returned status.

### Step 24 — `test/spawn/resume.test.ts` — REPLACE — branch 2, the supplied thread_id mismatch

FIND:

```ts
    const mismatched = await callPark(fx.spawned, fx.published, { thread_id: b.threadId })
    assertOkResult('park_thread (mismatched id)', mismatched)
    const structured = mismatched.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'not-the-worked-thread')
    assert.equal(structured.pointer_released, false)

    const followUp = await callPark(fx.spawned, fx.published, { thread_id: a.threadId })
```

REPLACE:

```ts
    const refused = await callPark(fx.spawned, fx.published, {
      thread_id: b.threadId,
      outcome: 'MARKER-NOT-THE-WORKED-THREAD this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome aimed at a thread that is not the worked one')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, new RegExp(a.threadId), 'the refusal must name the thread that is actually being worked')
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the mismatched-thread branch must leave the pointer in place'
    )

    const mismatched = await callParkWithoutOutcome(fx.spawned, fx.published, { thread_id: b.threadId })
    assertOkResult('park_thread (mismatched id, no outcome)', mismatched)
    const structured = mismatched.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'not-the-worked-thread')
    assert.equal(structured.pointer_released, false)

    const followUp = await callPark(fx.spawned, fx.published, {
      thread_id: a.threadId,
      outcome: 'the mismatch fixture session outcome'
    })
```

Rationale: acceptance criterion 1 for branch `:268`, and the pre-existing mislabel D2 names at
`:602` — the test called `park.refuses-...` now actually asserts a refusal. The second half keeps
the omitted-form no-op assertion that ruling R2 clause 3 preserves.

### Step 25 — `test/spawn/resume.test.ts` — REPLACE — branch 4, the record is gone

FIND:

```ts
    const park = await callPark(fx.spawned, fx.published, {})
    assertOkResult('park_thread (stale pointer)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'stale-pointer-released')
    assert.equal(structured.pointer_released, true)
```

REPLACE:

```ts
    const refused = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-STALE-POINTER this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome when the worked thread has no stored record')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, new RegExp(threadId), 'the refusal must name the thread whose record is gone')
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the missing-record branch must leave the pointer in place so the call can be retried'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (stale pointer)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'stale-pointer-released')
    assert.equal(structured.pointer_released, true)
```

Rationale: acceptance criterion 1 for branch `:149` and acceptance criterion 3 for the same release
branch, in one test. Ruling R2 clause 2 requires the refusal to leave the pointer alone; clause 3
requires the omitted form to release it and return the existing status unchanged.

### Step 26 — `test/spawn/resume.test.ts` — REPLACE — branch 5, the thread is terminal

FIND:

```ts
    const park = await callPark(fx.spawned, fx.published, {})
    assertOkResult('park_thread (terminal pointer)', park)
```

REPLACE:

```ts
    const refused = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-TERMINAL-POINTER this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome when the worked thread is already terminal')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, /which is terminal/)
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the terminal-thread branch must leave the pointer in place so the call can be retried'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (terminal pointer)', park)
```

Rationale: acceptance criterion 1 for branch `:164` and acceptance criterion 3 for the same release
branch. The existing assertion at the end of this test — that the stored thread record is
byte-identical before and after — still holds, because neither the refusal nor the omitted form
commits anything.

### Step 27 — `test/spawn/resume.test.ts` — REPLACE — branch 6, the pointer file is corrupt

FIND:

```ts
    const park = await callPark(fx.spawned, fx.published, {})
    assertOkResult('park_thread (corrupt pointer)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'stale-pointer-released')
    assert.equal(structured.pointer_released, true)
```

REPLACE:

```ts
    const refused = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-CORRUPT-POINTER this text must survive the refusal'
    })
    assert.equal(refused.isError, true, 'park_thread must refuse an outcome when the pointer file does not parse')
    const refusedText = firstTextOf(refused)
    assert.equal(refusedText.split('\n')[0], 'field: outcome')
    assert.match(refusedText, /does not parse/)
    assert.match(refusedText, /NOT stored and must be re-sent/)
    assert.equal(
      readFileSync(pointerFilePath(layout), 'utf8'),
      'not-json{{{',
      'a refusal on the corrupt-pointer branch must leave the unreadable pointer file exactly as it found it'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (corrupt pointer)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'stale-pointer-released')
    assert.equal(structured.pointer_released, true)
```

Rationale: acceptance criterion 1 for branch `:254` and acceptance criterion 3 for the same release
branch. `countPointerShapedFiles` cannot be used here because a corrupt pointer file is by
definition not pointer-shaped; the file's exact bytes are asserted instead.

### Step 28 — `test/spawn/resume.test.ts` — REPLACE — branch 3, another session holds the pointer

FIND:

```ts
      const park = await callPark(p1, published1, {})
      assertOkResult('park_thread (original session, pointer stolen)', park)
      const structured = park.structuredContent as { status: string; pointer_released: boolean }
      assert.equal(structured.status, 'not-the-worked-thread')
      assert.equal(structured.pointer_released, false)
```

REPLACE:

```ts
      const refused = await callPark(p1, published1, {
        outcome: 'MARKER-OTHER-SESSION this text must survive the refusal'
      })
      assert.equal(
        refused.isError,
        true,
        'park_thread must refuse an outcome when another session holds the record of what is being worked'
      )
      const refusedText = firstTextOf(refused)
      assert.equal(refusedText.split('\n')[0], 'field: outcome')
      assert.match(refusedText, /belongs to a different session/)
      assert.match(refusedText, /NOT stored and must be re-sent/)

      const park = await callParkWithoutOutcome(p1, published1, {})
      assertOkResult('park_thread (original session, pointer stolen)', park)
      const structured = park.structuredContent as { status: string; pointer_released: boolean }
      assert.equal(structured.status, 'not-the-worked-thread')
      assert.equal(structured.pointer_released, false)
```

Rationale: acceptance criterion 1 for branch `:272`, and the second pre-existing mislabel D2 names
at `:741`. This test runs two spawned servers against one store, so it has no `fx` and cannot call
`countPointerShapedFiles`; the omitted-form assertion at the end already proves the pointer survived
by returning `not-the-worked-thread` rather than `nothing-to-park`.

### Step 29 — `test/spawn/resume.test.ts` — REPLACE — the remaining silent-omission call sites

There are two left, both in tests whose assertions are unaffected. Making them explicit is what
keeps ground truth 2.11 from being a trap for the next reader.

FIND:

```ts
    const park = await callPark(fx.spawned, fx.published, {})
    assertOkResult('park_thread (after self-heal)', park)
```

REPLACE:

```ts
    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (after self-heal)', park)
```

FIND:

```ts
    const secondPark = await callPark(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread (second)', secondPark)
```

REPLACE:

```ts
    const secondPark = await callParkWithoutOutcome(fx.spawned, fx.published, { thread_id: threadId })
    assertOkResult('park_thread (second)', secondPark)
```

Rationale: `resume.self-heals-a-corrupt-pointer` and `park.twice-succeeds` both assert the omitted
form's behaviour; the helper states that and checks it.

### Step 30 — `test/spawn/resume.test.ts` — REPLACE — the quarantined refusal now needs an outcome

FIND:

```ts
    const park = await callPark(fx.spawned, fx.published, {})
    assert.equal(park.isError, true, 'parking a thread whose stored record is quarantined must be refused')
    const text = firstTextOf(park)
    assert.equal(text.split('\n')[0], 'field: thread_id')
    assert.match(text, new RegExp(threadId), 'the refusal must name the thread id that could not be resolved')
```

REPLACE:

```ts
    const park = await callPark(fx.spawned, fx.published, {
      outcome: 'MARKER-QUARANTINE this text must survive the refusal'
    })
    assert.equal(park.isError, true, 'parking a thread whose stored record is quarantined must be refused')
    const text = firstTextOf(park)
    assert.equal(text.split('\n')[0], 'field: outcome')
    assert.match(text, new RegExp(threadId), 'the refusal must name the thread id that could not be resolved')
    assert.match(text, /NOT stored and must be re-sent/)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'a refusal on the quarantined-record branch must leave the pointer in place so the call can be retried'
    )
```

Rationale: after step 1 the omitted form of this call no longer refuses, so the test that asserts a
refusal has to supply an outcome. `field: thread_id` becomes `field: outcome` because step 3
changed it.

### Step 31 — `test/spawn/resume.test.ts` — REPLACE — the designed exit (acceptance criterion 4)

FIND:

```ts
test('park.releases-the-pointer-when-the-thread-is-already-terminal', async () => {
```

REPLACE:

```ts
test('park.releases-a-pointer-that-names-a-quarantined-record', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const layout = layoutInFixture(fx.repo, fx.pluginData, fx.homeDir)
    writeFileSync(threadRecordPath(layout, threadId), '{not-json', 'utf8')

    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      1,
      'the fixture must start with the pointer naming the quarantined record'
    )

    const park = await callParkWithoutOutcome(fx.spawned, fx.published, {})
    assertOkResult('park_thread (quarantined record, no outcome)', park)
    const structured = park.structuredContent as { status: string; pointer_released: boolean }
    assert.equal(structured.status, 'quarantined-pointer-released')
    assert.equal(structured.pointer_released, true)
    assert.equal(
      countPointerShapedFiles(fx.repo, fx.pluginData, fx.homeDir),
      0,
      'a pointer naming a quarantined record must have a designed release, not only the side effect of resuming an unrelated thread'
    )
  })
})

test('park.releases-the-pointer-when-the-thread-is-already-terminal', async () => {
```

Rationale: acceptance criterion 4 — "A test asserts a pointer naming a quarantined record can be
released, and that it cannot be today." The two `countPointerShapedFiles` assertions are the
before-and-after of the release. This is the audit's `repro-c7.ts` re-authored as a committed test;
see section 5.2.

### Step 32 — `package.json` and `.claude-plugin/plugin.json` — RUN — the version bump


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

Expected exit code: 0. Expected stdout under the baseline: `1.0.4`.

Then run:

```bash
node scripts/check-packaging.mjs
```

Expected exit code: 0.

Expected `git diff` for the two manifest files under the baseline:

```diff
-  "version": "1.0.3",
+  "version": "1.0.4",
```

in `package.json`, and

```diff
-  "version": "1.0.3",
+  "version": "1.0.4",
```

in `.claude-plugin/plugin.json`.

Rationale: invariant I4 — both manifests move in the same commit and
`node scripts/check-packaging.mjs` passes. The script compares the two versions at
`scripts/check-packaging.mjs:139-149`.

---

## 5. Tests

### 5.1 `test/spawn/resume.test.ts`

This is the only test file this plan changes. Every change to it is given as an exact FIND/REPLACE
in section 4, steps 17 through 31. The exact test name strings after the change are:

| Test name string | Status | Discharges |
| --- | --- | --- |
| `park_thread.rejects-invalid` | modified (step 19) | criterion 5 |
| `park_thread.spawn.contract` | modified (step 20) | criterion 5 |
| `resume.round-trip` | modified (step 21) | criterion 5 |
| `park.refuses-an-outcome-when-nothing-is-marked-as-being-worked` | **new** (step 22) | criterion 1, branch `:263` |
| `park.control-a-held-pointer-still-stores-the-outcome` | **new** (step 23) | criterion 2 |
| `park.refuses-a-different-thread-id-and-keeps-the-pointer` | modified (step 24) | criteria 1 and 5, branch `:268` |
| `park.releases-a-stale-pointer-when-the-thread-record-is-gone` | modified (step 25) | criteria 1 and 3, branch `:149` |
| `park.releases-the-pointer-when-the-thread-is-already-terminal` | modified (step 26) | criteria 1 and 3, branch `:164` |
| `park.releases-a-corrupt-pointer` | modified (step 27) | criteria 1 and 3, branch `:254` |
| `park.refuses-when-another-session-took-the-pointer` | modified (step 28) | criteria 1 and 5, branch `:272` |
| `resume.self-heals-a-corrupt-pointer` | modified (step 29) | criterion 5 |
| `park.twice-succeeds` | modified (step 29) | criterion 5 |
| `park.refuses-a-quarantined-thread-record` | modified (step 30) | keeps the supplied-outcome refusal asserted after step 3 changed its field |
| `park.releases-a-pointer-that-names-a-quarantined-record` | **new** (step 31) | criterion 4 |

Two helper functions are added to the same file and are not tests:
`callParkWithoutOutcome` (step 17) and `readSessionBodies` (step 18).

Criterion 5 asks for seven tests in this file to be updated. The reconstructed list is the seven
marked "modified" and carrying "criterion 5" above: `park_thread.rejects-invalid`,
`park_thread.spawn.contract`, `resume.round-trip`,
`park.refuses-a-different-thread-id-and-keeps-the-pointer`,
`park.refuses-when-another-session-took-the-pointer`, `resume.self-heals-a-corrupt-pointer` and
`park.twice-succeeds`. Fourteen tests in this file change in total; the table above governs, and the
count of seven is the SPEC's, not one this plan re-derived.

Criterion 6 is discharged by command 3 of section 8, which runs `test/contract/skills.test.ts`
against the edited skill. Criterion 7 is discharged by command 6.

### 5.2 The inherited probes, re-authored as committed tests

Orchestrator ruling O10 assigns `repro-f7.ts` and `repro-c7.ts` to MSP-3. Both are re-authored here.

**`repro-f7.ts`** ran five scenarios in one script, labelled A through E, printing a verdict per
scenario. Its five scenarios map onto this plan's committed tests one for one:

| Probe scenario | Committed test |
| --- | --- |
| A. nothing-to-park (no pointer at all) | `park.refuses-an-outcome-when-nothing-is-marked-as-being-worked` (step 22) |
| B. not-the-worked-thread (mismatched thread_id) | `park.refuses-a-different-thread-id-and-keeps-the-pointer` (step 24) |
| C. terminal-pointer-released (thread already closed) | `park.releases-the-pointer-when-the-thread-is-already-terminal` (step 26) |
| D. stale-pointer-released (corrupt pointer file) | `park.releases-a-corrupt-pointer` (step 27) |
| E. CONTROL: parked (pointer held) - the log MUST survive | `park.control-a-held-pointer-still-stores-the-outcome` (step 23) |

Two things the probe did are deliberately **not** carried over. It swept the whole plugin-data
directory and every git object on every ref hunting for its marker; the committed tests assert the
refusal instead, which is the reported symptom and is far cheaper to run on every commit. And it
used an 8000-character payload to sit exactly on the cap; the committed tests use a short marker,
because the cap boundary is already covered by `sessionBodyCapRefusal` and the defect is not
length-dependent.

The two branches the probe never reached — `:149` (record gone) and `:272` (another session holds
the pointer) — are covered by steps 25 and 28.

**`repro-c7.ts`** opened two threads, resumed thread A, corrupted A's stored record, then printed
four observations: that `park_thread` refused without releasing, that re-resuming the same
quarantined thread refused as well, that the pointer survived both, and that resuming an unrelated
healthy thread B overwrote the pointer as a side effect.

The committed test in step 31 keeps the first and third of those and turns them into the assertion
that the exit now exists: the pointer is present before the call and gone after it. The other two
observations are deliberately **not** carried over. Re-resuming the quarantined record is
`resume_thread`'s behaviour, which this plan does not change and which SPEC section 7 keeps out of
scope by ruling that the exit must not widen `loadThread`'s contract. And the second healthy thread
existed in the probe only to demonstrate the accidental escape; asserting that an unrelated resume
overwrites the pointer would pin a side effect rather than the designed route.

---

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time; `0ade582` at authoring time.

Run, from a worktree at the parent commit with only the section 5 test changes applied (steps 17
through 31) and none of the `src/` or `skills/` changes:

```bash
node --test test/spawn/resume.test.ts
```

Expected exit code: **1**. This was measured, not predicted: running that command over a copy of
the parent tree carrying only the section 4 test steps reports `tests 22`, `pass 10`, `fail 12`.
The twelve that fail are `park.refuses-an-outcome-when-nothing-is-marked-as-being-worked`,
`park.refuses-a-different-thread-id-and-keeps-the-pointer`,
`park.releases-a-stale-pointer-when-the-thread-record-is-gone`,
`park.releases-the-pointer-when-the-thread-is-already-terminal`,
`park.releases-a-corrupt-pointer`, `park.refuses-when-another-session-took-the-pointer`,
`park.refuses-a-quarantined-thread-record`,
`park.releases-a-pointer-that-names-a-quarantined-record`, `park_thread.rejects-invalid`,
`resume.round-trip`, `resume.self-heals-a-corrupt-pointer` and `park.twice-succeeds`.

Each fails for a specific, stated reason:

| Test | Expected failure on the parent |
| --- | --- |
| `park.refuses-an-outcome-when-nothing-is-marked-as-being-worked` | `AssertionError [ERR_ASSERTION]: park_thread must refuse an outcome when no thread is marked as being worked` — the parent returns `ok: true` with status `nothing-to-park`, so `park.isError` is `undefined`, not `true` |
| `park.refuses-a-different-thread-id-and-keeps-the-pointer` | `AssertionError [ERR_ASSERTION]: park_thread must refuse an outcome aimed at a thread that is not the worked one` |
| `park.releases-a-stale-pointer-when-the-thread-record-is-gone` | `AssertionError [ERR_ASSERTION]: park_thread must refuse an outcome when the worked thread has no stored record` |
| `park.releases-the-pointer-when-the-thread-is-already-terminal` | `AssertionError [ERR_ASSERTION]: park_thread must refuse an outcome when the worked thread is already terminal` |
| `park.releases-a-corrupt-pointer` | `AssertionError [ERR_ASSERTION]: park_thread must refuse an outcome when the pointer file does not parse` |
| `park.refuses-when-another-session-took-the-pointer` | `AssertionError [ERR_ASSERTION]: park_thread must refuse an outcome when another session holds the record of what is being worked` |
| `park.refuses-a-quarantined-thread-record` | `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal: 'field: thread_id' !== 'field: outcome'` |
| `park.releases-a-pointer-that-names-a-quarantined-record` | `AssertionError [ERR_ASSERTION]: park_thread (quarantined record, no outcome) expected a successful call, got a refusal:` followed by the serialised refusal content |
| every test routed through `callParkWithoutOutcome` | `AssertionError [ERR_ASSERTION]: a pointer-release call must carry no outcome; park_thread.outcome is still a required property of the published schema` |
| `park_thread.rejects-invalid` | `AssertionError [ERR_ASSERTION]: expected park_thread's published schema to carry no mutation for exactly [minItems, required], but it carried none for [minItems]` |

The control test `park.control-a-held-pointer-still-stores-the-outcome` is **green on the parent** —
that was measured in the same run — and must stay green after the fix. That is what makes it the inertness discriminator rather than
another red test.

All of these compile on the parent. `callParkWithoutOutcome` and `readSessionBodies` use only
identifiers that already exist there (`schemaFor`, `generateSchemaCases`, `testRuntime`,
`openStore`, `assert`), so no substitute procedure is needed.

To confirm that the criterion-4 test is red for the reason D10 states rather than a compile error,
run it alone:

```bash
node --test --test-name-pattern='^park\.releases-a-pointer-that-names-a-quarantined-record$' test/spawn/resume.test.ts
```

Expected exit code: **1**, with the failure named in the table above.

---

## 7. Inertness mutation

Two acceptance criteria name a behaviour the fix adds. Run both mutations once, after the fix is
green, and restore after each.

### 7.1 The six-branch refusal (acceptance criterion 2 names the discriminator)

**The exact edit to revert.** In `src/server/tools/park_thread.ts`, delete these three lines from
inside the `if (pointerRead.kind === 'absent')` branch, leaving the branch as
`if (pointerRead.kind === 'absent') return emptyStatusReply('nothing-to-park')`:

```ts
      if (input.outcome !== undefined) {
        return { ok: false, refusal: noWorkedThreadRefusal() }
      }
```

**The exact command.**

```bash
node --test --test-name-pattern='^park\.refuses-an-outcome-when-nothing-is-marked-as-being-worked$' test/spawn/resume.test.ts
```

**The test that must turn red:** `park.refuses-an-outcome-when-nothing-is-marked-as-being-worked`.

**The expected exit code:** **1**.

**The expected failure text:**
`AssertionError [ERR_ASSERTION]: park_thread must refuse an outcome when no thread is marked as being worked`.

**The control that must stay green during the mutation.**

```bash
node --test --test-name-pattern='^park\.control-a-held-pointer-still-stores-the-outcome$' test/spawn/resume.test.ts
```

Expected exit code: 0, with `fail 0` in the output. This proves the mutation killed the branch under
test and nothing else.

**The exact restore.** Put the three deleted lines back so the branch reads:

```ts
    if (pointerRead.kind === 'absent') {
      if (input.outcome !== undefined) {
        return { ok: false, refusal: noWorkedThreadRefusal() }
      }
      return emptyStatusReply('nothing-to-park')
    }
```

Then re-run both commands above; expected exit code 0 and `fail 0` for each.

### 7.2 The quarantined-pointer exit (acceptance criterion 4)

**The exact edit to revert.** In `src/server/tools/park_thread.ts`, replace the whole
`if (slot.quarantined)` block with the three-line form it had before step 7:

```ts
  if (slot.quarantined) {
    return { ok: false, refusal: quarantinedPointerRefusal(threadId) }
  }
```

**The exact command.**

```bash
node --test --test-name-pattern='^park\.releases-a-pointer-that-names-a-quarantined-record$' test/spawn/resume.test.ts
```

**The test that must turn red:** `park.releases-a-pointer-that-names-a-quarantined-record`.

**The expected exit code:** **1**.

**The expected failure text:**
`AssertionError [ERR_ASSERTION]: park_thread (quarantined record, no outcome) expected a successful call, got a refusal:`.

**The control that must stay green during the mutation.**

```bash
node --test --test-name-pattern='^park\.refuses-a-quarantined-thread-record$' test/spawn/resume.test.ts
```

Expected exit code: 0, with `fail 0` in the output. The supplied-outcome refusal is unaffected by
this mutation, which proves it killed only the branch under test.

**The exact restore.** Put back the eleven-line form given as the REPLACE block of step 7, then
re-run both commands above; expected exit code 0 for each.

---

## 8. Full verification

Run all seven, from the repository root, in this order.

| # | Command | Expected exit | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | `> tsc -p tsconfig.json --noEmit` and no line after it |
| 2 | `node --test test/spawn/resume.test.ts` | 0 | `fail 0` |
| 3 | `node --test test/contract/skills.test.ts` | 0 | `fail 0` |
| 4 | `node --test test/contract/budget.test.ts` | 0 | `fail 0` |
| 5 | `node --test "test/contract/**/*.test.ts"` | 0 | `fail 0` |
| 6 | `npm test` | 0 | `fail 0` |
| 7 | `node scripts/check-packaging.mjs` | 0 | `check-packaging: ok` |

Command 3 is acceptance criterion 6: `skill.cannot-strand` parses the edited skill, drives its
`Call` steps against a live server and asserts the pointer count falls from 1 to 0, while
`contract.skill-references-exist` and `contract.skills-hold-no-rules` census every backtick span and
every non-blank line of it.

Command 4 measures the `INSTRUCTIONS` literal step 14 grew, against the 2048-byte budget.

Command 5 is called out separately because three further contract censuses read this tool's
published surface and would halt on a change made carelessly:
`contract.every-property-described` (`test/contract/described.test.ts:64`) requires the new
`outcome` description to be at least 10 characters,
`contract.every-tool-has-mandatory-tests` (`test/contract/mandatory-tests.test.ts:93`) requires the
test names `park_thread.spawn.contract` and `park_thread.rejects-invalid` to still exist, and
`error.discloses-no-path` (`test/contract/no-path.test.ts:1145`) censuses every **exported** refusal
producer under `src/`, which is why step 2's six factories are module-private.

Command 6 is invariant I1 and acceptance criterion 7.

---

## 9. Commits

### Commit 1

```
fix(park-thread): refuse instead of discarding a supplied session log
```

Files:

- `src/server/tools/park_thread.ts`

Plan steps: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13.

### Commit 2

```
docs(server): stop telling callers that parking always succeeds
```

Files:

- `src/server/instructions.ts`
- `src/server/prompts.ts`
- `skills/debrief/SKILL.md`

Plan steps: 14, 15, 16.

### Commit 3

```
test(park-thread): assert the lossy branches refuse and the stuck pointer can be released
```

Files:

- `test/spawn/resume.test.ts`

Plan steps: 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31.

### Commit 4

```
chore(release): bump the patch version for the park_thread refusal repair
```

Files:

- `package.json`
- `.claude-plugin/plugin.json`

Plan steps: 32.

Commit 2 changes only prose and carries no behaviour change; commits 1 and 3 carry the behaviour
change and its evidence. No commit mixes a refactor with a behaviour change.

---

## 10. Pull request

Open it with exactly this, filling `--verified` only for checks actually run:

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook \
  --head fix/msp-3-park-thread-refuses \
  --base main \
  --title "fix(park-thread): refuse instead of discarding a supplied session log" \
  --what "Parking now refuses when the text a caller supplied cannot be written, and says in words that the text was not stored and must be re-sent." \
  --what "The session text is now optional, so a caller that only wants to release the record of what is being worked can ask for exactly that." \
  --what "That same call is now the way to release the record of what is being worked when the thread it names has become unreadable, which nothing could do before." \
  --why "Six paths through parking returned success while silently discarding the session text the caller had just supplied, and three of them also deleted the state a retry would have needed." \
  --why "When the file describing a thread stopped being readable, nothing a caller could call would release the record of what is being worked; the only escape was picking up an unrelated thread." \
  --why "The shipped instructions, the hand-off prompt and the hand-off skill all stated that parking writes the log and releases the thread, with no path for a refusal." \
  --risk "A caller that treated every parking reply as a status token now sometimes receives a refusal, and the reply carries one status value its own list may not know." \
  --verified "npm test - 0 failures" \
  --verified "npm run typecheck - exit 0" \
  --verified "node --test test/contract/skills.test.ts - 0 failures" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "inertness mutation on the no-pointer branch - the named test turned red and the control stayed green" \
  --verified "inertness mutation on the unreadable-record branch - the named test turned red and the control stayed green" \
  --not-verified "mutation (Stryker) - not run against this diff" \
  --not-verified "coverage - not run"
```

The mutation-scope sentence SPEC section 8.2 requires, included above via `--not-verified`: the
Stryker mutate scope is `src/store/**`, `src/schema/**`, `src/merge/field-merge.ts`,
`src/merge/conflict.ts` and `src/render/**`. This change lives in `src/server/`, `skills/` and
`test/`, which fall outside that scope entirely, so the mutation job will report success having
mutated nothing in this diff. No `Verified: mutation` line may be written for this pull request.

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
   node -e "const s=require('fs').readFileSync('src/server/tools/park_thread.ts','utf8');process.stdout.write(String(s.includes('noWorkedThreadRefusal')))"
   ```

   Expected output: `false`. If the output is `true`, this change is already in the tree. STOP and
   report; do not improvise.

5. **`package.json` and `.claude-plugin/plugin.json` disagree before the change.** What you see: the
   step 32 command prints `STOP: package.json and .claude-plugin/plugin.json disagree before the
   bump` and exits 1. STOP and report; do not improvise. A version merely *higher* than `1.0.3` is
   **not** a stop condition — it means the ladder shifted, and the step handles it.

6. **The control test is red on the parent.** What you see: the section 6 run, on the parent,
   reports `park.control-a-held-pointer-still-stores-the-outcome` failing. That test must be green
   on the parent; if it is not, the fixture or the store has changed underneath this plan. STOP and
   report; do not improvise.

7. **A skills census halts or rejects.** What you see: command 3 of section 8 fails with a message
   containing `census halted on an unclassifiable item` or `census rejected a forbidden item`. The
   new skill steps have tripped `RULE_MARKER_PATTERN` or the line-kind parser. STOP and report; do
   not improvise. Do not delete a step, do not add an allowlist, and do not narrow the population —
   invariant I8.

8. **`skill.cannot-strand` fails with `no fixture argument resolver registered for tool`.** What you
   see: command 3 of section 8 fails with that message. A step in the edited skill begins with the
   word `Call` and names a tool the fixture does not know. STOP and report; do not improvise.

9. **The instructions budget is exceeded.** What you see: command 4 of section 8 fails inside
   `contract.instructions-within-budget`. The replacement text in step 14 has pushed the literal
   past 2048 bytes. STOP and report; do not improvise.

10. **A contract census halts on something this plan did not change.** What you see: command 5 of
   section 8 fails with a message containing `unclassifiable`. STOP and report; do not improvise. Do
   not add an allowlist, do not pin a count, and do not narrow the population — invariant I8.

11. **Either inertness mutation does not turn its named test red.** What you see: a section 7 command
   exits 0 while the mutation is in place. The test is not testing the fix. STOP and report; do not
   improvise.

12. **`npm test` fails in a file this plan does not name.** What you see: command 6 of section 8
    reports a failure outside `test/spawn/resume.test.ts`, `test/contract/skills.test.ts` and
    `test/contract/budget.test.ts`, and outside `workflow-hardening-census`, which stop condition 2
    covers. STOP and report; do not improvise.
