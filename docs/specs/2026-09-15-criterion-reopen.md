# Reopening a done completion criterion

Date: 2026-09-15
Status: specified
Thread: 01M2K3JHTD9RYEWTV0QXHD2FR7
Verified against: `main` at `7b6cf210`
Deferred from: `docs/specs/2026-09-11-deferred-cap-items.md`, decision `01M2K3HMZW51A9J1X3X2J84M67`
Replaces, for risk placement at hand-off: decision `01M2HK2XFVDMYDJABVW2SA5204`, shipped in PR #259

---

## Read this first

- A **thread** is one unit of work, stored as a JSON file in the project's git repository.
- A **criterion** is one statement of what done means for that thread.
- The **spine** is the running summary inside a thread: active goal, next step, risks, decision links.
- The **briefing** is the text a new session reads to pick the thread up.
- A **risk** is a recorded hazard. It may carry a `criterion_id`, meaning it bears on that one criterion.

---

## The defect

`done` is a one-way door, and passing through it hides whatever points at the criterion.

`update_thread` with `criteria_done` is the only writer that sets `done` true, at
`src/server/tools/update_thread.ts:458`. The only other assignment in the codebase is `done: false`
at creation, `src/domain/criteria.ts:158`. Nothing writes it back. `amend_criteria` with `rewrite`
refuses a criterion already marked done, `src/domain/criteria.ts:194`.

The briefing sorts every anchored item into a live lane and a settled lane, and a done criterion
sends its items to the settled lane, `src/render/briefing.ts:238`. A next step anchored to a done
criterion resolves to null, `src/render/briefing.ts:247`.

So a risk recorded against a criterion that was marked done renders under
**Settled items (on goals already met or struck)** rather than **Open risks**. When a later session
finds that the work behind a done criterion was not finished, the entry saying so is filed under
the heading claiming it was met.

### Why strike and insert is not the remedy

The refusal at `src/domain/criteria.ts:93` directs the caller to strike the criterion and insert a
replacement. Striking retains the criterion and marks it struck; inserting mints a **new id**.

Risks (`Risk.criterion_id`), key decisions (`KeyDecision.criterion_id`) and the next step
(`Spine.next_step_criterion_id`) all anchor by criterion id. After a strike they still point at the
struck original, which `laneFor` also files as settled. The hidden risk stays hidden, and an empty
new criterion appears beside it.

---

## Scope

### In scope

The four sections below: the stored shape, the refusals, the briefing lanes, and the debrief step.

### Out of scope, on purpose

**No merge rules.** Ruled by the human on 2026-09-15, decision `01M2KWT3AR5FNA63Q0RKZR00TD`: a
criterion marked done on one clone against the same criterion reopened on another is settled by
review, not by a rule written here.

The reason recorded on the thread cited `criterionContent` in `src/merge/field-merge.ts`. Neither
that file nor that symbol exists on `main` at `7b6cf210`. What exists is
`src/merge/json-differences.ts`, which walks the two records, keys id-bearing lists by id, and
reports the changed paths for a human to settle. There is no automatic field-level merge of
criterion content to write a rule against, so the decision holds by a shorter route than the one
recorded.

**No change to `close_thread`.** Closing a thread stays irreversible,
`docs/rules/continuity-ledger.md:81`. Reopening a criterion is not reopening a thread.

**No change to settledness.** `settledness` and `settled_by` stay unwritable by any amendment,
which `settlednessNotAmendableRefusal` already enforces for `rewrite` and `strike`. Reopen joins
them. Who stands behind a criterion did not change because the criterion was reopened.

---

## Section 1: the stored shape

`Criterion` in `src/schema/thread.ts:15` gains one field.

```
reopened_by?: Ulid | null | undefined
```

Declared `structural`, mirroring `struck_by`, and **optional**, mirroring `settledness`. Optional is
load-bearing: threads already stored in the ledger carry no such field, and a required field would
make `ThreadRecord.parse` reject every record written before this change.

An accessor mirrors `criterionSettledness`:

```
criterionReopenedBy = (criterion: Criterion): Ulid | null => criterion.reopened_by ?? null
```

### What a reopen writes

| Field | After a reopen |
| --- | --- |
| `id` | unchanged, which is the whole point |
| `done` | `false` |
| `reopened_by` | the `decision_id` that justified the reopen |
| `result` | unchanged, the earlier result kept as history |
| `result_status` | unchanged |
| `text`, `check` | unchanged |
| `settledness`, `settled_by` | unchanged |
| `struck_by` | unchanged, and a struck criterion is refused anyway |

### What marking it done again writes

`update_thread` with `criteria_done` clears `reopened_by` to `null` in the same write that sets
`done` true and records the new `result` and `result_status`. A criterion that is done is not also
reopened, and the fresh result replaces the earlier one.

The cycle is therefore repeatable: done, reopened, done again. Each reopen names its own decision.

---

## Section 2: the refusals

A new domain entry point `reopenCriterion` in `src/domain/criteria.ts`, and a fourth `operation`
value on `amend_criteria`. The refusals, in the order they are evaluated:

| Order | Condition | Refusal | Retryable |
| --- | --- | --- | --- |
| 1 | `decision_id` absent or blank | `missingDecisionRefusal`, existing | yes |
| 2 | `decision_id` resolves to no stored decision | `unresolvedDecisionRefusal`, existing | yes |
| 3 | `criterion_id` names no criterion on the thread | `criterionNotFoundRefusal`, existing | yes |
| 4 | the criterion is struck | `struckCriterionRefusal`, existing | yes |
| 5 | the criterion is not done | `notDoneCriterionRefusal`, **new** | yes |

The tool layer refuses before reaching the domain, matching the `rewrite` and `strike` branches:

| Condition | Refusal |
| --- | --- |
| `criterion_id` omitted | `missingFieldRefusal('criterion_id', 'reopen')`, existing |
| `settledness` given | `settlednessNotAmendableRefusal('settledness', 'reopen')`, existing |
| `settled_by` given | `settlednessNotAmendableRefusal('settled_by', 'reopen')`, existing |

`decision_id` is already non-optional on `AmendCriteriaInputSchema`, so a call omitting it is
refused by schema validation before the handler runs. `reopenCriterion` still calls
`requireDecision`, so the domain refuses on its own terms when called directly.

The new refusal reads:

> `criterion_id` names a criterion that is not marked done, so there is nothing to reopen; a
> criterion that has not been met is already open; received `<id>`.

It emits no filesystem path. `test/contract/no-path.test.ts` is a closed census, so
`reopenCriterion` is registered there as a refusal producer and exercised; a producer the register
does not name halts the census rather than passing silently.

---

## Section 3: the briefing lanes

`laneFor` at `src/render/briefing.ts:238` and `openCriterionId` at `src/render/briefing.ts:247`
both test `criterion.done`. Setting `done` false restores both without touching either function:

- a risk anchored to the reopened criterion returns to **Open risks**
- a `next_step_criterion_id` anchored to it resolves again, so the briefing narrows to it

Two render changes are needed so the reopen is legible rather than silent.

**Status label.** `criterionStatus` at `src/render/briefing.ts:118` gains a fourth outcome, ordered
after struck and done:

```
struck -> 'struck'
done -> 'done'
reopened_by non-null -> 'reopened'
otherwise -> 'open'
```

**Earlier result.** `renderCriterionBlock` at `src/render/briefing.ts:165` renders the result line
for a criterion that is done. It renders it for a reopened criterion too, so the earlier result
stays readable beside `done: false`. The line keeps its existing shape and clip budget; a reopened
criterion is not a new budget line.

---

## Section 4: the debrief step

`skills/debrief/SKILL.md` currently pairs each found risk with a criterion the thread record shows
as **open**, or with null for the whole thread (step 6). A risk about a done criterion therefore has
nowhere accurate to go and lands against the thread at large, losing which goal it concerned.

The sequence gains three steps, placed after the found risks are gathered and before
`update_thread` records them:

1. **Gather** the risks this session found that bear on a criterion the record shows as done, each
   paired with that criterion id.
2. **Call** `record_decision` recording the reopening of those criteria and the reason.
3. **Call** `amend_criteria` with `operation` set to `reopen`, once per criterion, carrying that
   decision id.

Step 6 keeps its existing wording, so a risk about an open criterion is unaffected.

### Wording constraint

`contract.skills-hold-no-rules` rejects any skill line containing `must`, `never`, `only`,
`unless`, `cannot`, `always`, `should`, `may`, `require`, `requires`, `if`, `when`, `at most` or
`at least`, and every step begins with one of `Call`, `Present`, `Wait`, `Gather`, `Print`, `Stop`.
The new steps are written to that grammar.

### Contract changes

`skill.cannot-strand` drives every `Call` step of each skill against a live server and asserts none
of them errors, so two things follow from adding two calls to the debrief sequence. The drive needs
a fixture argument resolver for `record_decision` and one for `amend_criteria`, and it must carry
the decision id from the first into the second, so `DriveContext` gains a `decisionId` that the
drive folds in from the `record_decision` reply. The fixture criterion must also be marked done
before the debrief sequence is driven, since a reopen of a criterion that is not done is refused.

A new assertion,
`skill.debrief-reopens-a-criterion-a-found-risk-shows-incomplete`, covers the ordering: the risks
are gathered, then the decision is recorded, then the `amend_criteria` reopen call is made carrying
that decision id, then `update_thread` adds the risk.

`skill.debrief-chooses-criteria-from-the-thread-record-and-keeps-found-risks-through-a-refusal`
needs no change. It scopes itself to `Gather` steps containing the phrase "completion criterion",
and the reopen step names a criterion without that phrase, so the steps that anchor a risk or the
next step keep their existing obligation to choose one the record shows as open.

### The description budget

`contract.instructions-within-budget` caps each published tool description at 2048 bytes and its
lead sentence at 200. Naming the fourth operation pushed the `amend_criteria` lead to 220, so the
lead drops "on a thread", which the rest of the description and `amend_criteria.thread_id` already
carry. The whole description lands at 1779 bytes.

---

## Completion criteria

| Criterion | Proved by |
| --- | --- |
| c1 `01M2K3JHTD0PK3W5TM1BGXC9S3`: reopen only with a recorded decision, keeping id and earlier result | spawn test: mark done, reopen, assert `done` false, id unchanged, earlier result readable, reopen without `decision_id` refused |
| c2 `01M2K3JHTD99WQG191Q130937E`: risks and next step return to the live view | spawn test: anchor a risk and `next_step_criterion_id`, mark done, reopen, assert the risk renders under Open risks and the briefing narrows to it |
| c3 `01M2K3JHTDPQ3NKZW5KWXR7K6T`: the debrief reopens rather than recording a whole-thread risk | `test/contract/skills.test.ts` asserts the reopen call precedes the `update_thread` risk call |

---

## Files this touches

| File | Change |
| --- | --- |
| `src/schema/thread.ts` | `reopened_by` on `Criterion` and `CriterionSchema`, `criterionReopenedBy` accessor |
| `src/domain/criteria.ts` | `notDoneCriterionRefusal`, `ReopenCriterionInput`, `reopenCriterion` |
| `src/server/tools/amend_criteria.ts` | `reopen` on both operation enums, the handler branch, the tool description |
| `src/server/tools/update_thread.ts` | `criteria_done` clears `reopened_by` |
| `src/render/briefing.ts` | `reopened` status, earlier result rendered for a reopened criterion |
| `skills/debrief/SKILL.md` | the three new steps |
| `docs/rules/continuity-ledger.md` | the amendment sentence names four operations |
| `docs/registers/size-limits.json` | three `briefing.ts` rows re-pointed at the lines the render change moved |
| `test/spawn/criterion-reopen.test.ts` | c1 and c2, new file |
| `test/contract/skills.test.ts` | c3, plus the fixture resolvers `skill.cannot-strand` needs |
| `test/contract/no-path.test.ts` | `reopenCriterion` registered as a refusal producer |
| `test/support/published.ts` | the amended and the new `amend_criteria` claim phrases |
