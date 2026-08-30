# U8 — Derived `last_session`

## 0. Identity

**What this unit is about, in plain words.** Logbook keeps, on every thread, a short hand-written
summary of what the last working session did. It is called `last_session`. Nothing refreshes it
automatically, so it is only as current as the last person who remembered to type it. This unit stops
asking anyone to type it: the briefing now builds that section out of the session log entries the
previous session already wrote, and it shows each entry's own identifier so a reader can go and read
the entry in full. Where a thread has no session log entries at all, the old hand-written text is
still shown, labelled as a legacy value so nobody mistakes it for something derived. The stored field
is never deleted.

**Terms used throughout, defined once.**

- **Session log entry** — one dated note attached to a thread, holding who wrote it, its text, and a
  26-character sortable identifier called a ULID. Two tools write them: `log_session_event`, which an
  agent calls during a session, and `park_thread`, which writes one when a session ends.
- **The spine** — the six-field running summary stored on the thread record. `last_session` is one of
  its six fields.
- **The briefing** — the block of text `resume_thread` returns when a session picks a thread back up.
- **Clip marker** — a fixed piece of text appended to a value that had to be shortened, so a reader
  can see that what they are looking at is not the whole thing.
- **Published contract** — the tool names, arguments and argument types this plugin advertises over
  the Model Context Protocol to any agent, including agents outside this repository.

**Closes:** the wrap-up that does nothing. `park_thread` accepts a `last_session` argument
(`src/server/tools/park_thread.ts:33-37`) that the shipped `debrief` skill never passed, so the field
went stale on every thread and nothing surfaced it. The value is now derived from records the system
already holds, which is the private development constraint *store by hand only what cannot be derived
from records already written*.

**Depends on:**

1. The briefing renderer as the item-completeness unit left it — no display-time item caps,
   `currentCriterionId` gone, a `**Focus:** not set.` line, a `**Settled items (on goals already met
   or struck):**` group rendering last, and a `Not shown` block with exactly two possible members.
2. `src/render/clip.ts`, exporting `CLIP_MARKER`, `CLIP_MARKER_GRAPHEMES` and `clipWithMarker`. This
   unit shortens text and imports that helper. It writes no second one.
3. The capture unit, which stopped the `debrief` skill passing `last_session`. Section 3.4 records
   what the briefing showed in the window that opened.

Section 11 turns each of these into a checkable stop condition.

**Required by:** one later unit edits `src/render/briefing.ts` after this one — the unit that lets a
session declare which goals it is focused on. It is not planned here.

**Wave:** 3, and wave 3 is sequential rather than parallel. This unit merges first; the declared-focus
unit is cut from a `main` that already contains it.

**Splits into two pull requests.** Measured by applying this plan's own blocks to a throwaway copy of
the tree, not estimated. Section 10.1 gives the numbers and the ruling.

| Order | Part | Branch | Type | Carries |
| --- | --- | --- | --- | --- |
| 1 | **U8-A** The briefing derives the last session | `feat/u8-derived-last-session-a` | feat | `B23` |
| 2 | **U8-B** `park_thread` stops accepting the field | `feat/u8-derived-last-session-b` | feat | `B14` |

**Version bump.** Baseline `2.3.0` -> `2.4.0` per orchestrator ruling OR1, as amended by OR23. Two
rulings move that baseline and neither invalidates this plan, because every version step below is a
read-then-increment and never a hard-coded pair: OR25 inserts a fourth schema pull request, and OR30
makes the criterion-contract unit two major bumps so the ladder lands in `3.x`.

- **U8-A** increments MINOR and sets PATCH to 0. Its Conventional Commits type is `feat`.
- **U8-B** increments MAJOR and sets MINOR and PATCH to 0. Its Conventional Commits type is also
  `feat`; the centralized pull-request tool accepts the type set `feat fix refactor docs test chore
  perf ci` and nothing else, so there is no `feat!` to write and the break is disclosed in the body.

**Why U8-B is a MAJOR and not a MINOR.** `park_thread`'s input schema is a `z.strictObject`
(`src/server/tools/park_thread.ts:21`), and the server refuses any key the schema does not declare —
`src/server/register.ts:66-68` rejects a non-strict input schema at registration precisely so that
unknown keys are refused rather than silently accepted. Removing `last_session` therefore turns a call
that succeeds today into a refusal. Measured by probe against a copy of the schema with the field
removed:

    { "ok": false, "field": "last_session", "accepted": "object", "example": "{}",
      "retryable": true,
      "message": "last_session was refused; it accepts object; a valid example is {}; retryable=true." }

That is a breaking change to a contract published over the Model Context Protocol to agents outside
this repository. Semantic versioning answers to the published contract, not to the in-repo caller
count, which is the principle orchestrator ruling OR1 already settled for the criterion-contract unit
and OR30 restated. Rejected: a MINOR on the ground that the only in-repo caller is a test. That hides
a breaking change from the one signal an external caller reads.

**New module this unit creates and wholly owns:** `src/domain/session-log.ts`. It holds the actor
string `park_thread` stamps on the entry it writes, and the one function that decides which entries
belong to the previous session. No other unit in this ladder creates a module at that path.

**Also edits (to keep the tree green):** files this unit does not own, edited only where the tree
would not typecheck or the suite would not pass otherwise, each with its reason:

| File | Part | Reason |
| --- | --- | --- |
| `src/server/tools/resume_thread.ts` | A | It is the only production caller of the briefing renderer. Without the session entries reaching it, the derivation is dead code and the unit's green cannot be observed |
| `test/spawn/resume.test.ts` | A, B | It holds the end-to-end receipts for both parts, and one shipped test in it asserts that `park_thread` writes `last_session` |
| `test/unit/briefing.test.ts` | A | Two golden whole-output tests in it render a thread that takes this unit's legacy branch, so their expectations gain the one line it adds. Ground truth 2.19 measures it. The item-completeness unit creates both and merges a whole wave earlier, so there is no simultaneous writer |
| `test/support/published.ts` | B | It maps a sentence of `park_thread`'s published description to the arguments that provide it. Change one without the other and the shipped claim census halts |

**SPEC anchors:** section 9 unit U8; section 8 rules B14, B23; section 7 defect D10; section 10's risk
*a spine field is dropped before its replacement exists*. SPEC section 11.4 assigns this unit no
invariant, which section 1 below records rather than leaves implicit.

**Three standing plan invariants, and how this unit stands against each.**

- *No new silent success.* Part A adds one pure function and one optional renderer argument; it adds
  no tool, no refusal path and no place a call could report success for something it did not do. Part
  B removes an accepted argument, and the removal produces a refusal that names the field, what the
  call accepts, a valid example and `retryable: true` — the four-part shape, quoted above from a probe.
- *No record disappears.* Neither part changes any record schema. `src/schema/` is untouched. The
  stored `spine.last_session` field keeps its declaration, its cap and its value on every record; the
  briefing simply stops being the only thing that reads it. A record written before this unit renders
  through the legacy path and is not rewritten.
- *This repository is the installed plugin.* No test specified here observes this session's own
  ledger. Every one is either a pure function called with a fixture value built in memory, or the
  existing spawned-server fixture, which builds its own git repository and its own plugin-data
  directory under the system temporary directory and removes both afterwards.

---

## 1. Acceptance criteria (the ceiling)

Numbered, each naming the rule it discharges. **P** marks the part that ships it.

| # | Criterion | Discharges | P |
| --- | --- | --- | --- |
| 1 | The `**Last session:**` section of the briefing renders one line per session log entry of the previous session, newest first, and every line carries that entry's own identifier | B23 | A |
| 2 | "The previous session" is the run of entries ending at the newest entry, beginning immediately after the newest entry written by `park_thread` that is not itself the newest entry. Where no such entry exists the run is the whole log | B23 | A |
| 3 | Where the previous session has no entries, the stored `spine.last_session` text renders instead, on its own line, preceded by one fixed line marking it as legacy | B23 | A |
| 4 | Nothing is deleted. `spine.last_session` keeps its schema declaration and its stored value, and a render leaves the record byte-identical | B23 | A |
| 5 | Where the previous session has no entries and `spine.last_session` is empty, the whole section is omitted — no heading, no legacy line | B23 | A |
| 6 | Every entry of the previous session renders however tight the briefing's budget — none is dropped to make the briefing fit — and a line the budget forced shorter ends with the marker from the one shared clip helper. A briefing that fits its budget renders every entry whole and carries no marker | B23, and the Green clause *Nothing is deleted* | A |
| 7 | `park_thread` no longer publishes a `last_session` argument, and a call carrying one is refused with a refusal naming the field `last_session` and setting `retryable` to `true`. The thread record is not written by that refused call | B14 | B |
| 8 | `park_thread`'s `spine_fields_updated` reply can report only `next_step`, and its published description no longer claims it refreshes `last_session` | B14 | B |
| 9 | The derivation and `park_thread` agree on the value that marks a session boundary: `park_thread` stamps its session log entry with the same value the derivation looks for | B23 | A, B |

**No SPEC invariant is assigned to this unit.** SPEC section 11.4 maps `A1`-`A7`, `O1`-`O5` and
`S1`-`S4` to other units and names none for U8, so no row above discharges one.

**Where criteria 6 and 9 come from, since neither is obvious.** Both trace to `B23` and to the Green
clause *Nothing is deleted*. Criterion 6: the briefing is a budgeted surface, so a list added to it
either participates in the budget search or is dropped from the render to make room, and dropping an
entry is deleting it from what the reader sees. Criterion 9: `B23` says the section is derived from
*the previous session's* entries, which is undecidable unless the writer of the boundary marker and
the reader of it agree on its value. Neither criterion adds a property above the two sources; each
states what those two sources already require of a rendered list.

**Deliberately NOT a criterion, and recorded so it is not mistaken for one.** "The boundary value has
exactly one definition in the source tree" is a code-organisation preference, not a behaviour any of
the three permitted sources mandates. Step B4 takes it because it is cheap and it removes a drift
risk, and its rationale says so; nothing in section 1 claims it.

Anything discovered above this list is appended to
`docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item, and is not folded into this
plan. Four items were filed during planning: `F8a`, `F8b`, `F8c`, `F8d`.

---

## 2. Ground truth

Line numbers for `src/render/briefing.ts` were read from the file as the item-completeness unit's
third part leaves it, reconstructed in the session scratchpad by applying that unit's own whole-file
replacement. Line numbers for every other file were read from the working tree, where they are
unchanged by every earlier unit in this ladder.

### 2.1 `src/render/briefing.ts:1-4` — the imports

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope, Artifact } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored } from './escape.ts'
import { CLIP_MARKER_GRAPHEMES, clipWithMarker } from './clip.ts'
```

What is wrong with it: nothing, and it is quoted because the derivation needs two more imports — the
session entry type, and the function that decides which entries belong to the previous session.

### 2.2 `src/render/briefing.ts:53-54` — the last two per-item text limits

```ts
const CRITERION_RESULT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120
```

What is wrong with it: nothing, and it is quoted because a derived entry line carries stored text up
to 8000 characters long (`src/schema/caps.ts:38`, `SESSION_BODY_MAX`), so it needs a per-item limit of
its own inside the budget search.

### 2.3 `src/render/briefing.ts:66` — the settled heading, and where the two new constants go

```ts
const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'
```

What is wrong with it: nothing. It is the anchor for the section heading constant and the legacy
marker constant, both of which are fixed text the server writes.

### 2.4 `src/render/briefing.ts:118-119` — the settled risk line, and where the new line renderer goes

```ts
const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
  `- risk ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`
```

What is wrong with it: nothing. It is quoted because the derived entry line is built to the same
shape — an escaped identifier followed by clipped stored text — and that shape is what the shipped
render census resolves as escaped.

### 2.5 `src/render/briefing.ts:164-165`, `:179-180`, `:194-195` and `:209-210` — the four places a text limit is declared

```ts
  criterionResult: number
  settled: number
```

```ts
  criterionResult: Math.min(perItemClip, CRITERION_RESULT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX),
```

```ts
  criterionResult: NO_CLIP,
  settled: NO_CLIP,
```

```ts
  CRITERION_RESULT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX,
```

What is wrong with them: nothing. A per-item text limit exists in four places — the `RenderClip` type,
the `clipAt` function that builds one at a given budget, the `UNCLIPPED` value that switches
shortening off entirely, and the `MAX_ITEM_CLIP` computation that bounds the search. A new limit that
misses any one of them is either untyped, unsearched, or shortened on a render that had room.

### 2.6 `src/render/briefing.ts:245-262` — the assembler's parameters and its spine lines

```ts
const assembleBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: readonly OutOfScope[],
  criteria: readonly Criterion[],
  renderClip: RenderClip,
  textWasClipped: boolean
): string => {
  const notShownAddress = `logbook://thread/${escapeStored(thread.id)}`
  const unreadableDecisionCount = decisionIntegrity.dangling.length + decisionIntegrity.quarantined.length

  const activeGoalLines = thread.spine.active_goal.length === 0 ? [] : [thread.spine.active_goal]
  const lastSessionLines = thread.spine.last_session.length === 0 ? [] : [thread.spine.last_session]
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]
```

What is wrong with it: `lastSessionLines` is the stored hand-written string and nothing else. It is
the whole of what the briefing knows about the previous session, and it is refreshed only when a
caller remembers to type it. That is SPEC defect D10 seen from the render side.

### 2.7 `src/render/briefing.ts:299-302` — the rendered section

```ts
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.slice(0, 1).map(() => '**Last session:**'),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.map((value) => escapeStored(value)),
```

What is wrong with it: the heading appears exactly when the stored string is non-empty, so a thread
with a rich session log and an empty stored string shows nothing at all.

### 2.8 `src/render/briefing.ts:341-346` and `:353-365` — the entry point and the assembler call

```ts
export const renderBriefingWithPasses = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): BriefingRender => {
```

```ts
  const renderWith = (renderClip: RenderClip, textWasClipped: boolean): string =>
    assembleBriefing(
      thread,
      decisionIntegrity,
      pointer,
      predecessor,
      risks,
      keyDecisions,
      thread.spine.out_of_scope,
      thread.completion_criteria,
      renderClip,
      textWasClipped
    )
```

What is wrong with it: the renderer is handed a thread record and nothing else, so it cannot see the
session log even though the store can read it in one call.

Note on the name: `hasPreviousSession` here means *another session left this machine's pointer behind*
— a crash report. It is unrelated to the previous session's log entries, and this unit does not touch
it.

### 2.9 `src/render/briefing.ts:384-390` — the thin wrapper

```ts
export const renderBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): string => renderBriefingWithPasses(thread, decisionIntegrity, pointer, predecessor, hasPreviousSession).briefing
```

What is wrong with it: nothing. It is quoted because it forwards every argument and must forward one
more.

### 2.10 `src/schema/session.ts:9-15` — what a session entry actually holds

```ts
export type SessionEntry = {
  id: Ulid
  thread_id: Ulid
  actor: string
  body: string
  created_at: Iso8601
}
```

What is wrong with it: there is no session identifier on a session entry. The only record that carries
one is the pointer that marks which thread is being worked, and `park_thread` releases that pointer
(`src/server/tools/park_thread.ts:301`). So "the previous session" cannot be looked up; it has to be
decided from the entry stream itself. Section 4's step A2 states the rule that does it, and `F8c`
records the consequence.

### 2.11 `src/server/tools/park_thread.ts:33-37` — the argument that is removed

```ts
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
```

What is wrong with it: this is the hand-written write that SPEC rule `B14` removes, because the value
is now derived from records already written.

### 2.12 `src/server/tools/park_thread.ts:62-64` — what the reply may report

```ts
  spine_fields_updated: z
    .array(z.enum(['last_session', 'next_step']))
    .describe('which spine fields this call changed'),
```

What is wrong with it: once the argument is gone, `last_session` can never appear in this array. A
value a caller can never observe, left in a published enum, reads as live and is not.

### 2.13 `src/server/tools/park_thread.ts:252-259` — the write and the report

```ts
  const spineContribution: SpineContribution = {
    ...(input.last_session !== undefined ? { last_session: input.last_session } : {}),
    ...(input.next_step !== undefined ? { next_step: input.next_step } : {})
  }
  const spineFieldsUpdated: ('last_session' | 'next_step')[] = [
    ...(input.last_session !== undefined ? (['last_session'] as const) : []),
    ...(input.next_step !== undefined ? (['next_step'] as const) : [])
  ]
```

What is wrong with it: it is the body of the write the argument drives.

### 2.14 `src/server/tools/park_thread.ts:277-286` — the session log entry a park writes

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
```

What is wrong with it: `'logbook:park_thread'` is a bare string literal, and it is the only thing in
the whole store that marks where one session's work ends and the next begins. The derivation has to
read it, and two copies of a boundary marker in two modules is one copy too many.

### 2.15 `src/server/tools/park_thread.ts:322-323` — the published description

```ts
  description:
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the last_session and next_step fields, and releases the record of what is being worked. Send the outcome as text plus either of those two fields; the thread id is optional because the machine already knows which thread is being worked. Omit the outcome to release the record of what is being worked without writing a session log entry. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
```

What is wrong with it: it will claim an argument the tool no longer has.

### 2.16 `src/server/tools/resume_thread.ts:85-92` — the only production call of the renderer

```ts
    const hasPreviousSession = previousSession !== null
    const render = renderBriefingWithPasses(
      thread,
      decisionIntegrity,
      writtenPointer,
      resolvePredecessor(rt, store, thread),
      hasPreviousSession
    )
```

What is wrong with it: it holds an open store that can list a thread's session entries in one call
(`src/store/records.ts:29`, `readSessionEntries`) and does not.

### 2.17 `test/support/published.ts:116-121` — the shipped claim census entry

```ts
  park_thread: [
    {
      phrase: 'refreshes the last_session and next_step fields',
      providers: ['park_thread.last_session', 'park_thread.next_step']
    },
```

What is wrong with it: nothing today. It is quoted because the census that reads it halts on any
sentence of a tool's published description that no published argument provides
(`test/support/published.ts:191-197`, `classifyPublishedClaim`), so the description and this entry
have to change in the same commit.

### 2.18 `test/spawn/resume.test.ts:543-572` — the shipped test that asserts the write

```ts
test('park.refreshes-the-spine', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const before = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)

    await callResume(fx.spawned, fx.published, threadId)

    const suppliedOutcome = 'wrapped up the spine refresh assertions for this session'
    const suppliedLastSession = 'confirmed the park call updates last_session and next_step only'
    const suppliedNextStep = 'verify the remaining spine fields stay untouched'

    const parked = await callPark(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: suppliedOutcome,
      last_session: suppliedLastSession,
      next_step: suppliedNextStep
    })
    assertOkResult('park_thread (refreshes-the-spine)', parked)
    const structured = parked.structuredContent as { spine_fields_updated: string[] }
    assert.deepEqual(structured.spine_fields_updated, ['last_session', 'next_step'])

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.last_session, escapeStored(suppliedLastSession))
    assert.equal(after.spine.next_step, escapeStored(suppliedNextStep))
    assert.equal(after.spine.active_goal, before.spine.active_goal, 'active_goal must be byte-identical when only last_session and next_step were supplied')
    assert.deepEqual(after.spine.open_risks, before.spine.open_risks, 'open_risks must be untouched by a park call that supplied no risk contribution')
    assert.deepEqual(after.spine.key_decisions, before.spine.key_decisions, 'key_decisions must be untouched by a park call that supplied no decision contribution')
    assert.deepEqual(after.spine.out_of_scope, before.spine.out_of_scope, 'out_of_scope must be untouched by a park call that supplied no out-of-scope contribution')
  })
})
```

What is wrong with it: it pins the removed argument as correct behaviour through a spawned server, so
`B14` cannot land while this assertion stands. It is replaced, not deleted, and the replacement
asserts the same surrounding property — that a park call touches nothing it was not asked to touch.

### 2.19 `test/unit/briefing.test.ts:176-178` and `:228-230` — two golden tests that take the legacy branch

As the item-completeness unit leaves them. From
`briefing.renders-exact-output-for-a-full-thread` (`test/unit/briefing.test.ts:98`), the expectation's
last-session region:

```ts
    '**Last session:**',
    '',
    'wrote the first draft',
```

From `briefing.omits-empty-list-sections-entirely` (`:212`), the same region:

```ts
    '**Last session:**',
    '',
    'wrote the renderer',
```

What is wrong with them: nothing today, and they are quoted because this unit changes what they assert.
Both are whole-output assertions — `assert.equal(rendered, expected)` at `:209` and `:239` — and both
call the renderer with four arguments, so they pass no session entries. Both fixtures carry a non-empty
stored `spine.last_session`, so both take this unit's legacy branch and both expectations gain exactly
one line.

Measured on a tree carrying the schema, criterion-contract and item-completeness units plus this one,
all applied from their own blocks with zero mismatches:

    node --test --experimental-strip-types test/unit/briefing.test.ts
    tests 22, pass 20, fail 2, exit 1

with both failures differing from expectation by the single line

    + '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead\n'

Left unrepaired this halts the implementer at stop condition 11.10, on two failures that are not the
one tracked flake, and leaves the next unit's parent red.

---

## 3. Divergences from the SPEC

### 3.1 Wave 3 is ordered, not parallel

SPEC section 9 calls units within a wave "disjoint and parallel-safe". Wave 3 is not: this unit and
the declared-focus unit both own `src/render/briefing.ts`. Ruled by the orchestrator: wave 3 is
sequential, this unit merges first, and the declared-focus unit is cut from a `main` that already
contains it.

### 3.2 This unit edits `src/server/tools/resume_thread.ts`, which SPEC section 9 assigns to the declared-focus unit

SPEC section 9 gives this unit `src/render/briefing.ts` and `src/server/tools/park_thread.ts`. Neither
is a caller of the renderer. `src/server/tools/resume_thread.ts` is the only production caller —
measured: `grep -rn renderBriefing src hooks bin scripts` returns that file and the renderer itself and
nothing else — so the derived section cannot reach a user without an edit there.

**Ruling applied.** The edit is taken, and it is the smallest one that works: three added lines that
read the thread's session entries from the store already open in that handler, and one added argument
at the existing call. Nothing else in the file moves. Because wave 3 is ordered and this unit merges
first, the declared-focus unit is cut from a tree that already contains those four lines.

**Rejected:** leaving the renderer able to derive but never handed the entries. That ships a code path
no caller reaches, which is the definition of a change whose green cannot be observed.
**Rejected:** having the renderer open the store itself. The renderer is a pure function over a record;
giving it a store handle would make every one of its thirty-odd unit tests need a fixture store.

### 3.3 The renderer's new argument is optional, with an empty default

The new `sessionEntries` argument is appended last and defaults to the empty list. That keeps roughly
thirty shipped call sites in `test/unit/briefing.test.ts`,
`test/unit/briefing-frontier-sweep.test.ts` and `test/unit/briefing-styling-cost.test.ts` compiling
unchanged, and an empty list is exactly the state those fixtures describe: a thread with no session
log. The one production caller passes the real list.

**Rejected:** a required argument. It is the same behaviour for the same fixtures at a cost of about
sixty more changed lines in files this unit does not own, and it would push part A over the
reviewable-diff ceiling.

### 3.4 What the spine showed between the capture unit and this one, and that this unit closes it

SPEC section 10 attaches one risk to this unit: *if `park_thread` stops accepting `last_session`
before the derivation renders, the field goes stale with nothing standing in*. The capture unit already
opened half of that window: SPEC rule `B34` stops the `debrief` skill passing `last_session`, and
`debrief` was the only shipped caller that ever passed it.

**What the briefing showed in that window**, stated exactly: the `**Last session:**` section rendered
`thread.spine.last_session` verbatim — whatever string was last written into it by a `park_thread` or
`update_thread` call that supplied one — and, because nothing refreshed it any more, that string
described some earlier session and said nothing about which one. Where the field was empty the whole
section was omitted and the briefing said nothing at all about the previous session. Nothing was lost:
the value was still stored, still rendered, and still readable on the thread resource.

**This unit closes the window, and part A closes it before part B widens it.** Part A ships the
derivation while `park_thread` still accepts the argument, so from part A's merge onward the section
is derived from records the system already writes. Part B then removes the hand-written write, which
is safe only because the replacement is already live. Shipping part B first would extend the stale
window instead of closing it, which is why the order in section 0 is not reversible.

**What still writes `spine.last_session` after this unit, named rather than left implied.** Two tools
do, and neither is touched here because `B14` names only `park_thread`:

- `update_thread` publishes and accepts the same argument (`src/server/tools/update_thread.ts:54-58`),
  writes it (`:237`) and reports it (`:243-246`).
- `resolve_conflict` can overwrite the field when the same record differs on two sides of a sync
  (`src/server/tools/resolve_conflict.ts:399-400`).

This is load-bearing rather than incidental in two ways. It is why the stored field can still be
non-empty on a thread that never called `park_thread`, which is the state the legacy fallback exists
for. And the end-to-end legacy receipt in section 5.3 sets that field **through `update_thread`**, so
that test depends on `update_thread` continuing to accept the argument after part B merges. Filed as
`F8a`; closing it is a separate decision and is not folded in here.

### 3.5 The legacy text renders unshortened, exactly as the field rendered before this unit

The derived entry lines enter the budget search, because a session entry body may be 8000 characters
and a thread may hold many. The legacy fallback text does not: it renders through `escapeStored`,
unshortened, exactly as `lastSessionLines` did at `src/render/briefing.ts:302`.

The reason is measured rather than reasoned. Putting it inside the search shortens it to 500 graphemes
at a tight budget, and the shipped over-budget fixture
(`test/support/briefing-over-budget-fixture.ts:29`) holds that field at its 500-character cap filled
with text that expands sixfold when escaped. Probe run on the throwaway tree: with the legacy text
inside the search, `resume_thread.logs-a-budget-breach-only-for-a-render-that-does-not-fit`
(`test/contract/resume-payload-envelope.test.ts:123`) failed with
`the over-budget fixture must actually render past the 12000 character cap, got 11532`, because the
render no longer exceeded the cap. With the legacy text left unshortened the same file reports
`2 pass, 0 fail`.

**Ruling applied.** The legacy value is one of the three spine scalar strings, and its two siblings —
`active_goal` and `next_step` — are rendered unshortened by the same assembler. Rendering it the third
way would change a spine scalar's budget behaviour in a unit whose mandate says nothing about it, and
would falsify a shipped fixture whose whole purpose is to produce an over-budget render.

**Rejected:** clipping it and repointing the over-budget fixture. That is a change to a contract test
this unit does not own, to obtain a property no rule in this unit's mandate asks for.

### 3.6 The `Not shown` block is not extended for an unreadable session entry

A session entry whose stored record fails to parse is dropped from the derivation. The equivalent
omission for a decision is counted in the `Not shown` block; for a session entry it is not. SPEC rule
`B20` fixes that block at exactly two members and the item-completeness unit shipped it that way, so a
third member is new material. Filed as `F8d` and not folded in.

### 3.7 Part B takes a MAJOR bump, which the ladder's version rule reserves for one other unit

The ladder's mechanical version rule says a `feat` unit increments MINOR and names one other unit as
the only one that increments MAJOR. Part B is a `feat` unit and takes a MAJOR anyway, for the reason
section 0 gives and a probe measures: removing an accepted argument from a `z.strictObject` input
schema turns a call that succeeds today into a refusal, and semantic versioning answers to the
published contract rather than to the in-repo caller count — the same principle the ladder already
applied to the criterion-contract unit, which itself took two MAJOR bumps rather than one.

**Ruling applied.** Part B increments MAJOR. Recorded here as a divergence rather than left inside
section 0, because it shifts every later row of the ladder's version table, which is an
orchestrator-level consequence and not a planner's to absorb silently. The read-then-increment in
steps A1 and B1 means no plan needs re-authoring for the shift.

**Rejected:** a MINOR for part B, on the ground that the mechanical rule names only one MAJOR unit.
That would ship a breaking contract change under a version signal that says nothing broke.

### 3.8 No decomposition procedure was read

The decomposition skill some agent definitions name as a first read does not exist on disk. This
ladder does not depend on it; this plan was authored from the approved specification, the planning
brief and the orchestrator rulings alone.

### 3.9 The unit brief pointed at a section 12 of the item-completeness plan, which has no section 12

That plan runs to section 11 and folds its three parts into sections 4, 6, 7, 9, 10 and 11 rather than
into a trailing appendix. The material needed here — the whole-file renderer its third part leaves,
and the clip module its second part creates — was read from its steps `B2`, `B3` and `C2`. This plan
uses the trailing appendix form instead, as section 12.

---

## 4. The change, step by step

Steps are numbered by the pull request that carries them: `A1`, `A2`, ... then `B1`, ... Apply them in
the order given. After the last step of each part the tree typechecks and the suite is green.

### Part A — the briefing derives the last session

#### Step A1 — bump the version in both manifests

1. Read the current version. Run, from the repository root:

   ```
   node -p "require('./package.json').version"
   ```

   Expect exit code 0. Call what it prints `CURRENT`.

2. Read the plugin manifest's version. Run:

   ```
   node -p "require('./.claude-plugin/plugin.json').version"
   ```

   Expect exit code 0, and expect it to print exactly `CURRENT`. Any other value means the two
   manifests disagree: STOP and report; do not improvise.

3. This part's Conventional Commits type is `feat`, so increment the MINOR component of `CURRENT` and
   set PATCH to `0`. Call the result `NEXT`. Worked example, with the baseline this plan was written
   against: `CURRENT` is `2.3.0`, so `NEXT` is `2.4.0`. Substitute the values you read and computed,
   never the example.

4. Edit `package.json`. FIND the line `  "version": "CURRENT",` and REPLACE it with
   `  "version": "NEXT",`, substituting the two values.

5. Edit `.claude-plugin/plugin.json`. FIND the line `  "version": "CURRENT",` and REPLACE it with
   `  "version": "NEXT",`, substituting the two values.

6. Run `node scripts/check-packaging.mjs`. Expect exit code 0 and the single line `check-packaging: ok`.

Rationale: plan invariant `P4` requires both manifests to move in one commit.

#### Step A2 — create the session-log module

File: `src/domain/session-log.ts`. CREATE. Entire contents:

```ts
import type { SessionEntry } from '../schema/session.ts'

export const PARK_THREAD_ACTOR = 'logbook:park_thread'

const byIdAscending = (left: SessionEntry, right: SessionEntry): number => {
  if (left.id < right.id) return -1
  return left.id > right.id ? 1 : 0
}

export const previousSessionEntries = (entries: readonly SessionEntry[]): SessionEntry[] => {
  const ordered = [...entries].sort(byIdAscending)
  const boundary = ordered
    .slice(0, Math.max(0, ordered.length - 1))
    .reduce((found, entry, index) => (entry.actor === PARK_THREAD_ACTOR ? index + 1 : found), 0)
  return ordered.slice(boundary).reverse()
}
```

Rationale, and the rule stated in words because acceptance criterion 2 is exactly this function.

A session entry carries no session identifier (ground truth 2.10), so the boundary between sessions is
read from the log itself. `park_thread` is the call that ends a session's work on a thread, and the
entry it writes is stamped with a distinct actor, so a park entry is the last entry of the session it
closes. The log therefore divides into runs, each ending at a park entry, plus a trailing run with no
park entry at the end when the last session did not park — which is the crash case the whole system
exists to survive.

**The previous session is the last run.** In code: sort ascending by entry identifier, which is what
the store itself already orders by (`src/store/read-path.ts:254` sorts the record filenames, and a
session entry's filename is its identifier); look for the newest park entry among every entry *except
the newest*, and begin one past it; take everything from there to the end and reverse it, so the
newest renders first.

The five cases, each asserted by a named test in section 5.1:

| Log, oldest first | Previous session, newest first |
| --- | --- |
| `a`, `b`, PARK, `c`, PARK | PARK, `c` |
| `a`, PARK, `b`, `c` | `c`, `b` |
| `a`, `b` | `b`, `a` |
| PARK | PARK |
| empty | empty |

Excluding the newest entry from the park search is what makes rows one and two both correct with one
rule: a park entry that *is* the newest entry closes the run it belongs to rather than starting a new
empty one.

`PARK_THREAD_ACTOR` lives here, and step B4 makes `park_thread` stamp its entry from it, so the
boundary marker has one definition (acceptance criterion 9). Ordering is by identifier rather than by
`created_at` because the store's own read order is by identifier, and two ordering keys that can
disagree would let the briefing print a sequence the store never uses.

`.sort()` and `.reverse()` are called on arrays this function has just created with `[...entries]` and
`.slice(...)`; neither the argument nor any record it holds is modified.

#### Step A3 — teach the briefing renderer to derive the section

File: `src/render/briefing.ts`. Ten edits, applied in this order.

**Edit A3.1** — FIND:

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope, Artifact } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored } from './escape.ts'
```

REPLACE with:

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope, Artifact } from '../schema/thread.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Pointer } from '../domain/pointer.ts'
import { previousSessionEntries } from '../domain/session-log.ts'
import { escapeStored } from './escape.ts'
```

**Edit A3.2** — FIND:

```ts
const CRITERION_RESULT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120
```

REPLACE with:

```ts
const CRITERION_RESULT_NATURAL_MAX = 500
const LAST_SESSION_TEXT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120
```

**Edit A3.3** — FIND:

```ts
const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'
```

REPLACE with:

```ts
const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'

const LAST_SESSION_HEADING = '**Last session:**'

const LEGACY_LAST_SESSION_MARKER =
  '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead'
```

**Edit A3.4** — FIND:

```ts
const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
```

REPLACE with:

```ts
const renderSessionEntryLine = (entry: SessionEntry, textClip: number): string =>
  `- ${escapeStored(entry.id)} ${clip(entry.body, textClip)}`

const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
```

**Edit A3.5** — FIND:

```ts
  criterionResult: number
  settled: number
```

REPLACE with:

```ts
  criterionResult: number
  lastSession: number
  settled: number
```

**Edit A3.6** — FIND:

```ts
  criterionResult: Math.min(perItemClip, CRITERION_RESULT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX),
```

REPLACE with:

```ts
  criterionResult: Math.min(perItemClip, CRITERION_RESULT_NATURAL_MAX),
  lastSession: Math.min(perItemClip, LAST_SESSION_TEXT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX),
```

**Edit A3.7** — FIND:

```ts
  criterionResult: NO_CLIP,
  settled: NO_CLIP,
```

REPLACE with:

```ts
  criterionResult: NO_CLIP,
  lastSession: NO_CLIP,
  settled: NO_CLIP,
```

**Edit A3.8** — FIND:

```ts
  CRITERION_RESULT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX,
```

REPLACE with:

```ts
  CRITERION_RESULT_NATURAL_MAX,
  LAST_SESSION_TEXT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX,
```

**Edit A3.9** — FIND:

```ts
  criteria: readonly Criterion[],
  renderClip: RenderClip,
  textWasClipped: boolean
): string => {
```

REPLACE with:

```ts
  criteria: readonly Criterion[],
  previousEntries: readonly SessionEntry[],
  renderClip: RenderClip,
  textWasClipped: boolean
): string => {
```

**Edit A3.10** — FIND:

```ts
  const activeGoalLines = thread.spine.active_goal.length === 0 ? [] : [thread.spine.active_goal]
  const lastSessionLines = thread.spine.last_session.length === 0 ? [] : [thread.spine.last_session]
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]
```

REPLACE with:

```ts
  const activeGoalLines = thread.spine.active_goal.length === 0 ? [] : [thread.spine.active_goal]
  const legacyLastSessionText =
    previousEntries.length > 0 || thread.spine.last_session.length === 0 ? [] : [thread.spine.last_session]
  const lastSessionHeading =
    previousEntries.length + legacyLastSessionText.length === 0 ? [] : [LAST_SESSION_HEADING]
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]
```

Rationale for the ten edits together. The derived section needs a per-item text limit like every other
list on the briefing, so `LAST_SESSION_TEXT_NATURAL_MAX` joins the `RenderClip` type, the `clipAt`
builder, the `UNCLIPPED` value and the `MAX_ITEM_CLIP` computation — edits A3.5 to A3.8, which are the
four places ground truth 2.5 names. It is 500 while a stored body may be 8000, which bounds only the
budget search and never the full render, and it keeps `MAX_ITEM_CLIP` at 500 so the pass count the
shipped test `briefing.the-clip-search-converges-within-the-pass-ceiling` bounds at 11 is unchanged.
`renderSessionEntryLine` is built to the same shape as `renderSettledRiskLine` — an escaped identifier
followed by clipped stored text — which is the shape the shipped render census resolves as escaped.
`legacyLastSessionText` is non-empty only when there are no derived entries and the stored string is
non-empty, which is acceptance criteria 3 and 5 together. `lastSessionHeading` is non-empty when either
list is, so the heading appears for a derived section, for a legacy section, and for neither.

#### Step A4 — render the derived lines

File: `src/render/briefing.ts`. REPLACE.

FIND:

```ts
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.slice(0, 1).map(() => '**Last session:**'),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.map((value) => escapeStored(value)),
```

REPLACE with:

```ts
    ...lastSessionHeading.slice(0, 1).map(() => ''),
    ...lastSessionHeading.slice(0, 1).map(() => LAST_SESSION_HEADING),
    ...lastSessionHeading.slice(0, 1).map(() => ''),
    ...previousEntries.map((entry) => renderSessionEntryLine(entry, renderClip.lastSession)),
    ...legacyLastSessionText.slice(0, 1).map(() => LEGACY_LAST_SESSION_MARKER),
    ...legacyLastSessionText.map((value) => escapeStored(value)),
```

Rationale: `B23` — the previous session's entries render newest first with their identifiers, and the
stored text renders instead, marked as legacy, when there are none. The two lists are mutually
exclusive by construction in edit A3.10, so exactly one of the last three spreads ever produces a line.
Every spread is a `.map()` whose callback returns either a fixed string the server wrote or a value
that reaches an escaping helper, which is what the shipped render census requires; a spread of a bare
identifier would halt it. The legacy text keeps `escapeStored` rather than `clip` for the measured
reason in divergence 3.5.

#### Step A5 — hand the session entries to the renderer

File: `src/render/briefing.ts`. Three edits, applied in this order.

**Edit A5.1** — FIND:

```ts
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const risks = laneSplit(thread.spine.open_risks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)
```

REPLACE with:

```ts
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT,
  sessionEntries: readonly SessionEntry[] = []
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const risks = laneSplit(thread.spine.open_risks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)
  const previousEntries = previousSessionEntries(sessionEntries)
```

**Edit A5.2** — FIND:

```ts
      thread.spine.out_of_scope,
      thread.completion_criteria,
      renderClip,
      textWasClipped
    )
```

REPLACE with:

```ts
      thread.spine.out_of_scope,
      thread.completion_criteria,
      previousEntries,
      renderClip,
      textWasClipped
    )
```

**Edit A5.3** — FIND:

```ts
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): string => renderBriefingWithPasses(thread, decisionIntegrity, pointer, predecessor, hasPreviousSession).briefing
```

REPLACE with:

```ts
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT,
  sessionEntries: readonly SessionEntry[] = []
): string =>
  renderBriefingWithPasses(thread, decisionIntegrity, pointer, predecessor, hasPreviousSession, sessionEntries).briefing
```

Rationale: the segmentation runs once, outside the budget search, because the search may render the
briefing up to eleven times and the answer does not change between passes. The argument is appended
last and defaults to the empty list, for the reason in divergence 3.3.

#### Step A6 — read the session entries at the one production call site

File: `src/server/tools/resume_thread.ts`. REPLACE.

FIND:

```ts
    const hasPreviousSession = previousSession !== null
    const render = renderBriefingWithPasses(
      thread,
      decisionIntegrity,
      writtenPointer,
      resolvePredecessor(rt, store, thread),
      hasPreviousSession
    )
```

REPLACE with:

```ts
    const hasPreviousSession = previousSession !== null
    const sessionEntries = store
      .readSessionEntries(thread.id)
      .flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
    const render = renderBriefingWithPasses(
      thread,
      decisionIntegrity,
      writtenPointer,
      resolvePredecessor(rt, store, thread),
      hasPreviousSession,
      sessionEntries
    )
```

Rationale: `B23` — without this the derivation is unreachable. `readSessionEntries` returns a list of
slots, each either a parsed record or a note that the file on disk failed to parse
(`src/store/read-path.ts:11-13`), and only the parsed records are rendered. An entry that failed to
parse is dropped without a count, which is filed as `F8d` and not closed here.

### Part B — `park_thread` stops accepting the field

Every step below is applied to the tree as part A left it.

#### Step B1 — bump the version in both manifests

Identical in form to step A1 except for the component that moves, and restated in full so this part is
executable on its own.

1. `node -p "require('./package.json').version"` — expect exit code 0; call what it prints `CURRENT`.
2. `node -p "require('./.claude-plugin/plugin.json').version"` — expect exit code 0, and expect it to
   print exactly `CURRENT`. Any other value means the two manifests disagree: STOP and report; do not
   improvise.
3. This part removes an argument from a contract published over the Model Context Protocol, which is a
   breaking change. Increment the MAJOR component of `CURRENT`, set MINOR to `0` and set PATCH to `0`.
   Call the result `NEXT`. Worked example, with the baseline this plan was written against: `CURRENT`
   is `2.4.0`, so `NEXT` is `3.0.0`. Substitute the values you read and computed, never the example.
4. In `package.json`, FIND `  "version": "CURRENT",` and REPLACE with `  "version": "NEXT",`.
5. In `.claude-plugin/plugin.json`, FIND `  "version": "CURRENT",` and REPLACE with
   `  "version": "NEXT",`.
6. Run `node scripts/check-packaging.mjs`. Expect exit code 0 and the single line `check-packaging: ok`.

#### Step B2 — remove the published argument

File: `src/server/tools/park_thread.ts`. REPLACE.

FIND:

```ts
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  next_step: z
```

REPLACE with:

```ts
  next_step: z
```

Rationale: `B14` — `park_thread` stops accepting `last_session`, because the value is derived. The
schema is a `z.strictObject`, so a call that still sends the key is refused rather than silently
ignored.

#### Step B3 — narrow what the reply can report

File: `src/server/tools/park_thread.ts`. Two edits, applied in this order.

**Edit B3.1** — FIND:

```ts
  spine_fields_updated: z
    .array(z.enum(['last_session', 'next_step']))
    .describe('which spine fields this call changed'),
```

REPLACE with:

```ts
  spine_fields_updated: z
    .array(z.enum(['next_step']))
    .describe('which spine fields this call changed'),
```

**Edit B3.2** — FIND:

```ts
  const spineContribution: SpineContribution = {
    ...(input.last_session !== undefined ? { last_session: input.last_session } : {}),
    ...(input.next_step !== undefined ? { next_step: input.next_step } : {})
  }
  const spineFieldsUpdated: ('last_session' | 'next_step')[] = [
    ...(input.last_session !== undefined ? (['last_session'] as const) : []),
    ...(input.next_step !== undefined ? (['next_step'] as const) : [])
  ]
```

REPLACE with:

```ts
  const spineContribution: SpineContribution = {
    ...(input.next_step !== undefined ? { next_step: input.next_step } : {})
  }
  const spineFieldsUpdated: 'next_step'[] = [...(input.next_step !== undefined ? (['next_step'] as const) : [])]
```

Rationale: acceptance criterion 8. With the argument gone, `last_session` can never appear in
`spine_fields_updated`, and a published enum member no caller can ever observe reads as live code that
is not. Rejected: leaving the enum as it is, which reproduces the unreachable-branch defect the SPEC's
section 7 records as `D3`.

#### Step B4 — stamp the park entry from the shared constant

File: `src/server/tools/park_thread.ts`. Two edits, applied in this order.

**Edit B4.1** — FIND:

```ts
import type { SessionEntry } from '../../schema/session.ts'
```

REPLACE with:

```ts
import type { SessionEntry } from '../../schema/session.ts'
import { PARK_THREAD_ACTOR } from '../../domain/session-log.ts'
```

**Edit B4.2** — FIND:

```ts
          actor: 'logbook:park_thread',
```

REPLACE with:

```ts
          actor: PARK_THREAD_ACTOR,
```

Rationale: acceptance criterion 9. The derivation in step A2 reads this actor to find a session
boundary; two copies of that string in two modules is one copy too many, and the copy that drifts is
the one that silently stops marking a boundary.

#### Step B5 — correct the published description

File: `src/server/tools/park_thread.ts`. REPLACE.

FIND:

```ts
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the last_session and next_step fields, and releases the record of what is being worked. Send the outcome as text plus either of those two fields; the thread id is optional because the machine already knows which thread is being worked. Omit the outcome to release the record of what is being worked without writing a session log entry. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
```

REPLACE with:

```ts
    'Ends work on the thread being worked right now, in a single call: it writes the session log entry, refreshes the next_step field, and releases the record of what is being worked. The last_session field is no longer accepted here; it is derived from the session log. Send the outcome as text plus the next step; the thread id is optional because the machine already knows which thread is being worked. Omit the outcome to release the record of what is being worked without writing a session log entry. The thread stays open, parking is not closing, and a parked thread appears in the next roster.',
```

Rationale: `B14`, and the shipped description census. Measured on the throwaway tree: the new
description is 595 bytes against a 2048-byte budget, its lead sentence is 178 bytes against a
200-byte limit, and `classifyDescription` returns `allowed` (`test/support/published.ts:54-59`).

#### Step B6 — keep the claim census pointing at something that exists

File: `test/support/published.ts`. REPLACE.

FIND:

```ts
    {
      phrase: 'refreshes the last_session and next_step fields',
      providers: ['park_thread.last_session', 'park_thread.next_step']
    },
```

REPLACE with:

```ts
    { phrase: 'refreshes the next_step field', providers: ['park_thread.next_step'] },
    {
      phrase: 'The last_session field is no longer accepted here; it is derived from the session log.',
      providers: []
    },
```

Rationale: the census halts on any registered claim whose phrase is absent from the published
description, and marks as forbidden any claim whose named provider is not a published argument
(`test/support/published.ts:191-197`). Both halves of the claim are updated in the same commit as the
description they describe. The second entry has no providers because the sentence describes an
argument that is deliberately absent, which the census's own `providers.length === 0` branch already
treats as `allowed`. This is classifying a changed item, not narrowing the census.

---

## 5. Tests

### 5.1 `test/unit/session-log.test.ts` — new

The segmentation rule, one test per row of the table in step A2's rationale, plus its ordering
property and its shared constant. File: `test/unit/session-log.test.ts`. CREATE. Entire contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARK_THREAD_ACTOR, previousSessionEntries } from '../../src/domain/session-log.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const THREAD_ID = rt.ulid()

const ids = Array.from({ length: 8 }, () => rt.ulid()).sort()

const entryAt = (index: number, actor: string, body: string): SessionEntry => {
  const id = ids[index]
  assert.ok(id !== undefined, `the fixture asked for id ${index} but only ${ids.length} were minted`)
  return { id, thread_id: THREAD_ID, actor, body, created_at: rt.now() }
}

const bodies = (entries: readonly SessionEntry[]): string[] => entries.map((entry) => entry.body)

test('session-log.the-previous-session-is-the-run-of-entries-after-the-last-completed-park', () => {
  const entries = [
    entryAt(0, 'claude', 'one'),
    entryAt(1, 'claude', 'two'),
    entryAt(2, PARK_THREAD_ACTOR, 'parked the first session'),
    entryAt(3, 'claude', 'three'),
    entryAt(4, PARK_THREAD_ACTOR, 'parked the second session')
  ]

  assert.deepEqual(
    bodies(previousSessionEntries(entries)),
    ['parked the second session', 'three'],
    'the previous session is the entries after the first park entry, newest first'
  )
})

test('session-log.entries-written-after-the-last-park-are-the-previous-session', () => {
  const entries = [
    entryAt(0, 'claude', 'one'),
    entryAt(1, PARK_THREAD_ACTOR, 'parked the first session'),
    entryAt(2, 'claude', 'two'),
    entryAt(3, 'claude', 'three')
  ]

  assert.deepEqual(
    bodies(previousSessionEntries(entries)),
    ['three', 'two'],
    'a session that logged entries and never parked is still the previous session'
  )
})

test('session-log.a-log-with-no-park-entry-is-one-session', () => {
  const entries = [entryAt(0, 'claude', 'one'), entryAt(1, 'claude', 'two')]
  assert.deepEqual(bodies(previousSessionEntries(entries)), ['two', 'one'])
})

test('session-log.a-log-holding-only-a-park-entry-is-one-session', () => {
  const entries = [entryAt(0, PARK_THREAD_ACTOR, 'parked')]
  assert.deepEqual(bodies(previousSessionEntries(entries)), ['parked'])
})

test('session-log.an-empty-log-has-no-previous-session', () => {
  assert.deepEqual(previousSessionEntries([]), [])
})

test('session-log.the-segment-is-decided-by-entry-id-order-not-by-argument-order', () => {
  const ordered = [
    entryAt(0, 'claude', 'one'),
    entryAt(1, PARK_THREAD_ACTOR, 'parked the first session'),
    entryAt(2, 'claude', 'two'),
    entryAt(3, 'claude', 'three')
  ]
  const shuffled = [ordered[3], ordered[0], ordered[2], ordered[1]].flatMap((entry) => (entry === undefined ? [] : [entry]))

  assert.equal(shuffled.length, 4, 'the shuffled fixture must hold every entry')
  assert.deepEqual(bodies(previousSessionEntries(shuffled)), bodies(previousSessionEntries(ordered)))
})

test('session-log.the-park-actor-is-the-one-park_thread-writes', () => {
  assert.equal(PARK_THREAD_ACTOR, 'logbook:park_thread')
})
```

### 5.2 `test/unit/briefing-last-session.test.ts` — new

The rendered section. File: `test/unit/briefing-last-session.test.ts`. CREATE. Entire contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { PARK_THREAD_ACTOR } from '../../src/domain/session-log.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const LEGACY_MARKER =
  '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead'

const threadWith = (lastSession: string): Thread => ({
  id: rt.ulid(),
  slug: 'last-session-fixture',
  title: 'Last Session Fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the derivation',
    next_step: 'write the tests',
    last_session: lastSession,
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const ids = Array.from({ length: 6 }, () => rt.ulid()).sort()

const entryAt = (index: number, threadId: string, actor: string, body: string): SessionEntry => {
  const id = ids[index]
  assert.ok(id !== undefined, `the fixture asked for id ${index} but only ${ids.length} were minted`)
  return { id, thread_id: threadId, actor, body, created_at: rt.now() }
}

const sectionOf = (rendered: string, heading: string): string[] => {
  const lines = rendered.split('\n')
  const start = lines.indexOf(heading)
  assert.notEqual(start, -1, `the briefing must carry the ${heading} heading`)
  const rest = lines.slice(start + 2)
  const end = rest.findIndex((line) => line.length === 0)
  return end === -1 ? rest : rest.slice(0, end)
}

test('briefing.last-session-renders-the-previous-sessions-entries-newest-first-with-their-ids', () => {
  const thread = threadWith('the hand-written summary nobody refreshed')
  const entries = [
    entryAt(0, thread.id, 'claude', 'older session, first entry'),
    entryAt(1, thread.id, PARK_THREAD_ACTOR, 'older session, parked'),
    entryAt(2, thread.id, 'claude', 'previous session, first entry'),
    entryAt(3, thread.id, PARK_THREAD_ACTOR, 'previous session, parked')
  ]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    `- ${ids[3]} previous session, parked`,
    `- ${ids[2]} previous session, first entry`
  ])
  assert.equal(
    rendered.includes('the hand-written summary nobody refreshed'),
    false,
    'the stored legacy text must not render while the previous session has entries of its own'
  )
  assert.equal(rendered.includes(LEGACY_MARKER), false, 'the legacy marker must not render on a derived section')
})

test('briefing.last-session-falls-back-to-the-stored-text-marked-as-legacy', () => {
  const thread = threadWith('the hand-written summary nobody refreshed')

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, [])

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [
    LEGACY_MARKER,
    'the hand-written summary nobody refreshed'
  ])
})

test('briefing.last-session-is-omitted-when-there-are-no-entries-and-no-stored-text', () => {
  const rendered = renderBriefing(threadWith(''), EMPTY_INTEGRITY, null, null, false, [])
  assert.equal(rendered.includes('**Last session:**'), false)
  assert.equal(rendered.includes(LEGACY_MARKER), false)
})

test('briefing.deriving-last-session-deletes-nothing-from-the-record', () => {
  const thread = threadWith('the hand-written summary nobody refreshed')
  const entries = [entryAt(0, thread.id, 'claude', 'previous session, only entry')]

  renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.equal(
    thread.spine.last_session,
    'the hand-written summary nobody refreshed',
    'rendering must leave the stored field exactly as it was'
  )
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the record must still be schema-admissible after a render')
})

test('briefing.a-session-entry-that-does-not-fit-the-budget-carries-the-clip-marker', () => {
  const thread = threadWith('')
  const entries = Array.from({ length: 40 }, (_, index) =>
    index < ids.length
      ? entryAt(index, thread.id, 'claude', 'x'.repeat(8000))
      : { id: `${rt.ulid()}`, thread_id: thread.id, actor: 'claude', body: 'x'.repeat(8000), created_at: rt.now() }
  )

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.equal(rendered.length <= 12000, true, 'the briefing must be searched down into its character budget')
  assert.equal(
    sectionOf(rendered, '**Last session:**').length,
    40,
    'every entry of the previous session must render, however tight the budget'
  )
  assert.equal(
    sectionOf(rendered, '**Last session:**').every((line) => line.endsWith(CLIP_MARKER)),
    true,
    'every shortened entry line must end with the shared clip marker'
  )
})

test('briefing.a-session-entry-that-fits-renders-whole-with-no-marker', () => {
  const thread = threadWith('')
  const entries = [entryAt(0, thread.id, 'claude', 'y'.repeat(1200))]

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null, false, entries)

  assert.deepEqual(sectionOf(rendered, '**Last session:**'), [`- ${ids[0]} ${'y'.repeat(1200)}`])
  assert.equal(rendered.includes(CLIP_MARKER), false, 'a briefing that fits its budget must carry no clip marker')
})
```

### 5.3 `test/spawn/resume.test.ts` — modified

Four edits. The first belongs to part A, the last three to part B. Within part B they are applied in
the order T2, T3, T4. Each drives a spawned server against
a fixture git repository and a fixture plugin-data directory under the system temporary directory;
none observes this session's own ledger.

**Edit T1 (part A)** — INSERT-AFTER. FIND:

```ts
    assert.deepEqual(after.spine.out_of_scope, before.spine.out_of_scope, 'out_of_scope must be untouched by a park call that supplied no out-of-scope contribution')
  })
})
```

REPLACE with:

```ts
    assert.deepEqual(after.spine.out_of_scope, before.spine.out_of_scope, 'out_of_scope must be untouched by a park call that supplied no out-of-scope contribution')
  })
})

test('resume.last-session-renders-the-previous-sessions-entries-newest-first', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const firstBody = 'MARKER-ENTRY-ONE read the spec and located the derivation point'
    const secondBody = 'MARKER-ENTRY-TWO wrote the segmentation rule'
    const outcome = 'MARKER-PARK closed out the session with the derivation landed'

    const entryIds: string[] = []
    for (const body of [firstBody, secondBody]) {
      const logged = (await fx.spawned.client.callTool({
        name: 'log_session_event',
        arguments: { thread_id: threadId, actor: 'claude', body }
      })) as CallToolResult
      assertOkResult('log_session_event', logged)
      entryIds.push((logged.structuredContent as { session_entry_id: string }).session_entry_id)
    }

    const parked = await callPark(fx.spawned, fx.published, { thread_id: threadId, outcome })
    assertOkResult('park_thread (last-session derivation)', parked)
    const parkEntryIds = (parked.structuredContent as { session_entry_ids: string[] }).session_entry_ids
    const parkEntryId = parkEntryIds[0]
    assert.ok(parkEntryId !== undefined, 'the park call must have written a session log entry')

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (last-session derivation)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    const lines = briefing.split('\n')
    const headingAt = lines.indexOf('**Last session:**')
    assert.notEqual(headingAt, -1, 'the briefing must carry a Last session heading')

    assert.deepEqual(
      lines.slice(headingAt + 2, headingAt + 5),
      [`- ${parkEntryId} ${outcome}`, `- ${entryIds[1]} ${secondBody}`, `- ${entryIds[0]} ${firstBody}`],
      'the Last session section must render the previous session entries newest first, each with its entry id'
    )
  })
})

test('resume.last-session-falls-back-to-the-stored-text-marked-as-legacy', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    const storedSummary = 'MARKER-LEGACY a summary typed by hand before the derivation existed'

    const updated = (await fx.spawned.client.callTool({
      name: 'update_thread',
      arguments: { thread_id: threadId, last_session: storedSummary }
    })) as CallToolResult
    assertOkResult('update_thread (legacy last session)', updated)

    const resumed = await callResume(fx.spawned, fx.published, threadId)
    assertOkResult('resume_thread (legacy last session)', resumed)
    const briefing = (resumed.structuredContent as { briefing: string }).briefing
    const lines = briefing.split('\n')
    const headingAt = lines.indexOf('**Last session:**')
    assert.notEqual(headingAt, -1, 'the briefing must carry a Last session heading')

    assert.deepEqual(
      lines.slice(headingAt + 2, headingAt + 4),
      [
        '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead',
        storedSummary
      ],
      'with no session log entries the stored text must render, marked as legacy'
    )
  })
})
```

The FIND block above is the closing of `park.refreshes-the-spine`, which is that test's last assertion
at `test/spawn/resume.test.ts:570-572`. That exact three-line sequence occurs once in the file.

**Edit T2 (part B)** — REPLACE. FIND:

```ts
    const suppliedOutcome = 'wrapped up the spine refresh assertions for this session'
    const suppliedLastSession = 'confirmed the park call updates last_session and next_step only'
    const suppliedNextStep = 'verify the remaining spine fields stay untouched'

    const parked = await callPark(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: suppliedOutcome,
      last_session: suppliedLastSession,
      next_step: suppliedNextStep
    })
    assertOkResult('park_thread (refreshes-the-spine)', parked)
    const structured = parked.structuredContent as { spine_fields_updated: string[] }
    assert.deepEqual(structured.spine_fields_updated, ['last_session', 'next_step'])

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.last_session, escapeStored(suppliedLastSession))
    assert.equal(after.spine.next_step, escapeStored(suppliedNextStep))
    assert.equal(after.spine.active_goal, before.spine.active_goal, 'active_goal must be byte-identical when only last_session and next_step were supplied')
```

REPLACE with:

```ts
    const suppliedOutcome = 'wrapped up the spine refresh assertions for this session'
    const suppliedNextStep = 'verify the remaining spine fields stay untouched'

    const parked = await callPark(fx.spawned, fx.published, {
      thread_id: threadId,
      outcome: suppliedOutcome,
      next_step: suppliedNextStep
    })
    assertOkResult('park_thread (refreshes-the-spine)', parked)
    const structured = parked.structuredContent as { spine_fields_updated: string[] }
    assert.deepEqual(structured.spine_fields_updated, ['next_step'])

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.next_step, escapeStored(suppliedNextStep))
    assert.equal(after.spine.last_session, before.spine.last_session, 'last_session must be byte-identical; park_thread no longer writes it')
    assert.equal(after.spine.active_goal, before.spine.active_goal, 'active_goal must be byte-identical when only next_step was supplied')
```

**Edit T4 (part B)** — REPLACE, applied after edit T3. FIND:

```ts
    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.last_session, '', 'a refused park call must write nothing')
  })
})
```

REPLACE with:

```ts
    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.last_session, '', 'a refused park call must write nothing')

    const outputSchema = outputSchemaFor(fx.outputSchemas, 'park_thread')
    const outputProperties = outputSchema.properties as Record<string, unknown>
    const updated = outputProperties.spine_fields_updated as { items?: { enum?: unknown } }
    assert.deepEqual(
      updated.items?.enum,
      ['next_step'],
      'park_thread must publish next_step as the only spine field its reply can report'
    )
  })
})
```

This closes the half of criterion 8 that the narrowed reply enum carries. Without it, restoring the
old enum leaves every test green: after step B2 removes the argument, `input.last_session` is always
`undefined`, so the reply never reports `last_session` whatever the enum permits, and only the
published schema itself records the difference. `outputSchemaFor` and `fx.outputSchemas` already exist
in this file (`test/spawn/resume.test.ts:114-118` and `:77-82`).

**Edit T3 (part B)** — INSERT-AFTER. FIND:

```ts
    assert.deepEqual(after.spine.out_of_scope, before.spine.out_of_scope, 'out_of_scope must be untouched by a park call that supplied no out-of-scope contribution')
  })
})

test('resume.last-session-renders-the-previous-sessions-entries-newest-first', async () => {
```

REPLACE with:

```ts
    assert.deepEqual(after.spine.out_of_scope, before.spine.out_of_scope, 'out_of_scope must be untouched by a park call that supplied no out-of-scope contribution')
  })
})

test('park.refuses-a-last-session-argument', async () => {
  await withFixture(async (fx) => {
    const { threadId } = await createFixtureThread(fx.spawned, fx.published)
    await callResume(fx.spawned, fx.published, threadId)

    const parkSchema = schemaFor(fx.published, 'park_thread')
    const properties = (parkSchema as { properties?: Record<string, unknown> }).properties ?? {}
    assert.equal(
      Object.prototype.hasOwnProperty.call(properties, 'last_session'),
      false,
      'park_thread must no longer publish a last_session argument'
    )

    const result = (await fx.spawned.client.callTool({
      name: 'park_thread',
      arguments: { thread_id: threadId, outcome: 'this call supplies a field the tool no longer accepts', last_session: 'a hand-written summary' }
    })) as CallToolResult
    assert.equal(result.isError, true, 'park_thread must refuse a call carrying last_session')
    assert.match(JSON.stringify(result.content), /last_session/, 'the refusal must name the field that was wrong')

    const after = readStoredThread(fx.repo, fx.pluginData, fx.homeDir, threadId)
    assert.equal(after.spine.last_session, '', 'a refused park call must write nothing')
  })
})
test('resume.last-session-renders-the-previous-sessions-entries-newest-first', async () => {
```

### 5.4 `test/unit/briefing.test.ts` — modified

Two edits, both part A, applied in either order. Each updates a golden whole-output expectation to
carry the one line this unit's legacy branch adds. Neither fixture is changed, and no assertion is
removed, weakened or deleted.

**Edit T5 (part A)** — REPLACE. FIND:

```ts
    '**Last session:**',
    '',
    'wrote the first draft',
```

REPLACE with:

```ts
    '**Last session:**',
    '',
    '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead',
    'wrote the first draft',
```

**Edit T6 (part A)** — REPLACE. FIND:

```ts
    '**Last session:**',
    '',
    'wrote the renderer',
```

REPLACE with:

```ts
    '**Last session:**',
    '',
    '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead',
    'wrote the renderer',
```

Each FIND occurs once in the file as the item-completeness unit leaves it; the two regions differ in
their third line, which is what makes each unique.

**Why the expectations change and the fixtures do not, decided here.** Neither test is about
`last_session`: one pins the whole rendered output of a fully-populated thread, the other asserts that
a section with nothing in it is omitted. Both fixtures hold a stored summary and no session log
entries, which is precisely a thread recorded before this unit, so the legacy line is the correct
output for each and a golden test that shows it is documenting real behaviour.

**Rejected:** giving either fixture session log entries so it takes the derived branch instead. That
changes what the test tests, and it would assert the derived rendering in a second place when section
5.2 already asserts it precisely — one behaviour belongs in one home.
**Rejected:** emptying `spine.last_session` on the second fixture so the section is omitted. It
weakens a shipped whole-output assertion to avoid an expected line, and section 5.2 already covers the
omitted case.

### 5.5 Every acceptance criterion has a named test

| Criterion | Test | File |
| --- | --- | --- |
| 1 | `briefing.last-session-renders-the-previous-sessions-entries-newest-first-with-their-ids`, and end to end `resume.last-session-renders-the-previous-sessions-entries-newest-first` | 5.2, 5.3 |
| 2 | the six `session-log.*` segmentation tests | 5.1 |
| 3 | `briefing.last-session-falls-back-to-the-stored-text-marked-as-legacy`, and end to end `resume.last-session-falls-back-to-the-stored-text-marked-as-legacy` | 5.2, 5.3 |
| 3, again | `briefing.renders-exact-output-for-a-full-thread` and `briefing.omits-empty-list-sections-entirely` as edits T5 and T6 leave them, which pin the legacy line inside two whole-output assertions | 5.4 |
| 4 | `briefing.deriving-last-session-deletes-nothing-from-the-record` | 5.2 |
| 5 | `briefing.last-session-is-omitted-when-there-are-no-entries-and-no-stored-text` | 5.2 |
| 6 | `briefing.a-session-entry-that-does-not-fit-the-budget-carries-the-clip-marker` and `briefing.a-session-entry-that-fits-renders-whole-with-no-marker` | 5.2 |
| 7 | `park.refuses-a-last-session-argument` | 5.3 |
| 8 | `park.refuses-a-last-session-argument` as edit T4 leaves it, for the narrowed reply enum; `park.refreshes-the-spine` as edit T2 leaves it, for what the reply actually reports; and the shipped `contract.published-schema-matches-enforced.claims.park-thread-summary-fields-are-reachable` reading step B6's entry, for the published description | 5.3, shipped |
| 9 | `session-log.the-park-actor-is-the-one-park_thread-writes`, plus `resume.last-session-renders-the-previous-sessions-entries-newest-first`, whose expected first line is produced only when `park_thread` stamped the actor the derivation looks for | 5.1, 5.3 |

No SPEC invariant is assigned to this unit, so no row is owed for one.

---

## 6. Red on the parent

"The parent" means the tip of `main` the part's branch was cut from: for part A, a `main` containing
all of waves 1 and 2; for part B, a `main` containing part A. Both reds below were produced by running
the command against a reconstruction of that parent in the session scratchpad, and the failure text is
copied from the run rather than predicted.

### 6.1 Part A

On the parent, with only test edit T1 applied and no production change, run from the repository root:

```
node --test --experimental-strip-types test/spawn/resume.test.ts
```

Expect a non-zero exit code, `ℹ tests 24`, `ℹ pass 22`, `ℹ fail 2`, and exactly these two failures.

From `resume.last-session-renders-the-previous-sessions-entries-newest-first`:

    AssertionError [ERR_ASSERTION]: the briefing must carry a Last session heading
      actual: -1
      expected: -1
      operator: 'notStrictEqual'

The parent renders that section only when the stored hand-written string is non-empty, and a freshly
opened thread stores an empty one, so the heading is absent even though the thread has three session
log entries.

From `resume.last-session-falls-back-to-the-stored-text-marked-as-legacy`:

    AssertionError [ERR_ASSERTION]: with no session log entries the stored text must render, marked as legacy
    + actual - expected

      [
    -   '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead',
        'MARKER-LEGACY a summary typed by hand before the derivation existed',
    +   ''
      ]

**The two unit test files do not compile on the parent** and cannot be run red there.
`test/unit/session-log.test.ts` imports `../../src/domain/session-log.ts`, which does not exist on the
parent, and `test/unit/briefing-last-session.test.ts` calls `renderBriefing` with six arguments where
the parent declares five. `npx tsc -p tsconfig.json --noEmit` on the parent with both files present
exits non-zero with `Cannot find module '../../src/domain/session-log.ts'` and
`Expected 1-5 arguments, but got 6`.

**Substitute procedure, and why no proxy is used instead.** The two spawn tests above are part A's
receipt: they compile on the parent, run on the parent, and fail on the parent for the behaviour `B23`
mandates rather than for a proxy of it. The unit tests are the finer-grained statement of the same
behaviour, and section 7 proves each of them with an inertness mutation instead. No assertion is
weakened to obtain a red, and no test is deleted, skipped or focused.

### 6.2 Part B

On the parent — a `main` containing part A — with only test edit T3 applied and no production change,
run from the repository root:

```
node --test --experimental-strip-types test/spawn/resume.test.ts
```

Expect a non-zero exit code, `ℹ tests 25`, `ℹ pass 24`, `ℹ fail 1`, and exactly this failure, from
`park.refuses-a-last-session-argument`:

    AssertionError [ERR_ASSERTION]: park_thread must no longer publish a last_session argument

    true !== false

That is the test's first assertion, and it fails on the parent because the published input schema still
carries the argument.

---

## 7. Inertness mutation

Each mutation below was applied to the merged change in the session scratchpad, run, and reverted; the
failure text is copied from that run. Apply the edit, run the command, confirm the failure, then
restore by reversing the edit exactly.

### 7.1 Criterion 1 — the derived lines render

**Mutate.** In `src/render/briefing.ts`, FIND:

```ts
    ...previousEntries.map((entry) => renderSessionEntryLine(entry, renderClip.lastSession)),
```

REPLACE with:

```ts
    ...previousEntries.slice(0, 0).map((entry) => renderSessionEntryLine(entry, renderClip.lastSession)),
```

**Run.** `node --test --experimental-strip-types test/unit/briefing-last-session.test.ts`

**Expect** a non-zero exit code and three failures —
`briefing.last-session-renders-the-previous-sessions-entries-newest-first-with-their-ids`,
`briefing.a-session-entry-that-does-not-fit-the-budget-carries-the-clip-marker` and
`briefing.a-session-entry-that-fits-renders-whole-with-no-marker` — the first of them reporting

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal

with an actual value of `[]`.

**Restore.** Reverse the edit exactly.

### 7.2 Criterion 1 — the entry identifier is on the line

**Mutate.** In `src/render/briefing.ts`, FIND:

```ts
  `- ${escapeStored(entry.id)} ${clip(entry.body, textClip)}`
```

REPLACE with:

```ts
  `- ${clip(entry.body, textClip)}`
```

**Run.** `node --test --experimental-strip-types test/unit/briefing-last-session.test.ts`

**Expect** a non-zero exit code and, from
`briefing.last-session-renders-the-previous-sessions-entries-newest-first-with-their-ids`

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal

with actual lines carrying the body text and no identifier.

**Restore.** Reverse the edit exactly.

### 7.3 Criterion 2 — the segment boundary is the park entry

**Mutate.** In `src/domain/session-log.ts`, FIND:

```ts
    .reduce((found, entry, index) => (entry.actor === PARK_THREAD_ACTOR ? index + 1 : found), 0)
```

REPLACE with:

```ts
    .reduce((found) => found, 0)
```

**Run.** `node --test --experimental-strip-types test/unit/session-log.test.ts`

**Expect** a non-zero exit code and, from
`session-log.the-previous-session-is-the-run-of-entries-after-the-last-completed-park`

    AssertionError [ERR_ASSERTION]: the previous session is the entries after the first park entry, newest first

with an actual value of five bodies rather than two.
`session-log.entries-written-after-the-last-park-are-the-previous-session` fails alongside it.

**Restore.** Reverse the edit exactly.

### 7.4 Criterion 1 — newest first

**Mutate.** In `src/domain/session-log.ts`, FIND:

```ts
  return ordered.slice(boundary).reverse()
```

REPLACE with:

```ts
  return ordered.slice(boundary)
```

**Run.** `node --test --experimental-strip-types test/unit/session-log.test.ts`

**Expect** a non-zero exit code and three failures, including
`session-log.a-log-with-no-park-entry-is-one-session` reporting

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal

with an actual value of `[ 'one', 'two' ]` against an expected `[ 'two', 'one' ]`.

**Restore.** Reverse the edit exactly.

### 7.5 Criterion 3 — the legacy marker

**Mutate.** In `src/render/briefing.ts`, FIND:

```ts
    ...legacyLastSessionText.slice(0, 1).map(() => LEGACY_LAST_SESSION_MARKER),
```

REPLACE with:

```ts
    ...legacyLastSessionText.slice(0, 0).map(() => LEGACY_LAST_SESSION_MARKER),
```

**Run.** `node --test --experimental-strip-types test/unit/briefing-last-session.test.ts`

**Expect** a non-zero exit code and exactly one failure,
`briefing.last-session-falls-back-to-the-stored-text-marked-as-legacy`, reporting

    AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal

with an actual value holding the stored text alone.

**Restore.** Reverse the edit exactly.

### 7.6 Criterion 5 — the section is omitted when there is nothing to show

**Mutate.** In `src/render/briefing.ts`, FIND:

```ts
  const lastSessionHeading =
    previousEntries.length + legacyLastSessionText.length === 0 ? [] : [LAST_SESSION_HEADING]
```

REPLACE with:

```ts
  const lastSessionHeading = [LAST_SESSION_HEADING]
```

**Run.** `node --test --experimental-strip-types test/unit/briefing-last-session.test.ts`

**Expect** a non-zero exit code and exactly one failure,
`briefing.last-session-is-omitted-when-there-are-no-entries-and-no-stored-text`, reporting

    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal

with `true !== false`.

**Restore.** Reverse the edit exactly.

### 7.7 Criterion 6 — the derived lines are inside the budget search

**Mutate.** In `src/render/briefing.ts`, FIND:

```ts
  lastSession: Math.min(perItemClip, LAST_SESSION_TEXT_NATURAL_MAX),
```

REPLACE with:

```ts
  lastSession: LAST_SESSION_TEXT_NATURAL_MAX,
```

**Run.** `node --test --experimental-strip-types test/unit/briefing-last-session.test.ts`

**Expect** a non-zero exit code and exactly one failure,
`briefing.a-session-entry-that-does-not-fit-the-budget-carries-the-clip-marker`, reporting

    AssertionError [ERR_ASSERTION]: the briefing must be searched down into its character budget

with `false !== true`, because a limit the search cannot lower leaves the render above 12000
characters.

**Restore.** Reverse the edit exactly.

### 7.8 Criterion 7 — the argument is refused

**Mutate.** In `src/server/tools/park_thread.ts`, FIND:

```ts
  next_step: z
```

REPLACE with:

```ts
  last_session: z
    .string()
    .max(caps.SPINE_LAST_SESSION_MAX)
    .optional()
    .describe('replaces the spine last_session field when supplied; omit to leave it unchanged'),
  next_step: z
```

**Run.** `node --test --experimental-strip-types test/spawn/resume.test.ts`

**Expect** a non-zero exit code and exactly one failure, `park.refuses-a-last-session-argument`,
reporting

    AssertionError [ERR_ASSERTION]: park_thread must no longer publish a last_session argument

    true !== false

**Restore.** Reverse the edit exactly. `  next_step: z` occurs once in the file both before and after
the mutation.

### 7.9 Criterion 9 — one definition of the boundary actor

**Mutate.** In `src/domain/session-log.ts`, FIND:

```ts
export const PARK_THREAD_ACTOR = 'logbook:park_thread'
```

REPLACE with:

```ts
export const PARK_THREAD_ACTOR = 'logbook:parked'
```

**Run.** `node --test --experimental-strip-types test/unit/session-log.test.ts`

**Expect** a non-zero exit code and exactly one failure,
`session-log.the-park-actor-is-the-one-park_thread-writes`, reporting

    AssertionError [ERR_ASSERTION]: Expected values to be strictly equal

**Restore.** Reverse the edit exactly.

**What this mutation does and does not prove, stated plainly.** It proves the constant's value is
asserted rather than assumed. It cannot prove "there is only one copy", because after step B4 both the
writer and the reader take the value from this one declaration, so changing it moves them together and
the end-to-end test still passes — which is the property, not a gap. The count itself is checked by running
`grep -rn "logbook:park_thread" src`, which after part B exits `0` and prints exactly one line, naming
`src/domain/session-log.ts`. Measured against the tree today, before part B, the same command exits `0`
and prints exactly one line, naming `src/server/tools/park_thread.ts:283`.

### 7.10 Criterion 8 — the reply enum is narrowed

**Mutate.** In `src/server/tools/park_thread.ts`, FIND:

```ts
    .array(z.enum(['next_step']))
```

REPLACE with:

```ts
    .array(z.enum(['last_session', 'next_step']))
```

**Run.** `node --test --experimental-strip-types test/spawn/resume.test.ts`

**Expect** a non-zero exit code and exactly one failure, `park.refuses-a-last-session-argument`,
reporting

    AssertionError [ERR_ASSERTION]: park_thread must publish next_step as the only spine field its reply can report
    + actual - expected

      [
    +   'last_session',
        'next_step'
      ]

**Restore.** Reverse the edit exactly.

### 7.11 Criterion 8 — the published description stops claiming the field

**Mutate.** In `src/server/tools/park_thread.ts`, FIND:

```ts
it writes the session log entry, refreshes the next_step field, and releases the record of what is being worked. The last_session field is no longer accepted here; it is derived from the session log. Send the outcome as text plus the next step;
```

REPLACE with:

```ts
it writes the session log entry, refreshes the last_session and next_step fields, and releases the record of what is being worked. Send the outcome as text plus either of those two fields;
```

**Run.** `node --test --experimental-strip-types test/contract/published-schema.test.ts`

**Expect** a non-zero exit code and three failures, of which the narrowest is
`contract.published-schema-matches-enforced.claims.park-thread-summary-fields-are-reachable`
(`test/contract/published-schema.test.ts:459`), reporting

    AssertionError [ERR_ASSERTION]: Got unwanted exception.
    Actual message: "census halted on an unclassifiable item: {"tool":"park_thread","description":"Ends work
    on the thread being worked right now, in a single call: it writes the session log entry, refreshes the
    last_session and next_step fields, ...","phrase":"refreshes the next_step field","providers":["park_thread.next_step"]}"

The census halts because step B6's registered phrase is no longer present in the description, which is
the census working as designed rather than a gap in it.

**Restore.** Reverse the edit exactly.

---

## 8. Full verification

Run every command from the repository root, in this order, for each part.

| # | Command | Expected exit code | Output substring that proves it |
| --- | --- | --- | --- |
| 1 | `npx tsc -p tsconfig.json --noEmit` | 0 | no output at all |
| 2 | `node scripts/check-packaging.mjs` | 0 | the single line `check-packaging: ok` |
| 3 | `node --test --experimental-strip-types test/unit/session-log.test.ts` | 0 | `ℹ pass 7` and `ℹ fail 0` |
| 4 | `node --test --experimental-strip-types test/unit/briefing-last-session.test.ts` | 0 | `ℹ pass 6` and `ℹ fail 0` |
| 4b | `node --test --experimental-strip-types test/unit/briefing.test.ts` | 0 | `ℹ tests 22`, `ℹ pass 22` and `ℹ fail 0` |
| 5 | `node --test --experimental-strip-types test/contract/render-census.test.ts` | 0 | `✔ render.no-unescaped-site` and `ℹ fail 0` |
| 6 | `node --test --experimental-strip-types "test/contract/**/*.test.ts"` | 0 | `ℹ fail 0` |
| 7 | `node --test --experimental-strip-types test/spawn/resume.test.ts` | 0 | `ℹ fail 0`, with `ℹ tests 24` for part A and `ℹ tests 25` for part B |
| 8 | `npm test` | 0 | `ℹ fail 0` |

**Two kinds of row, distinguished because they are read differently.** Rows 3, 4, 4b and 7 run test
files this plan creates or modifies; they are where this unit's own behaviour is proved. Rows 5 and 6
run test files this plan does not touch at all — they are regression guards over two shipped censuses
this unit could halt without meaning to: the render census, because this unit adds interpolated values
to a censused file, and the published-claim census, because part B changes a published description. A
guard that never goes red still earns its row; a reader who mistakes it for a receipt does not.

Rows 3, 4 and 4b apply to both parts: part A creates the two new files and updates the golden one, and
part B must leave all three green. **Row 4b is not optional.** Two golden whole-output assertions in
that file render a thread that takes this unit's legacy branch, so without edits T5 and T6 it reports
`ℹ tests 22, ℹ pass 20, ℹ fail 2, exit 1` and `npm test` in row 8 goes red on two tests that are not
the one tracked flake — which stop condition 11.10 then halts on, correctly.

**Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository and an install
rewrites tracked files.

Command 8 is the full-suite gate, and it carries this rule:

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

That re-run governs command 8 only. It is not part of any acceptance criterion, it is not part of any
receipt, and it is not part of section 6. It is restated as stop condition 11.10.

---

## 9. Commits

Refactor and behaviour change never share a commit. Part A contains no refactor. Part B contains
exactly one — step B4 replaces a string literal with an imported constant of the identical value, so
no behaviour changes — and it gets its own commit, ahead of the behaviour change that depends on it.

### Part A, on `feat/u8-derived-last-session-a`

**Commit A1** — `chore(briefing): bump the plugin version for the derived last session`

Files: `package.json`, `.claude-plugin/plugin.json`. Contains step A1.

**Commit A2** — `feat(briefing): derive the last session from the previous session log entries`

Files: `src/domain/session-log.ts`, `src/render/briefing.ts`, `src/server/tools/resume_thread.ts`,
`test/unit/session-log.test.ts`, `test/unit/briefing-last-session.test.ts`,
`test/unit/briefing.test.ts`, `test/spawn/resume.test.ts`. Contains steps A2, A3, A4, A5, A6 and test
edits T1, T5 and T6. Edits T5 and T6 belong in this commit and no earlier one: they are red without
the production change and green with it.

### Part B, on `feat/u8-derived-last-session-b`

**Commit B1** — `chore(park-thread): bump the plugin version for the removed argument`

Files: `package.json`, `.claude-plugin/plugin.json`. Contains step B1.

**Commit B2** — `refactor(park-thread): stamp the park entry from the shared boundary constant`

Files: `src/server/tools/park_thread.ts`. Contains step B4 and nothing else. The stored value is
identical before and after, so the suite is green at this commit without any test change.

**Commit B3** — `feat(park-thread): stop accepting a hand-written last session`

Files: `src/server/tools/park_thread.ts`, `test/support/published.ts`, `test/spawn/resume.test.ts`.
Contains steps B2, B3, B5, B6 and test edits T2, T3 and T4.

---

## 10. Pull request

### 10.1 The split, decided here and measured

Measured by applying this plan's own blocks to a throwaway copy of the tree in the session scratchpad —
a copy of `main` carrying the item-completeness unit's whole-file renderer and its clip module — and
reading `git diff --numstat`. Never estimated.

| Cut | Changed lines | Production | Test | Version manifests |
| --- | --- | --- | --- | --- |
| Unsplit | 423 | 82 | 337 | 4 |
| **U8-A** | **358** | 64 | 290 | 4 |
| **U8-B** | **69** | 18 | 47 | 4 |

The two parts sum to 427 rather than 423 because each bumps the version, which is four lines counted
twice. Both figures are two lines higher than an earlier measurement of this plan, which is edits T5
and T6: two inserted lines, no deletion.

**Ruled: split.** Unsplit the unit is 423 changed lines against a 400-line ceiling. The exception the
ceiling allows applies only where splitting would destroy a red-on-parent receipt, and it does not
apply here: section 6 shows each part reaching its own red at its own parent — part A through two
end-to-end tests that compile and run there, part B through one. Both parts are then under the ceiling
with room to spare.

**The order is not reversible.** Part A must land first, because part B removes the hand-written write
and the SPEC's section 10 attaches to this unit the risk that a spine field is dropped before its
replacement exists. Shipping B first would widen the stale window that divergence 3.4 describes;
shipping A first closes it.

**Rejected:** splitting the derivation itself into a rendering half and a wiring half. The rendering
half would have no reachable behaviour and therefore no red at its parent, which is the exact case the
ceiling's exception exists to protect.

### 10.2 Part A

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u8-derived-last-session-a --base main \
  --title "feat(briefing): derive the last session from the session log" \
  --what "The Last session section of a resumption briefing now lists the previous session's log entries, newest first, each with the identifier that reaches the entry itself." \
  --what "A thread with no session log entries still shows its stored hand-written summary, on a line that says it is a legacy value." \
  --what "A thread with neither entries nor a stored summary shows no Last session section at all, where before it showed nothing under a heading it still printed." \
  --why "Nothing refreshed the stored summary, so it was only as current as the last person who remembered to type it, and the end-of-session step meant to type it never passed the field." \
  --why "The entries describing the previous session were already recorded and already addressable, so the summary was being stored by hand when it could be derived." \
  --risk "A briefing for a thread with a long session log now carries more text, so the size search that fits a briefing into its budget shortens more values than before; every shortened value ends with the marker that says so." \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok" \
  --verified "node --test test/unit/session-log.test.ts - 7 pass, 0 fail" \
  --verified "node --test test/unit/briefing-last-session.test.ts - 6 pass, 0 fail" \
  --verified "node --test test/unit/briefing.test.ts - 22 pass, 0 fail" \
  --verified "node --test test/spawn/resume.test.ts - 24 pass, 0 fail" \
  --verified "node --test test/contract/render-census.test.ts - render.no-unescaped-site passed, 0 fail" \
  --verified "npm test - 0 fail" \
  --not-verified "the derived section against a real project store - not run; every test drives a fixture store in a temporary directory"
```

Expect exit code `0` and a printed pull request URL beginning `https://github.com/SatanshuMishra/logbook/pull/`.
A non-zero exit code means the tool rejected a field value: read the rejection, correct that one value,
and run it again. Never fall back to another way of opening a pull request.

Diff size, which the implementer states from the value it measured: 358 changed lines, 64 production
and 290 test, plus 4 lines of version manifest. Under the reviewable ceiling; no exception claimed.

### 10.3 Part B

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u8-derived-last-session-b --base main \
  --title "feat(park-thread): stop accepting a hand-written last session" \
  --what "park_thread no longer accepts a last_session argument, and a call that still sends one is refused with a message naming that field." \
  --what "The reply from park_thread can now report only next_step as a changed summary field, and its published description no longer claims it refreshes the last session." \
  --why "The last session summary is now built from the session log, so a second hand-written copy of it could only ever disagree with the derived one." \
  --risk "This is a breaking change to a published tool contract: a caller outside this repository that sends last_session to park_thread will start receiving a refusal and must drop the argument." \
  --verified "npx tsc -p tsconfig.json --noEmit - exit 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "node --test test/spawn/resume.test.ts - 25 pass, 0 fail" \
  --verified "node --test over test/contract - 0 fail" \
  --verified "npm test - 0 fail" \
  --not-verified "callers outside this repository - not run; no inventory of external callers exists"
```

Expect exit code `0` and a printed pull request URL beginning `https://github.com/SatanshuMishra/logbook/pull/`.
A non-zero exit code means the tool rejected a field value: read the rejection, correct that one value,
and run it again. Never fall back to another way of opening a pull request.

Diff size, which the implementer states from the value it measured: 69 changed lines, 18 production and
47 test, plus 4 lines of version manifest. Well under the reviewable ceiling.

### 10.4 Rules that bind both

- The pull request is opened only through `node ~/.claude/lib/git/pr.mjs pr-create`. Ad-hoc
  `gh pr create`, `gh api` POSTs to the pulls endpoint and the GitHub tool that creates pull requests
  are denied at the gate.
- A title and body are fixed at creation. Never run `gh pr edit`.
- Never write a `--verified` line for a check that was not run. A check that was not run is
  `--not-verified "<thing> - not run"`; a check whose result was not read is
  `--not-verified "<thing> - result not read"`. Substitute the real numbers you observed for the ones
  above, and drop any `--verified` line whose check you did not run.
- Merging is human-gated. Do not merge.

---

## 11. Stop conditions

Each names what the implementer sees, the exact command that shows it, and what to do.

### 11.1 The item-completeness unit's first part has not landed

Run:

```
grep -c "LANE_A_RISKS_MAX\|currentCriterionId" src/render/briefing.ts
```

Expect `0`, with the command exiting `1` because `grep -c` exits `1` when it counts zero. Any other
number, with exit code `0`, means the display-time item caps or the guessed current criterion are still
in the file, so every FIND string in section 4 that touches `src/render/briefing.ts` was written
against a file that does not exist yet. STOP and report; do not improvise.

### 11.2 The item-completeness unit's second part has not landed

Run:

```
grep -c "clipWithMarker" src/render/clip.ts
```

Expect a number of at least `1`, with the command exiting `0`. An exit code of `2` with
`No such file or directory` means `src/render/clip.ts` does not exist, so the shared clip helper this
unit's rendered lines depend on has not shipped. STOP and report; do not improvise.

### 11.3 The item-completeness unit's third part has not landed

Run:

```
grep -c "renderCriterionBlock\|artifactPointer" src/render/briefing.ts
```

Expect a number of at least `2`, with the command exiting `0`. Measured `6` against the reconstruction
this plan was authored on. A smaller number, or exit code `1`, means the renderer is not in the state
edits A3.1 to A3.10 and step A4 were written against. STOP and report; do not improvise.

### 11.4 The capture unit has not landed

Run:

```
grep -c "last_session" skills/debrief/SKILL.md
```

Expect `0`, with the command exiting `1` because `grep -c` exits `1` when it counts zero. Any other
number means the end-of-session skill still passes a field this unit is about to derive, and the two
would disagree. STOP and report; do not improvise.

### 11.5 Part B's parent does not contain part A

Before starting any step numbered `B`, run:

```
grep -c "previousSessionEntries" src/render/briefing.ts
```

Expect a number of at least `1`, with the command exiting `0`. Measured `2` against the tree part A
leaves. `0` with exit code `1` means part A has not merged, and removing the hand-written write before
its replacement exists is the exact risk this unit was ordered to avoid. STOP and report; do not
improvise.

### 11.6 The two version manifests disagree with each other

Run:

```
node -p "require('./package.json').version"
node -p "require('./.claude-plugin/plugin.json').version"
```

Expect exit code `0` from each, and expect the two to print the same string. If they differ, STOP and
report; do not improvise. A version merely HIGHER than the baseline this plan names is NOT a stop
condition — it means the ladder shifted, and the read-then-increment in steps A1 and B1 absorbs that
without any change to this plan.

### 11.7 A FIND string does not match

Before applying each edit, take the first line of that edit's FIND block, and run, with `<line>` and
`<file>` substituted:

```
grep -c -F -- '<line>' <file>
```

Expect `1`, with the command exiting `0`. `0` with exit code `1` means the FIND block is not in the
file. Any number above `1` means it is not unique. In either case STOP and report; do not improvise,
and do not adjust the FIND string to make it match.

Two edits take a different first line, because theirs begins with whitespace that `grep -F` still
matches exactly: edit A3.5's is `  criterionResult: number` and edit B3.1's is
`  spine_fields_updated: z`. Both are checked the same way.

### 11.8 A test outside this plan's list was touched

After the last step of a part, run:

```
git diff --name-only main -- test/
```

For part A expect exactly these four paths and no others:

```
test/spawn/resume.test.ts
test/unit/briefing-last-session.test.ts
test/unit/briefing.test.ts
test/unit/session-log.test.ts
```

For part B expect exactly these two and no others:

```
test/spawn/resume.test.ts
test/support/published.ts
```

Any other path means a test this plan does not name was changed. STOP and report; do not improvise.

### 11.9 The render census halts

Run:

```
node --test --experimental-strip-types test/contract/render-census.test.ts
```

Expect exit code `0`. A failure naming `src/render/briefing.ts` and an expression from this unit's new
lines means the census cannot prove one of those values is escaped. STOP and report; do not improvise,
and in particular do not add the new expression to any allowlist.

### 11.10 The suite is red for anything other than the one tracked failure

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

### 11.11 A test would have to be weakened to go green

After the last step of a part, run:

```
grep -rn "\.skip(\|\.only(\|\.todo(" test/
```

Expect no output and exit code `1`. Any output means a test was skipped, focused or marked to-do, all
of which are forbidden here.

Then run:

```
git diff main -- test/ | grep -c "^-.*assert\."
```

For part A expect `0`, with the command exiting `1` because `grep -c` exits `1` when it counts zero:
part A deletes no assertion. For part B expect `4`, with the command exiting `0`: edit T2 removes the
four assertions of `park.refreshes-the-spine` that named the removed argument and replaces them, which
section 5.3 gives in full. Any other number means an assertion this plan does not replace was removed.
STOP and report; do not improvise.

One shipped test is explicitly replaced and it is named: `park.refreshes-the-spine` at
`test/spawn/resume.test.ts:543-572`, replaced by edit T2, which asserts the same surrounding property —
that a park call touches nothing it was not asked to touch. Nothing else is touched.

---

## 12. Per-pull-request execution

Two blocks. Each is executable start to finish and references no other block.

### 12.A — `feat/u8-derived-last-session-a`, the briefing derives the last session

**Branch.** Cut `feat/u8-derived-last-session-a` from the current tip of `main`.

**Before any edit,** run the stop conditions in sections 11.1, 11.2, 11.3, 11.4 and 11.6 and act on
each as written. Section 11.7 is run once per edit, immediately before that edit is applied.

**Version step.** Section 4 step A1, in full: read `package.json`'s version, confirm
`.claude-plugin/plugin.json` prints the same string, increment MINOR and set PATCH to `0`, write the
new value into both files, and run `node scripts/check-packaging.mjs` expecting exit code 0 and the
single line `check-packaging: ok`. The Conventional Commits type is `feat`.

**Steps, in order.** A1, A2, A3 (edits A3.1 through A3.10), A4, A5 (edits A5.1 through A5.3), A6.

**Tests.** Create `test/unit/session-log.test.ts` in full from section 5.1. Create
`test/unit/briefing-last-session.test.ts` in full from section 5.2. Apply test edit T1 from section 5.3
to `test/spawn/resume.test.ts`. Apply test edits T5 and T6 from section 5.4 to
`test/unit/briefing.test.ts`; without them that file reports two failures and the full-suite gate goes
red.

**Red on the parent.** Section 6.1. On the parent, with only test edit T1 applied,
`node --test --experimental-strip-types test/spawn/resume.test.ts` exits non-zero with `ℹ fail 2` and

    AssertionError [ERR_ASSERTION]: the briefing must carry a Last session heading

    AssertionError [ERR_ASSERTION]: with no session log entries the stored text must render, marked as legacy

The two unit test files do not compile on the parent and are not run there; section 6.1 states that
plainly and section 7 supplies their proof instead.

**Inertness mutations.** Sections 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7 and 7.9. Apply each, run its named
command, confirm its named failure, then restore exactly.

**Full verification.** Section 8, rows 1, 3, 4, 4b, 5, 6, 7 and 8. Row 4b expects `ℹ tests 22` and
`ℹ fail 0`. Row 7 expects `ℹ tests 24` and `ℹ fail 0`. Row 8 carries the full-suite rule quoted in
section 11.10. Never run `npm ci` or
`npm install`.

**Commits.** Section 9, commits A1 and A2.

**Pull request.** Section 10.2, with `--verified` lines kept only for checks that were actually run and
their real numbers substituted. Do not merge.

**Stop conditions.** Before starting, sections 11.1, 11.2, 11.3, 11.4 and 11.6. Before each individual
edit, section 11.7. After the last step, sections 11.8, 11.9, 11.10 and 11.11.

### 12.B — `feat/u8-derived-last-session-b`, `park_thread` stops accepting the field

**Branch.** Cut `feat/u8-derived-last-session-b` from a tip of `main` that already contains
`feat/u8-derived-last-session-a`. Confirm the content arrived rather than trusting a merged status, by
running with part A's merged head substituted for the placeholder:

```
git merge-base --is-ancestor <the merged head of part A> origin/main
```

Expect exit code 0. A non-zero exit code means part A's content is not on `main` whatever the pull
request status says: STOP and report; do not improvise.

**Before any edit,** run the stop conditions in sections 11.5 and 11.6 and act on each as written.
Section 11.7 is run once per edit, immediately before that edit is applied.

**Version step.** Section 4 step B1, in full: read `package.json`'s version, confirm
`.claude-plugin/plugin.json` prints the same string, increment MAJOR and set MINOR and PATCH to `0`,
write the new value into both files, and run `node scripts/check-packaging.mjs` expecting exit code 0
and the single line `check-packaging: ok`. The Conventional Commits type is `feat`; the MAJOR bump is
because removing an accepted
argument from a tool published over the Model Context Protocol turns a call that succeeds today into a
refusal.

**Steps, in order.** B1, B4 (edits B4.1 and B4.2), B2, B3 (edits B3.1 and B3.2), B5, B6. Step B4 moves
ahead of the rest because it is the part's only refactor and commit B2 carries it alone.

**Tests.** Apply test edits T2, T3 and T4 from section 5.3 to `test/spawn/resume.test.ts`, in that
order.

**Red on the parent.** Section 6.2. On the parent, with only test edit T3 applied,
`node --test --experimental-strip-types test/spawn/resume.test.ts` exits non-zero with `ℹ fail 1` and

    AssertionError [ERR_ASSERTION]: park_thread must no longer publish a last_session argument

    true !== false

**Inertness mutations.** Sections 7.8, 7.9, 7.10 and 7.11. Apply each, run its named command, confirm
its named failure, then restore exactly.

**Full verification.** Section 8, rows 1, 2, 3, 4, 4b, 5, 6, 7 and 8. Row 4b expects `ℹ tests 22` and
`ℹ fail 0`. Row 7 expects `ℹ tests 25` and `ℹ fail 0`. Row 8 carries the full-suite rule quoted in
section 11.10. Never run `npm ci` or
`npm install`.

**Commits.** Section 9, commits B1, B2 and B3.

**Pull request.** Section 10.3, with `--verified` lines kept only for checks that were actually run and
their real numbers substituted. Do not merge.

**Stop conditions.** Before starting, sections 11.5 and 11.6. Before each individual edit, section
11.7. After the last step, sections 11.8, 11.9, 11.10 and 11.11.
