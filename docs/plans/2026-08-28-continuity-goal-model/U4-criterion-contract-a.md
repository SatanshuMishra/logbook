# U4-A — Criterion contract, part A: every criterion carries its check

## 0. Identity

| | |
|---|---|
| **Closes** | `D19` — a criterion carries no statement of how it would be decided |
| **Carries** | `B8` (`open_thread` requires a `check` on every criterion it creates), `B10` (`amend_criteria` insert requires `check`) |
| **Asserts** | `A4` — for every criterion created or inserted, an absent `check` is refused |
| **Depends on** | the schema unit that adds `Criterion.check`, `Criterion.result`, `Criterion.result_status` and the caps `CRITERION_CHECK_MAX` and `CRITERION_RESULT_MAX`. Section 11 gives the exact command that proves it landed |
| **Required by** | U4-B (`docs/plans/2026-08-28-continuity-goal-model/U4-criterion-contract-b.md`), which is cut from a `main` that already contains this unit |
| **Wave** | 2 |
| **Branch** | `feat/u4-criterion-contract-a`, cut from `main`, pull request targets `main` |
| **PR title scope** | `criteria` |
| **Version bump** | Baseline `1.6.2` -> `2.0.0` per orchestrator ruling OR1 as revised by OR23. MAJOR, because the published `open_thread.completion_criteria` argument changes from an array of strings to an array of objects. Step 15 performs it as a read-then-increment |
| **Owns** | `src/server/tools/open_thread.ts`, `src/server/tools/amend_criteria.ts` |
| **Also edits (to keep the tree green)** | `src/domain/criteria.ts` — see section 3, divergence `DIV-A2`. It is edited by no other unit in this wave |
| **Creates** | `test/contract/criterion-contract.test.ts` |

### Terms used in this document, defined once

- **Criterion.** One statement of what must be true before a thread of work can be called finished. Opening a thread with none is refused.
- **Check.** The re-runnable thing that decides whether a criterion is true — a command, a query, an observation someone other than the claimant can repeat. This unit makes it a required argument wherever a criterion is created.
- **`result` and `result_status`.** The two values recorded when a criterion is later marked done. `result_status` has exactly two values: `verified` means the check was run and `result` is what it returned; `unverified-reasoned` means the check could not be run and `result` states specifically why. It describes **this run**, never the quality of the check. This unit writes both as `null` at creation time, because nothing has been observed yet.
- **Refusal.** This project's structured rejection. It always carries four parts: the field that was wrong, what that field accepts, a valid example, and whether a retry can succeed.
- **Escaping.** `escapeStored` rewrites control characters into printable tokens before a value is stored. Every character cap in this repository is measured on the escaped form, never on the raw input.

## 1. Acceptance criteria (the ceiling)

1. `open_thread` refuses a criterion carrying no `check`, and the refusal names the field `completion_criteria.0.check`. — `B8`, `A4`
2. `open_thread` stores, on each criterion it creates, the escaped `check` it was given, and stores `result` and `result_status` as `null`. — `B8`
3. `open_thread` refuses a `check` whose escaped form exceeds `CRITERION_CHECK_MAX`, naming `completion_criteria`, the limit, the observed length and a remedy, and stores nothing. — `B8`
4. `amend_criteria` refuses an `insert` carrying no `check`, and the refusal names the field `check`. — `B10`, `A4`
5. `amend_criteria` stores, on an inserted criterion, the escaped `check` it was given. — `B10`

Two standing plan invariants bind this unit as well. They are not numbered above, because the ceiling is built from the unit's behavioural rules, the clauses of its green criteria and its assigned invariants, and from nothing else. They are verified in section 8 and enforced by section 11: `P1`, `npm test` and `npm run typecheck` pass on every merge commit; and `P4`, `package.json` and `.claude-plugin/plugin.json` bump in the same commit and `node scripts/check-packaging.mjs` passes.

Anything discovered above this list is appended to `docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item with its evidence, and is not folded into this plan.

## 2. Ground truth

Every line range below was read from the working tree at the tip of `main` while this plan was written. `src/` is byte-identical between `main` and the documentation branch, so these ranges hold on a branch cut from `main`.

### 2.1 `src/server/tools/open_thread.ts:23-34` — the input takes bare strings

```ts
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

A criterion arrives as a bare string, so there is nowhere for the caller to state how the criterion would be decided. That is defect `D19`: a criterion carries no statement of how it would be decided.

### 2.2 `src/server/tools/open_thread.ts:40-49` — the reply omits the check

```ts
  completion_criteria: z
    .array(
      z.object({
        id: z.string().describe('the id minted for this criterion'),
        ordinal: z.number().int().describe('the display position of this criterion'),
        text: z.string().describe('the stored text of this criterion')
      })
    )
    .describe('the criteria minted for this thread, in display order')
```

The reply cannot report a value the input cannot carry. Same defect, on the output side.

### 2.3 `src/server/tools/open_thread.ts:72-79` — the only per-criterion cap refusal

```ts
const criterionTextCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: `at most ${caps.CRITERION_TEXT_MAX} characters after escaping, per criterion`,
  example: 'ship the health check before closing this thread',
  retryable: true,
  message: `completion_criteria[${index}] exceeds its cap of ${caps.CRITERION_TEXT_MAX} characters after escaping; observed ${observed}; remedy: shorten the criterion text and retry.`
})
```

There is a cap refusal for criterion text and none for a check, because no check exists yet.

### 2.4 `src/server/tools/open_thread.ts:104-109` — escaping and cap-checking the text

```ts
    const escapedCriteriaTexts = input.completion_criteria.map((text) => escapeStored(text))
    const oversizedIndex = escapedCriteriaTexts.findIndex((text) => text.length > caps.CRITERION_TEXT_MAX)
    if (oversizedIndex !== -1) {
      const oversizedText = escapedCriteriaTexts[oversizedIndex]
      return { ok: false, refusal: criterionTextCapRefusal(oversizedIndex, oversizedText === undefined ? 0 : oversizedText.length) }
    }
```

The handler escapes each criterion string and checks one cap. A second value per criterion has no path through here.

### 2.5 `src/server/tools/open_thread.ts:118-125` — building the stored criterion

```ts
    const completionCriteria: Criterion[] = escapedCriteriaTexts.map((text, index) => ({
      id: rt.ulid(),
      ordinal: index + 1,
      text,
      done: false,
      kind: 'planned',
      struck_by: null
    }))
```

The stored record is built with no `check`, no `result` and no `result_status`, so the fields the schema unit added stay absent on every criterion this tool creates.

### 2.6 `src/server/tools/open_thread.ts:157` — the reply's criterion projection

```ts
        completion_criteria: committed.value.completion_criteria.map((c) => ({ id: c.id, ordinal: c.ordinal, text: c.text }))
```

### 2.7 `src/server/tools/amend_criteria.ts:25-28` — the insert arguments

```ts
  kind: z
    .enum(['planned', 'detour'])
    .optional()
    .describe('whether an inserted criterion was planned up front or added mid-thread; required for insert, ignored otherwise'),
```

`text` and `kind` are declared optional in the schema and required in the handler for the `insert` operation. There is no `check` argument at all, so a criterion inserted mid-thread is created with no statement of how it would be decided. Defect `D19` again, on the second creation path.

### 2.8 `src/server/tools/amend_criteria.ts:46-53` — the missing-field refusal

```ts
export const missingFieldRefusal = (field: string, forOperation: string): Refusal => ({
  ok: false,
  field,
  accepted: `a value for ${field} when operation is "${forOperation}"`,
  example: field === 'position' ? '0' : field === 'kind' ? 'planned' : 'ship the health check before closing this thread',
  retryable: true,
  message: `${field} is required when operation is "${forOperation}".`
})
```

The example is chosen by field name. A new required field with no branch here would be given the criterion-text example, which is wrong for a check.

### 2.9 `src/server/tools/amend_criteria.ts:79-89` — the insert branch

```ts
      if (input.kind === undefined) return { ok: false, refusal: missingFieldRefusal('kind', 'insert') }

      const result = insertCriterion(
        rt,
        thread,
        {
          text: input.text,
          kind: input.kind,
          decisionId: input.decision_id,
          ...(input.position !== undefined ? { position: input.position } : {})
        },
        resolveDecision
      )
```

Both conditionally-required arguments are guarded here, one line each, and then everything is handed to `insertCriterion`.

### 2.10 `src/domain/criteria.ts:9-14` — the insert input type

```ts
export type InsertCriterionInput = {
  text: string
  kind: 'planned' | 'detour'
  decisionId: string | null | undefined
  position?: number
}
```

### 2.11 `src/domain/criteria.ts:154-161` — where the inserted criterion is constructed

```ts
  const inserted: Criterion = {
    id: rt.ulid(),
    ordinal: 0,
    text: escapedText,
    done: false,
    kind: input.kind,
    struck_by: null
  }
```

This is the only place an inserted criterion is built. A check cannot reach the stored record without passing through here, which is why this unit edits this file — see divergence `DIV-A2`.

### 2.12 `src/server/tools/open_thread.ts:85` — the published description

The full current value, whose relevant fragment step 4 replaces:

```
'Creates a new thread of work and returns its id. A thread needs a one-line title, a short slug that is unique in this project, and at least one completion criterion stating what finishing looks like; a thread with no criterion can never be closed, so the call is refused without one. Criteria are supplied as plain strings and the server assigns each one a stable id and its display ordinal, so ["the merge test passes in both push orders", "the plan is committed"] is a complete value. The slug is lowercase letters, digits and hyphens, up to 64 characters, for example merge-and-sync.'
```

### 2.13 `src/server/tools/amend_criteria.ts:59` — the published description

The full current value, whose relevant fragment step 14 replaces:

```
'Amends one completion criterion on a thread by inserting a new one, rewriting the text of an existing one, or striking it, and no other kind of edit reaches a criterion once it exists. Every amendment carries a decision_id that must resolve to a decision record already stored on this project; an id that resolves to nothing is refused. Striking a criterion keeps it on the thread marked struck rather than deleting it, so a struck criterion still renders in the history it came from. Insert also takes an optional zero-based position: {"operation": "insert", "text": "the merge test passes in both push orders", "kind": "detour", "decision_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "position": 0} inserts a criterion at the very front of the list, and omitting position appends it at the end instead.'
```

### 2.14 What happens when a stored thread record grows past its whole-record cap

`commitThread` (`src/server/tool-support.ts:124-138`) measures the serialised thread record before validating it, and refuses the whole call when it exceeds `THREAD_RECORD_SERIALISED_MAX_BYTES = 65536`. Nothing is shortened and nothing is written. The refusal carries `field: 'thread'`, the observed byte count, the name and size of the record's largest field, and the remedy "remove or shorten an entry in `<that field>` and retry".

Measured headroom: the largest thread record in the live store is 39,079 bytes, and the worst case once this ladder populates the new criterion fields is 50,027 bytes, against the 65,536-byte cap. A check long enough to push a record over is therefore possible only on a record already near the cap, and the behaviour above is what the caller sees. This unit changes none of it.

## 3. Divergences from the SPEC

- **`DIV-A1` — the external decomposition procedure is absent, and nothing here depends on it.** `~/.claude/skills/mitosis/SKILL.md` does not exist on disk. This plan was written from the planning brief and the orchestrator rulings alone, which are jointly self-contained.
- **`DIV-A2` — this unit edits `src/domain/criteria.ts`, which the SPEC's file ownership does not assign to it.** The SPEC gives U4 `src/server/tools/{open_thread,update_thread,amend_criteria,close_thread}.ts`. `amend_criteria` does not construct the criterion it inserts; `insertCriterion` in `src/domain/criteria.ts:114-169` does, and it is also where criterion text is escaped and cap-refused. Requiring a check on insert without touching that file would mean re-implementing escaping and the cap refusal inside the tool, a second copy of logic that already has one home. Ruling applied: this unit also edits `src/domain/criteria.ts` and enumerates it in section 0. No other unit in this wave owns or edits that file — checked against the wave's four units, which own `src/render/briefing.ts` and `roster.ts`, `src/server/{resources,resource-render,completions}.ts`, and the hooks tree respectively.
- **`DIV-A3` — the unit is split, and this is part A.** Applied to a throwaway copy of the tree and measured, the two halves together are 771 changed lines against one base, which is 1.9 times the 400-line review ceiling. The unit is split at the seam between creating a criterion and completing one. This document is part A and lands first; the second half is a separate unit, cut from a `main` that already contains this one.
- **`DIV-A4` — this is a breaking input change, and the SPEC names only the other half as one.** The SPEC states explicitly that changing `update_thread.criteria_done` is a breaking input change and says nothing of the kind about `open_thread`. Requiring a check changes the published type of `open_thread.completion_criteria` from an array of strings to an array of objects, which breaks every external caller exactly as the other change does. Recorded here, and covered by the MAJOR version bump in step 15.
- **`DIV-A5` — `Criterion.kind` is retained.** The schema unit's census found a live reader at `src/merge/field-merge.ts:151`, consumed at `:168-170`, where a divergence raises a merge conflict. `amend_criteria`'s `kind` argument is therefore left exactly as it is by this unit.
- **`DIV-A6` — this document names the unit that follows it in a third place, beyond the two that the self-containment ruling allows.** The two allowed places are the `Required by` field in section 0 and the stop conditions in section 11. The third is the split ruling immediately above, which the review-size ruling requires the plan itself to make. No occurrence instructs the implementer to read another plan; each states a fact about the repository or about this unit's own scope.

## 4. The change, step by step

Apply the steps in the order given. Production code is type-correct after step 14; the whole tree, tests included, typechecks and the suite passes only after section 5 has also been applied. Step 15 is the version bump and touches no code.

### Step 1 — `src/server/tools/open_thread.ts` — INSERT-AFTER

FIND (exact, unique):

```ts
const OpenThreadInputSchema = z.strictObject({
```

REPLACE with:

```ts
const CriterionCreateSchema = z
  .strictObject({
    text: z
      .string()
      .min(1)
      .max(caps.CRITERION_TEXT_MAX)
      .describe('one completion criterion as plain text; the server mints its id and display ordinal'),
    check: z
      .string()
      .min(1)
      .max(caps.CRITERION_CHECK_MAX)
      .describe('the re-runnable check that decides whether this criterion is true, for example npm test exits 0')
  })
  .describe('one completion criterion together with the check that decides it')

const OpenThreadInputSchema = z.strictObject({
```

Rationale: `B8` requires a check on every criterion `open_thread` creates. Declaring `check` as a required key of a strict object is what makes its absence a refusal.

### Step 2 — `src/server/tools/open_thread.ts` — REPLACE

FIND (exact, unique):

```ts
  completion_criteria: z
    .array(
      z
        .string()
        .min(1)
        .max(caps.CRITERION_TEXT_MAX)
        .describe('one completion criterion as plain text; the server mints its id and display ordinal')
    )
    .min(1)
```

REPLACE with:

```ts
  completion_criteria: z
    .array(CriterionCreateSchema)
    .min(1)
```

Rationale: `B8`. The element type becomes the pair declared in step 1.

### Step 3 — `src/server/tools/open_thread.ts` — REPLACE

FIND (exact, unique):

```ts
        text: z.string().describe('the stored text of this criterion')
      })
```

REPLACE with:

```ts
        text: z.string().describe('the stored text of this criterion'),
        check: z.string().describe('the stored check that decides this criterion')
      })
```

Rationale: `B8`. The reply reports the check it stored, so the caller can read back what it will be held to.

### Step 4 — `src/server/tools/open_thread.ts` — REPLACE

FIND (exact, unique) — one line, the full current description string, beginning `'Creates a new thread`:

```
Criteria are supplied as plain strings and the server assigns each one a stable id and its display ordinal, so ["the merge test passes in both push orders", "the plan is committed"] is a complete value.
```

REPLACE with:

```
Every criterion carries its own check, the re-runnable thing that decides whether it is true, and a criterion with no check is refused. Criteria are supplied as text-and-check pairs and the server assigns each one a stable id and its display ordinal, so [{"text": "the merge test passes in both push orders", "check": "npm test exits 0"}] is a complete value.
```

Rationale: `B8`. A published description that still tells callers to send plain strings would be false the moment step 2 lands.

### Step 5 — `src/server/tools/open_thread.ts` — INSERT-AFTER

FIND (exact, unique):

```ts
  message: `completion_criteria[${index}] exceeds its cap of ${caps.CRITERION_TEXT_MAX} characters after escaping; observed ${observed}; remedy: shorten the criterion text and retry.`
})
```

REPLACE with:

```ts
  message: `completion_criteria[${index}] exceeds its cap of ${caps.CRITERION_TEXT_MAX} characters after escaping; observed ${observed}; remedy: shorten the criterion text and retry.`
})

const criterionCheckCapRefusal = (index: number, observed: number): Refusal => ({
  ok: false,
  field: 'completion_criteria',
  accepted: `at most ${caps.CRITERION_CHECK_MAX} characters after escaping, per check`,
  example: 'npm test exits 0',
  retryable: true,
  message: `completion_criteria[${index}].check exceeds its cap of ${caps.CRITERION_CHECK_MAX} characters after escaping; observed ${observed}; remedy: shorten the check and retry.`
})
```

Rationale: `B8`, and the standing rule that a value is never shortened to fit — a check over its cap refuses the whole call and names the field, the limit, the observed length and a remedy. This function is not exported, matching `criterionTextCapRefusal` beside it; the repository's refusal census enumerates exported producers only.

### Step 6 — `src/server/tools/open_thread.ts` — REPLACE

FIND (exact, unique):

```ts
    const escapedCriteriaTexts = input.completion_criteria.map((text) => escapeStored(text))
    const oversizedIndex = escapedCriteriaTexts.findIndex((text) => text.length > caps.CRITERION_TEXT_MAX)
    if (oversizedIndex !== -1) {
      const oversizedText = escapedCriteriaTexts[oversizedIndex]
      return { ok: false, refusal: criterionTextCapRefusal(oversizedIndex, oversizedText === undefined ? 0 : oversizedText.length) }
    }
```

REPLACE with:

```ts
    const escapedCriteria = input.completion_criteria.map((entry) => ({
      text: escapeStored(entry.text),
      check: escapeStored(entry.check)
    }))
    const oversizedTextIndex = escapedCriteria.findIndex((entry) => entry.text.length > caps.CRITERION_TEXT_MAX)
    if (oversizedTextIndex !== -1) {
      const oversized = escapedCriteria[oversizedTextIndex]
      return {
        ok: false,
        refusal: criterionTextCapRefusal(oversizedTextIndex, oversized === undefined ? 0 : oversized.text.length)
      }
    }
    const oversizedCheckIndex = escapedCriteria.findIndex((entry) => entry.check.length > caps.CRITERION_CHECK_MAX)
    if (oversizedCheckIndex !== -1) {
      const oversized = escapedCriteria[oversizedCheckIndex]
      return {
        ok: false,
        refusal: criterionCheckCapRefusal(oversizedCheckIndex, oversized === undefined ? 0 : oversized.check.length)
      }
    }
```

Rationale: `B8`. Both stored values are escaped and both caps are measured on the escaped form, matching every other cap in this repository.

### Step 7 — `src/server/tools/open_thread.ts` — REPLACE

FIND (exact, unique):

```ts
    const completionCriteria: Criterion[] = escapedCriteriaTexts.map((text, index) => ({
      id: rt.ulid(),
      ordinal: index + 1,
      text,
      done: false,
      kind: 'planned',
      struck_by: null
    }))
```

REPLACE with:

```ts
    const completionCriteria: Criterion[] = escapedCriteria.map((entry, index) => ({
      id: rt.ulid(),
      ordinal: index + 1,
      text: entry.text,
      done: false,
      kind: 'planned',
      check: entry.check,
      result: null,
      result_status: null,
      struck_by: null
    }))
```

Rationale: `B8`. A criterion is created with its check recorded, and with no result recorded, because nothing has been observed yet. `null` renders as *not recorded*, never as blank.

### Step 8 — `src/server/tools/open_thread.ts` — REPLACE

FIND (exact, unique):

```ts
        completion_criteria: committed.value.completion_criteria.map((c) => ({ id: c.id, ordinal: c.ordinal, text: c.text }))
```

REPLACE with:

```ts
        completion_criteria: committed.value.completion_criteria.map((c) => ({
          id: c.id,
          ordinal: c.ordinal,
          text: c.text,
          check: c.check ?? ''
        }))
```

Rationale: `B8`. The stored field is nullable so that records written before this ladder still parse; every criterion this tool creates carries one, and `?? ''` is what satisfies the reply's string type without widening the published output schema.

### Step 9 — `src/domain/criteria.ts` — REPLACE

FIND (exact, unique):

```ts
export type InsertCriterionInput = {
  text: string
  kind: 'planned' | 'detour'
```

REPLACE with:

```ts
export type InsertCriterionInput = {
  text: string
  check: string
  kind: 'planned' | 'detour'
```

Rationale: `B10`. The check reaches the stored record through the same function that already escapes and cap-refuses the criterion text.

### Step 10 — `src/domain/criteria.ts` — REPLACE

FIND (exact, unique):

```ts
  const inserted: Criterion = {
    id: rt.ulid(),
    ordinal: 0,
    text: escapedText,
    done: false,
    kind: input.kind,
    struck_by: null
  }
```

REPLACE with:

```ts
  const escapedCheck = escapeStored(input.check)
  if (escapedCheck.length > caps.CRITERION_CHECK_MAX) {
    return textCapRefusal(
      'criteria.insert.check',
      escapedCheck.length,
      caps.CRITERION_CHECK_MAX,
      'shorten the check and retry'
    )
  }

  const inserted: Criterion = {
    id: rt.ulid(),
    ordinal: 0,
    text: escapedText,
    done: false,
    kind: input.kind,
    check: escapedCheck,
    result: null,
    result_status: null,
    struck_by: null
  }
```

Rationale: `B10`. `textCapRefusal` already exists in this module and already produces the four-part shape; reusing it keeps one cap-refusal implementation rather than two.

### Step 11 — `src/server/tools/amend_criteria.ts` — INSERT-AFTER

FIND (exact, unique):

```ts
    .describe('whether an inserted criterion was planned up front or added mid-thread; required for insert, ignored otherwise'),
```

REPLACE with:

```ts
    .describe('whether an inserted criterion was planned up front or added mid-thread; required for insert, ignored otherwise'),
  check: z
    .string()
    .min(1)
    .max(caps.CRITERION_CHECK_MAX)
    .optional()
    .describe('the re-runnable check that decides whether an inserted criterion is true; required for insert, ignored otherwise'),
```

Rationale: `B10`. `check` is declared optional and required by the handler for `insert` only, exactly as `text` and `kind` already are, because `rewrite` and `strike` never create a criterion.

### Step 12 — `src/server/tools/amend_criteria.ts` — REPLACE

FIND (exact, unique):

```ts
  example: field === 'position' ? '0' : field === 'kind' ? 'planned' : 'ship the health check before closing this thread',
```

REPLACE with:

```ts
  example:
    field === 'position'
      ? '0'
      : field === 'kind'
        ? 'planned'
        : field === 'check'
          ? 'npm test exits 0'
          : 'ship the health check before closing this thread',
```

Rationale: `B10`. A refusal must carry a valid example of the field it names; without this branch a missing check would be illustrated with a criterion sentence.

### Step 13 — `src/server/tools/amend_criteria.ts` — REPLACE

FIND (exact, unique):

```ts
      if (input.kind === undefined) return { ok: false, refusal: missingFieldRefusal('kind', 'insert') }

      const result = insertCriterion(
        rt,
        thread,
        {
          text: input.text,
          kind: input.kind,
```

REPLACE with:

```ts
      if (input.kind === undefined) return { ok: false, refusal: missingFieldRefusal('kind', 'insert') }
      if (input.check === undefined) return { ok: false, refusal: missingFieldRefusal('check', 'insert') }

      const result = insertCriterion(
        rt,
        thread,
        {
          text: input.text,
          check: input.check,
          kind: input.kind,
```

Rationale: `B10` and `A4`. This is the named refusal for an insert carrying no check.

### Step 14 — `src/server/tools/amend_criteria.ts` — REPLACE

FIND (exact, unique) — a fragment of the one-line description string at line 59:

```
Insert also takes an optional zero-based position: {"operation": "insert", "text": "the merge test passes in both push orders", "kind": "detour", "decision_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "position": 0}
```

REPLACE with:

```
An inserted criterion also carries a check, the re-runnable thing that decides whether it is true, and an insert with no check is refused. Insert also takes an optional zero-based position: {"operation": "insert", "text": "the merge test passes in both push orders", "check": "npm test exits 0", "kind": "detour", "decision_id": "01ARZ3NDEKTSV4RRFFQ69G5FAV", "position": 0}
```

Rationale: `B10`. The worked example in the description must be a call that succeeds.

### Step 15 — the version bump, as a read-then-increment

1. Read the current version:

   ```
   node -p "require('./package.json').version"
   ```

   Expect exit 0. The output is the current version string, for example `1.6.2`; it is read, not compared against a number written here.

2. Compute the next version by setting MAJOR to MAJOR plus one, MINOR to 0 and PATCH to 0. This unit is the MAJOR step; the published `open_thread.completion_criteria` argument changes shape.

3. Write that exact value into the `"version"` field of `package.json` and into the `"version"` field of `.claude-plugin/plugin.json`, in the same commit. Change nothing else in either file.

4. Run:

   ```
   node scripts/check-packaging.mjs
   ```

   Expect exit 0 and the output `check-packaging: ok`.

Rationale: the two manifests are read by different consumers and a disagreement between them ships a plugin whose declared version is not its package version.

## 5. Tests

### 5.1 `test/contract/criterion-contract.test.ts` — CREATE

New file, given in full. It drives the tool handlers against a throwaway git repository and a throwaway plugin-data directory, both under the system temporary directory, so no test touches the store of the project this repository is checked out in. The fixture shape is copied from `test/store/lineage.test.ts:18-33`.

```ts
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolContext } from '../../src/server/register.ts'
import { declare } from '../../src/schema/declare.ts'
import { openThreadTool } from '../../src/server/tools/open_thread.ts'
import { amendCriteriaTool } from '../../src/server/tools/amend_criteria.ts'
import { recordDecisionTool } from '../../src/server/tools/record_decision.ts'
import type { Criterion } from '../../src/schema/thread.ts'
import { openStore } from '../../src/store/records.ts'
import * as caps from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'
import { rawGit } from '../support/git-fixture.ts'

const STUB_TOOL_CTX = {} as unknown as ToolContext

const withCriterionFixture = async (fn: (rt: Runtime) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-criterion-repo-'))
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-criterion-plugin-data-'))
  try {
    rawGit(repo, ['init', '--initial-branch=main'])
    rawGit(repo, ['config', 'user.name', 'Logbook Criterion Fixture'])
    rawGit(repo, ['config', 'user.email', 'criterion@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'logbook criterion fixture repository\n')
    rawGit(repo, ['add', 'README.md'])
    rawGit(repo, ['commit', '-m', 'fixture: initial commit'])
    await fn(testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo }))
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(pluginData, { recursive: true, force: true })
  }
}

const openFixtureThread = async (
  rt: Runtime,
  slug: string,
  criteria: { text: string; check: string }[]
): Promise<{ threadId: string; criterionIds: string[] }> => {
  const opened = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
    title: `criterion contract fixture ${slug}`,
    slug,
    completion_criteria: criteria
  })
  if (!opened.ok) throw new Error(`criterion fixture: open_thread refused: ${opened.refusal.message}`)
  return {
    threadId: opened.structured.thread_id,
    criterionIds: opened.structured.completion_criteria.map((criterion) => criterion.id)
  }
}

const seedDecision = async (rt: Runtime, threadId: string): Promise<string> => {
  const recorded = await recordDecisionTool.handler(rt, STUB_TOOL_CTX, {
    thread_id: threadId,
    title: 'the criterion fixture decision',
    context: 'a decision recorded so an amendment has something to resolve against',
    options: ['amend the criteria', 'leave them alone'],
    outcome: 'amend the criteria'
  })
  if (!recorded.ok) throw new Error(`criterion fixture: record_decision refused: ${recorded.refusal.message}`)
  return recorded.structured.decision_id
}

const readStoredCriteria = (rt: Runtime, threadId: string): Criterion[] => {
  const opened = openStore(rt, rt.cwd)
  if (!opened.ok) throw new Error('criterion fixture: the store did not open')
  const slot = opened.value.readThread(threadId)
  if (slot === null || slot.quarantined) throw new Error('criterion fixture: the thread did not read back')
  return slot.record.completion_criteria
}

test('criterion.open-thread-refuses-a-criterion-carrying-no-check', () => {
  const declared = declare<unknown>(openThreadTool.name, openThreadTool.input)
  const refusal = declared.parse({
    title: 'a thread whose criterion states no check',
    slug: 'no-check-thread',
    completion_criteria: [{ text: 'the health check ships' }]
  })
  assert.equal(refusal.ok, false)
  if (refusal.ok) throw new Error('expected open_thread to refuse a criterion carrying no check')
  assert.equal(refusal.field, 'completion_criteria.0.check')
  assert.equal(refusal.retryable, true)
  assert.match(refusal.accepted, /the re-runnable check that decides whether this criterion is true/)
})

test('criterion.open-thread-stores-the-check-it-was-given', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'stores-the-check', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const stored = readStoredCriteria(rt, threadId)
    assert.equal(stored.length, 1)
    assert.equal(stored[0]?.check, 'npm test exits 0')
    assert.equal(stored[0]?.result, null)
    assert.equal(stored[0]?.result_status, null)
  })
})

test('criterion.amend-criteria-refuses-an-insert-carrying-no-check', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'insert-without-check', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const decisionId = await seedDecision(rt, threadId)
    const refused = await amendCriteriaTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      text: 'a criterion inserted with no check',
      kind: 'detour'
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected amend_criteria to refuse an insert carrying no check')
    assert.equal(refused.refusal.field, 'check')
    assert.equal(refused.refusal.accepted, 'a value for check when operation is "insert"')
    assert.equal(refused.refusal.example, 'npm test exits 0')
    assert.equal(refused.refusal.retryable, true)
    assert.equal(refused.refusal.message, 'check is required when operation is "insert".')
    assert.equal(readStoredCriteria(rt, threadId).length, 1)
  })
})

test('criterion.amend-criteria-stores-the-check-on-an-inserted-criterion', async () => {
  await withCriterionFixture(async (rt) => {
    const { threadId } = await openFixtureThread(rt, 'insert-with-check', [
      { text: 'the health check ships', check: 'npm test exits 0' }
    ])
    const decisionId = await seedDecision(rt, threadId)
    const inserted = await amendCriteriaTool.handler(rt, STUB_TOOL_CTX, {
      thread_id: threadId,
      operation: 'insert',
      decision_id: decisionId,
      text: 'the merge test passes in both push orders',
      check: 'node --test test/sync/two-clones.test.ts exits 0',
      kind: 'detour'
    })
    assert.equal(inserted.ok, true)
    if (!inserted.ok) throw new Error('expected amend_criteria to insert a criterion carrying a check')
    const stored = readStoredCriteria(rt, threadId)
    const found = stored.find((criterion) => criterion.id === inserted.structured.criterion_id)
    assert.equal(found?.check, 'node --test test/sync/two-clones.test.ts exits 0')
  })
})

test('criterion.open-thread-refuses-a-check-that-overflows-its-cap-once-escaped', async () => {
  await withCriterionFixture(async (rt) => {
    const refused = await openThreadTool.handler(rt, STUB_TOOL_CTX, {
      title: 'a thread whose criterion check overflows its cap once escaped',
      slug: 'over-cap-check-thread',
      completion_criteria: [
        { text: 'the health check ships', check: String.fromCharCode(1).repeat(84) }
      ]
    })
    assert.equal(refused.ok, false)
    if (refused.ok) throw new Error('expected open_thread to refuse a check that overflows its cap once escaped')
    assert.equal(refused.refusal.field, 'completion_criteria')
    assert.equal(
      refused.refusal.accepted,
      `at most ${caps.CRITERION_CHECK_MAX} characters after escaping, per check`
    )
    assert.equal(refused.refusal.example, 'npm test exits 0')
    assert.equal(refused.refusal.retryable, true)
    assert.equal(
      refused.refusal.message,
      `completion_criteria[0].check exceeds its cap of ${caps.CRITERION_CHECK_MAX} characters after escaping; observed 504; remedy: shorten the check and retry.`
    )
    const opened = openStore(rt, rt.cwd)
    if (!opened.ok) throw new Error('criterion fixture: the store did not open')
    assert.equal(opened.value.readThreads().length, 0)
  })
})
```

`String.fromCharCode(1).repeat(84)` is 84 characters raw, which passes the schema's `maxLength` of 500, and 504 characters once `escapeStored` expands each control character into the six-character token `U+0001`, which is over the same 500-character cap. That is the only way to reach the handler's own cap branch, and the numbers were measured while this plan was written. The same technique is already used against sibling fields at `test/contract/no-path.test.ts:163`.

### 5.2 Which test discharges which acceptance criterion

| Acceptance criterion | Test |
|---|---|
| 1 — refuses a criterion with no check (`B8`, `A4`) | `criterion.open-thread-refuses-a-criterion-carrying-no-check` |
| 2 — stores the check (`B8`) | `criterion.open-thread-stores-the-check-it-was-given` |
| 3 — refuses an over-cap check (`B8`) | `criterion.open-thread-refuses-a-check-that-overflows-its-cap-once-escaped` |
| 4 — refuses an insert with no check (`B10`, `A4`) | `criterion.amend-criteria-refuses-an-insert-carrying-no-check` |
| 5 — stores the check on insert (`B10`) | `criterion.amend-criteria-stores-the-check-on-an-inserted-criterion` |

Every acceptance criterion that carries a behavioural change has a test of its own, and every one of those tests is red at the parent commit. No criterion in this unit ships on the honesty ladder.

### 5.3 Existing tests updated, and why each one is answered rather than excluded

Each entry below constructs the old bare-string criterion shape or the old `insertCriterion` input. Every one is answered by updating it to the new shape. None is deleted, skipped, focused, or excluded from any census.

`test/unit/criteria.test.ts` — seven calls to `insertCriterion`. Add `check: 'npm test exits 0'` to each input object, immediately after `text`:

- `{ text: 'a new criterion', kind: 'planned', decisionId: undefined }` becomes `{ text: 'a new criterion', check: 'npm test exits 0', kind: 'planned', decisionId: undefined }`
- `{ text: 'a new criterion', kind: 'planned', decisionId: unknown }` becomes `{ text: 'a new criterion', check: 'npm test exits 0', kind: 'planned', decisionId: unknown }`
- `{ text: oversizedText, kind: 'planned', decisionId }` becomes `{ text: oversizedText, check: 'npm test exits 0', kind: 'planned', decisionId }`
- `{ text: 'one more', kind: 'planned', decisionId }` becomes `{ text: 'one more', check: 'npm test exits 0', kind: 'planned', decisionId }`
- `{ text: 'over the cap', kind: 'planned', decisionId }` becomes `{ text: 'over the cap', check: 'npm test exits 0', kind: 'planned', decisionId }`
- `{ text: 'now there is room', kind: 'planned', decisionId }` becomes `{ text: 'now there is room', check: 'npm test exits 0', kind: 'planned', decisionId }`
- `{ text: 'inserted between the two', kind: 'detour', decisionId, position: 1 }` becomes `{ text: 'inserted between the two', check: 'npm test exits 0', kind: 'detour', decisionId, position: 1 }`

`test/contract/no-path.test.ts` — four sites.

FIND:
```ts
      completion_criteria: ['a census criterion']
    })
    if (!firstOpen.ok)
```
REPLACE:
```ts
      completion_criteria: [{ text: 'a census criterion', check: 'the census check' }]
    })
    if (!firstOpen.ok)
```

FIND:
```ts
      completion_criteria: ['a census criterion']
    })
    if (duplicateOpen.ok)
```
REPLACE:
```ts
      completion_criteria: [{ text: 'a census criterion', check: 'the census check' }]
    })
    if (duplicateOpen.ok)
```

FIND:
```ts
    completion_criteria: ['a census criterion']
  })
  if (!openedThread.ok)
```
REPLACE:
```ts
    completion_criteria: [{ text: 'a census criterion', check: 'the census check' }]
  })
  if (!openedThread.ok)
```

FIND:
```ts
    { text: 'a census criterion', kind: 'planned', decisionId: undefined },
```
REPLACE:
```ts
    { text: 'a census criterion', check: 'the census check', kind: 'planned', decisionId: undefined },
```

`test/contract/resume-payload-envelope.test.ts` — one site.

FIND:
```ts
    completion_criteria: ['the predicted payload size bounds the serialised reply']
```
REPLACE:
```ts
    completion_criteria: [
      { text: 'the predicted payload size bounds the serialised reply', check: 'the envelope test asserts it' }
    ]
```

`test/store/lineage.test.ts` — three sites.

FIND: `      completion_criteria: ['the first criterion']`
REPLACE: `      completion_criteria: [{ text: 'the first criterion', check: 'the lineage fixture check' }]`

FIND: `      completion_criteria: ['the second criterion'],`
REPLACE: `      completion_criteria: [{ text: 'the second criterion', check: 'the lineage fixture check' }],`

FIND: `      completion_criteria: ['the only criterion'],`
REPLACE: `      completion_criteria: [{ text: 'the only criterion', check: 'the lineage fixture check' }],`

`test/contract/skills.test.ts` — one site.

FIND:
```ts
        completion_criteria: ['prove the documented preflight and debrief sequence cannot strand a pointer']
```
REPLACE:
```ts
        completion_criteria: [
          {
            text: 'prove the documented preflight and debrief sequence cannot strand a pointer',
            check: 'the skills contract test drives both skills end to end'
          }
        ]
```

`test/spawn/blocked-by-writer.test.ts` — one site.

FIND: `completion_criteria: ['the blockage renders'] }`
REPLACE: `completion_criteria: [{ text: 'the blockage renders', check: 'the roster prints it' }] }`

`test/spawn/completions.test.ts` — one site.

FIND: `completion_criteria: ['a completions fixture criterion'] }`
REPLACE: `completion_criteria: [{ text: 'a completions fixture criterion', check: 'the completions fixture check' }] }`

`test/spawn/resources.test.ts` — two sites.

FIND: `      completion_criteria: ['a resources fixture criterion']`
REPLACE: `      completion_criteria: [{ text: 'a resources fixture criterion', check: 'the resources fixture check' }]`

FIND:
```ts
      completion_criteria: ['the first thread detail criterion', 'the second thread detail criterion']
```
REPLACE:
```ts
      completion_criteria: [
        { text: 'the first thread detail criterion', check: 'the first thread detail check' },
        { text: 'the second thread detail criterion', check: 'the second thread detail check' }
      ]
```

`test/spawn/resume.test.ts` — one site.

FIND: `      completion_criteria: [fixtureCriterion]`
REPLACE: `      completion_criteria: [{ text: fixtureCriterion, check: 'the resume wiring proof check' }]`

`test/spawn/roster.test.ts` — one site.

FIND: `    completion_criteria: ['a roster fixture criterion']`
REPLACE: `    completion_criteria: [{ text: 'a roster fixture criterion', check: 'the roster fixture check' }]`

`test/sync/resolve.test.ts` — one site.

FIND: `    completion_criteria: ['a criterion for the resolve fixture']`
REPLACE: `    completion_criteria: [{ text: 'a criterion for the resolve fixture', check: 'the resolve fixture check' }]`

`test/sync/two-clones-spawn.test.ts` — one site.

FIND:
```ts
      completion_criteria: ['a criterion for the spawn offline-merge scenario']
```
REPLACE:
```ts
      completion_criteria: [
        { text: 'a criterion for the spawn offline-merge scenario', check: 'the offline-merge scenario check' }
      ]
```

`test/spawn/decisions.test.ts` — eight sites. The first two are helpers that take a `string[]`; mapping inside the helper leaves every one of their callers unchanged.

FIND:
```ts
    arguments: { title: `${slug} fixture`, slug, completion_criteria: criteria }
```
REPLACE:
```ts
    arguments: {
      title: `${slug} fixture`,
      slug,
      completion_criteria: criteria.map((text) => ({ text, check: 'the spawn fixture check' }))
    }
```

FIND:
```ts
    completion_criteria: criteria
  })
```
REPLACE:
```ts
    completion_criteria: criteria.map((text) => ({ text, check: 'the census fixture check' }))
  })
```

FIND:
```ts
            completion_criteria: ['a criterion minted purely for the open_thread census probe']
```
REPLACE:
```ts
            completion_criteria: [
              { text: 'a criterion minted purely for the open_thread census probe', check: 'the census probe check' }
            ]
```

FIND:
```ts
              text: 'a criterion inserted by the amend_criteria census probe',
              kind: 'planned'
```
REPLACE:
```ts
              text: 'a criterion inserted by the amend_criteria census probe',
              check: 'the amend_criteria census probe check',
              kind: 'planned'
```

FIND:
```ts
      completion_criteria: ['first seed criterion', 'second seed criterion', 'third seed criterion']
```
REPLACE:
```ts
      completion_criteria: [
        { text: 'first seed criterion', check: 'the first seed check' },
        { text: 'second seed criterion', check: 'the second seed check' },
        { text: 'third seed criterion', check: 'the third seed check' }
      ]
```

FIND:
```ts
      completion_criteria: ['a criterion for the supersede fixture']
```
REPLACE:
```ts
      completion_criteria: [{ text: 'a criterion for the supersede fixture', check: 'the supersede fixture check' }]
```

FIND:
```ts
        completion_criteria: ['a criterion for the project head fixture']
```
REPLACE:
```ts
        completion_criteria: [
          { text: 'a criterion for the project head fixture', check: 'the project head fixture check' }
        ]
```

FIND:
```ts
      completion_criteria: ['a criterion for the concurrency fixture']
```
REPLACE:
```ts
      completion_criteria: [
        { text: 'a criterion for the concurrency fixture', check: 'the concurrency fixture check' }
      ]
```

`test/spawn/lifecycle.test.ts` — five sites.

FIND:
```ts
    const criteria = Array.from({ length: caps.CRITERIA_MAX_ELEMENTS }, (_, i) => `criterion ${i}`)
```
REPLACE:
```ts
    const criteria = Array.from({ length: caps.CRITERIA_MAX_ELEMENTS }, (_, i) => ({
      text: `criterion ${i}`,
      check: `the check for criterion ${i}`
    }))
```

FIND:
```ts
        text: 'a new criterion inserted after the strike freed capacity',
        kind: 'detour'
```
REPLACE:
```ts
        text: 'a new criterion inserted after the strike freed capacity',
        check: 'the check for the criterion inserted after the strike',
        kind: 'detour'
```

FIND:
```ts
      arguments: { title: oversizedTitle, slug: 'title-cap-thread', completion_criteria: ['a criterion'] }
```
REPLACE:
```ts
      arguments: {
        title: oversizedTitle,
        slug: 'title-cap-thread',
        completion_criteria: [{ text: 'a criterion', check: 'the title-cap fixture check' }]
      }
```

FIND:
```ts
        completion_criteria: ['first criterion', 'second criterion']
```
REPLACE:
```ts
        completion_criteria: [
          { text: 'first criterion', check: 'the first check' },
          { text: 'second criterion', check: 'the second check' }
        ]
```

FIND:
```ts
      text: synthesiseValue(schema, propOf(schema, 'text')),
      kind: synthesiseValue(schema, propOf(schema, 'kind'))
```
REPLACE:
```ts
      text: synthesiseValue(schema, propOf(schema, 'text')),
      check: synthesiseValue(schema, propOf(schema, 'check')),
      kind: synthesiseValue(schema, propOf(schema, 'kind'))
```

The last one is required because `amend_criteria.spawn.contract` builds its call from the published schema and supplies each conditionally-required argument explicitly. Without it the call is refused with `field: check`, which was observed while this plan was written.

## 6. Red on the parent

The parent commit is the tip of `main` at branch-cut time. At authoring time that is the commit that carries the schema unit's third part; section 11 gives the command that proves it.

Procedure, run from the repository root on a clean checkout of the parent commit:

1. Write only the new file from section 5.1 into `test/contract/criterion-contract.test.ts`. Apply no other step from section 4 or 5.
2. Run:

   ```
   node --test test/contract/criterion-contract.test.ts
   ```

3. Expect exit 1 and all five tests failing, with these exact assertions:

   - `criterion.open-thread-refuses-a-criterion-carrying-no-check` —
     `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:` with `actual: 'completion_criteria.0'` and `expected: 'completion_criteria.0.check'`.
   - `criterion.open-thread-stores-the-check-it-was-given` —
     `actual: undefined`, `expected: 'npm test exits 0'`.
   - `criterion.amend-criteria-refuses-an-insert-carrying-no-check` —
     `actual: true`, `expected: false`.
   - `criterion.amend-criteria-stores-the-check-on-an-inserted-criterion` —
     `actual: undefined`, `expected: 'node --test test/sync/two-clones.test.ts exits 0'`.
   - `criterion.open-thread-refuses-a-check-that-overflows-its-cap-once-escaped` —
     `AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:` with `true !== false`, on the `refused.ok` assertion.

4. Delete the file again before applying section 4.

All five failures above were produced and read while this plan was written, against a tree carrying the parent's schema and none of section 4's edits. The run reported `ℹ pass 0`, `ℹ fail 5`.

## 7. Inertness mutation

Each mutation is applied on top of the finished change, the named test is run, and the change is then restored exactly. Every expected red below was produced and read while this plan was written.

### `M-A1` — acceptance criterion 1

Edit `src/server/tools/open_thread.ts`. In `CriterionCreateSchema`, insert `.optional()` between `.max(caps.CRITERION_CHECK_MAX)` and `.describe(...)` on the `check` field.

Run `node --test test/contract/criterion-contract.test.ts`. Expect exit 1 and:

`✖ criterion.open-thread-refuses-a-criterion-carrying-no-check`, with `actual: true`, `expected: false` on the `refusal.ok` assertion.

Restore by deleting the inserted `.optional()` line.

### `M-A2` — acceptance criterion 2

Edit `src/server/tools/open_thread.ts`. In the criterion built by step 7, change `check: entry.check,` to `check: null,`.

Run `node --test test/contract/criterion-contract.test.ts`. Expect exit 1 and:

`✖ criterion.open-thread-stores-the-check-it-was-given`.

Restore by changing `check: null,` back to `check: entry.check,`.

### `M-A2b` — acceptance criterion 3

Edit `src/server/tools/open_thread.ts`. Delete the whole `oversizedCheckIndex` block added by step 6.

Run `node --test test/contract/criterion-contract.test.ts`. Expect exit 1.

Expect `✖ criterion.open-thread-refuses-a-check-that-overflows-its-cap-once-escaped`, with `actual: 'thread'` and `expected: 'completion_criteria'` — the oversized check then survives as far as the whole-record validator, which names the record rather than the field.

Restore by re-applying step 6.

### `M-A3` — acceptance criterion 4

Edit `src/server/tools/amend_criteria.ts`. Delete this whole line:

```ts
      if (input.check === undefined) return { ok: false, refusal: missingFieldRefusal('check', 'insert') }
```

Run `node --test test/contract/criterion-contract.test.ts`. Expect exit 1 and:

`✖ criterion.amend-criteria-refuses-an-insert-carrying-no-check`.

Restore by re-inserting the deleted line immediately after the `kind` guard.

### `M-A4` — acceptance criterion 5

Edit `src/domain/criteria.ts`. In the criterion built by step 10, change `check: escapedCheck,` to `check: null,`.

Run `node --test test/contract/criterion-contract.test.ts`. Expect exit 1 and:

`✖ criterion.amend-criteria-stores-the-check-on-an-inserted-criterion`.

Restore by changing `check: null,` back to `check: escapedCheck,`.

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
   Expect exit 0, the summary line `ℹ fail 0`, and these five lines each prefixed `✔`:
   `criterion.open-thread-refuses-a-criterion-carrying-no-check`,
   `criterion.open-thread-stores-the-check-it-was-given`,
   `criterion.amend-criteria-refuses-an-insert-carrying-no-check`,
   `criterion.amend-criteria-stores-the-check-on-an-inserted-criterion`,
   `criterion.open-thread-refuses-a-check-that-overflows-its-cap-once-escaped`.

4. ```
   npm test
   ```
   Expect exit 0 and the summary line `ℹ fail 0`. Do not compare the `ℹ tests` count against any number written down anywhere; this unit adds five tests to whatever the parent carried, and a pinned total is a test that fails on unrelated growth.

   The full suite was run under this exact change on a throwaway copy of the tree while this plan was written: `ℹ tests 441`, `ℹ pass 441`, `ℹ fail 0`, exit 0.

5. **Never run `npm ci` or `npm install`.** `node_modules` is tracked in this repository and an install rewrites tracked files.

## 9. Commits

### Commit 1

Subject: `feat(criteria): require a check on every criterion created or inserted`

Files:
- `src/server/tools/open_thread.ts`
- `src/domain/criteria.ts`
- `src/server/tools/amend_criteria.ts`

Contains plan steps 1 through 14.

### Commit 2

Subject: `test(criteria): assert the check contract and update the fixtures`

Files:
- `test/contract/criterion-contract.test.ts` (new)
- `test/unit/criteria.test.ts`
- `test/contract/no-path.test.ts`
- `test/contract/resume-payload-envelope.test.ts`
- `test/contract/skills.test.ts`
- `test/store/lineage.test.ts`
- `test/spawn/blocked-by-writer.test.ts`
- `test/spawn/completions.test.ts`
- `test/spawn/decisions.test.ts`
- `test/spawn/lifecycle.test.ts`
- `test/spawn/resources.test.ts`
- `test/spawn/resume.test.ts`
- `test/spawn/roster.test.ts`
- `test/sync/resolve.test.ts`
- `test/sync/two-clones-spawn.test.ts`

Contains section 5.

### Commit 3

Subject: `chore(criteria): bump the version for the breaking criterion input`

Files:
- `package.json`
- `.claude-plugin/plugin.json`

Contains plan step 15.

No commit mixes a rename or a move with a behaviour change; this unit contains neither.

## 10. Pull request

Run exactly this, from the repository root, with the branch pushed:

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u4-criterion-contract-a --base main \
  --title "feat(criteria): require a check on every criterion created" \
  --what "Opening a thread now takes each completion criterion as a text-and-check pair, and a criterion sent without a check is refused." \
  --what "Inserting a criterion mid-thread now requires a check too, and an insert without one is refused by name." \
  --why "A goal recorded with no statement of how it would be decided cannot be checked by anyone but the person who claimed it." \
  --risk "The published argument shape of open_thread changes, so any caller outside this repository that sends plain strings breaks until it sends pairs." \
  --verified "npm test - fail 0, exit 0" \
  --verified "npm run typecheck - exit 0, no output" \
  --verified "node scripts/check-packaging.mjs - check-packaging: ok, exit 0" \
  --verified "new acceptance tests red on the parent commit - 5 of 5 failed" \
  --verified "inertness mutation on each behavioural criterion - 5 mutations, every named test turned red" \
  --not-verified "npm run mutate - not run"
```

Measured diff size: **392 changed lines — 112 production, 280 test.** Measured by applying every step in sections 4 and 5 to a throwaway copy of the tree and diffing it against the unmodified copy. That is inside the 400-line review ceiling.

Expect the command to exit 0 and to print the URL of the created pull request on its last line. A non-zero exit is a stop condition: report it and open no pull request by any other means.

## 11. Stop conditions

For every condition below: **STOP and report; do not improvise.**

### 11.1 The schema fields this unit writes into must already exist

Run, and expect exit 0:

```
node -e "const t=require('fs').readFileSync('src/schema/thread.ts','utf8');console.log(['check','result','result_status'].every(f=>t.includes(f+': ')))"
```

If the output is not `true`, the schema unit has not landed on this branch's base. STOP and report; do not improvise.

Run, and expect exit 0:

```
node -e "const c=require('fs').readFileSync('src/schema/caps.ts','utf8');console.log(c.includes('CRITERION_CHECK_MAX'))"
```

If the output is not `true`, the cap this unit measures against does not exist. STOP and report; do not improvise.

### 11.2 The two manifests must agree before anything is changed

Run, and expect exit 0:

```
node -e "console.log(require('./package.json').version, require('./.claude-plugin/plugin.json').version)"
```

If the two values printed are not identical, STOP and report; do not improvise. A version merely higher than `1.6.2` is not a stop condition — the ladder shifted, and step 15 reads the current value rather than assuming one.

### 11.3 Every FIND string must match exactly once

If any FIND string in section 4 or section 5 is absent from its file, or occurs more than once, the file has moved under this plan. STOP and report; do not improvise. Do not search for something similar and edit that.

### 11.4 The suite gate

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

### 11.5 Things this unit never does

- It never runs `npm ci` or `npm install`.
- It never calls any `mcp__plugin_logbook_ledger__*` tool, and never writes to this project's own ledger store. Every test in this plan drives a throwaway store under the system temporary directory.
- It never opens a pull request by any path other than the command in section 10. If a skill or slash command offers to create one, refuse it.
- It never edits, skips, focuses or deletes a test to reach a green.
- It never edits `docs/specs/2026-08-28-continuity-goal-model.md` or any other unit's plan.
