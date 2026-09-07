# Continuity Recording Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A thread states what the work is and what happens next before it can record anything, every criterion records who stands behind it, and each actor records what it established at the moment it stops rather than at a hand-off that may never run.

**Architecture:** Add two fields to the criterion — a required settledness enum and a nullable verbatim quote — declared on the create and insert paths and answered on `update_thread`. Invert the `open_thread` contract so the goal and the next step are required and criteria are optional. Replace the Stop gate's presence check with a pair of gates, at `Stop` and at `SubagentStop`, that fire when the ledger head has not moved and present the recording assertions the spec fixes.

**Tech Stack:** TypeScript on Node with native type stripping, `zod` v4 for schemas, `node:test` for tests, git as the durable store.

**Spec:** `docs/specs/2026-09-06-continuity-recording-model.md` — read it before starting any task. This plan argues from it and does not restate its reasoning. It cites the spec's definitions as `C-n`, its assertions as `R-n`, its invariants as `A`/`O`/`S`, and its behavioural rules as `B-n`.

## Global Constraints

- **Never author a code comment.** Not explanatory, not a docstring, not a section header. This is absolute.
- **No emojis** anywhere — code, commits, PR bodies, skill text.
- **No AI attribution** in any commit message or PR body.
- **Immutability:** build new objects; never mutate an existing one in place.
- **`node_modules` is vendored and tracked.** Never run `npm install` or `npm ci` — it rewrites tracked files and leaves the suite red.
- **Test command:** `npm test`. Typecheck: `npm run typecheck`. Never pass `--experimental-test-coverage`: it injects `NODE_V8_COVERAGE` and the closed spawn-env census refuses it.
- **Test naming:** a flat `test('<area>.<behaviour-in-kebab-case>', ...)`. No `describe()`, no spaces in the name.
- **Merge, never rebase.** Integrating a moved parent branch is a merge.
- **Every PR goes through** `node ~/.claude/lib/git/pr.mjs pr-create`. Ad-hoc `gh pr create` is denied at the gate.
- **Field classes:** every new schema field is wrapped in `content(...)`, `structural(...)`, or built with `pointer(max, description)` from `src/schema/field-class.ts`. A field with no class fails the field-class census at `test/unit/field-class.test.ts:41-48`.
- **Caps refuse, they never truncate.** A new capped field adds its constant to `src/schema/caps.ts` and its role to `CAP_ROLES` in `test/unit/caps-census.test.ts:14-56`.
- **The criterion shape is declared twice.** A hand-written TypeScript type at `src/schema/thread.ts:12-22` and a Zod object at `:58-100`, bound by a cast at `:220` rather than inferred. Both must be edited and nothing forces them to agree.
- **Two version series move together.** `package.json:3` and `.claude-plugin/plugin.json:3` are kept byte-identical. Read both rather than trusting a remembered value: this branch carries `6.0.0` and `origin/main` has since released `6.1.0`.

---

## The decomposition

Every spec unit belongs to exactly one MSP. A minimum shippable product is one pull request that leaves the branch it lands on working.

| Spec unit | What it is | MSP | Wave |
|---|---|---|---|
| U1 | schema fields, the cap, the legacy read, cardinality | MSP-1 | 1 |
| U2 | the goal and the next step become required, criteria optional | MSP-1 | 1 |
| U3 | settledness on the create and insert paths | MSP-1 | 1 |
| U5 | the renderer | MSP-1 | 1 |
| U7 | both recording gates | MSP-2 | 1 |
| U4 | the settledness update path | MSP-3 | 2 |
| U6 | the relay and close reporting | MSP-3 | 2 |
| U9 | the three new invariant censuses | MSP-4 | 2 |
| U8 | the `file` skill | MSP-5 | 3 |
| U10 | the agent roster grant | MSP-6 | external |

| MSP | Name | Branch | Base | Version after |
|---|---|---|---|---|
| MSP-1 | the criterion gains settledness | `feat/criterion-settledness` | `main` | `7.0.0` |
| MSP-2 | the recording gates | `feat/recording-gates` | `main` | unchanged |
| MSP-3 | the settledness answer path | `feat/settledness-answer-path` | `main` after MSP-1 | `8.0.0` |
| MSP-4 | the three new invariant censuses | `test/recording-model-invariants` | `main` after MSP-1 | unchanged |
| MSP-5 | the `file` skill | `feat/file-skill` | `main` after MSP-3 | unchanged |
| MSP-6 | the agent roster grant | outside this repository | — | — |

### Two departures from the sketch recorded in the session log, and why

**No unit is split across MSPs.** The sketch put part of the gate work in one MSP and the rest in another, and split the relay from the close-time reporting the same way. Both splits are dropped. A unit split across two MSPs cannot satisfy the thread's first completion criterion, which requires every unit to appear in exactly one MSP, and the gate split was drawn to avoid two agents editing `src/hooklib/stop-gate.ts` at once — a problem that disappears when both gates are one branch rather than two.

**Census repair is not deferred and is not a unit.** Every table that halts on a new field or argument is repaired inside the MSP that changes it, because a branch that leaves one red is not shippable. What remains for its own MSP is the three genuinely new censuses the spec asks for, which assert properties rather than repairing tables, and which can only be written once the code they assert exists.

### Wave 1 runs two agents in parallel, and they are file-disjoint

MSP-1 owns `src/schema/`, `src/server/tools/open_thread.ts`, `src/server/tools/amend_criteria.ts`, `src/render/briefing.ts`, `src/server/resource-render.ts` and their tests. MSP-2 owns `src/hooklib/`, `hooks/`, `test/fixtures/hook-events/`, `test/hooks/` and `src/server/tools/resume_thread.ts`. The single shared risk is `test/support/published.ts`, which MSP-2 does not touch because it publishes no new tool argument.

Give each agent its own git worktree anyway. Two agents in one checkout branch-switch under each other whatever the file split says.

---
## Parent state

`3c2932f7` on `docs/continuity-recording-model`, which holds the spec and nothing else. Verified at that commit: `npm test` exit 0, 850 tests, 850 pass, 0 fail, 0 skipped; `npm run typecheck` exit 0 with no output. `origin/main` is at `ade6b607`, two commits ahead of the local `main`, and carries a release to `6.1.0` — so read the two version files rather than trusting a remembered number, and merge `origin/main` into this branch before cutting any MSP branch from it.

---

# MSP-1 — the criterion gains settledness

**Ships:** a criterion that records who stands behind it, an `open_thread` that demands the goal and the next step and accepts no criteria at all, and a renderer that shows both.

**Branch:** `feat/criterion-settledness` from `main`.

**Why these four units are one pull request.** `test/contract/content-rendered.test.ts:206-216` plants a sentinel in every schema field classed `content` and fails unless it surfaces through a render call. The settledness quote is classed `content` by the spec, so declaring the field turns the suite red until a renderer emits it — the schema and the renderer cannot be separate pull requests. The create path joins them because a stored schema that requires settledness while nothing writes it means every newly opened thread carries a criterion the record rejects. The formation change joins them because it edits the same tool's input schema, forces the same three census repairs, and would otherwise cost a second major version for one file.

## Task 1: the criterion schema carries settledness

**Files:**
- Modify: `src/schema/thread.ts:10-22` (the hand-written `Criterion` type), `:58-100` (`CriterionSchema`)
- Modify: `src/schema/caps.ts` (one new constant)
- Modify: `src/store/records.ts:46-80` (`validateChange`)
- Modify: `test/unit/caps-census.test.ts:14-56` (`CAP_ROLES`)
- Test: `test/unit/thread-schema.test.ts`

**Interfaces:**
- Produces: `export type Settledness = 'confirmed' | 'proposed' | 'unsettled'` from `src/schema/thread.ts`. Every later task imports this name.
- Produces: `Criterion` gains `settledness: Settledness` and `settled_by: string | null`.
- Produces: `export const CRITERION_SETTLED_BY_MAX = 500` from `src/schema/caps.ts`.

**The shape, and why it is not a plain required field.** Rule `B48` wants two things that pull apart: a record written before this change must still parse, and no write path may produce a criterion with no settledness. A single required field breaks the first. A single optional field breaks the second. So the stored schema accepts the field as absent and fills `proposed` on read, and the write path grows an explicit presence check that refuses. The read substitution is the legacy path only; the check is what stops it becoming a silent default, which `C-5` forbids.

- [ ] **Step 1: Write the failing tests**

In `test/unit/thread-schema.test.ts`:

```ts
test('thread-schema.criterion-with-no-settledness-reads-as-proposed', () => {
  const stored = threadFixture()
  const raw = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
  const criteria = raw.completion_criteria as Record<string, unknown>[]
  delete criteria[0].settledness

  const parsed = ThreadRecord.parse(raw)

  assert.equal(parsed.ok, true, 'a record written before this field existed must still parse')
  if (parsed.ok) {
    assert.equal(
      parsed.value.completion_criteria[0].settledness,
      'proposed',
      'a stored criterion with no settledness reads as proposed, because nobody declared who stood behind it'
    )
  }
})

test('thread-schema.criterion-settledness-refuses-an-unknown-value', () => {
  const stored = threadFixture()
  const raw = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
  const criteria = raw.completion_criteria as Record<string, unknown>[]
  criteria[0].settledness = 'probably'

  const parsed = ThreadRecord.parse(raw)

  assert.equal(parsed.ok, false, 'settledness is a closed set of three values and a fourth is refused')
})

test('thread-schema.settled-by-refuses-past-its-cap', () => {
  const stored = threadFixture()
  const raw = JSON.parse(JSON.stringify(stored)) as Record<string, unknown>
  const criteria = raw.completion_criteria as Record<string, unknown>[]
  criteria[0].settled_by = 'x'.repeat(caps.CRITERION_SETTLED_BY_MAX + 1)

  const parsed = ThreadRecord.parse(raw)

  assert.equal(parsed.ok, false, 'a capped field refuses rather than truncating')
  if (!parsed.ok) {
    assert.ok(
      parsed.message.includes(String(caps.CRITERION_SETTLED_BY_MAX)),
      `the refusal must name the numeric limit, got: ${parsed.message}`
    )
  }
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/unit/thread-schema.test.ts`
Expected: all three FAIL. The first two because `settledness` is not a declared property and the non-strict `z.object` ignores it, so nothing is filled and nothing is refused; the third because `caps.CRITERION_SETTLED_BY_MAX` does not exist and the file will not typecheck.

- [ ] **Step 3: Add the cap and its role**

In `src/schema/caps.ts`, beside `CRITERION_CHECK_MAX`:

```ts
export const CRITERION_SETTLED_BY_MAX = 500
```

In `test/unit/caps-census.test.ts`, inside `CAP_ROLES`:

```ts
  CRITERION_SETTLED_BY_MAX: 'record-field',
```

The census at `:58-67` halts on the first constant with no role, so this is not optional and cannot be deferred.

- [ ] **Step 4: Declare the fields**

In `src/schema/thread.ts`, beside `ResultStatus` at `:10`:

```ts
export type Settledness = 'confirmed' | 'proposed' | 'unsettled'
```

In the `Criterion` type at `:12-22`, two new members:

```ts
  settledness: Settledness
  settled_by: string | null
```

In `CriterionSchema` at `:58-100`, two new properties. `settledness` is `structural` because it says which party stands behind the statement rather than carrying content a reader needs quoted; `settled_by` is `content` because it carries the human's own words:

```ts
    settledness: structural(
      z
        .enum(['confirmed', 'proposed', 'unsettled'])
        .default('proposed')
        .describe(
          'who stands behind this criterion: confirmed when the human stated or agreed it, proposed when the model derived it, unsettled when done is genuinely not known for this part yet'
        )
    ),
    settled_by: content(
      z
        .string()
        .max(caps.CRITERION_SETTLED_BY_MAX)
        .nullable()
        .describe('the human words behind a confirmed criterion, quoted verbatim, and null on any other settledness')
    ),
```

`.default('proposed')` is what makes a legacy record parse. It fires only when the key is absent, which after Step 5 can only happen for a record written before this change.

- [ ] **Step 5: Refuse a write that omits it**

In `src/store/records.ts`, inside `validateChange` at `:46-80`, before the record is handed to `ThreadRecord.parse`. Checking the raw record rather than the parsed one is the whole point: the schema default would otherwise fill the field and hide the omission.

```ts
const missingSettlednessRefusal = (criterionId: string): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: 'a settledness of confirmed, proposed or unsettled on every criterion',
  example: 'proposed',
  retryable: true,
  message: `criterion ${criterionId} carries no settledness; observed 0 entries; remedy: state who stands behind the criterion and retry.`
})
```

- [ ] **Step 6: Run the tests and watch them pass**

Run: `node --test test/unit/thread-schema.test.ts test/unit/caps-census.test.ts`
Expected: PASS.

- [ ] **Step 7: Prove the write-side check is load-bearing**

Add to `test/store/records.test.ts`:

```ts
test('records.write-refuses-a-criterion-carrying-no-settledness', () => {
  const thread = threadFixture()
  const stripped = {
    ...thread,
    completion_criteria: thread.completion_criteria.map(({ settledness, ...rest }) => rest)
  }

  const result = validateChange(stripped as unknown as Thread)

  assert.equal(result.ok, false, 'the read-time substitution exists for legacy records only; a write may never produce one')
})
```

Run: `node --test test/store/records.test.ts`
Expected: PASS. Then delete the refusal added in Step 5, re-run, and confirm this test turns red — a check that survives its own removal is testing nothing. Restore it.

- [ ] **Step 8: Commit**

```bash
git add src/schema/thread.ts src/schema/caps.ts src/store/records.ts test/unit/thread-schema.test.ts test/unit/caps-census.test.ts test/store/records.test.ts
git commit -m "feat: the criterion records who stands behind it"
```

## Task 2: `open_thread` asks what the work is, and stops demanding what done means

**Files:**
- Modify: `src/server/tools/open_thread.ts:25-48` (input schema), `:38-42` (the `min(1)`), `:108-109` (the published description), `:179-187` (the spine literal)
- Modify: `test/support/published.ts:63-70` (`PUBLISHED_CLAIMS` for `open_thread`)
- Modify: `test/support/optional-argument-recipes.ts:709-725` (`RECIPES`)
- Test: the existing `open_thread.spawn.contract` and `open_thread.rejects-invalid` files

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `open_thread` input gains required `active_goal: string` and `next_step: string`; `completion_criteria` becomes optional and accepts `[]`.

**Invariants:** `A8`, `A9`, `A10`.

- [ ] **Step 1: Write the failing tests**

```ts
test('open_thread.refuses-a-thread-with-no-active-goal', async () => {
  const reply = await callOpenThread({ title: 'a thread', slug: 'no-goal', next_step: 'read the spec' })

  assert.equal(reply.isError, true, 'a thread that does not say what the work is cannot be opened')
})

test('open_thread.refuses-a-whitespace-only-next-step', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'blank-next-step',
    active_goal: 'ship the recording model',
    next_step: '   '
  })

  assert.equal(reply.isError, true, 'a next step made only of spaces states nothing and is refused')
})

test('open_thread.accepts-a-thread-carrying-no-criteria', async () => {
  const withEmpty = await callOpenThread({
    title: 'a thread',
    slug: 'empty-criteria',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: []
  })
  const withAbsent = await callOpenThread({
    title: 'a thread',
    slug: 'absent-criteria',
    active_goal: 'ship the recording model',
    next_step: 'read the spec'
  })

  assert.equal(withEmpty.isError, undefined, 'an empty criteria array opens a thread')
  assert.equal(withAbsent.isError, undefined, 'an absent criteria argument opens a thread')
})

test('open_thread.writes-the-goal-and-the-next-step-into-the-spine', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'spine-populated',
    active_goal: 'ship the recording model',
    next_step: 'read the spec'
  })

  const thread = readThreadRecord(reply.structuredContent.thread_id)

  assert.equal(thread.spine.active_goal, 'ship the recording model', 'the goal a fresh session reads first is populated at open')
  assert.equal(thread.spine.next_step, 'read the spec', 'the next step a fresh session reads first is populated at open')
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/spawn/open-thread.test.ts`
Expected: the first two FAIL because unknown keys are refused by `z.strictObject` before any goal check exists; the third FAILS on `.min(1)`; the fourth FAILS because the spine is initialised to empty strings.

- [ ] **Step 3: Declare the two required inputs**

In `OpenThreadInputSchema` at `:25-48`. The `\S` pattern is what makes a whitespace-only value a refusal rather than an accepted blank, and it is not decorative in a second way: `test/contract/criteria-writers.test.ts:83-102` halts on any free-text string leaf absent from its disposition table, and returns `allowed` early for any string carrying a `pattern`. Drop the regex and that census stops the build.

```ts
  active_goal: z
    .string()
    .regex(/\S/)
    .max(caps.SPINE_ACTIVE_GOAL_MAX)
    .describe('what this thread is trying to achieve, in one or two sentences a fresh session can act on'),
  next_step: z
    .string()
    .regex(/\S/)
    .max(caps.SPINE_NEXT_STEP_MAX)
    .describe('the next action someone would take, naming the file and the place in it where the action involves one'),
```

- [ ] **Step 4: Make criteria optional and write the spine**

At `:38-42`, delete `.min(1)` and add `.optional()`. Change the description, which currently promises the opposite:

```ts
  completion_criteria: z
    .array(CriterionCreateSchema)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('what finishing looks like where that is already known; omit it and the definition of done is owed later'),
```

At `:179-187`, replace the two empty strings with the supplied values, leaving the other four spine fields as they are:

```ts
      spine: {
        active_goal: input.active_goal,
        next_step: input.next_step,
        landed: '',
        last_session: '',
        open_risks: [],
        key_decisions: [],
        out_of_scope: []
      },
```

The handler reads `input.completion_criteria ?? []` at every site that consumed it directly.

- [ ] **Step 5: Repair the published-claims census**

`test/support/published.ts:63-70` pins the phrase `A thread needs a one-line title, a short slug that is unique in this project, and at least one completion criterion` and fails when it stops being a substring of the live description. That promise is now false. Rewrite the description at `open_thread.ts:108-109` so its opening sentence reads:

> A thread needs a one-line title, a short slug that is unique in this project, what the work is, and what happens next.

and add a second sentence naming criteria as optional. Then replace the claim entry:

```ts
  open_thread: [
    {
      phrase:
        'A thread needs a one-line title, a short slug that is unique in this project, what the work is, and what happens next',
      providers: ['open_thread.title', 'open_thread.slug', 'open_thread.active_goal', 'open_thread.next_step']
    },
    {
      phrase: 'Completion criteria are optional at this moment',
      providers: ['open_thread.completion_criteria']
    }
  ],
```

Both phrases must appear byte-for-byte in the description. `test/contract/budget.test.ts:32-33` caps the whole description at 2048 bytes and its lead sentence at 200; measure before committing.

- [ ] **Step 6: Register the newly optional argument**

`test/contract/optional-arguments-are-absent.test.ts:78-82` throws `no registered sentinel builder for optional argument "..."` for any optional argument with no driving recipe. Add one for `open_thread.completion_criteria` in `test/support/optional-argument-recipes.ts:709-725`, following the shape of the recipe beside it, plus its `TEST_2_CASES` entry.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: exit 0 on both. Every other caller of `open_thread` in the test tree now needs the two new arguments, and the typecheck finds them.

- [ ] **Step 8: Commit**

```bash
git add src/server/tools/open_thread.ts test/support/published.ts test/support/optional-argument-recipes.ts test/spawn/open-thread.test.ts
git commit -m "feat: a thread states its goal and next step before it records"
```

## Task 3: settledness on the create and insert paths

**Files:**
- Modify: `src/server/tools/open_thread.ts:10-23` (`CriterionCreateSchema`) and its handler
- Modify: `src/server/tools/amend_criteria.ts:11-41` (input) and the insert branch at `:91-93`
- Test: `test/spawn/open-thread.test.ts`, `test/spawn/amend-criteria.test.ts`

**Interfaces:**
- Consumes: `Settledness` from `src/schema/thread.ts` (Task 1).
- Produces: both create paths take `settledness` required, `check` optional, `settled_by` optional, with the conditional rules enforced in the handler.

**Invariants:** `A11`, `A12`, `A14`, and the negative `A16`.

**Do not express the conditionals in the schema.** A Zod union emits `oneOf`/`anyOf` into the published JSON Schema, and two censuses return `unclassifiable` on exactly that — `test/contract/criteria-writers.test.ts:89` and the unwalked-subschema branch of `test/contract/described.test.ts:23-30`. Declare all three fields flat and refuse in the handler, which is the idiom `amend_criteria` already uses for its insert branch at `:52-66`.

**`A16` is the one to keep in mind while writing the refusals.** No refusal may fire on the settledness value alone. Each of the three reads it *together with* a companion field: a missing check, a missing quote, or a quote that should not be there. A branch reading only `settledness === 'unsettled'` and refusing is the shape that falsifies it.

- [ ] **Step 1: Write the failing tests**

```ts
test('open_thread.refuses-a-criterion-with-no-settledness', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'no-settledness',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: [{ text: 'the suite is green', check: 'npm test exits 0' }]
  })

  assert.equal(reply.isError, true, 'settledness is declared at creation and never derived')
})

test('open_thread.refuses-a-proposed-criterion-with-no-check', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'proposed-no-check',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: [{ text: 'the suite is green', settledness: 'proposed' }]
  })

  assert.equal(reply.isError, true, 'a proposed criterion asserts something, so something must decide it')
})

test('open_thread.accepts-an-unsettled-criterion-with-no-check', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'unsettled-no-check',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: [{ text: 'what counts as acceptable latency is not decided', settledness: 'unsettled' }]
  })

  assert.equal(reply.isError, undefined, 'an unsettled criterion asserts nothing, so there is no claim for a check to decide')
})

test('open_thread.refuses-a-confirmed-criterion-with-no-quote', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'confirmed-no-quote',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: [{ text: 'the suite is green', check: 'npm test exits 0', settledness: 'confirmed' }]
  })

  assert.equal(reply.isError, true, 'claiming the human confirmed a criterion costs typing their words')
})

test('open_thread.refuses-a-quote-on-a-criterion-nobody-confirmed', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'proposed-with-quote',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: [
      { text: 'the suite is green', check: 'npm test exits 0', settledness: 'proposed', settled_by: 'they said so' }
    ]
  })

  assert.equal(reply.isError, true, 'a quote on a criterion nobody confirmed attributes words to nobody')
})

test('open_thread.accepts-all-three-settledness-values', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'all-three-values',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: [
      { text: 'the suite is green', check: 'npm test exits 0', settledness: 'proposed' },
      { text: 'the gate fires', check: 'the stop-gate tests pass', settledness: 'confirmed', settled_by: 'it has to block' },
      { text: 'what counts as acceptable latency is not decided', settledness: 'unsettled' }
    ]
  })

  assert.equal(reply.isError, undefined, 'no call is ever refused because of the settledness value itself')
})
```

Write the same six against `amend_criteria` insert, substituting its argument names.

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/spawn/open-thread.test.ts test/spawn/amend-criteria.test.ts`
Expected: the first FAILS as accepted-and-ignored, the rest FAIL on the unknown key `settledness` being refused by `z.strictObject`.

- [ ] **Step 3: Declare the three fields on both create paths**

In `CriterionCreateSchema` at `open_thread.ts:10-23`, and the matching properties in `AmendCriteriaInputSchema` at `amend_criteria.ts:11-41`:

```ts
    settledness: z
      .enum(['confirmed', 'proposed', 'unsettled'])
      .describe(
        'who stands behind this criterion: confirmed when the human stated or agreed it, proposed when you derived it, unsettled when done is genuinely not known for this part yet'
      ),
    settled_by: z
      .string()
      .regex(/\S/)
      .max(caps.CRITERION_SETTLED_BY_MAX)
      .optional()
      .describe('the human words behind a confirmed criterion, quoted verbatim; refused on any other settledness'),
```

`check` on the create path becomes `.optional()`. Its description states the condition the handler enforces.

- [ ] **Step 4: Refuse in the handler**

Three factories, module level, beside the existing ones:

```ts
const checkOwedRefusal = (index: number, settledness: string): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: 'a check on every confirmed or proposed criterion',
  example: 'npm test exits 0',
  retryable: true,
  message: `completion_criteria[${index}] is ${settledness} and carries no check; a criterion that asserts something needs something to decide it; remedy: add a check, or record it as unsettled if done is not known for this part yet.`
})

const quoteOwedRefusal = (index: number): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: 'the human words behind a confirmed criterion, quoted verbatim',
  example: 'it has to block before the turn ends',
  retryable: true,
  message: `completion_criteria[${index}] is confirmed and carries no settled_by; remedy: quote what the human said, or record it as proposed.`
})

const quoteNotOwedRefusal = (index: number, settledness: string): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: 'settled_by only on a confirmed criterion',
  example: 'omit settled_by',
  retryable: true,
  message: `completion_criteria[${index}] is ${settledness} and carries a settled_by quote; remedy: drop the quote, or record the criterion as confirmed if the human really said it.`
})
```

Call them in the criterion loop that already raises `criterionTextCapRefusal` at `open_thread.ts:135-138`, and in the insert branch at `amend_criteria.ts:91-93`.

- [ ] **Step 5: Run the tests and watch them pass**

Run: `node --test test/spawn/open-thread.test.ts test/spawn/amend-criteria.test.ts`
Expected: PASS.

- [ ] **Step 6: Place the new arguments in both censuses**

`settledness` and `settled_by` are published input arguments on two tools. Each must be either a `PUBLISHED_CLAIMS` provider or an `ARGUMENT_GAPS` entry, and a gap reason that duplicates an existing one is `forbidden` at `test/support/published.ts:314`. Prefer claims: the description of both tools should say the criterion records who stands behind it, and the four addresses provide it.

- [ ] **Step 7: Run the full suite and commit**

Run: `npm test && npm run typecheck`

```bash
git add src/server/tools/open_thread.ts src/server/tools/amend_criteria.ts test/support/published.ts test/spawn/open-thread.test.ts test/spawn/amend-criteria.test.ts
git commit -m "feat: settledness is declared where a criterion is written"
```

## Task 4: both surfaces show settledness

**Files:**
- Modify: `src/render/briefing.ts:48-59` (natural maxima), `:81-110` (the criterion block), `:187-202` (`clipAt`), `:359-361` (the criteria section)
- Modify: `src/server/resource-render.ts` (`renderThreadDetail`)
- Modify: `test/unit/briefing.test.ts:175-228` and `:236-261` (both goldens)
- Test: `test/unit/briefing.test.ts`

**Interfaces:**
- Consumes: `Criterion.settledness` and `Criterion.settled_by` from Task 1.
- Produces: `renderCriterionLine` emits a second bracketed marker; `renderSettledByLine` is new and lives inside `briefing.ts`.

**Invariants:** `O6`, `O7`. Rule `B63` is a prohibition this task must not violate: no count, split or tally over settledness anywhere on the path from `resume_thread`, and no new roster column. `src/render/roster.ts` is not on that path — its only importers are `list_threads` and the resources module — but it is in the render directory, so leave it alone entirely.

**Three constraints on how this is written, all enforced by censuses:**

1. `test/contract/render-census.test.ts:580-594` resolves an interpolation site only through declarations **in the same file**. A helper extracted to a new module makes the site `unclassifiable` and halts the census even when it is in fact escaped. Every new render helper goes in `briefing.ts`.
2. `test/unit/briefing-hides-nothing.test.ts:50` forbids any `.slice` whose `.map` callback takes a parameter. Section suppression keeps the zero-parameter form already used at `:359-361`.
3. `test/contract/content-rendered.test.ts:170-178` renders its sentinel through `renderThreadDetail`, not through the briefing. The quote must therefore reach the thread resource as well, or the content-class census fails whatever the briefing does.

- [ ] **Step 1: Write the failing tests**

```ts
test('briefing.criterion-line-carries-its-settledness', () => {
  const thread = threadWith([criterion({ settledness: 'proposed', done: false })])

  const rendered = renderBriefing(thread, briefingContext())

  assert.match(
    rendered,
    /- c1 \[open\] \[proposed\]:/,
    'settledness renders beside the status, on the criterion own line'
  )
})

test('briefing.confirmed-criterion-renders-the-human-words', () => {
  const thread = threadWith([
    criterion({ settledness: 'confirmed', settled_by: 'it has to block before the turn ends' })
  ])

  const rendered = renderBriefing(thread, briefingContext())

  assert.ok(
    rendered.includes('- settled by: it has to block before the turn ends'),
    `a confirmed criterion shows whose words back it, got: ${rendered}`
  )
})

test('briefing.unconfirmed-criterion-shows-no-settled-by-line', () => {
  const thread = threadWith([criterion({ settledness: 'proposed', settled_by: null })])

  const rendered = renderBriefing(thread, briefingContext())

  assert.equal(rendered.includes('settled by:'), false, 'there is nobody to quote on a criterion nobody confirmed')
})

test('briefing.a-thread-with-no-criteria-says-the-definition-of-done-is-owed', () => {
  const thread = threadWith([])

  const rendered = renderBriefing(thread, briefingContext())

  assert.ok(
    rendered.includes('**Completion criteria:**'),
    'the section renders rather than being suppressed, so silence is never mistaken for a clipped section'
  )
  assert.ok(
    rendered.includes('none recorded; a definition of done is still owed'),
    `the empty case says so in words, got: ${rendered}`
  )
})

test('resource-render.thread-detail-carries-the-settled-by-quote', () => {
  const thread = threadWith([
    criterion({ settledness: 'confirmed', settled_by: 'it has to block before the turn ends' })
  ])

  const rendered = renderThreadDetail(thread, { resolved: 0, dangling: [], quarantined: [] }, null, null, {
    bound: [],
    unreadable: 0,
    unread: false
  })

  assert.ok(
    rendered.includes('it has to block before the turn ends'),
    'the content-class census renders through this function, so the quote must reach it'
  )
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/unit/briefing.test.ts`
Expected: all five FAIL. Both goldens also fail as soon as the implementation lands, which is expected and is Step 5.

- [ ] **Step 3: Render the marker and the quote**

In `src/render/briefing.ts`, at the criterion block. `clip` at `:79` is `clipWithMarker(escapeStored(text), max)`, so routing the quote through it satisfies the escaping census:

```ts
const renderCriterionLine = (criterion: Criterion, textClip: number): string => {
  const text = clip(criterion.text, textClip)
  const label = `- c${criterion.ordinal} [${criterionStatus(criterion)}] [${criterion.settledness}]:`
  const withText = text.length === 0 ? label : `${label} ${text}`
  return `${withText} (id ${escapeStored(criterion.id)})`
}

const renderSettledByLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.settled_by === 'string'
    ? `  - settled by: ${clip(criterion.settled_by, textClip)}`
    : `  - settled by: ${NOT_RECORDED}`
```

In `renderCriterionBlock` at `:99-110`, between the check line and the result line, using the same conditional-emission idiom the result line already uses:

```ts
    ...[criterion]
      .filter((entry) => entry.settledness === 'confirmed')
      .map((entry) => renderSettledByLine(entry, renderClip.criterionSettledBy)),
```

Add `criterionSettledBy` to the `RenderClip` type and give it a natural maximum of `caps.CRITERION_SETTLED_BY_MAX` in the table at `:48-59`, then a line in `clipAt` at `:187-202` matching the existing fields.

- [ ] **Step 4: Say so when there are no criteria**

The section at `:359-361` renders nothing when `criterionBlocks` is empty, which makes a thread with no criteria indistinguishable from one whose section was clipped. Give the empty case a block instead of changing the suppression idiom, which a census pins:

```ts
const CRITERIA_OWED_LINE = '- none recorded; a definition of done is still owed.'
```

and where `criterionBlocks` is built, substitute that single line when the list is empty. The three `.slice(0, 1).map(() => ...)` calls stay exactly as they are.

- [ ] **Step 5: Render the quote on the thread resource**

In `src/server/resource-render.ts`, wherever `renderThreadDetail` emits each criterion, add the quote line for a confirmed criterion. That file has its own local `NOT_RECORDED` at `:19`; use it rather than importing the briefing's. It is already in `CENSUSED_FILES`, so the interpolation must be escaped the way its neighbours are.

- [ ] **Step 6: Update both goldens by hand**

There is no regeneration script and no update flag. The full-thread golden at `test/unit/briefing.test.ts:175-228` gains a settledness marker on every criterion line and a `settled by:` line under any confirmed one; the empty-thread golden at `:236-261` gains the whole criteria section it previously suppressed. Change the expected arrays, never the assertion.

- [ ] **Step 7: Run the full suite**

Run: `npm test && npm run typecheck`
Expected: exit 0. Watch specifically for `test/contract/content-rendered.test.ts` and `test/contract/render-census.test.ts` — those two are the ones this task can break silently in the wrong direction.

- [ ] **Step 8: Commit**

```bash
git add src/render/briefing.ts src/server/resource-render.ts test/unit/briefing.test.ts
git commit -m "feat: both surfaces show who stands behind a criterion"
```

## Task 5: bump the version and open the pull request

**Files:**
- Modify: `package.json:3`, `.claude-plugin/plugin.json:3`

- [ ] **Step 1: Bump both files to the same major**

The input contract of `open_thread` changed in three breaking ways: two new required arguments, a required criterion field, and a relaxed cardinality. That is the case commits `8386c370` and `836860f4` set the precedent for — each touched exactly these two files, exactly one line each, and took a full major on its own rather than folding into a neighbour. Read the current value rather than assuming it; `origin/main` released `6.1.0` after this branch was cut.

```bash
git add package.json .claude-plugin/plugin.json
git commit -m "chore(criteria): bump the version for the breaking open_thread input"
```

- [ ] **Step 2: Verify the whole suite one more time on the branch tip**

Run: `npm test && npm run typecheck`
Record the actual counts. They go into the pull request body verbatim, and a count you did not read is `--not-verified`.

- [ ] **Step 3: Open the pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/criterion-settledness --base main \
  --title "feat(criteria): record who stands behind each criterion" \
  --what "Opening a thread now requires saying what the work is and what happens next, and those two statements appear in the record from the moment the thread exists rather than staying blank until the first hand-off." \
  --what "A thread can be opened with no definition of done, which is deferred to the moment one is actually knowable." \
  --what "Every criterion records whether a person stated it, the model derived it, or nobody has decided what done means for that part yet, and a criterion a person stated carries their own words." \
  --why "The record demanded a definition of done at the one moment least likely to have one, so something was stated anyway, and it never asked what the work was at all." \
  --why "A criterion a person dictated and one the model guessed read identically forever, so a later reader could not tell which parts of the goal were agreed." \
  --verified "npm test - <counts you read>" \
  --verified "npm run typecheck - exit 0" \
  --risk "A stored criterion written before this change reads as derived-by-the-model, which is the honest reading but is indistinguishable from one explicitly recorded that way."
```

---
# MSP-2 — the recording gates

**Ships:** a `Stop` gate that asks for what a fresh session would need rather than merely noting the ledger did not move, and a `SubagentStop` gate that asks the agent holding the material to record it before that material is gone.

**Branch:** `feat/recording-gates` from `main`. Runs in parallel with MSP-1 in its own worktree.

**Why both gates are one pull request.** The sketch in the session log split them, because they both edit `src/hooklib/stop-gate.ts` and two agents cannot hold one checkout. One branch removes the conflict rather than managing it, and the two gates share the state file, the fail-open discipline and the ledger-head comparison, so splitting them would mean building that shared floor twice.

**What is verified and what is not.** The payload field the damping rule reads is verified: `prompt_id` is declared at `test/fixtures/hook-types.d.ts:66` and carries a real value in the captured `stop.json`. The `SubagentStop` payload shape is **not** verified from anything in this repository — the spec's claim that it carries `agent_id` and `agent_type` and no `stop_hook_active` is sourced from external documentation. Task 1 settles it by capture, and nothing after Task 1 may proceed on the unverified version.

## Task 1: capture a real `SubagentStop` payload

**Files:**
- Create: `test/fixtures/hook-events/subagent-stop.json`
- Modify: `test/fixtures/hook-events/manifest.json`, `test/fixtures/hook-types.d.ts`

**This task is a hard prerequisite and it cannot be satisfied by writing the file.** `test/hooks/unreadable-cwd.test.ts:100-104` fails with *"no CAPTURED fixture exists for ..."* unless the payload was recorded from a live client, and `test/fixtures/hook-events/manifest.json` records capture provenance for every fixture it holds. A hand-written fixture is exactly the thing that check exists to reject.

- [ ] **Step 1: Bind a throwaway capture hook**

In your own Claude Code settings, not in this repository, bind `SubagentStop` to a command that appends its stdin to a file:

```bash
cat >> /tmp/subagent-stop-capture.jsonl
```

- [ ] **Step 2: Run a session that dispatches a subagent, and let it finish**

Any subagent will do. One dispatch produces one payload.

- [ ] **Step 3: Read what was captured and compare it to the spec's claim**

```bash
tail -1 /tmp/subagent-stop-capture.jsonl | python3 -m json.tool
```

Confirm three things and write down what you actually see: whether `agent_id` is present, whether `agent_type` is present, and whether any `stop_hook_active` equivalent is present. The spec asserts the first two and denies the third. **If the capture disagrees with any of the three, stop and record a decision before writing code** — the one-shot-per-agent design in Task 5 rests on `agent_id` being unique per subagent instance, and the absence of a stop-hook-active flag is why that design is needed at all.

- [ ] **Step 4: File the fixture and its type**

Save the captured object as `test/fixtures/hook-events/subagent-stop.json`. Add its entry to `manifest.json` with `"status": "CAPTURED"` and the client version you captured under, matching the shape the existing `stop.json` entry uses. Add a `SubagentStopEvent` type to `test/fixtures/hook-types.d.ts` derived from the capture, because `test/hooks/fixtures-typecheck.test.ts:57-76` typechecks every fixture against its pinned type.

- [ ] **Step 5: Remove the throwaway hook from your settings**

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/hook-events/subagent-stop.json test/fixtures/hook-events/manifest.json test/fixtures/hook-types.d.ts
git commit -m "test: capture a live SubagentStop payload"
```

## Task 2: the baseline moves to session start

**Files:**
- Modify: `src/hooklib/ledger-presence.ts:72-77` (rename and re-home the writer)
- Modify: `src/server/tools/resume_thread.ts:6` and `:62` (remove the call)
- Modify: `src/cli/session-start.ts` (add the call)
- Modify: `test/hooks/stop-gate-ledger-presence.test.ts:387-404` (invert the pinned expectation)

**Interfaces:**
- Produces: `recordSessionBaseline(rt, layout, sessionId)`, replacing `recordResumeBaseline`. Same body, same file, same `resume-baseline.json` path.

Decision `01M1X5S1KZRM93TYS2SJGS707S` settles why. In short: the baseline had exactly one writer, `resume_thread`, so everything recorded before the resume was discarded, and this thread watched the gate report an empty ledger immediately after nine records were written.

- [ ] **Step 1: Invert the test that pins the fault**

`test/hooks/stop-gate-ledger-presence.test.ts:387-404` is named `hook.stop-gate-blocks-when-a-ledger-write-lands-before-resume-and-nothing-after` and asserts a block *"even though a write landed between session start and the resume"*. That expectation is the defect. Rewrite it:

```ts
test('hook.stop-gate-clears-when-a-ledger-write-lands-before-the-resume', async () => {
  await withFixture(async ({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitOneThread(rt, repo, 'stop-gate-write-before-resume')
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false))

    assert.equal(
      verdict.kind,
      'silent',
      'a record written before the resume is still a record written this session, and the gate must count it'
    )
  })
})
```

Note the reordering: `startSession` now comes before `commitOneThread`, because the baseline is taken at session start rather than at resume.

- [ ] **Step 2: Run it and watch it fail**

Run: `node --test test/hooks/stop-gate-ledger-presence.test.ts`
Expected: FAIL with a `block` verdict, which is today's behaviour.

- [ ] **Step 3: Move the writer**

Rename `recordResumeBaseline` to `recordSessionBaseline` in `src/hooklib/ledger-presence.ts:72-77`. Delete the import at `src/server/tools/resume_thread.ts:6` and the call at `:62`. Call it from `src/cli/session-start.ts`, keyed to the session id the payload carries, using `createStateDirectory` exactly as the gate does so no half-built store appears.

- [ ] **Step 4: Run the hook suite and watch it pass**

Run: `node --test test/hooks/stop-gate-ledger-presence.test.ts test/hooks/stop-gate-store-shape.test.ts`
Expected: PASS, including the two silence tests at `:327-337` and `:339-352`, which still hold — a session with no baseline and a project with no ledger ref both stay silent, which is the fail-open behaviour `B73` requires.

- [ ] **Step 5: Commit**

```bash
git add src/hooklib/ledger-presence.ts src/server/tools/resume_thread.ts src/cli/session-start.ts test/hooks/stop-gate-ledger-presence.test.ts
git commit -m "fix: the recording baseline is taken at session start"
```

## Task 3: the `Stop` gate presents the assertions

**Files:**
- Modify: `src/hooklib/stop-gate.ts:52-62` (the two reason builders), `:82-109` (the ledger verdict), `:40-45` (`StopEvent`)
- Modify: `hooks/stop.ts:14-19` (forward `prompt_id`)
- Create: `src/hooklib/recording-gate-state.ts`
- Test: `test/hooks/stop-gate-recording-assertions.test.ts`

**Interfaces:**
- Produces: `readRecordingGateState(stateDir)` / `writeRecordingGateState(rt, stateDir, state)` over a new `state/recording-gate.json`.
- Produces: `StopEvent` gains `prompt_id: string | null`.

**Use a new state file, not `stop-gate.json`.** The existing one belongs to the verbatim-echo gate, which writes it at `stop-gate.ts:70` *before* two early returns, so the write happens on every first Stop of a session whatever the verdict. `test/hooks/stop-gate-store-shape.test.ts:39-43` pins that ordering. Reusing the file inherits a write you do not want.

**The fire condition, stated once.** Let `reference` be the head recorded at the last fire for this thread, or the session baseline when there has been no fire. The gate fires when the current ledger head equals `reference`. After a fire it records the current head, which is what `S8` means by cleared: any write at all moves the head off the reference, and no write is inspected for content or attributed to an actor.

**The damping, stated once.** The gate stands down for the rest of the session for this thread when it has already fired at least twice **and** the payload's `prompt_id` differs from the one recorded at the last fire. Neither alone stands it down. Decision `01M1X5SQ1EQSWSAB30BGE0GNBP` settles why this reads a payload field rather than the transcript.

- [ ] **Step 1: Write the failing tests**

```ts
test('hook.stop-gate-presents-every-assertion-when-the-ledger-has-not-moved', async () => {
  await withFixture(async ({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitOneThread(rt, repo, 'recording-assertions')
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind === 'block') {
      assert.ok(verdict.reason.includes('Every selection between options is recorded by whoever selected'))
      assert.ok(verdict.reason.includes("The thread's definition of done reflects what is now known"))
      assert.ok(verdict.reason.includes('The recorded next action is one someone could begin'))
      assert.ok(verdict.reason.includes('Everything a subagent returned but could not record itself'))
      assert.ok(
        verdict.reason.includes('reports only that the record is silent'),
        'the gate makes no claim about what the answer should be'
      )
    }
  })
})

test('hook.stop-gate-names-what-the-record-holds-nothing-for', async () => {
  await withFixture(async ({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitThreadWithNoDecisions(rt, repo, 'nothing-linked')
    await resumeAs(rt, SESSION_ID, threadId)

    const verdict = stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind === 'block') {
      assert.ok(
        verdict.reason.includes('no decision is linked to this thread'),
        `the block names the observably empty category, got: ${verdict.reason}`
      )
    }
  })
})

test('hook.stop-gate-clears-once-any-write-moves-the-head-past-the-last-fire', async () => {
  await withFixture(async ({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitOneThread(rt, repo, 'clears-after-fire')
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind, 'block')
    await logSessionEventAs(rt, threadId, 'anything at all')

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind,
      'silent',
      'the head moved off the value recorded at the fire, which is the whole clearing condition'
    )
  })
})

test('hook.stop-gate-stands-down-after-two-fires-and-a-fresh-human-turn', async () => {
  await withFixture(async ({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitOneThread(rt, repo, 'stands-down')
    await resumeAs(rt, SESSION_ID, threadId)

    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind, 'block')
    assert.equal(stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind, 'block')

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-two')).kind,
      'silent',
      'two fires and a fresh human turn stand the gate down; a gate that fires every turn is cleared reflexively'
    )
  })
})

test('hook.stop-gate-keeps-firing-on-two-fires-with-no-fresh-turn', async () => {
  await withFixture(async ({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)
    const threadId = commitOneThread(rt, repo, 'no-fresh-turn')
    await resumeAs(rt, SESSION_ID, threadId)

    stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))
    stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one'))

    assert.equal(
      stopGateVerdict(rt, stopEventFor(repo, SESSION_ID, false, 'prompt-one')).kind,
      'block',
      'neither condition alone stands the gate down'
    )
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/hooks/stop-gate-recording-assertions.test.ts`
Expected: FAIL. `stopEventFor` does not take a fifth argument yet, so this will not compile until Step 3.

- [ ] **Step 3: Widen the event**

Add `prompt_id: string | null` to `StopEvent` at `stop-gate.ts:40-45`, forward it from `hooks/stop.ts:14-19` as `typeof record.prompt_id === 'string' ? record.prompt_id : null`, and add the parameter to the `stopEventFor` test helper.

- [ ] **Step 4: Write the gate state module**

`src/hooklib/recording-gate-state.ts`, following the read/write shape of `stop-gate.ts:16-36` exactly — `ENOENT` and malformed JSON both read as absent, any other errno rethrows, writes go through `durableWrite`:

```ts
export type ThreadFireState = { head_at_last_fire: string; fires: number; prompt_id_at_last_fire: string | null }
export type RecordingGateState = { session_id: string; threads: Record<string, ThreadFireState> }
```

- [ ] **Step 5: Replace the two reason builders**

Delete `ledgerUntouchedReason` and `ledgerMismatchReason` at `:52-62` and build the block text from the four assertions. Each of the three observable categories — no linked decision, no artifact, no un-struck criterion — prefixes its assertion with a line saying the record currently holds nothing for it. The remainder are presented in full and unqualified. The closing sentence states that the gate reports only that the record is silent and makes no claim about what the answer should be.

Keep the thread-mismatch path: `ledgerPathsChangedSince` at `:99` still distinguishes a write filed under this thread from one that is not, and the block text for that case still says records reached the ledger but none under this thread.

- [ ] **Step 6: Rewrite the verdict**

In `ledgerPresenceVerdict` at `:82-109`, keep the four silence guards at `:83-92` unchanged, replace the head comparison at `:94-96` with the reference rule, and add the fire record and the stand-down check. Preserve `--end-of-options` and `SHA_PATTERN` in `ledger-presence.ts:33-38` untouched; `test/hooks/stop-gate-ledger-presence.test.ts:448-483` is a dedicated regression against a worktree file named for the baseline SHA.

- [ ] **Step 7: Amend the latching test**

`test/hooks/stop-gate-re-evaluates-rather-than-latching` at `:274-290` asserts the verdict is *"evaluated at every turn end, never latched to fire once per session"*. Damping changes that on purpose. Amend it to assert re-evaluation up to the stand-down rather than deleting it, so the property it guards — that a single fire does not silence the gate — is still pinned.

- [ ] **Step 8: Run the hook suite and commit**

Run: `node --test test/hooks/` then `npm test && npm run typecheck`

```bash
git add src/hooklib/ hooks/stop.ts test/hooks/
git commit -m "feat: the stop gate asks for what a fresh session would need"
```

## Task 4: the `SubagentStop` gate

**Files:**
- Create: `src/hooklib/subagent-stop-gate.ts`
- Create: `hooks/subagent-stop.ts`
- Test: `test/hooks/subagent-stop-gate.test.ts`

**Interfaces:**
- Consumes: `readRecordingGateState` from Task 3, `readLedgerHead` from `src/hooklib/ledger-presence.ts`.
- Produces: `subagentStopGateVerdict(rt, event): StopVerdict`, reusing the `StopVerdict` type already exported at `stop-gate.ts:38`.

**The once-per-agent record is a directory of marker files, not a set in one file.** `durableWrite` is atomic per write but offers nothing for read-modify-write, and two subagents can finish at the same moment. A set held in one JSON object loses an entry under that race. One empty file per `agent_id` under `state/subagent-gate/` is the same set, is lock-free by construction, and needs no new concurrency idiom. `B72` asks for the set to live under `state/`, which this satisfies.

**One ambiguity the spec leaves, named rather than hidden.** `S10` fixes when this gate may fire at most, and `B69` says both gates clear when the ledger head moves off the value recorded at the fire, but nothing states what the reference is for the *first* subagent of a session. This plan uses the same reference as the `Stop` gate: the head at the last fire of either gate, or the session baseline when neither has fired. The consequence is that a subagent finishing after another subagent recorded is not asked, because the head has moved and the gate attributes no write to an actor — which is `S8` working as written, not a defect in it. Confirm this reading before Task 6; if it is wrong, only this file changes.

**The block text must name the return message as a destination.** Until the roster grant lands, these agents hold no ledger tool at all. A gate that tells an ungranted agent to call `record_decision` traps it. The text names recording where the tools exist, and the agent's own return message where they do not.

- [ ] **Step 1: Write the failing tests**

```ts
test('hook.subagent-gate-presents-all-six-assertions', () => {
  withFixture(({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one'))

    assert.equal(verdict.kind, 'block')
    if (verdict.kind === 'block') {
      assert.ok(verdict.reason.includes('Every cause, measurement or approach this agent established'))
      assert.ok(verdict.reason.includes('Every approach tried and abandoned is recorded, with what made it fail'))
      assert.ok(verdict.reason.includes('Every fault this agent observed in what it read is recorded'))
      assert.ok(verdict.reason.includes('Every file this agent produced or changed is named'))
      assert.ok(verdict.reason.includes('Where the work stopped is recorded'))
      assert.ok(verdict.reason.includes('Everything this agent could not determine is recorded'))
      assert.ok(
        verdict.reason.includes('return message'),
        'an agent holding no ledger tool must be told where else its material can go'
      )
    }
  })
})

test('hook.subagent-gate-fires-at-most-once-per-agent', () => {
  withFixture(({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)

    assert.equal(subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one')).kind, 'block')

    assert.equal(
      subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one')).kind,
      'silent',
      'agent_id is unique per subagent instance, so a second stop for one agent is the same agent stopping again'
    )
  })
})

test('hook.subagent-gate-asks-each-agent-separately', () => {
  withFixture(({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)

    subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-one'))

    assert.equal(
      subagentStopGateVerdict(rt, subagentEventFor(repo, SESSION_ID, 'agent-two')).kind,
      'block',
      'a different agent holds different material and has not been asked'
    )
  })
})

test('hook.subagent-gate-is-silent-with-no-agent-id', () => {
  withFixture(({ rt, repo }) => {
    startSession(rt, repo, SESSION_ID)

    const verdict = subagentStopGateVerdict(rt, { ...subagentEventFor(repo, SESSION_ID, 'x'), agent_id: null })

    assert.equal(verdict.kind, 'silent', 'a payload the gate cannot key on fails open rather than firing blind')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/hooks/subagent-stop-gate.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write the gate, then the hook entry**

`hooks/subagent-stop.ts` is a thin wrapper on the exact shape of `hooks/stop.ts`, with the same non-object and missing-field guards. The name must be exactly `subagent-stop.ts`: `test/hooks/hook-process.ts:99` resolves `hooks/${hookName}.ts` and `scripts/check-packaging.mjs:271` builds the same string, and they must agree.

The file is TypeScript and ships as source. There is no build step; `tsconfig.json:12` sets `noEmit` and `scripts/check-packaging.mjs:71-72` forbids `.mjs` and `.cjs` under `hooks/`.

- [ ] **Step 4: Run, watch pass, commit**

Run: `node --test test/hooks/subagent-stop-gate.test.ts`

```bash
git add src/hooklib/subagent-stop-gate.ts hooks/subagent-stop.ts test/hooks/subagent-stop-gate.test.ts
git commit -m "feat: a subagent is asked to record before its material is gone"
```

## Task 5: bind the event across four enumerations

**Files:**
- Modify: `hooks/hooks.json`
- Modify: `scripts/check-packaging.mjs:6-27`, `:47`, `:49-56`
- Modify: `test/contract/cutover-manifest-commands.test.ts:15`, `:18`, `:23-30`
- Modify: `test/hooks/hook-process.ts:14-21`, `:25-34`
- Modify: `README.md:77`

**The spec names two closed censuses. There are four enumerations, and the third one fails silently.** `test/hooks/hook-process.ts` drives three generated suites from `HOOK_NAMES` — crash visibility, no-hang, and unreadable-cwd. A hook absent from that map is not censused at all rather than failing, so the new gate would ship with none of those three properties checked and nothing would say so.

**Invariant:** `S12`.

- [ ] **Step 1: Bind it in the manifest**

In `hooks/hooks.json`, beside the `Stop` entry, with the same 15-second timeout:

```json
    "SubagentStop": [
      { "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/subagent-stop.ts\"", "timeout": 15 }] }
    ]
```

- [ ] **Step 2: Admit it in the packaging census**

`scripts/check-packaging.mjs` is closed in both directions: `:260-262` rejects an unexpected binding and `:264-267` rejects a missing one.

- Append `'SubagentStop'` to `REQUIRED_HOOK_EVENTS` at `:47`.
- Add `SubagentStop: 'subagent-stop'` to `EVENT_HOOK_FILES` at `:49-56`. Without this, `:270` yields `undefined` and `:271` builds a command naming `hooks/undefined.ts`.
- Add `'hooks/subagent-stop.ts'` to `REQUIRED_FILES` at `:6-27`, beside the other six hook entries.

- [ ] **Step 3: Admit it in the manifest-commands census**

- Append `'SubagentStop'` to `EXPECTED_EVENTS` at `:15`, which fixes the exact set equality at `:153-161`.
- Change `EXPECTED_POPULATION_SIZE` at `:18` from `7` to `8`, asserted at `:203-209`.
- Add `SubagentStop: 'subagent-stop.json'` to `FIXTURE_FILE_FOR_EVENT` at `:23-30`. Because that map is typed `Record<HookEventName, string>`, the typecheck fails the moment the first edit lands, so this one cannot be silently skipped. `:222-233` then spawns the real hook with the captured fixture from Task 1 and asserts exit 0.

- [ ] **Step 4: Admit it in the generated hook suites**

In `test/hooks/hook-process.ts`, add the type-only import, the `HookEntryModules` member at `:14-21`, and the `EVENT_NAME_OF` entry at `:25-34`. This is what puts the new hook into crash-is-visible, no-hang and unreadable-cwd. The last of those needs the captured fixture from Task 1 and fails loudly without it.

- [ ] **Step 5: Correct the README**

`README.md:77` says six lifecycle hooks. It is now seven. Nothing tests this line; correct it anyway.

- [ ] **Step 6: Run everything and commit**

Run: `npm test && npm run typecheck`
Expected: exit 0. If `unreadable-cwd` fails naming a missing captured fixture, Task 1 was skipped or the fixture is not marked `CAPTURED`.

```bash
git add hooks/hooks.json scripts/check-packaging.mjs test/contract/cutover-manifest-commands.test.ts test/hooks/hook-process.ts README.md
git commit -m "feat: bind SubagentStop and admit it in every hook census"
```

## Task 6: open the pull request

- [ ] **Step 1: Run the whole suite on the branch tip and read the counts**

Run: `npm test && npm run typecheck`

- [ ] **Step 2: Open it**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/recording-gates --base main \
  --title "feat(gates): ask for the record while the material still exists" \
  --what "A turn that ends with nothing new in the record is now shown four short statements about what a fresh session would need, and told which of them the record visibly holds nothing for." \
  --what "A helper agent finishing its work is shown six statements about what it alone knows, at the moment it stops, rather than that knowledge reaching the main conversation only as a summary." \
  --what "The point a session is measured from moved to the start of the session, so anything recorded before the first thread is picked up now counts." \
  --why "The old check only noticed whether anything at all had been written, and said so itself; one write of any kind satisfied it for a whole session." \
  --why "Records written before a thread was picked up were discarded, so a session that recorded nine things and then picked up its thread was told the record was empty." \
  --why "Everything a helper agent learned reached the record only through a summary someone else wrote, and whatever the summary dropped was gone." \
  --verified "npm test - <counts you read>" \
  --verified "npm run typecheck - exit 0" \
  --not-verified "the helper-agent prompt in a real session - not run; those agents hold no recording tool until a separate change outside this repository lands" \
  --risk "The helper-agent prompt does nothing useful until that separate change lands, so until then it names the agent's own reply as the place to put what it found."
```

---
# MSP-3 — the settledness answer path

**Ships:** the other half of the relay. `open_thread` puts the criteria it just stored in front of the human, `update_thread` records the answer, and `close_thread` reports how the finished criteria divide.

**Branch:** `feat/settledness-answer-path`, cut from `main` after MSP-1 lands. It cannot start earlier: every argument it adds names a field MSP-1 declares.

**Why the relay and the close report ship together.** They are the two ends of one mechanism. The ask with no place to put the answer is decorative; the answer with no ask is never given. The close report is the aggregation guard the spec relies on in place of refusing to close, and it belongs with the axis it reports on.

## Task 1: `update_thread` records the answer

**Files:**
- Modify: `src/server/tools/update_thread.ts:37-48` (beside `CriterionDoneSchema`), `:52-56` (beside `criteria_done`), `:136-224` (refusal factories), `:243-296` (the handler)
- Modify: `test/support/published.ts`, `test/support/optional-argument-recipes.ts:709-725`
- Test: `test/spawn/update-thread.test.ts`

**Interfaces:**
- Consumes: `Settledness` from `src/schema/thread.ts`.
- Produces: `criteria_settled?: { criterion_id: string; settledness: Settledness; settled_by?: string }[]`, capped at `caps.CRITERIA_MAX_ELEMENTS` like its sibling.

**Invariants:** `A14`, `A15`, `A16`.

`criteria_done` at `:37-56` is the model to copy, down to the element cap and the `.optional()` array. Its handler at `:243-296` already raises the three id refusals this argument needs — duplicate within one call, unknown on this thread, and struck — so mirror those rather than inventing new ones. The two quote refusals are the ones written in MSP-1 Task 3; lift them rather than rewriting.

The `\S` pattern on `settled_by` is what keeps `test/contract/criteria-writers.test.ts` from halting: a free-text leaf on a tool that also takes `thread_id` needs a disposition, and a string carrying a pattern is classified before that lookup. The spec's own reasoning at `C-7` is that a field recording an observation *about* a criterion is not a field carrying the criterion's statement, which is the distinction that census exists to hold.

- [ ] **Step 1: Write the failing tests**

```ts
test('update_thread.records-a-confirmation-with-the-human-words', async () => {
  const { threadId, criterionId } = await openThreadWithOneProposedCriterion()

  const reply = await callUpdateThread({
    thread_id: threadId,
    criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed', settled_by: 'yes, that is what done means' }]
  })

  assert.equal(reply.isError, undefined)
  const thread = readThreadRecord(threadId)
  assert.equal(thread.completion_criteria[0].settledness, 'confirmed')
  assert.equal(thread.completion_criteria[0].settled_by, 'yes, that is what done means')
})

test('update_thread.allows-a-confirmation-to-be-taken-back', async () => {
  const { threadId, criterionId } = await openThreadWithOneConfirmedCriterion()

  const reply = await callUpdateThread({
    thread_id: threadId,
    criteria_settled: [{ criterion_id: criterionId, settledness: 'proposed' }]
  })

  assert.equal(reply.isError, undefined, 'a transition may move between any two values; the record keeps only the current one')
  assert.equal(readThreadRecord(threadId).completion_criteria[0].settled_by, null, 'the quote goes with the confirmation')
})

test('update_thread.refuses-a-repeated-criterion-in-one-settlement-call', async () => {
  const { threadId, criterionId } = await openThreadWithOneProposedCriterion()

  const reply = await callUpdateThread({
    thread_id: threadId,
    criteria_settled: [
      { criterion_id: criterionId, settledness: 'proposed' },
      { criterion_id: criterionId, settledness: 'unsettled' }
    ]
  })

  assert.equal(reply.isError, true, 'two settlements for one criterion in one call have no defined winner')
})

test('update_thread.refuses-settling-a-struck-criterion', async () => {
  const { threadId, criterionId } = await openThreadWithOneStruckCriterion()

  const reply = await callUpdateThread({
    thread_id: threadId,
    criteria_settled: [{ criterion_id: criterionId, settledness: 'confirmed', settled_by: 'it counts' }]
  })

  assert.equal(reply.isError, true, 'a struck criterion is retained for the record, not reopened through a side door')
})

test('update_thread.refuses-marking-an-unsettled-criterion-done', async () => {
  const { threadId, criterionId } = await openThreadWithOneUnsettledCriterion()

  const reply = await callUpdateThread({
    thread_id: threadId,
    criteria_done: [{ criterion_id: criterionId, result: '850 tests, 0 fail', result_status: 'verified' }]
  })

  assert.equal(reply.isError, true, 'an unsettled criterion asserts nothing, so there is no claim for a result to report')
  assert.ok(
    replyText(reply).includes('asserts nothing'),
    'the refusal says why, not merely that'
  )
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node --test test/spawn/update-thread.test.ts`
Expected: the first four FAIL on the unknown key; the fifth FAILS by succeeding, because nothing yet stops an unsettled criterion being marked done.

- [ ] **Step 3: Declare the argument and mirror the refusals**

Follow `CriterionDoneSchema` exactly. Then, in the handler, run the id checks in the same order the `criteria_done` block uses at `:246-258` — duplicate, unknown, struck — before any settledness-specific check.

- [ ] **Step 4: Refuse marking an unsettled criterion done**

This is invariant `A13` and it belongs in the `criteria_done` block, not the new one:

```ts
const unsettledHasNoResultRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'a criterion whose settledness is confirmed or proposed',
  example: '{"criterion_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "result": "850 tests, 0 fail", "result_status": "verified"}',
  retryable: true,
  message: `these criteria are unsettled, and an unsettled criterion asserts nothing for a result to report: ${ids.join(', ')}; remedy: settle what done means for it first, through criteria_settled or amend_criteria.`
})
```

**Check `A16` before moving on.** Three of the four refusals in this task read settledness together with a companion field — a missing quote, a quote that should not be there, a result for a claim that was never made. None fires on the value alone. A branch reading only `settledness === 'unsettled'` and refusing without asking what else was sent is the shape that falsifies the invariant.

- [ ] **Step 5: Repair both censuses and run**

`criteria_settled` is a new published argument and a new optional argument: it needs a `PUBLISHED_CLAIMS` phrase or a distinct `ARGUMENT_GAPS` reason, and a recipe in `test/support/optional-argument-recipes.ts:709-725`.

Run: `npm test && npm run typecheck`

```bash
git add src/server/tools/update_thread.ts test/support/ test/spawn/update-thread.test.ts
git commit -m "feat: the human answer to a criterion is recorded where it lands"
```

## Task 2: `open_thread` puts its criteria in front of the human

**Files:**
- Modify: `src/server/tools/open_thread.ts:50-64` (output schema), `:197` (the reply text)
- Test: `test/spawn/open-thread.test.ts`

**Invariant:** `O8`.

The reply today is a count: `opened thread X (id) with N completion criteria`. A count prompts nothing. `B57` requires the criteria as stored, plus server-authored text naming the action to take.

- [ ] **Step 1: Write the failing tests**

```ts
test('open_thread.reply-carries-the-criteria-as-stored', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'relay-carries-criteria',
    active_goal: 'ship the recording model',
    next_step: 'read the spec',
    completion_criteria: [{ text: 'the suite is green', check: 'npm test exits 0', settledness: 'proposed' }]
  })

  const text = replyText(reply)
  assert.ok(text.includes('the suite is green'), 'the criterion text itself is in the reply, not a tally of it')
  assert.ok(text.includes('proposed'), 'each criterion carries the settledness it was stored with')
  assert.ok(
    /put (them|these) to the/i.test(text),
    `the reply names the action rather than reporting a state, got: ${text}`
  )
})

test('open_thread.reply-says-a-definition-of-done-is-owed-when-none-was-given', async () => {
  const reply = await callOpenThread({
    title: 'a thread',
    slug: 'relay-no-criteria',
    active_goal: 'ship the recording model',
    next_step: 'read the spec'
  })

  const text = replyText(reply)
  assert.ok(text.includes('no completion criteria were recorded'))
  assert.ok(text.includes('definition of done is still owed'))
})
```

- [ ] **Step 2: Run, fail, then write the reply**

Run: `node --test test/spawn/open-thread.test.ts`

Build the text from the stored criteria, one line each carrying the text and the settledness, followed by the instruction to put them to the human and record the answer with `criteria_settled`. The empty case replaces the list with the two statements the second test asserts. Add the criteria to `OpenThreadOutputSchema` at `:50-64` so the structured reply carries them too, each new property described in at least ten characters.

- [ ] **Step 3: Commit**

```bash
git add src/server/tools/open_thread.ts test/spawn/open-thread.test.ts
git commit -m "feat: open_thread asks for the criteria it just stored"
```

## Task 3: `close_thread` reports the settledness split

**Files:**
- Modify: `src/server/tools/close_thread.ts:27-41` (output schema), `:45-57` (the splits), `:149-158` (the reply)
- Test: `test/spawn/close-thread.test.ts`

**Invariant:** `O9`.

`resultStatusSplitOf` at `:45-54` is the exact model: it filters to un-struck met criteria and tallies three ways. The new split tallies the same population by settledness. The output-schema description states that no count is a reason to refuse — that promise already exists in prose at `:97` for the sibling split.

- [ ] **Step 1: Write the failing test**

```ts
test('close_thread.reports-how-the-closed-criteria-divide-by-settledness', async () => {
  const threadId = await threadReadyToClose({ confirmed: 1, proposed: 2 })

  const reply = await callCloseThread({ thread_id: threadId, outcome: 'done', detail: 'shipped' })

  assert.equal(reply.isError, undefined, 'no count is ever a reason to refuse')
  const text = replyText(reply)
  assert.ok(text.includes('1 confirmed'), `the split names the confirmed count, got: ${text}`)
  assert.ok(text.includes('2 proposed'), `the split names the proposed count, got: ${text}`)
})
```

- [ ] **Step 2: Run, fail, implement, run, commit**

Run: `node --test test/spawn/close-thread.test.ts`

```bash
git add src/server/tools/close_thread.ts test/spawn/close-thread.test.ts
git commit -m "feat: closing a thread reports who stood behind its criteria"
```

## Task 4: bump the version and open the pull request

`update_thread`'s published input changed. Precedent `836860f4` took its own major for exactly this argument's sibling rather than folding into the bump 36 minutes earlier, so this is a second major, not a reuse of MSP-1's.

- [ ] **Step 1: Bump `package.json:3` and `.claude-plugin/plugin.json:3` to the same value, commit as `chore(criteria): bump the version for the breaking criteria_settled input`**

- [ ] **Step 2: Run `npm test && npm run typecheck`, read the counts**

- [ ] **Step 3: Open the pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/settledness-answer-path --base main \
  --title "feat(criteria): put new criteria to the human and record the answer" \
  --what "Opening a thread now returns the criteria it stored, in full, with an instruction to put them to the person rather than a count of how many there were." \
  --what "A person's answer about a criterion is recorded against that criterion, including their own words when they agreed to it, and can be taken back later." \
  --what "A criterion recording an open question rather than a claim can no longer be marked finished, because there is no claim for a result to report." \
  --what "Closing a thread reports how its finished criteria divide between agreed and derived, and that report never blocks the close." \
  --why "A criterion nobody had agreed to looked exactly like one the person dictated, and nothing ever asked which it was." \
  --why "The one moment a person is present and the criteria are fresh passed without anything putting them in front of that person." \
  --verified "npm test - <counts you read>" \
  --verified "npm run typecheck - exit 0"
```

---

# MSP-4 — the three new invariant censuses

**Ships:** the three properties the spec asks to be defended by a test rather than by care.

**Branch:** `test/recording-model-invariants`, cut from `main` after MSP-1. Test-only; it adds no argument, no field and no render site, so it repairs nothing.

**Why this is a unit and the repairs are not.** The session log recorded a risk that census work cannot be its own MSP, because the tables that halt on a new field would sit red between merges. That risk holds for *repairs*, and this plan puts every repair inside the MSP that causes it. What is left here is different in kind: three censuses that assert properties nothing currently checks, each of which can only be written once the code it audits exists.

**Invariants:** `S6`, `S7`, `S11`.

## Task 1: every settledness field has a reader outside its writer

**Files:** create `test/contract/settledness-has-a-reader.test.ts`

The quote is classed `content`, so `test/contract/content-rendered.test.ts` already proves it reaches a surface. The settledness value is classed `structural` and that census does not cover it, which is the gap `S6` names. Assert that a sentinel settledness value planted on a criterion surfaces through both `renderBriefing` and `renderThreadDetail`, and that the writer that stores it is not the only place it appears.

## Task 2: the done gate reads no settledness

**Files:** create `test/contract/done-gate-ignores-settledness.test.ts`

`S7` requires an unsettled criterion to block closing through the refusal written in MSP-3 and the pre-existing doneness rule, never through a settledness-specific branch in the gate. Census the source of `src/domain/done-gate.ts` and its callees for any reference to the settledness field, and halt on one. Pair it with a behavioural test: a thread whose only un-struck criterion is unsettled fails to close, and the refusal names doneness rather than settledness.

## Task 3: no assertion is dressed as an invariant

**Files:** create `test/contract/assertions-are-not-invariants.test.ts`

`S11` forbids any statement from the spec's assertion section appearing in an `A`, `O` or `S` invariant table. Parse `docs/specs/2026-09-06-continuity-recording-model.md`, extract the ten assertion rows from section 5 and every invariant row from section 6, and halt on any assertion text found in an invariant table. The population must be non-empty on both sides or the census proves nothing — the existing censuses all guard this and so must this one.

- [ ] **Run `npm test && npm run typecheck`, commit each census separately, open the pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head test/recording-model-invariants --base main \
  --title "test(criteria): defend three properties of the recording model" \
  --what "A test now fails if the new criterion fields are ever stored without anything showing them to a reader." \
  --what "A test now fails if the rule deciding whether a thread can be closed starts reading who stood behind a criterion." \
  --what "A test now fails if a statement meant to be judged by a person is rewritten as a rule a machine claims to check." \
  --why "All three properties were held only by the care of whoever edited next, and each is the kind that breaks quietly." \
  --verified "npm test - <counts you read>" \
  --verified "npm run typecheck - exit 0"
```

---
# MSP-5 — the `file` skill

**Ships:** a skill that opens a thread the way the recording model wants one opened.

**Branch:** `feat/file-skill`, cut from `main` after MSP-3. It calls `update_thread` with the settlement argument, so it cannot precede it.

**A skill here is executed, not merely read.** `test/contract/skills.test.ts:460-528` extracts each skill's `Call` sequence and drives it against a live spawned server. Every tool a skill names needs an argument resolver in the closed table at `:310-314`, which today holds three. This skill names four, one of which is already there.

**Two rules govern every line of the file.** `test/contract/skills.test.ts:146-147` bans fourteen words case-insensitively — `must`, `never`, `only`, `unless`, `cannot`, `always`, `should`, `may`, `require`, `requires`, `if`, `when`, `at most`, `at least` — anywhere in the file, frontmatter values and headings included. `:148` requires every step to open with one of `Call`, `Present`, `Wait`, `Gather`, `Print`, `Stop`. The marker check runs first, so a step opening with a legal verb still fails on a banned word further along. The shipped skills express conditions with a participial phrase rather than a clause: `preflight` writes *"absent a single resolved match"* where an `if` would be natural.

`B75` is a decision, not an omission: `preflight` and `debrief` are untouched. Everything conditional in this model lives in tool descriptions, reply text and gate text, all of which are free to state conditions.

## Task 1: write the skill

**Files:** create `skills/file/SKILL.md`

- [ ] **Step 1: Write the file**

```markdown
---
name: file
description: Use at the start of work to open a new thread.
---

## Sequence

1. Gather what the work is, the action that comes next, what finishing looks like for the parts already settled, and what has happened in this session so far.
2. Call `open_thread` with `open_thread.active_goal` set to what the work is, `open_thread.next_step` set to the action that comes next, and `open_thread.completion_criteria` carrying the parts of finishing that are already settled.
3. Present the criteria the reply returns, one line each, naming the party standing behind it.
4. Wait for the human to name which of those criteria they stand behind and in whose words.
5. Call `update_thread` with `update_thread.criteria_settled` carrying that answer.
6. Call `log_session_event` with `log_session_event.body` set to what happened in this session before the thread existed.
7. Call `resume_thread` with `resume_thread.thread_id` set to the id the opened thread returned.
8. Print the returned `resume_thread.briefing` verbatim.
9. Stop.
```

- [ ] **Step 2: Check it against the two rules by hand before running anything**

Read every line for the fourteen banned words. Read every backtick span: a bare span names a live tool, a dotted span names a real top-level input or output property of that tool. Nested properties are not top-level and will not resolve — that is why step 2 names `open_thread.completion_criteria` and not a field inside it.

- [ ] **Step 3: Run the contract suite**

Run: `node --test test/contract/skills.test.ts`
Expected: FAIL on the missing argument resolvers, which Task 2 supplies. A failure naming a banned marker or an unresolvable span means Step 2 was done too quickly; fix the prose rather than the census.

## Task 2: register it in three closed lists

**Files:**
- Modify: `scripts/check-packaging.mjs:6-27` (`REQUIRED_FILES`)
- Modify: `test/spawn/install.test.ts:43` (`EXPECTED_SKILL_FILES`)
- Modify: `test/contract/skills.test.ts:310-314` (`CALL_ARGS_BY_TOOL`)

There is no skills manifest and discovery is by convention, so nothing here is optional and none of it is discoverable by reading the plugin metadata.

- [ ] **Step 1: Add `'skills/file/SKILL.md'` to `REQUIRED_FILES`**

- [ ] **Step 2: Add the same path to `EXPECTED_SKILL_FILES`**

`test/spawn/install.test.ts:143-150` compares the materialised tree by `assert.deepStrictEqual` against that array. A third skill fails there with everything else green.

- [ ] **Step 3: Add resolvers for `open_thread`, `update_thread` and `log_session_event`**

`CALL_ARGS_BY_TOOL` holds `list_threads`, `resume_thread` and `park_thread`. Each new entry returns fixture arguments valid against the live schema, so the driven sequence in `skill.cannot-strand` reaches its end. The `open_thread` resolver supplies the goal, the next step and one criterion carrying a settledness; the `update_thread` resolver settles that criterion; the `log_session_event` resolver supplies an actor and a body.

- [ ] **Step 4: Extend the strand assertion for this skill**

`skill.cannot-strand` asserts a pointer count of 1 after `preflight` and 0 after `debrief`. This skill also ends holding the thread, so it asserts 1. Add the case rather than generalising the existing two, so a future skill that strands is still caught.

- [ ] **Step 5: Run everything and commit**

Run: `npm test && npm run typecheck`

```bash
git add skills/file/SKILL.md scripts/check-packaging.mjs test/spawn/install.test.ts test/contract/skills.test.ts
git commit -m "feat: a skill that opens a thread the way the model wants one opened"
```

- [ ] **Step 6: Open the pull request**

```bash
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/file-skill --base main \
  --title "feat(skills): add a skill for opening a thread" \
  --what "There is now a written sequence for starting a piece of work: state the goal and the next action, record whatever is already known about finishing, put those to the person, record their answer, and carry over what happened before the thread existed." \
  --why "Picking up existing work and ending a session each had a written sequence; starting something new did not, so the record of a new thread depended on whoever opened it remembering the order." \
  --verified "npm test - <counts you read>" \
  --verified "npm run typecheck - exit 0"
```

---

# MSP-6 — the agent roster grant

**Ships:** the tool grant without which the helper-agent gate has nothing to ask for.

**Where it lands:** the user's global configuration, not this repository. Thirteen specialist agent definitions gain `record_decision` and `log_session_event`, and nothing else. Dispatch briefs for those agents carry the thread id, since an agent with no thread id has nothing to record against.

**Order:** after MSP-2, because until that lands there is no gate to satisfy. It has no dependency on any other MSP and blocks none of them.

**Not `update_thread`.** It carries `next_step`, `active_goal` and risk retirement alongside the fields a subagent would want, and an MCP call carries no caller identity, so a wide grant cannot be narrowed server-side. Decision `01M1X4CVDH6NQMFPMHG6934197` records this.

- [ ] **Step 1: Add the two tools to each of the thirteen agent definitions**

- [ ] **Step 2: Add the thread id to the dispatch brief template**

- [ ] **Step 3: Open a pull request against the configuration repository**

Direct pushes to its default branch are blocked, and copying the files puts the change in force immediately, so the pull request is the whole mechanism rather than a formality.

- [ ] **Step 4: Confirm the grant reached a real dispatch**

Dispatch one specialist agent with a thread id and confirm it can call `record_decision`. Until that is observed, treat the helper-agent gate as inert.

---

## Coverage

Every unit appears once, in the table at the top of this plan. Every behavioural rule the spec assigns to a unit is carried by the MSP that unit belongs to.

| Spec obligation | Where it lands |
|---|---|
| `B44`-`B49` | MSP-1 Task 1 |
| `B50`, `B51` | MSP-1 Task 2 |
| `B52`, `B53`, `B54` | MSP-1 Task 3 |
| `B61`-`B65` | MSP-1 Task 4 |
| `B60` | MSP-1 Task 5, MSP-3 Task 4 |
| `B66` | MSP-2 Task 5 |
| `B67`, `B69`, `B70`, `B71`, `B72` | MSP-2 Task 3 |
| `B68` | MSP-2 Task 4 |
| `B73` | MSP-2 Tasks 3 and 4 |
| `B55`, `B56` | MSP-3 Task 1 |
| `B57` | MSP-3 Task 2 |
| `B58` | MSP-3 Task 3 |
| `B59` | MSP-1 Tasks 2 and 3, MSP-3 Task 1 |
| `B74`, `B76` | MSP-5 Tasks 1 and 2 |
| `B75` | MSP-5, by leaving both skills untouched |
| `B77`, `B78` | MSP-6 |
| `A8`, `A9`, `A10` | MSP-1 Task 2 |
| `A11`, `A12`, `A14` | MSP-1 Task 3 |
| `A13`, `A15`, `A16` | MSP-3 Task 1 |
| `O6`, `O7` | MSP-1 Task 4 |
| `O8` | MSP-3 Task 2 |
| `O9` | MSP-3 Task 3 |
| `O10`, `O12` | MSP-2 Task 3 |
| `O11` | MSP-2 Task 4 |
| `S5` | MSP-1 Task 4 as a prohibition, MSP-4 Task 1 as a test |
| `S8`, `S9` | MSP-2 Task 3 |
| `S10` | MSP-2 Task 4 |
| `S12` | MSP-2 Task 5 |
| `S6`, `S7`, `S11` | MSP-4 |
| `R-1`-`R-6` | MSP-2 Task 4, as the text the gate presents |
| `R-7`-`R-10` | MSP-2 Task 3, as the text the gate presents |

`C-12` and `C-13` are guidance and carry no invariant by the spec's own design, so they carry no task. `B59` appears three times because it is a standing obligation on every new input property rather than a single edit.

## What this plan does not settle

**What wins on a merge when two clones disagree about settledness.** The union-by-id merge compares four criterion fields and settledness is not among them. Adding it is mechanical, but the case where one clone confirmed a criterion and another struck it needs a stated winner, and neither the spec nor this plan states one. No task above touches `src/merge/field-merge.ts`, so the field simply does not participate in a merge until someone decides.

**Whether the reference head for the first subagent gate is right.** Named in MSP-2 Task 4 and worth confirming before that pull request opens.

**Whether the captured `SubagentStop` payload matches the spec.** MSP-2 Task 1 settles it by measurement. Everything downstream of it assumes `agent_id` is present and unique per subagent instance.
