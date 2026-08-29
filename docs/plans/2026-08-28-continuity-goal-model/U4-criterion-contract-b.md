# U4-B — Criterion contract, part B: what was observed, and the closing split

## 0. Identity

| | |
|---|---|
| **Closes** | `D18` — marking a criterion done is a bare array of ids, and nothing asks what was observed |
| **Carries** | `B9` (`update_thread.criteria_done` changes from an array of ids to an array of `{criterion_id, result, result_status}`), `B41` (`close_thread` reports the verified / unverified-reasoned split and refuses on neither) |
| **Asserts** | `A3` — for every criterion marked done, an empty `result` or an absent `result_status` is refused. `A2`, this unit's share — a `criterion_id` naming nothing on the thread it is given against is refused |
| **Depends on** | (a) the schema unit that adds `Criterion.check`, `Criterion.result`, `Criterion.result_status` and the cap `CRITERION_RESULT_MAX`; (b) **U4-A**, `feat/u4-criterion-contract-a`, which must already be merged into `main` before this branch is cut, because it creates the test file this unit extends. Section 11 gives the exact command for each |
| **Required by** | nothing in this ladder |
| **Wave** | 2 |
| **Branch** | `feat/u4-criterion-contract-b`, cut from `main`, pull request targets `main` |
| **PR title scope** | `criteria` |
| **Version bump** | Baseline `2.0.0` -> `3.0.0` per orchestrator ruling OR1, adjusted for the split recorded in section 3. MAJOR, because the published `update_thread.criteria_done` argument changes from an array of id strings to an array of objects. Step 8 performs it as a read-then-increment |
| **Owns** | `src/server/tools/update_thread.ts`, `src/server/tools/close_thread.ts` |
| **Also edits** | `test/contract/criteria-writers.test.ts` — a census whose classifier must be taught to distinguish a recorded observation from criterion text. See section 3, divergence `DIV-B4` |
| **Extends** | `test/contract/criterion-contract.test.ts`, created by U4-A |

### Terms used in this document, defined once

- **Criterion.** One statement of what must be true before a thread of work can be called finished.
- **Check.** The re-runnable thing that decides whether a criterion is true. U4-A made it a required argument wherever a criterion is created.
- **`result`.** What was observed when the check was run, or, when it could not be run, specifically why not. Never empty.
- **`result_status`.** Exactly two values. `verified` means the check was run and `result` is what it returned. `unverified-reasoned` means the check could not be run and `result` states specifically why. It describes **this run**, never the quality of the check. Logbook stores both values exactly as given, inspects neither, executes nothing, and judges nothing.
- **The split.** The counts of met criteria by `result_status`, reported when a thread is closed. Reporting it is the whole mechanism: closing is refused on neither count, because making the honest answer more expensive than the dishonest one only teaches callers to claim `verified`.
- **Refusal.** This project's structured rejection, always carrying four parts: the field that was wrong, what that field accepts, a valid example, and whether a retry can succeed.
- **Escaping.** `escapeStored` rewrites control characters into printable tokens before a value is stored. Every character cap in this repository is measured on the escaped form.

## 1. Acceptance criteria (the ceiling)

1. `update_thread.criteria_done` accepts only the object shape `{criterion_id, result, result_status}`; a bare array of criterion id strings is refused, and the refusal names the field, states that the old bare string is no longer accepted, and shows the object to send instead. — `B9`
2. Marking a criterion done stores the escaped `result` and the `result_status` on that criterion, and sets `done` to true. — `B9`
3. An empty or whitespace-only `result` is refused by a refusal naming `criteria_done`, and nothing is written. — `B9`, `A3`
4. An absent `result_status` is refused, and the refusal names `criteria_done.0.result_status` and gives `verified` as a valid example. — `B9`, `A3`
5. A `criterion_id` naming no criterion on the named thread is refused. — `A2`, this unit's share
6. Marking a criterion done a second time with a different `result` or a different `result_status` is refused and nothing is overwritten; resending the identical pair succeeds. — `B9`, and plan invariant `P2`: once marking done records a value, the existing silent no-op on an already-done criterion would become a silent overwrite
7. `close_thread` reports the split as three counts — `verified`, `unverified_reasoned`, `not_recorded` — in both its reply text and its structured reply. — `B41`
8. `close_thread` refuses on neither side of the split: a thread whose only met criterion is `unverified-reasoned` closes as done. — `B41`
9. `npm test` reports `fail 0` and exits 0; `npm run typecheck` exits 0; `node scripts/check-packaging.mjs` prints `check-packaging: ok` and exits 0. — plan invariants `P1` and `P4`
10. `package.json` and `.claude-plugin/plugin.json` carry the same version, one MAJOR step above the version read at the start of the work. — plan invariant `P4`

Anything discovered above this list is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is not folded into this plan.

## 2. Ground truth

Every line range below was read from the working tree at the tip of `main` while this plan was written. U4-A does not touch either of this unit's two production files, so these ranges hold on a branch cut from a `main` that contains U4-A.

### 2.1 `src/server/tools/update_thread.ts:37-43` — the input takes bare ids

```ts
const UpdateThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to update'),
  criteria_done: z
    .array(ulidField('the id of a completion criterion already present on this thread'))
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('criterion ids to mark done; an id not present on the thread is refused'),
```

Marking a criterion done is a bare array of ids. Nothing asks what was observed. That is defect `D18`.

### 2.2 `src/server/tools/update_thread.ts:116-123` — the struck-criterion refusal

```ts
const struckCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'only un-struck criterion ids present on this thread',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_done names criteria that have already been struck and cannot be marked done: ${ids.join(', ')}.`
})
```

This is the local pattern the new refusals follow: a module-level constant that is **not exported**, returning the four-part shape. The repository's refusal census (`test/contract/no-path.test.ts`, backed by `scanRefusalProducers` in `test/support/refusal-census.ts:193-248`) enumerates **exported** producers only, so a refusal declared this way does not grow that census.

### 2.3 `src/server/tools/update_thread.ts:178-195` — where criteria are marked done

```ts
    const criteriaDoneIds = input.criteria_done ?? []
    const unknownCriteria = criteriaDoneIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
    if (unknownCriteria.length > 0) {
      return { ok: false, refusal: unknownCriterionRefusal(unknownCriteria) }
    }
    const struckCriteria = criteriaDoneIds.filter((id) =>
      thread.completion_criteria.some((c) => c.id === id && c.struck_by !== null)
    )
    if (struckCriteria.length > 0) {
      return { ok: false, refusal: struckCriterionRefusal(struckCriteria) }
    }
    const markedDone = criteriaDoneIds.filter((id) => {
      const existing = thread.completion_criteria.find((c) => c.id === id)
      return existing !== undefined && !existing.done
    })
    const nextCriteria = thread.completion_criteria.map((c) =>
      criteriaDoneIds.includes(c.id) ? { ...c, done: true } : c
    )
```

Two things to see here. First, marking a criterion done writes one boolean and nothing else. Second, naming a criterion that is already done is a **silent no-op**: it is filtered out of `markedDone`, the call succeeds, and the reply says nothing about it. Once `done` carries a recorded observation beside it, that silence becomes a silent overwrite of a recorded value — see step 4's rationale.

### 2.4 `src/server/tools/update_thread.ts:165` — the published description

The full current value, whose relevant fragment step 5 replaces:

```
'Records mid-session progress on one thread: mark criteria done, refresh any of the six running-summary fields, set or clear what the thread is blocked on, and add or retire risks. Every argument is optional and only what is supplied is written, so a call carrying just criteria_done: ["<criterion ulid>"] changes nothing else. Risks are retired by id rather than by resubmitting the whole list, so a thread with fourteen risks costs one id to change one of them. The reply reports what changed, not what the record now holds.'
```

The worked example in the description shows the shape this unit removes.

### 2.5 `src/server/tools/close_thread.ts:25-29` — the reply carries no split

```ts
const CloseThreadOutputSchema = z.object({
  thread_id: z.string().describe('the id of the thread that was closed'),
  status: z.enum(['done', 'abandoned']).describe('the lifecycle state the thread now carries'),
  session_entry_id: z.string().describe('the id of the session log entry that recorded the closure detail')
})
```

### 2.6 `src/server/tools/close_thread.ts:116-124` — the successful reply

```ts
    return {
      ok: true,
      text: `closed thread ${thread.slug} as ${input.outcome}.`,
      structured: {
        thread_id: validated.value.id,
        status: input.outcome,
        session_entry_id: sessionEntry.id
      }
    }
```

Closing reports nothing about how the met criteria were decided.

### 2.7 `src/server/tools/close_thread.ts:8` — the import to widen

```ts
import { ThreadRecord } from '../../schema/thread.ts'
```

### 2.8 `src/server/tools/close_thread.ts:69` — the published description

The full current value, whose closing sentence step 7 extends:

```
'Closes one thread as either done or abandoned, and this cannot be undone through any tool. Closing as done is gated: every criterion that has not been struck must already be marked done and a closure statement must be supplied, and if any criterion is still open the call is refused and names each one. Closing as abandoned needs a reason instead, which is written to the session log rather than onto the thread. Reopening later means creating a new thread that references this one.'
```

### 2.9 `test/contract/criteria-writers.test.ts:47-62` — the census that this change collides with

```ts
export const classifyCriteriaTextProperty = (
  entry: SchemaProperty,
  toolHasThreadId: boolean
): Classified<SchemaProperty>['verdict'] | 'unclassifiable' => {
  const { node } = entry
  if (!isPlainObject(node)) return 'unclassifiable'
  if ('oneOf' in node || 'anyOf' in node || 'allOf' in node) return 'unclassifiable'

  const type = node.type
  if (type === undefined) return 'unclassifiable'
  if (type !== 'string') return 'allowed'

  if (!CRITERIA_DOMAIN_PATTERN.test(entry.topLevelName)) return 'allowed'
  if ('pattern' in node || 'enum' in node || 'const' in node) return 'allowed'

  return toolHasThreadId ? 'forbidden' : 'allowed'
}
```

This census protects one property: only `amend_criteria` may write the **text** of a criterion that already exists. It decides by name — any free-text string under a top-level argument whose name matches `/criteri/i`, on a tool that also takes a `thread_id`, is forbidden. The new `criteria_done[].result` is a free-text string under `criteria_done` on `update_thread`, so the census classifies it `forbidden` and halts. Observed while this plan was written: without the edits in section 5.3, `criteria.no-other-tool-writes-criteria` fails.

`result` is not criterion text. It is what was observed. Section 5.3 answers the halt by teaching the classifier which property is the criterion's statement, and adds two control tests pinning the new verdict at both ends. The population is not narrowed, nothing is excluded, no count is pinned and no allowlist is added.

### 2.10 What happens when a `result` pushes the stored record past its whole-record cap

`commitThread` (`src/server/tool-support.ts:124-138`) measures the serialised thread record before validating it, and refuses the whole call when it exceeds `THREAD_RECORD_SERIALISED_MAX_BYTES = 65536`. Nothing is shortened and nothing is written. The refusal carries `field: 'thread'`, the observed byte count, the name and size of the record's largest field, and the remedy "remove or shorten an entry in `<that field>` and retry".

Measured headroom: the largest thread record in the live store is 39,079 bytes, and the worst case once this ladder populates the new criterion fields is 50,027 bytes, against the 65,536-byte cap. A `result` long enough to push a record over is therefore possible only on a record already near the cap. This unit changes none of that behaviour, and adds a separate per-field refusal, declared in step 2 and applied in step 4, so that an oversized `result` is named as such before the whole-record cap is ever reached.

## 3. Divergences from the SPEC

- **`DIV-B1` — the external decomposition procedure is absent, and nothing here depends on it.** `~/.claude/skills/mitosis/SKILL.md` does not exist on disk. This plan was written from the planning brief and the orchestrator rulings alone, which are jointly self-contained.
- **`DIV-B2` — the unit is split, and this is part B.** Applied to a throwaway copy of the tree and measured, the whole unit is 760 changed lines, 1.9 times the 400-line review ceiling. Part A lands the check on the two creation paths; this part lands the recorded observation and the closing report. This part is cut from a `main` that already contains part A, and section 11 proves it.
- **`DIV-B3` — the bare id array is refused by the input schema, not by a purpose-written refusal function.** The unit's green cell asks for a *named* refusal. A purpose-written refusal in the handler is unreachable: the handler runs only after the declared input schema has parsed the arguments (`src/server/register.ts:96-106`), so a bare string element is rejected before any handler code executes. The only way to reach the handler with the old shape is to publish an input schema that accepts a string — a published contract that says one thing and does another, which is exactly the class of defect this specification exists to remove.

  Ruling applied: the element schema's own description carries the migration, and the project's standard refusal builder renders it into all four parts. The refusal a caller sending the old shape actually receives, produced and read while this plan was written, is:

  ```
  field: criteria_done.0
  accepted: object one criterion to mark done, as an object carrying what was observed; the bare criterion id string this argument took before is refused, so send {"criterion_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "result": "436 tests, 0 fail, exit 0", "result_status": "verified"} in place of "01ARZ3NDEKTSV4RRFFQ69G5FAV"
  example: {"criterion_id":"00000000000000000000000000","result":"x","result_status":"verified"}
  retryable: true
  criteria_done.0 was refused; it accepts object one criterion to mark done, as an object carrying what was observed; the bare criterion id string this argument took before is refused, so send {"criterion_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "result": "436 tests, 0 fail, exit 0", "result_status": "verified"} in place of "01ARZ3NDEKTSV4RRFFQ69G5FAV"; a valid example is {"criterion_id":"00000000000000000000000000","result":"x","result_status":"verified"}; retryable=true.
  ```

  It names the field, names the shape that is gone, shows the shape to send, gives a machine-usable example and says a retry can succeed. That is the whole migration path for an external caller. Rejected: publishing a union that accepts a string and rejecting it in the handler, which lies in the published schema and, additionally, makes the census in section 2.9 halt on an unclassifiable `anyOf` node.

- **`DIV-B4` — this unit edits `test/contract/criteria-writers.test.ts`, which no unit owns.** Its classifier halts on the new `criteria_done[].result` property. The halt is answered by classifying the new member, which is what section 5.3 does; it is never answered by excluding it. Section 2.9 states the reasoning and section 5.3 records the residual gap that is filed rather than fixed.
- **`DIV-B5` — the whole-record cap refusal does name a field.** The whole-record byte cap is sometimes described as refusing without naming which field overflowed. The shipped code names the record's largest field and the observed byte count (`src/server/tool-support.ts:90-100`), which was read while this plan was written. Section 2.10 states the behaviour as the code actually has it. Filed as an item above this unit's ceiling.
- **`DIV-B6` — both halves of the split take a MAJOR bump, so the ladder's version table shifts by one MAJOR.** Part A changes the published shape of `open_thread.completion_criteria`; part B changes the published shape of `update_thread.criteria_done`. Both are breaking to an external caller. Semantic versioning answers to the published contract, so each takes its own MAJOR step. Step 8 reads the current version rather than assuming one, so a further shift anywhere in the ladder does not invalidate this plan.

## 4. The change, step by step

Apply the steps in the order given. Production code is type-correct after step 9; the whole tree, tests included, typechecks and the suite passes only after section 5 has also been applied. Step 10 is the version bump and touches no code.

### Step 1 — `src/server/tools/update_thread.ts` — REPLACE

FIND (exact, unique):

```ts
const UpdateThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to update'),
  criteria_done: z
    .array(ulidField('the id of a completion criterion already present on this thread'))
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('criterion ids to mark done; an id not present on the thread is refused'),
```

REPLACE with:

```ts
const CriterionDoneSchema = z
  .strictObject({
    criterion_id: ulidField('the id of a completion criterion already present on this thread'),
    result: z
      .string()
      .max(caps.CRITERION_RESULT_MAX)
      .describe('what the check returned, or when it could not be run, specifically why it could not'),
    result_status: z
      .enum(['verified', 'unverified-reasoned'])
      .describe('verified when the check was run and result is what it returned; unverified-reasoned when the check could not be run and result says why')
  })
  .describe('one criterion to mark done, as an object carrying what was observed; the bare criterion id string this argument took before is refused, so send {"criterion_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "result": "436 tests, 0 fail, exit 0", "result_status": "verified"} in place of "01ARZ3NDEKTSV4RRFFQ69G5FAV"')

const UpdateThreadInputSchema = z.strictObject({
  thread_id: ulidField('the id of the thread to update'),
  criteria_done: z
    .array(CriterionDoneSchema)
    .max(caps.CRITERIA_MAX_ELEMENTS)
    .optional()
    .describe('criteria to mark done, each carrying what was observed; an id not present on the thread is refused'),
```

Rationale: `B9`, `A3`. `result_status` is a two-value enum so an absent or unrecognised value is refused by the schema and named to the caller. `result` deliberately carries **no** `.min(1)`: an empty string then reaches the handler, where step 4 refuses it with a purpose-written refusal that says what the value is for. The element's description is what a caller sending the old shape reads back — see divergence `DIV-B3`.

### Step 2 — `src/server/tools/update_thread.ts` — INSERT-BEFORE

FIND (exact, unique):

```ts
const struckCriterionRefusal = (ids: string[]): Refusal => ({
```

REPLACE with:

```ts
const duplicateCriterionRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'at most one entry per criterion id in a single call',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: true,
  message: `criteria_done names the same criterion more than once, so no single result could be stored for it: ${ids.join(', ')}.`
})

const emptyResultRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'a non-empty result on every entry, stating what the check returned or why it could not be run',
  example: '436 tests, 0 fail, exit 0',
  retryable: true,
  message: `criteria_done carries an empty result for these criteria, and a criterion is never marked done without one: ${ids.join(', ')}.`
})

const resultCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: `at most ${caps.CRITERION_RESULT_MAX} characters after escaping, per result`,
  example: '436 tests, 0 fail, exit 0',
  retryable: true,
  message: `criteria_done[${index}].result exceeds its cap of ${caps.CRITERION_RESULT_MAX} characters after escaping; observed ${observed}; remedy: shorten the result, record the detail through log_session_event, and retry.`
})

const contradictoryResultRefusal = (ids: string[]): Refusal => ({
  ok: false,
  field: 'criteria_done',
  accepted: 'a criterion that is not already done, or the same result and result_status it was already marked done with',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `criteria_done would overwrite the recorded result of a criterion already marked done, and a recorded result is never rewritten: ${ids.join(', ')}.`
})

const struckCriterionRefusal = (ids: string[]): Refusal => ({
```

Rationale: `B9`, `A3`. Four refusals, each for one way the call cannot do what was asked. None is exported, matching `struckCriterionRefusal` beside them, so the refusal census in `test/contract/no-path.test.ts` is unchanged.

### Step 3 — `src/server/tools/update_thread.ts` — REPLACE

FIND (exact, unique):

```ts
    const criteriaDoneIds = input.criteria_done ?? []
    const unknownCriteria = criteriaDoneIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
```

REPLACE with:

```ts
    const criteriaDone = input.criteria_done ?? []
    const criteriaDoneIds = criteriaDone.map((entry) => entry.criterion_id)
    const duplicatedIds = criteriaDoneIds.filter((id, index) => criteriaDoneIds.indexOf(id) !== index)
    if (duplicatedIds.length > 0) {
      return { ok: false, refusal: duplicateCriterionRefusal([...new Set(duplicatedIds)]) }
    }
    const unknownCriteria = criteriaDoneIds.filter((id) => !thread.completion_criteria.some((c) => c.id === id))
```

Rationale: `B9`, `A2`. Two entries naming the same criterion carry two different observations and only one can be stored, so the call is refused rather than silently keeping one of them. The existing unknown-id and struck-id refusals below are untouched and keep naming `criteria_done`, which is this unit's share of `A2`.

### Step 4 — `src/server/tools/update_thread.ts` — REPLACE

FIND (exact, unique):

```ts
    if (struckCriteria.length > 0) {
      return { ok: false, refusal: struckCriterionRefusal(struckCriteria) }
    }
    const markedDone = criteriaDoneIds.filter((id) => {
      const existing = thread.completion_criteria.find((c) => c.id === id)
      return existing !== undefined && !existing.done
    })
    const nextCriteria = thread.completion_criteria.map((c) =>
      criteriaDoneIds.includes(c.id) ? { ...c, done: true } : c
    )
```

REPLACE with:

```ts
    if (struckCriteria.length > 0) {
      return { ok: false, refusal: struckCriterionRefusal(struckCriteria) }
    }
    const emptyResults = criteriaDone.filter((entry) => entry.result.trim().length === 0)
    if (emptyResults.length > 0) {
      return { ok: false, refusal: emptyResultRefusal(emptyResults.map((entry) => entry.criterion_id)) }
    }
    const escapedResults = criteriaDone.map((entry) => escapeStored(entry.result))
    const oversizedResultIndex = escapedResults.findIndex((result) => result.length > caps.CRITERION_RESULT_MAX)
    if (oversizedResultIndex !== -1) {
      const oversized = escapedResults[oversizedResultIndex]
      return {
        ok: false,
        refusal: resultCapRefusal(oversizedResultIndex, oversized === undefined ? 0 : oversized.length)
      }
    }
    const completions = new Map(
      criteriaDone.map((entry, index) => [
        entry.criterion_id,
        { result: escapedResults[index] as string, result_status: entry.result_status }
      ])
    )
    const contradicted = criteriaDone.filter((entry) => {
      const existing = thread.completion_criteria.find((c) => c.id === entry.criterion_id)
      if (existing === undefined || !existing.done) return false
      const completion = completions.get(entry.criterion_id)
      return existing.result !== completion?.result || existing.result_status !== completion?.result_status
    })
    if (contradicted.length > 0) {
      return { ok: false, refusal: contradictoryResultRefusal(contradicted.map((entry) => entry.criterion_id)) }
    }
    const markedDone = criteriaDoneIds.filter((id) => {
      const existing = thread.completion_criteria.find((c) => c.id === id)
      return existing !== undefined && !existing.done
    })
    const nextCriteria = thread.completion_criteria.map((c) => {
      const completion = completions.get(c.id)
      return completion === undefined
        ? c
        : { ...c, done: true, result: completion.result, result_status: completion.result_status }
    })
```

Rationale: `B9`, `A3`. Four things happen in order, and every one of them refuses rather than proceeding quietly.

An empty result is refused first, because a criterion is never marked done without a statement of what was observed. The result is then escaped and its cap measured on the escaped form, matching every other cap in this repository, and a value over the cap refuses the whole call rather than being shortened.

The `contradicted` check exists because the ground truth in section 2.3 shows that naming an already-done criterion used to be a silent no-op. Once `done` carries a recorded observation beside it, that silence would either discard the new observation or overwrite the recorded one, and both are a write no caller was told about. Resending the identical pair still succeeds, so a retry after a transient failure is safe; only a *different* observation is refused, and it is refused as non-retryable because retrying the same call cannot make it succeed. Rejected: last-write-wins, which rewrites a recorded value, and refusing every repeat, which makes an ordinary retry fail.

### Step 5 — `src/server/tools/update_thread.ts` — REPLACE

FIND (exact, unique) — a fragment of the one-line description string at line 165:

```
so a call carrying just criteria_done: ["<criterion ulid>"] changes nothing else.
```

REPLACE with:

```
so a call carrying just criteria_done: [{"criterion_id": "<criterion ulid>", "result": "<what the check returned>", "result_status": "verified"}] changes nothing else. Marking a criterion done records what was observed and whether the check was actually run, and it is refused without both.
```

Rationale: `B9`. A published description whose worked example is a call that now refuses is worse than no example.

### Step 6 — `src/server/tools/close_thread.ts` — REPLACE

FIND (exact, unique):

```ts
import { ThreadRecord } from '../../schema/thread.ts'
```

REPLACE with:

```ts
import { ThreadRecord, type Thread } from '../../schema/thread.ts'
```

Rationale: `B41`. The split is computed from a validated thread record, so the function that computes it needs the type.

### Step 7 — `src/server/tools/close_thread.ts` — REPLACE

FIND (exact, unique):

```ts
  session_entry_id: z.string().describe('the id of the session log entry that recorded the closure detail')
})
```

REPLACE with:

```ts
  session_entry_id: z.string().describe('the id of the session log entry that recorded the closure detail'),
  result_status_split: z
    .object({
      verified: z.number().int().describe('how many met criteria recorded a check that was actually run'),
      unverified_reasoned: z
        .number()
        .int()
        .describe('how many met criteria recorded a check that could not be run, with the reason'),
      not_recorded: z.number().int().describe('how many met criteria carry no recorded result at all')
    })
    .describe('how the met criteria on this thread divide by how their result was obtained')
})

type ResultStatusSplit = { verified: number; unverified_reasoned: number; not_recorded: number }

const resultStatusSplitOf = (thread: Thread): ResultStatusSplit => {
  const met = thread.completion_criteria.filter((criterion) => criterion.struck_by === null && criterion.done)
  const verified = met.filter((criterion) => criterion.result_status === 'verified').length
  const unverifiedReasoned = met.filter((criterion) => criterion.result_status === 'unverified-reasoned').length
  return {
    verified,
    unverified_reasoned: unverifiedReasoned,
    not_recorded: met.length - verified - unverifiedReasoned
  }
}

const renderResultStatusSplit = (split: ResultStatusSplit): string =>
  `criteria met: ${split.verified} verified, ${split.unverified_reasoned} unverified-reasoned, ${split.not_recorded} not recorded.`
```

Rationale: `B41`. Three counts, always all three, computed over the criteria that are met and not struck. The third count exists because a criterion marked done before this ladder carries no recorded result, and reporting it as `verified` would be a claim nobody made; reporting it as absent is what the system promises.

### Step 8 — `src/server/tools/close_thread.ts` — REPLACE

FIND (exact, unique):

```ts
    return {
      ok: true,
      text: `closed thread ${thread.slug} as ${input.outcome}.`,
      structured: {
        thread_id: validated.value.id,
        status: input.outcome,
        session_entry_id: sessionEntry.id
      }
    }
```

REPLACE with:

```ts
    const split = resultStatusSplitOf(validated.value)

    return {
      ok: true,
      text: `closed thread ${thread.slug} as ${input.outcome}; ${renderResultStatusSplit(split)}`,
      structured: {
        thread_id: validated.value.id,
        status: input.outcome,
        session_entry_id: sessionEntry.id,
        result_status_split: split
      }
    }
```

Rationale: `B41`. The split is reported after the close has succeeded, on both the human-readable and the machine-readable channel, and it is reported unconditionally. Nothing above this point in the handler consults it, which is what "refuses on neither" means in code.

A thread closed with one criterion verified and one unverified-reasoned produces exactly this reply text, produced and read while this plan was written:

```
closed thread the-split as done; criteria met: 1 verified, 1 unverified-reasoned, 0 not recorded.
```

and this structured value:

```json
{ "verified": 1, "unverified_reasoned": 1, "not_recorded": 0 }
```

### Step 9 — `src/server/tools/close_thread.ts` — REPLACE

FIND (exact, unique) — the final sentence of the one-line description string at line 69:

```
Reopening later means creating a new thread that references this one.'
```

REPLACE with:

```
Reopening later means creating a new thread that references this one. The reply reports how the met criteria divide between checks that were run and checks that could not be, and neither count is ever a reason to refuse.'
```

Rationale: `B41`. The published description states that the split is reported and that it never blocks, so a caller does not have to discover by experiment that an honest downgrade is safe to send.

### Step 10 — the version bump, as a read-then-increment

1. Read the current version:

   ```
   node -p "require('./package.json').version"
   ```

2. Compute the next version by setting MAJOR to MAJOR plus one, MINOR to 0 and PATCH to 0. This unit is a MAJOR step; the published `update_thread.criteria_done` argument changes shape.

3. Write that exact value into the `"version"` field of `package.json` and into the `"version"` field of `.claude-plugin/plugin.json`, in the same commit. Change nothing else in either file.

4. Run:

   ```
   node scripts/check-packaging.mjs
   ```

   Expect exit 0 and the output `check-packaging: ok`.

## 5. Tests

### 5.1 `test/contract/criterion-contract.test.ts` — MODIFY

This file was created by U4-A. Two edits.

**Edit 1 — the imports.**

FIND (exact, unique):

```ts
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
```

REPLACE with:

```ts
import { updateThreadTool } from '../../src/server/tools/update_thread.ts'
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
import { closeThreadTool } from '../../src/server/tools/close_thread.ts'
```

**Edit 2 — append these eight tests at the end of the file**, after the last existing test, keeping the existing helpers `withCriterionFixture`, `openFixtureThread` and `readStoredCriteria` exactly as U4-A wrote them:

```ts
test('criterion.criteria-done-refuses-the-bare-criterion-id-array', () => {
  const declared = declare<unknown>(updateThreadTool.name, updateThreadTool.input)
  const refusal = declared.parse({
    thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    criteria_done: ['01ARZ3NDEKTSV4RRFFQ69G5FAV']
  })
  assert.equal(refusal.ok, false)
  if (refusal.ok) throw new Error('expected update_thread to refuse a bare criterion id array')
  assert.equal(refusal.field, 'criteria_done.0')
  assert.equal(refusal.retryable, true)
  assert.match(refusal.accepted, /the bare criterion id string this argument took before is refused/)
  assert.match(refusal.accepted, /"criterion_id".*"result".*"result_status"/)
  assert.match(refusal.example, /"criterion_id"/)
  assert.match(refusal.example, /"result_status"/)
})

test('criterion.criteria-done-records-the-result-and-its-status', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'records-the-result', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const criterionId = criterionIds[0] as string
    const marked = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '436 tests, 0 fail, exit 0', result_status: 'verified' }]
    })
    assert.equal(marked.ok, true)
    if (!marked.ok) throw new Error('expected update_thread to mark the criterion done')
    assert.deepEqual(marked.structured.criteria_marked_done, [criterionId])
    const stored = readStoredCriteria(rt, threadId)
    assert.equal(stored[0]?.done, true)
    assert.equal(stored[0]?.result, '436 tests, 0 fail, exit 0')
    assert.equal(stored[0]?.result_status, 'verified')
  })
})

test('criterion.criteria-done-refuses-an-empty-result', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'empty-result', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const criterionId = criterionIds[0] as string
    const refused = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '   ', result_status: 'verified' }]
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected update_thread to refuse an empty result')
    assert.equal(refused.refusal.field, 'criteria_done')
    assert.equal(
      refused.refusal.accepted,
      'a non-empty result on every entry, stating what the check returned or why it could not be run'
    )
    assert.equal(refused.refusal.retryable, true)
    assert.match(refused.refusal.message, /a criterion is never marked done without one/)
    assert.equal(readStoredCriteria(rt, threadId)[0]?.done, false)
  })
})

test('criterion.criteria-done-refuses-an-absent-result-status', () => {
  const declared = declare<unknown>(updateThreadTool.name, updateThreadTool.input)
  const refusal = declared.parse({
    thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    criteria_done: [{ criterion_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', result: 'the check was run' }]
  })
  assert.equal(refusal.ok, false)
  if (refusal.ok) throw new Error('expected update_thread to refuse an absent result_status')
  assert.equal(refusal.field, 'criteria_done.0.result_status')
  assert.equal(refusal.example, 'verified')
  assert.match(refusal.accepted, /enum=verified,unverified-reasoned/)
})

test('criterion.criteria-done-refuses-an-id-that-names-no-criterion-on-the-thread', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'unknown-criterion', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const strangerId = rt.ulid()
    const refused = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: strangerId, result: 'the check was run', result_status: 'verified' }]
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected update_thread to refuse a criterion id that is not on the thread')
    assert.equal(refused.refusal.field, 'criteria_done')
    assert.match(refused.refusal.message, /names ids not present on this thread/)
  })
})

test('criterion.criteria-done-refuses-overwriting-a-recorded-result', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'no-overwrite', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const criterionId = criterionIds[0] as string
    const first = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '436 tests, 0 fail, exit 0', result_status: 'verified' }]
    })
    assert.equal(first.ok, true)

    const repeated = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: '436 tests, 0 fail, exit 0', result_status: 'verified' }]
    })
    assert.equal(repeated.ok, true, 'resending the same result must not be refused')

    const contradiction = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: 'a different result', result_status: 'verified' }]
    })
    assert.equal(contradiction.ok, false)
    if (contradiction.ok) throw new Error('expected update_thread to refuse overwriting a recorded result')
    assert.equal(contradiction.refusal.field, 'criteria_done')
    assert.equal(contradiction.refusal.retryable, false)
    assert.equal(readStoredCriteria(rt, threadId)[0]?.result, '436 tests, 0 fail, exit 0')
  })
})

test('criterion.close-thread-prints-the-verified-and-unverified-reasoned-split', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'the-split', [
      { text: 'the health check ships', check: 'npm test exits 0' },
      { text: 'the mutation score holds', check: 'npm run mutate reports at least 75 percent' }
    ])
    const marked = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [
        { criterion_id: criterionIds[0] as string, result: '436 tests, 0 fail, exit 0', result_status: 'verified' },
        {
          criterion_id: criterionIds[1] as string,
          result: 'the mutation run takes 152 minutes and was not performed on this machine',
          result_status: 'unverified-reasoned'
        }
      ]
    })
    assert.equal(marked.ok, true)

    const closed = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      outcome: 'done',
      detail: 'shipped the criterion contract'
    })
    assert.equal(closed.ok, true)
    if (!closed.ok) throw new Error('expected close_thread to close a thread carrying an unverified-reasoned criterion')
    assert.deepEqual(closed.structured.result_status_split, {
      verified: 1,
      unverified_reasoned: 1,
      not_recorded: 0
    })
    assert.equal(
      closed.text,
      'closed thread the-split as done; criteria met: 1 verified, 1 unverified-reasoned, 0 not recorded.'
    )
  })
})

test('criterion.close-thread-refuses-on-neither-side-of-the-split', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId, criterionIds } = await openFixtureThread(rt, 'no-refusal', [
      { text: 'the mutation score holds', check: 'npm run mutate reports at least 75 percent' }
    ])
    const marked = await updateThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      criteria_done: [
        {
          criterion_id: criterionIds[0] as string,
          result: 'the mutation run takes 152 minutes and was not performed on this machine',
          result_status: 'unverified-reasoned'
        }
      ]
    })
    assert.equal(marked.ok, true)

    const closed = await closeThreadTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      outcome: 'done',
      detail: 'shipped what could be shipped and recorded what could not be verified'
    })
    assert.equal(closed.ok, true)
    if (!closed.ok) throw new Error('a thread whose only met criterion is unverified-reasoned must still close')
    assert.deepEqual(closed.structured.result_status_split, {
      verified: 0,
      unverified_reasoned: 1,
      not_recorded: 0
    })
  })
})
```

### 5.2 Which test discharges which acceptance criterion

| Acceptance criterion | Test |
|---|---|
| 1 — the bare id array is refused (`B9`) | `criterion.criteria-done-refuses-the-bare-criterion-id-array` |
| 2 — the result and its status are stored (`B9`) | `criterion.criteria-done-records-the-result-and-its-status` |
| 3 — an empty result is refused (`B9`, `A3`) | `criterion.criteria-done-refuses-an-empty-result` |
| 4 — an absent result_status is refused (`B9`, `A3`) | `criterion.criteria-done-refuses-an-absent-result-status` |
| 5 — an unknown criterion id is refused (`A2`) | `criterion.criteria-done-refuses-an-id-that-names-no-criterion-on-the-thread` |
| 6 — a recorded result is never overwritten (`B9`, `P2`) | `criterion.criteria-done-refuses-overwriting-a-recorded-result` |
| 7 — the split is reported (`B41`) | `criterion.close-thread-prints-the-verified-and-unverified-reasoned-split` |
| 8 — closing refuses on neither count (`B41`) | `criterion.close-thread-refuses-on-neither-side-of-the-split` |
| 9 — the suite, the typecheck and the packaging check (`P1`, `P4`) | section 8 |
| 10 — the two manifests agree (`P4`) | `node scripts/check-packaging.mjs` in section 8 |

**Honesty note on acceptance criterion 5.** `criterion.criteria-done-refuses-an-id-that-names-no-criterion-on-the-thread` was run at this unit's parent commit and **passed** there. That is correct and expected: `A2` is an invariant this unit must not lose, not a behaviour it introduces. The unknown-id refusal already exists at `src/server/tools/update_thread.ts:107-114` and this unit keeps it, so the test is a preservation assertion, not a receipt. It is recorded as such rather than presented as a red-on-parent proof.

### 5.3 The census in `test/contract/criteria-writers.test.ts` — MODIFY

Section 2.9 states why this is necessary. Four edits.

**Edit 1.**

FIND (exact, unique):

```ts
const CRITERIA_DOMAIN_PATTERN = /criteri/i
```

REPLACE with:

```ts
const CRITERIA_DOMAIN_PATTERN = /criteri/i
const CRITERION_STATEMENT_LEAF = 'text'
const ARRAY_ELEMENT_SUFFIX = '[]'
```

**Edit 2.**

FIND (exact, unique):

```ts
export const classifyCriteriaTextProperty = (
```

REPLACE with:

```ts
const isCriterionStatementProperty = (path: string): boolean =>
  path.endsWith(ARRAY_ELEMENT_SUFFIX) || path.slice(path.lastIndexOf('.') + 1) === CRITERION_STATEMENT_LEAF

export const classifyCriteriaTextProperty = (
```

**Edit 3.**

FIND (exact, unique):

```ts
  if ('pattern' in node || 'enum' in node || 'const' in node) return 'allowed'

  return toolHasThreadId ? 'forbidden' : 'allowed'
```

REPLACE with:

```ts
  if ('pattern' in node || 'enum' in node || 'const' in node) return 'allowed'
  if (!isCriterionStatementProperty(entry.path)) return 'allowed'

  return toolHasThreadId ? 'forbidden' : 'allowed'
```

**Edit 4 — two new control tests.**

FIND (exact, unique):

```ts
test('criteria.no-other-tool-writes-criteria.control.unrelated-scope-text-is-allowed', () => {
```

REPLACE with:

```ts
test('criteria.no-other-tool-writes-criteria.control.a-recorded-observation-is-not-criterion-text', () => {
  const resultProperty: SchemaProperty = {
    path: 'criteria_done[].result',
    topLevelName: 'criteria_done',
    node: {
      type: 'string',
      maxLength: caps.CRITERION_RESULT_MAX,
      description: 'what the check returned, or when it could not be run, specifically why it could not'
    }
  }
  assert.equal(classifyCriteriaTextProperty(resultProperty, true), 'allowed')
})

test('criteria.no-other-tool-writes-criteria.control.a-bare-criteria-array-element-on-a-thread-tool-is-forbidden', () => {
  const bareElementProperty: SchemaProperty = {
    path: 'criteria_replace[]',
    topLevelName: 'criteria_replace',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'replacement text for a criterion' }
  }
  assert.equal(classifyCriteriaTextProperty(bareElementProperty, true), 'forbidden')
})

test('criteria.no-other-tool-writes-criteria.control.unrelated-scope-text-is-allowed', () => {
```

The three control tests already in that file keep passing unchanged: `criteria_rewrite[].text` on a thread-bearing tool is still `forbidden`, a bare `completion_criteria[]` string on a creation-only tool is still `allowed`, and a patterned `criteria_done[]` id is still `allowed`.

**What this refinement does not cover, and is filed rather than fixed.** After it, a criteria-domain free-text property whose leaf name is neither `text` nor the array element itself — a hypothetical `criteria_rewrite[].wording` — is classified `allowed` on a thread-bearing tool. That gap is filed as an item above this unit's ceiling and is not closed here.

### 5.4 Existing tests updated

Each entry below constructs the old bare-id `criteria_done` shape. Every one is answered by updating it to the new shape. None is deleted, skipped, focused, or excluded.

`test/contract/no-path.test.ts` — one site.

FIND:
```ts
      criteria_done: [rt.ulid()]
```
REPLACE:
```ts
      criteria_done: [{ criterion_id: rt.ulid(), result: 'the census result', result_status: 'verified' }]
```

`test/spawn/decisions.test.ts` — one site, inside the `markCriterionDone` helper, which leaves every caller unchanged.

FIND:
```ts
    arguments: { thread_id: threadId, criteria_done: [criterionId] }
```
REPLACE:
```ts
    arguments: {
      thread_id: threadId,
      criteria_done: [{ criterion_id: criterionId, result: 'the fixture check was run', result_status: 'verified' }]
    }
```

`test/spawn/lifecycle.test.ts` — three sites.

FIND:
```ts
      criteria_done: [criterionId],
      active_goal: activeGoal
```
REPLACE:
```ts
      criteria_done: [
        { criterion_id: criterionId, result: 'the fixture check was run and returned this', result_status: 'verified' }
      ],
      active_goal: activeGoal
```

FIND:
```ts
      arguments: { thread_id: threadId, criteria_done: [criterionId] }
```
REPLACE:
```ts
      arguments: {
        thread_id: threadId,
        criteria_done: [
          { criterion_id: criterionId, result: 'the fixture check was run and returned this', result_status: 'verified' }
        ]
      }
```

FIND:
```ts
      arguments: { thread_id: threadId, criteria_done: [struckId] }
```
REPLACE:
```ts
      arguments: {
        thread_id: threadId,
        criteria_done: [{ criterion_id: struckId, result: 'the check was run', result_status: 'verified' }]
      }
```

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time, which by section 11.1 already contains U4-A.

Procedure, run from the repository root on a clean checkout of the parent commit:

1. Apply only the two edits in section 5.1 to `test/contract/criterion-contract.test.ts`. Apply no other step from section 4 or 5.
2. Run:

   ```
   node --test test/contract/criterion-contract.test.ts
   ```

3. Expect exit 1. U4-A's four tests pass. Of the eight appended tests, **seven fail** and one passes:

   | Test | Expected at the parent |
   |---|---|
   | `criterion.criteria-done-refuses-the-bare-criterion-id-array` | `✖`, `AssertionError`, `actual: true`, `expected: false` |
   | `criterion.criteria-done-records-the-result-and-its-status` | `✖`, `actual: false`, `expected: true` |
   | `criterion.criteria-done-refuses-an-empty-result` | `✖`, `actual: 'only criterion ids already present on this thread'`, `expected: 'a non-empty result on every entry, stating what the check returned or why it could not be run'` |
   | `criterion.criteria-done-refuses-an-absent-result-status` | `✖`, `actual: 'criteria_done.0'`, `expected: 'criteria_done.0.result_status'` |
   | `criterion.criteria-done-refuses-an-id-that-names-no-criterion-on-the-thread` | `✔` — see the honesty note in section 5.2 |
   | `criterion.criteria-done-refuses-overwriting-a-recorded-result` | `✖`, `actual: false`, `expected: true` |
   | `criterion.close-thread-prints-the-verified-and-unverified-reasoned-split` | `✖`, `actual: false`, `expected: true` |
   | `criterion.close-thread-refuses-on-neither-side-of-the-split` | `✖`, `actual: false`, `expected: true` |

4. Revert the file to its committed state before applying section 4.

Every row above was produced and read while this plan was written, against a tree carrying U4-A and none of section 4's edits.

## 7. Inertness mutation

Each mutation is applied on top of the finished change, the named test is run, and the change is then restored exactly. Every expected red below was produced and read while this plan was written.

### `M-B1` — acceptance criteria 1 and 4

Edit `src/server/tools/update_thread.ts`. Change:

```ts
    .array(CriterionDoneSchema)
```

to:

```ts
    .array(ulidField('the id of a completion criterion already present on this thread'))
```

Run `node --test test/contract/criterion-contract.test.ts`.

Expect `✖ criterion.criteria-done-refuses-the-bare-criterion-id-array` and `✖ criterion.criteria-done-refuses-an-absent-result-status`.

Restore by changing the line back to `.array(CriterionDoneSchema)`.

### `M-B2` — acceptance criteria 2, 6, 7 and 8

Edit `src/server/tools/update_thread.ts`. In the mapping added by step 4, change:

```ts
        : { ...c, done: true, result: completion.result, result_status: completion.result_status }
```

to:

```ts
        : { ...c, done: true }
```

Run `node --test test/contract/criterion-contract.test.ts`.

Expect four reds: `✖ criterion.criteria-done-records-the-result-and-its-status`, `✖ criterion.criteria-done-refuses-overwriting-a-recorded-result`, `✖ criterion.close-thread-prints-the-verified-and-unverified-reasoned-split`, `✖ criterion.close-thread-refuses-on-neither-side-of-the-split`.

Restore by putting the two fields back.

### `M-B3` — acceptance criterion 3

Edit `src/server/tools/update_thread.ts`. Delete this whole block added by step 4:

```ts
    const emptyResults = criteriaDone.filter((entry) => entry.result.trim().length === 0)
    if (emptyResults.length > 0) {
      return { ok: false, refusal: emptyResultRefusal(emptyResults.map((entry) => entry.criterion_id)) }
    }
```

Run `node --test test/contract/criterion-contract.test.ts`.

Expect `✖ criterion.criteria-done-refuses-an-empty-result`.

Restore by re-inserting the block immediately after the struck-criterion guard.

### `M-B4` — acceptance criteria 7 and 8

Edit `src/server/tools/close_thread.ts`. In the reply built by step 8, change:

```ts
        result_status_split: split
```

to:

```ts
        result_status_split: { verified: 0, unverified_reasoned: 0, not_recorded: 0 }
```

Run `node --test test/contract/criterion-contract.test.ts`.

Expect `✖ criterion.close-thread-prints-the-verified-and-unverified-reasoned-split` and `✖ criterion.close-thread-refuses-on-neither-side-of-the-split`.

Restore by changing the value back to `split`.

### Acceptance criterion 5

No inertness mutation. `A2`'s unknown-id refusal is not added by this unit; it is preserved by it. Section 5.2 records that, and the criterion ships as a preservation assertion rather than as a receipt.

## 8. Full verification

Run all four, from the repository root, after every step in sections 4 and 5 has been applied.

1. ```
   npm run typecheck
   ```
   Expect exit 0 and no output. Any output at all is a type error and a stop condition.

2. ```
   node scripts/check-packaging.mjs
   ```
   Expect exit 0 and the output line `check-packaging: ok`.

3. ```
   node --test test/contract/criterion-contract.test.ts
   ```
   Expect exit 0, `ℹ fail 0`, and twelve `✔` lines: U4-A's four plus this unit's eight.

4. ```
   node --test test/contract/criteria-writers.test.ts
   ```
   Expect exit 0 and `ℹ fail 0`. This is the census from section 2.9; running it on its own makes a halt legible before the whole suite buries it.

5. ```
   npm test
   ```
   Expect exit 0 and the summary line `ℹ fail 0`. Do not compare the `ℹ tests` count against any number written down anywhere; this unit adds ten tests to whatever the parent carried, and a pinned total is a test that fails on unrelated growth.

   The full suite was run under U4-A plus this exact change on a throwaway copy of the tree while this plan was written: `ℹ tests 450`, `ℹ pass 450`, `ℹ fail 0`, exit 0.

6. **Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository and an install rewrites tracked files.

## 9. Commits

### Commit 1

Subject: `feat(criteria): record what was observed when a criterion is done`

Files:
- `src/server/tools/update_thread.ts`

Contains plan steps 1 through 5.

### Commit 2

Subject: `feat(criteria): report the verified and unverified-reasoned split`

Files:
- `src/server/tools/close_thread.ts`

Contains plan steps 6 through 9.

### Commit 3

Subject: `test(criteria): assert the result contract and the closing split`

Files:
- `test/contract/criterion-contract.test.ts`
- `test/contract/criteria-writers.test.ts`
- `test/contract/no-path.test.ts`
- `test/spawn/decisions.test.ts`
- `test/spawn/lifecycle.test.ts`

Contains section 5.

### Commit 4

Subject: `chore(criteria): bump the version for the breaking criteria_done input`

Files:
- `package.json`
- `.claude-plugin/plugin.json`

Contains plan step 10.

No commit mixes a rename or a move with a behaviour change; this unit contains neither.

## 10. Pull request

Run exactly this, from the repository root, with the branch pushed:

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u4-criterion-contract-b --base main \
  --title "feat(criteria): record what was observed when a criterion is done" \
  --what "Marking a criterion done now requires stating what was observed and whether the check was run, and the old bare list of ids is refused with a message naming what to send instead." \
  --what "Closing a thread now reports how many met criteria had their check run, how many recorded a reason it could not be, and how many carry no record at all." \
  --what "A criterion already marked done can no longer be quietly re-marked with a different observation; the call is refused and the stored one is kept." \
  --why "Nothing recorded how a goal was decided, so a claim that a goal was met could not be checked by anyone other than whoever made it." \
  --why "Refusing to close on an honest downgrade would make the honest answer cost more than the dishonest one, so the counts are reported and never block." \
  --risk "The published argument shape of update_thread changes, so any caller outside this repository that sends a list of criterion ids breaks until it sends objects." \
  --verified "npm test - fail 0, exit 0" \
  --verified "npm run typecheck - exit 0, no output" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok, exit 0" \
  --verified "new acceptance tests red on the parent commit - 7 of 8 failed, the eighth asserts a preserved property" \
  --verified "inertness mutation on each behavioural criterion - 4 mutations, every named test turned red" \
  --not-verified "npm run mutate - not run"
```

Measured diff size: **384 changed lines — 142 production, 242 test.** Measured by applying every step in sections 4 and 5 to a throwaway copy of the tree that already carried U4-A, and diffing it against that copy. That is inside the 400-line review ceiling.

## 11. Stop conditions

For every condition below: **STOP and report; do not improvise.**

### 11.1 U4-A must already be on this branch's base

Run:

```
node -e "console.log(require('fs').readFileSync('src/server/tools/open_thread.ts','utf8').includes('const CriterionCreateSchema'))"
```

If the output is not `true`, U4-A has not landed. STOP and report; do not improvise.

Run:

```
test -f test/contract/criterion-contract.test.ts && echo present || echo absent
```

If the output is not `present`, the file section 5.1 modifies does not exist. STOP and report; do not improvise.

Where the merge that was supposed to bring U4-A in reported success, do not infer from that status that the content arrived. Assert it:

```
git merge-base --is-ancestor <the merged head of feat/u4-criterion-contract-a> origin/main
```

Expect exit 0.

### 11.2 The schema fields this unit writes into must already exist

Run:

```
node -e "const t=require('fs').readFileSync('src/schema/thread.ts','utf8');console.log(['result','result_status'].every(f=>t.includes(f+': ')))"
```

If the output is not `true`, STOP and report; do not improvise.

Run:

```
node -e "console.log(require('fs').readFileSync('src/schema/caps.ts','utf8').includes('CRITERION_RESULT_MAX'))"
```

If the output is not `true`, STOP and report; do not improvise.

### 11.3 The two manifests must agree before anything is changed

Run:

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

If the two values printed are not identical, STOP and report; do not improvise. A version merely higher than `2.0.0` is not a stop condition — the ladder shifted, and step 10 reads the current value rather than assuming one.

### 11.4 Every FIND string must match exactly once

If any FIND string in section 4 or section 5 is absent from its file, or occurs more than once, the file has moved under this plan. STOP and report; do not improvise. Do not search for something similar and edit that.

### 11.5 The census must halt loudly or not at all

If `criteria.no-other-tool-writes-criteria` fails after section 5.3 has been applied, do not narrow the census, do not pin a count and do not add an allowlist. STOP and report; do not improvise.

### 11.6 The suite gate

```
Run: npm test
If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
If it passes on the re-run, proceed, and record in the pull request body a
`--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
and do not edit, skip, focus or delete any test.
```

The re-run above governs the full-suite gate in section 8 only. It never applies to section 6 or section 7: a receipt is decided by one run.

### 11.7 Things this unit never does

- It never runs `npm ci` or `npm install`.
- It never calls any `mcp__plugin_logbook_ledger__*` tool, and never writes to this project's own ledger store. Every test in this plan drives a throwaway store under the system temporary directory.
- It never opens a pull request by any path other than the command in section 10. If a skill or slash command offers to create one, refuse it.
- It never edits, skips, focuses or deletes a test to reach a green.
- It never edits `docs/specs/2026-08-28-continuity-goal-model.md` or any other unit's plan.
