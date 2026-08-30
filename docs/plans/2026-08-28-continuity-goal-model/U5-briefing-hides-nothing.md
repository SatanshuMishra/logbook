# U5 — The briefing hides nothing

## 0. Identity

**Closes:** the four display-time counters that hide items from a list an agent already curated
(`src/render/briefing.ts:48-53`); items attached to a finished or struck criterion never rendering at
any budget (`src/render/briefing.ts:115,128-132`); key decisions rendering as bare titles though the
decision identifier is present in the same object (`src/render/briefing.ts:84`); `Risk.refs` being
stored and rendered by no surface; and the criterion being worked being guessed as the
lowest-numbered unfinished one (`src/render/briefing.ts:102-105`).

**Depends on:** the schema change that adds `Criterion.check`, `Criterion.result`,
`Criterion.result_status` and `Thread.artifacts`, and that leaves the serialised-thread-record byte
limit at 65536. Section 11 makes that a checkable stop condition.

**Required by:** two later units edit `src/render/briefing.ts` after this one — the unit that derives
the previous session's summary, and the unit that lets a session declare which goals it is focused
on. Neither is planned here.

**Wave:** 2.

**Splits into three pull requests.** Measured, not estimated — section 10 gives the numbers and the
ruling.

| Order | Part | Branch | Type |
| --- | --- | --- | --- |
| 1 | **U5-A** The display caps go | `feat/u5a-briefing-caps-go` | feat |
| 2 | **U5-B** Every shortened value says so | `feat/u5b-clip-marker` | feat |
| 3 | **U5-C** Every item says what it is | `feat/u5c-item-detail` | feat |

**Version bump.** Baseline `2.0.0` -> `2.1.0` for the unit as a whole, per orchestrator ruling OR1.
Each of the three parts increments MINOR and sets PATCH to 0, read-then-increment, per orchestrator
ruling OR6. No part hard-codes a version pair.

**New module this unit creates and wholly owns:** `src/render/clip.ts`. It holds the one clip-marker
implementation. The unit that adds a marker to the session-start banner imports the same module; it
does not write a second one.

**Also edits, to keep the tree green:** `test/contract/render-census.test.ts` (it must learn that
`src/render/clip.ts` is an escaping module, or the render census halts on the new call) and
`test/spawn/decisions.test.ts` (one assertion pins the key-decision line, which now carries the
decision identifier).

**Files this unit does not change, and why.** `src/render/roster.ts` belongs to this unit for this
wave. A census of it found no display-time item cap and no text shortening: `selectRosterThreads`
filters and sorts, `toRosterRow` copies fields, `paginateRoster` is caller-supplied page size with a
`next_cursor` and a `total`, and `renderRoster` renders every row it is handed. It is therefore left
byte-identical.

**SPEC anchors:** section 9 unit U5; section 8 rules B16, B17, B18, B19, B20, B21, B22, B24; section
6 invariants O1, O2, O3, S3; section 7 defects D1, D4, D5, D6, D9.

**Three standing plan invariants, and how this unit stands against each.**

- *No new silent success.* This unit changes one pure function chain and one new pure helper. It adds
  no tool, no argument, no validation and no refusal path, so there is no place a call could report
  success for something it did not do. The one thing the renderer already reports about itself —
  whether its output fits the budget — stops being an unasserted field and becomes a swept property:
  no record may render past a cap while reporting that it fits.
- *No record disappears.* This unit adds no field to any record schema, changes no stored shape, and
  writes nothing. `src/schema/` is untouched. Every record in the live store parses exactly as it did
  before, and a record that predates the schema unit — with no `check`, no `result` and no `artifacts`
  — renders the words `not recorded` and no artifacts section rather than failing.
- *This repository is the installed plugin.* No test specified here observes this session's own
  ledger. Every one of them is either a pure function called with a fixture value built in memory, or
  a walk over the compiled source tree, or — for the one end-to-end test touched in step C6 — the
  existing spawned-server fixture, which already builds its own repository and its own plugin-data
  directory under the system temporary directory.

---

## 1. Acceptance criteria (the ceiling)

Definitions used below, in plain words, defined once.

- **Display-time item cap** — a number in the renderer that decides how many of a list's entries are
  printed, discarding the rest. It is not the same thing as a text limit, which shortens one entry's
  text but never removes the entry.
- **The budget** — the two size limits the whole briefing must fit: 12000 characters, and 23800 bytes
  once the reply is serialised. The renderer searches for the largest per-entry text limit that fits
  both. This unit does not change either number or the search.
- **Lane** — which group an entry renders in. An entry may name the goal it belongs to; the lane is
  decided from that goal's state.
- **Marker** — a fixed piece of text appended to a value that was shortened, so a reader can see that
  what they are looking at is not the whole thing.

Numbered, each naming the rule or invariant it discharges. **P** marks the part that ships it.

| # | Criterion | Discharges | P |
| --- | --- | --- | --- |
| 1 | Every display-time item cap in `src/render/briefing.ts` is deleted. The complete list is the four lane caps `LANE_A_RISKS_MAX`, `LANE_B_RISKS_MAX`, `LANE_A_TITLES_MAX`, `LANE_B_TITLES_MAX`, plus `OUT_OF_SCOPE_SHOWN_MAX`, `CRITERIA_SHOWN_MAX` and `DECISION_ID_SHOWN_MAX`. Seven, established by census over the real file in section 2.1 | B16 | A |
| 2 | The character budget, the byte budget and the search that finds the largest fitting text limit are unchanged: `BRIEFING_MAX_CHARS`, `RESUME_PAYLOAD_MAX_BYTES`, `RESUME_PAYLOAD_RESERVE_BYTES`, `resumePayloadBytes`, `fitsBudget` and `largestFittingClipRender` keep their present values and shape | B16 | A |
| 3 | `laneFor` never removes an entry. Every entry it classifies renders, in one group or the other | B17 | A |
| 4 | `currentCriterionId` is deleted. With no focus recorded there is no lane A: risks and key decisions on unfinished goals render as one group, in the order they were recorded, and the briefing prints one line saying focus is not set | B18, D1 | A |
| 5 | Entries attached to a goal that is met or struck render **last**, **compactly** — identifier and text only — under their own heading naming them settled. They are never withheld | B19, D5 | A |
| 6 | The `Not shown` block carries exactly two possible entries: a count of linked decision records that could not be read, and one line saying that some text was shortened. The four per-list count lines are gone. The address line renders whenever the block renders | B20, O2 | A |
| 7 | A halting census whose population is every read of `Criterion.ordinal` across `src/`, `hooks/`, `bin/`, `scripts/` and `test/` classifies each read, prints all of them, and asserts that every read under `src/render` renders a display label. A control proves it halts. Section 3.5 records the three reads it prints but does not assert, and why | S3, partly | A |
| 8 | A briefing whose full render fits the budget renders in full: no value is shortened, no marker appears, and no `Not shown` block appears — including for a record whose stored text expands sixfold when escaped | O1 | B |
| 9 | Every shortened value ends with the marker, the marker fits inside that value's own limit, and the marker never appears more than once on a line | O3 | B |
| 10 | One module, `src/render/clip.ts`, holds the clip-marker implementation, and the briefing calls it. No second implementation exists | B24 | B |
| 11 | A key decision renders its decision identifier beside its title | B21, D6 | C |
| 12 | A risk renders each of its external pointers. A thread renders its artifacts, above the running summary | B22, D9 | C |
| 13 | A criterion renders its check on every render. A criterion marked done also renders its result and the status of that result. An absent value renders the words `not recorded`, never a blank | B24 | C |

Anything discovered above this list is appended to
`docs/plans/2026-08-28-continuity-goal-model/FILED.md` as a new item, and is not folded into this
plan.

---

## 2. Ground truth

Line numbers were read from the working tree while copying the text into this plan.

### 2.1 `src/render/briefing.ts:48-62` — the seven display-time item caps

```ts
const LANE_A_RISKS_MAX = 8
const LANE_B_RISKS_MAX = 4
const RISK_TEXT_NATURAL_MAX = 500

const LANE_A_TITLES_MAX = 10
const LANE_B_TITLES_MAX = 5
const KEY_DECISION_TITLE_NATURAL_MAX = 200

const OUT_OF_SCOPE_SHOWN_MAX = 10
const OUT_OF_SCOPE_TEXT_NATURAL_MAX = 300

const CRITERIA_SHOWN_MAX = caps.CRITERIA_MAX_ELEMENTS
const CRITERION_TEXT_NATURAL_MAX = 500

const DECISION_ID_SHOWN_MAX = 6
```

**The census that establishes the list is closed.** The population is every constant in this file
that bounds how many entries of a list are printed. Reading the file top to bottom there are exactly
seven: the four lane caps, `OUT_OF_SCOPE_SHOWN_MAX`, `CRITERIA_SHOWN_MAX` and `DECISION_ID_SHOWN_MAX`.
The four `*_NATURAL_MAX` constants interleaved with them are text limits, not item caps — each is fed
to `clipAt` and shortens one entry's text; none removes an entry. `RELATED_TITLE_CLIP = 100` and
`RELATED_SLUG_CLIP = 64` at lines 45-46 are text limits by the same test. `MIN_TEXT_CLIP` and
`MAX_ITEM_CLIP` bound the search, not the list.

Each of the seven reaches the render through exactly one call, and each of those calls discards
entries: `laneSplit(..., LANE_A_RISKS_MAX, LANE_B_RISKS_MAX)` at line 318,
`laneSplit(..., LANE_A_TITLES_MAX, LANE_B_TITLES_MAX)` at line 319,
`capList(thread.spine.out_of_scope, OUT_OF_SCOPE_SHOWN_MAX)` at line 320,
`capCriteria(thread.completion_criteria, CRITERIA_SHOWN_MAX)` at line 321, and
`capList(..., DECISION_ID_SHOWN_MAX)` at lines 322-323.

What is wrong: a list an agent already curated is filtered a second time by a counter that has read
none of its entries. That is SPEC defect D4.

### 2.2 `src/render/briefing.ts:102-105` — the guessed current criterion

```ts
const currentCriterionId = (criteria: readonly Criterion[]): string | null => {
  const current = criteria.find((criterion) => criterion.struck_by === null && !criterion.done)
  return current === undefined ? null : current.id
}
```

What is wrong: nothing records which goal is being worked, so the renderer guesses it as the first
unfinished one in array order. The guess is silent and wrong for anyone who does not work strictly
top to bottom. That is SPEC defect D1.

### 2.3 `src/render/briefing.ts:107-133` — the lane split that both orders and discards

```ts
const laneFor = (
  criterionId: string | undefined,
  criteriaById: ReadonlyMap<string, Criterion>,
  currentId: string | null
): Lane => {
  if (criterionId === undefined) return 'B'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'B'
  if (criterion.struck_by !== null || criterion.done) return 'C'
  return criterion.id === currentId ? 'A' : 'B'
}

type Laned<T> = { shown: T[]; hidden: number }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>,
  currentId: string | null,
  capA: number,
  capB: number
): Laned<T> => {
  const laneA = items.filter((item) => laneFor(item.criterion_id, criteriaById, currentId) === 'A')
  const laneB = items.filter((item) => laneFor(item.criterion_id, criteriaById, currentId) === 'B')
  const shownA = laneA.slice(0, capA)
  const shownB = laneB.slice(0, capB)
  return { shown: [...shownA, ...shownB], hidden: items.length - shownA.length - shownB.length }
}
```

What is wrong, twice over. Lane `'C'` is computed and then never collected into `shown`, so an entry
attached to a met or struck goal is withheld at every budget and is folded into an undifferentiated
`hidden` count — SPEC defect D5. And lane `'A'` exists only to rank against the guess of 2.2.

### 2.4 `src/render/briefing.ts:135-171` — the two selectors the caps drive

```ts
const capList = <T>(items: readonly T[], cap: number): Laned<T> => ({
  shown: items.slice(0, cap),
  hidden: Math.max(0, items.length - cap)
})

const CRITERION_RANK_OPEN = 0
const CRITERION_RANK_DONE = 1
const CRITERION_RANK_STRUCK = 2

const criterionRank = (criterion: Criterion): number => {
  const status = criterionStatus(criterion)
  if (status === 'open') return CRITERION_RANK_OPEN
  return status === 'done' ? CRITERION_RANK_DONE : CRITERION_RANK_STRUCK
}

type RankedCriterion = { criterion: Criterion; index: number; rank: number }

const byRankThenOriginalIndex = (left: RankedCriterion, right: RankedCriterion): number =>
  left.rank === right.rank ? left.index - right.index : left.rank - right.rank

const capCriteria = (criteria: readonly Criterion[], cap: number): Laned<Criterion> => {
  const ranked: RankedCriterion[] = criteria.map((criterion, index) => ({
    criterion,
    index,
    rank: criterionRank(criterion)
  }))
  const selectedIndices = new Set(
    [...ranked]
      .sort(byRankThenOriginalIndex)
      .slice(0, Math.max(0, cap))
      .map((entry) => entry.index)
  )
  return {
    shown: ranked.filter((entry) => selectedIndices.has(entry.index)).map((entry) => entry.criterion),
    hidden: criteria.length - selectedIndices.size
  }
}
```

What is wrong: both exist only to serve a cap. `capCriteria`'s ranking never reorders what is printed
— the final `ranked.filter(...)` restores the original order — so the sort exists purely to choose
which entries survive `cap`. With no cap there is nothing to choose and the whole apparatus is dead.

### 2.5 `src/render/briefing.ts:84` — a key decision printed without its identifier

```ts
const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string => `- ${clip(keyDecision.title, textClip)}`
```

What is wrong: `keyDecision.decision_id` sits in the same object and is dropped, so a reader who wants
the decision itself has to guess an address. The thread resource prints both
(`src/server/resource-render.ts:50-51`). That is SPEC defect D6.

### 2.6 `src/render/briefing.ts:82` — a risk printed without what backs it

```ts
const renderRiskLine = (risk: Risk, textClip: number): string => `- ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`
```

What is wrong: `Risk.refs` is declared as *"external pointers backing this risk"*, is written, and no
surface renders it. That is SPEC defect D9's render half.

### 2.7 `src/render/briefing.ts:75-80` — a criterion printed without its check

```ts
const renderCriterionLine = (criterion: Criterion, textClip: number): string => {
  const text = clip(criterion.text, textClip)
  const label = `- c${criterion.ordinal} [${criterionStatus(criterion)}]:`
  const withText = text.length === 0 ? label : `${label} ${text}`
  return `${withText} (id ${escapeStored(criterion.id)})`
}
```

What is wrong with it: nothing in the line itself, and it is quoted because acceptance criterion 13
rewrites it. The schema unit that precedes this one adds `check`, `result` and `result_status` to a
criterion; no surface reads any of the three, which is SPEC defect D19 — a criterion carrying no
statement of how it would be decided — surviving into the render layer.

### 2.8 `src/render/briefing.ts:249-258` — the `Not shown` block

```ts
  const notShownBulletLines = [
    ...[risks.hidden].filter((count) => count > 0).map((count) => `- ${count} risks not shown`),
    ...[keyDecisions.hidden].filter((count) => count > 0).map((count) => `- ${count} key decisions not shown`),
    ...[outOfScope.hidden].filter((count) => count > 0).map((count) => `- ${count} out-of-scope items not shown`),
    ...[criteria.hidden].filter((count) => count > 0).map((count) => `- ${count} completion criteria not shown`),
    ...[danglingOrQuarantinedHidden]
      .filter((count) => count > 0)
      .map((count) => `- ${count} dangling or quarantined decision ids not shown`),
    ...[textWasClipped].filter(Boolean).map(() => TEXT_CLIPPED_BULLET)
  ]
```

Today's members, established by reading the block: five count lines and one text-clip line. Once the
seven caps are gone, four of the five counts can only ever be zero and their lines are unreachable.
The fifth, the dangling-or-quarantined count, is likewise driven by a deleted cap.

### 2.9 `src/render/briefing.ts:64-68` — the one text-shortening helper, with no marker

```ts
const MIN_TEXT_CLIP = 0
const TEXT_CLIPPED_BULLET =
  '- some criterion, risk, key decision or out-of-scope text was shortened to fit the character budget'

const clip = (text: string, max: number): string => clipGraphemes(escapeStored(text), max)
```

What is wrong: `clip` truncates silently. A reader of one shortened line cannot tell it was shortened;
only the whole-briefing bullet says so, and it does not say which line. And the floor of the search is
zero, so at the tightest budget an entry's text disappears entirely with nothing standing in its place.

### 2.10 `src/render/briefing.ts:347-348` — the first render attempt is not a full render

```ts
  const unclipped = renderWith(FULL_CLIP, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)
```

What is wrong: `FULL_CLIP` is `clipAt(MAX_ITEM_CLIP)`, which is 500. A stored value whose text expands
when escaped — one `#` becomes the six characters `U+0023` — can exceed 500 escaped characters while
its record still fits the budget comfortably. The first attempt therefore shortens text on a briefing
that had room for all of it, and reports `textWasClipped` as `false` while doing so. The predecessor
title and slug are worse: they are pinned at 100 and 64 and never enter the search at all.

### 2.11 `test/contract/render-census.test.ts:26-28` — what the render census recognises

```ts
const ESCAPE_MODULE_SPECIFIERS = ['./escape.ts', '../render/escape.ts', '../../render/escape.ts']
const ESCAPE_FUNCTION = 'escapeStored'
const CLIP_FUNCTION = 'clipGraphemes'
```

What is wrong with it: nothing in the census itself, and it is quoted because acceptance criterion 10
cannot be met without changing it. This census walks the
briefing renderer and halts on any interpolation whose value it cannot prove is either escaped or
written by the server. It resolves a call only when the called function is one of these two names,
imported from one of these three module paths, or is declared in the same file. A new escaping helper
in a new module is invisible to it, and every call to it halts the census. Part B therefore teaches
the census the new module and the new name — which is classifying a new item, not excluding one.

### 2.12 `test/unit/briefing.test.ts:96-606` — the tests that assert the caps

The most direct of the ten, `test/unit/briefing.test.ts:502-524`, verbatim:

```ts
test('briefing.completion-criteria-are-capped-and-open-ones-survive', () => {
  const retired: Criterion[] = Array.from({ length: 199 }, (_, index) =>
    criterion({ ordinal: index + 1, text: 'retired', struck_by: rt.ulid() })
  )
  const survivor = criterion({ ordinal: 200, text: 'still open' })
  const thread = baseThread({ completion_criteria: [...retired, survivor] })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)

  assert.equal(
    criterionRowCount(rendered),
    40,
    'the completion criteria list must render at most 40 rows, however many criteria the thread retains'
  )
  assert.ok(
    rendered.includes(survivor.id),
    'the open criterion at ordinal 200 must survive the cap; a plain slice of the first 40 would drop it'
  )
  assert.ok(
    rendered.includes('- 160 completion criteria not shown'),
    'the 160 criteria the cap withheld must be counted in the not-shown tail'
  )
})
```

What is wrong with it: it pins `CRITERIA_SHOWN_MAX` as correct behaviour and asserts that 160 of a
thread's 200 goals are withheld and counted. That is SPEC defect D4 — a display-time counter filtering
a list an agent already curated — restated as a passing test, so the defect cannot be removed while
this assertion stands.

Ten tests in this file are in that position. They are named here so that replacing them is a
deliberate, listed act rather than a side effect:
`briefing.renders-exact-output-for-a-full-thread`,
`briefing.omits-empty-list-sections-entirely`,
`briefing.lane-a-is-the-current-criterions-items-shown-in-full`,
`briefing.out-of-scope-overflow-is-capped-and-counted-in-the-tail`,
`briefing.dangling-and-quarantined-overflow-is-capped-and-counted-in-the-tail`,
`briefing.lane-c-collapses-a-done-criterions-risk-while-lane-b-shows-an-unanchored-one-in-full`,
`briefing.a-risk-on-a-criterion-hidden-by-the-cap-still-collapses-to-lane-c`,
`briefing.lane-caps-collapse-overflow-into-the-not-shown-tail`,
`briefing.completion-criteria-are-capped-and-open-ones-survive`,
`briefing.renders-a-record-byte-maximal-thread-within-budget`.

An eleventh, `briefing.the-clip-search-keeps-most-of-the-risk-text-on-the-worst-reachable-ascii-record`,
pins a number that was calibrated against the capped render: it required 250 characters of the first
risk to survive when only 12 risks printed. With every risk printing, the same budget divides across
more entries. Measured on the changed renderer: 37 characters survive. That number is not restored and
not lowered to a new pin; section 5 replaces it with a property that does not depend on how many
entries print.

### 2.13 `src/server/tools/record_decision.ts:55-60` and `src/domain/criterion-backfill.ts:5-13` — the two reads of `Criterion.ordinal` this unit cannot remove

```ts
  const lowest = open.reduce<Criterion | null>(
    (best, candidate) => (best === null || candidate.ordinal < best.ordinal ? candidate : best),
    null
  )
  return lowest === null ? null : `criterion ${lowest.ordinal}`
```

```ts
export const criterionIdForScope = (scope: string, criteria: readonly Criterion[]): Criterion['id'] | undefined => {
  const match = SCOPE_ORDINAL_PATTERN.exec(scope.trim())
  if (match === null) return undefined
  const ordinalText = match[1]
  if (ordinalText === undefined) return undefined
  const ordinal = Number(ordinalText)
  const criterion = criteria.find((candidate) => candidate.ordinal === ordinal)
  return criterion?.id
}
```

What is wrong with them: both compare one criterion's position against a number to pick a criterion,
which is reading position to infer sequence. The first fabricates a decision's scope from the
lowest-numbered open goal, which is SPEC defect D2. The second resolves a stored scope string back to
a goal, so a thread whose goals are reordered — and ordinals recompute, asserted today by
`criteria.ordinals-recompute` — resolves that string to a different goal than the one it was written
against. Neither file belongs to this unit; section 3.5 records what that means for `S3`.

### 2.14 `test/spawn/decisions.test.ts:307-311` — the end-to-end assertion on a key-decision line

```ts
    assert.equal(
      lines[keyDecisionsAt + 1],
      '- link decisions into the spine automatically',
      'the Key decisions section must carry the decision title with no intervening update_thread call'
    )
```

What is wrong with it: it pins the key-decision line as a bare title, through a spawned server, so it
holds SPEC defect D6 — the decision identifier being dropped though it sits in the same object — in
place from the far end of the system.

### 2.15 `test/unit/briefing-frontier-sweep.test.ts:324-332` — the sweep's closing assertion

```ts
  assert.equal(
    breaching.length,
    0,
    [
      `${breaching.length} of ${swept.length} swept records exceeded the ${BRIEFING_MAX_CHARS} character cap or the ${RESUME_PAYLOAD_MAX_BYTES} resume-payload byte cap`,
      ...worstPerFill.map((record) => `worst ${record.fill}: ${describe(record)}`),
      ...worstFirst.slice(0, 5).map((record) => `breaching: ${describe(record)}`)
    ].join('\n')
  )
```

What is wrong with it: nothing today, and it is quoted because acceptance criteria 1 and 3 make the
property it asserts false. Section 3.1 records that as the plan's largest single consequence.

---

## 3. Divergences from the SPEC

### 3.1 A record at the top of its size limit no longer fits the briefing budget, and says so

The SPEC's section 9 gives this unit "Every display-time item cap deleted; the budget untouched." Both
halves are honoured literally. The consequence, measured rather than reasoned:

| Fixture | Before | After |
| --- | --- | --- |
| The record-byte-maximal thread already in the suite (65528 stored bytes; 200 criteria, 40 risks, 40 out-of-scope entries, 5 key decisions, 100 unreadable decision identifiers) | 40 criteria printed, within budget | every entry printed, 26834 characters and 55130 serialised bytes, reported as outside budget |
| The frontier sweep, 733 records after this unit's three parts | 0 records past a cap | 227 records past a cap, every one of them reporting itself as outside budget, and none losing an entry |

The sweep's record count is not a constant. Its grid searches for the criterion-text length at which
each configuration stops rendering unclipped, so a change to what the renderer prints moves that
frontier and changes how many lengths it samples. Measured: 697 records against the shipped renderer,
689 against the tree part B leaves, 733 against the tree part C leaves. Every count in this plan names
the tree it was taken against.

This is not a new failure mode. `renderBriefingWithPasses` already returns `withinBudget`, and
`resume_thread` already logs `briefing.budget-exceeded` and returns the briefing anyway
(`src/server/tools/resume_thread.ts:95-102`), asserted today by
`resume_thread.logs-a-budget-breach-only-for-a-render-that-does-not-fit`. What changes is how often
that path is taken.

The SPEC anticipated it. Section 10 records the risk "Cap removal outruns its replacement" and points
at the thread criterion that requires the write-time size limit to be sized first. That sizing was
done by the schema unit and left the limit at 65536 bytes. So the write-time limit is the replacement
the SPEC named, and it does not shrink what a record may hold.

**Ruling applied.** The caps are deleted as mandated. Nothing is hidden at display time to keep the
budget, because hiding is the defect this unit removes. The renderer's report of the breach is
strengthened from an unasserted field into a swept property: no record may render past a cap while
reporting that it fits. `briefing.renders-a-record-byte-maximal-thread-within-budget` is replaced by
`briefing.renders-every-item-of-a-record-byte-maximal-thread-and-reports-the-budget-breach`, which
asserts the entry-completeness the unit exists to deliver and the honesty of the breach report. The
frontier sweep's closing assertion is repointed the same way and renamed to match.

The operational consequence — a reply of up to about 55 kilobytes against a declared 24000-byte
budget — is filed as `F5c`. Closing it means either a smaller record limit or a bounded-growth display
mechanism, and neither is in this SPEC.

**Rejected:** keeping one cap "just for criteria". B16 names `CRITERIA_SHOWN_MAX` explicitly.
**Rejected:** shrinking the budget so the breach disappears. B16 says the budget is untouched.
**Rejected:** leaving the two tests asserting a property that is now false. That is a permanent red.

### 3.2 `Thread.artifacts` is optional, not required

The unit brief describes the schema unit as adding `artifacts: Artifact[]` to `Thread`. The schema
unit's own plan makes it `artifacts?: Artifact[] | undefined`, optional and never defaulted, because
every record already in the store lacks the field and must still parse. The renderer therefore reads
`thread.artifacts ?? []` and prints no artifacts section when the field is absent.

### 3.3 Lane `'A'` is not retained as an unreachable case

B18 deletes `currentCriterionId`, which is the only thing that could put an entry in lane `'A'`.
Keeping `'A'` in the lane type as a case nothing can reach reproduces exactly the defect SPEC D3
names — an unreachable branch that reads as live code. The lane type becomes `'live' | 'settled'`. The
later unit that introduces declared focus adds its own case.

**Rejected:** keeping `type Lane = 'A' | 'B' | 'C'` with `'A'` unreachable.

### 3.4 The `Not shown` block keeps a dangling-and-quarantined entry, repointed

B20 says the block "reduces to its remaining members: the text-clip marker, and dangling or
quarantined ids." Once `DECISION_ID_SHOWN_MAX` is deleted, every dangling and quarantined identifier
prints in full, so the old line — a count of identifiers a cap withheld — can never fire.

The line is kept and repointed: it counts linked decision records that exist on the thread and could
not be read, which is a real omission the reader cannot otherwise size, and it is the entry B20 names.
Its text becomes `- <n> linked decision records could not be read; their ids are listed under
Decisions above`.

**Rejected:** deleting the line as dead code, which would leave the block with one member where B20
names two. **Rejected:** moving the `- dangling:` and `- quarantined:` lines out of the `Decisions`
block into `Not shown`, which is a larger change to a block three shipped tests assert and which B20
does not ask for.

### 3.5 `S3`'s census is tree-wide; two reads it finds are owned outside this unit

`S3` reads: "`Criterion.ordinal` is read only to render a display label and to stable-sort for
display. Every other read is forbidden." Its subject is every read of that field, so the census
population is every read across `src/`, `hooks/`, `bin/`, `scripts/` and `test/`, and it halts on any
read it cannot classify. Scoping the population to one directory would be narrowing a census, which is
forbidden outright.

**What the census found, run over the tree.** Ten reads, classified by rule:

| Read | Use | Verdict |
| --- | --- | --- |
| `src/render/briefing.ts:77` | inside a template literal — a display label | allowed |
| `src/server/resource-render.ts:45` | inside a template literal — a display label | allowed |
| `src/server/tools/open_thread.ts:157` | copied into a response field itself named `ordinal` | allowed |
| `src/server/tools/record_decision.ts:60` | inside a template literal — a display label | allowed |
| `src/server/tools/record_decision.ts:57` (two reads) | `candidate.ordinal < best.ordinal` — picks a goal by position | **forbidden** |
| `src/domain/criterion-backfill.ts:11` | `candidate.ordinal === ordinal` — picks a goal by position | **forbidden** |
| `test/unit/criteria.test.ts:220`, `test/unit/field-merge.test.ts:147`, `test/spawn/decisions.test.ts:342` | a test observing a value | allowed |

The five non-TypeScript files under those roots are swept as text; none contains a read.

**`src/domain/criterion-backfill.ts` has a caller, so this unit does not delete it.** The caller is
`scripts/backfill-criterion-id.mjs:5,22`, which imports `backfillCriterionIds` and runs it over a
thread record on disk. That file is not listed in `scripts/check-packaging.mjs`'s required-file set, so
it is a repository-local migration tool rather than something the plugin ships — but it is a caller,
and deleting a module something calls is out of this unit's scope.

**`src/server/tools/record_decision.ts` is deleted by a later unit in this ladder**, which removes the
scope derivation outright. That file belongs to that unit, not this one.

**What this unit therefore asserts, and what it does not.** The census enumerates every read in the
tree and prints all ten with their classification, so nothing it declines to assert is silent. Its
blocking assertion covers the reads under `src/render`, which is this unit's surface and where the
guessed-goal defect lived. The three forbidden reads in the two files above are printed under
`unasserted here, owned elsewhere` with their path and expression.

`S3` is therefore **not fully discharged when this unit lands**, and the reason is specific rather than
general: two of its violations sit in files this unit does not own, one of them is removed by a later
unit in this ladder, and the other has a caller so it cannot simply be removed. Making the assertion
tree-wide and blocking would be a permanent red at this unit's commit, which the specification's own
rule on invariants forbids — "True of the system as it will be when its unit lands, never
aspirationally." The residue is reported for registration as new material; it is not left as a
narrowed census.

### 3.6 No decomposition procedure was read

The decomposition skill some agent definitions name as a first read does not exist on disk; this
ladder does not depend on it, and this plan was authored from the approved specification, the planning
brief and the orchestrator rulings alone.

---

## 4. The change, step by step

Steps are numbered by the pull request that carries them: `A1`, `A2`, ... then `B1`, ... then `C1`, ...
Apply them in the order given. After the last step of each part the tree typechecks and the suite is
green.

`src/render/briefing.ts` is given as a whole-file REPLACE in each part. That is deliberate: three
sequential parts edit overlapping regions of one 300-line function, and a chain of FIND strings
against intermediate states is the one class of defect this plan can eliminate outright. The
resulting diff is small; the numbers are in section 10.

### Part A — the display caps go

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
   against: `CURRENT` is `2.0.0`, so `NEXT` is `2.1.0`. Substitute the values you read and computed,
   never the example.

4. Edit `package.json`. FIND the line `  "version": "CURRENT",` and REPLACE it with
   `  "version": "NEXT",`, substituting the two values.

5. Edit `.claude-plugin/plugin.json`. FIND the line `  "version": "CURRENT",` and REPLACE it with
   `  "version": "NEXT",`, substituting the two values.

6. Run `node scripts/check-packaging.mjs`. Expect exit code 0 and no output.

Rationale: plan invariant `P4` requires both manifests to move in one commit.

#### Step A2 — replace the briefing renderer

File: `src/render/briefing.ts`. REPLACE (whole file). Entire new contents:

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored, clipGraphemes } from './escape.ts'

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

export const BRIEFING_HEADING = '# Your Preflight Briefing'
export const BRIEFING_MAX_CHARS = 12000
export const RESUME_PAYLOAD_MAX_BYTES = 24000

const RESUME_PAYLOAD_RESERVE_BYTES = 200
const RESUME_PAYLOAD_TARGET_BYTES = RESUME_PAYLOAD_MAX_BYTES - RESUME_PAYLOAD_RESERVE_BYTES

const BRIEFING_COPIES_IN_RESUME_PAYLOAD = 2
const RESUME_PAYLOAD_SCAFFOLD_BYTES = 114
const PREVIOUS_SESSION_NULL_BYTES = 4
const PREVIOUS_SESSION_LARGEST_BYTES = 82
const PREVIOUS_SESSION_PRESENT_EXTRA_BYTES = PREVIOUS_SESSION_LARGEST_BYTES - PREVIOUS_SESSION_NULL_BYTES
const PREVIOUS_SESSION_ABSENT_EXTRA_BYTES = 0
const PREVIOUS_SESSION_DEFAULT_PRESENT = true
const JSON_STRING_DELIMITER_BYTES = 2

const jsonEscapedByteLen = (text: string): number =>
  Buffer.byteLength(JSON.stringify(text), 'utf8') - JSON_STRING_DELIMITER_BYTES

export const resumePayloadBytes = (
  briefing: string,
  threadId: string,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): number =>
  BRIEFING_COPIES_IN_RESUME_PAYLOAD * jsonEscapedByteLen(briefing) +
  jsonEscapedByteLen(threadId) +
  RESUME_PAYLOAD_SCAFFOLD_BYTES +
  (hasPreviousSession ? PREVIOUS_SESSION_PRESENT_EXTRA_BYTES : PREVIOUS_SESSION_ABSENT_EXTRA_BYTES)

const fitsBudget = (briefing: string, threadId: string, hasPreviousSession: boolean): boolean =>
  briefing.length <= BRIEFING_MAX_CHARS &&
  resumePayloadBytes(briefing, threadId, hasPreviousSession) <= RESUME_PAYLOAD_TARGET_BYTES

const RELATED_TITLE_CLIP = 100
const RELATED_SLUG_CLIP = 64

const RISK_TEXT_NATURAL_MAX = 500
const KEY_DECISION_TITLE_NATURAL_MAX = 200
const OUT_OF_SCOPE_TEXT_NATURAL_MAX = 300
const CRITERION_TEXT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120

const MIN_TEXT_CLIP = 0
const TEXT_CLIPPED_BULLET =
  '- some criterion, risk, key decision or out-of-scope text was shortened to fit the character budget'

const FOCUS_NOT_SET_LINE =
  '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'

const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'

const clip = (text: string, max: number): string => clipGraphemes(escapeStored(text), max)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderCriterionLine = (criterion: Criterion, textClip: number): string => {
  const text = clip(criterion.text, textClip)
  const label = `- c${criterion.ordinal} [${criterionStatus(criterion)}]:`
  const withText = text.length === 0 ? label : `${label} ${text}`
  return `${withText} (id ${escapeStored(criterion.id)})`
}

const renderRiskLine = (risk: Risk, textClip: number): string => `- ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string => `- ${clip(keyDecision.title, textClip)}`

const renderOutOfScopeLine = (outOfScope: OutOfScope, textClip: number): string => `- ${clip(outOfScope.text, textClip)}`

const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
  `- risk ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderSettledKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- decision ${escapeStored(keyDecision.decision_id)} ${clip(keyDecision.title, textClip)}`

const renderDanglingLine = (decisionId: string): string => `- dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `- quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${clip(predecessor.title, RELATED_TITLE_CLIP)} (${clip(predecessor.slug, RELATED_SLUG_CLIP)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

type Lane = 'live' | 'settled'

const laneFor = (criterionId: string | undefined, criteriaById: ReadonlyMap<string, Criterion>): Lane => {
  if (criterionId === undefined) return 'live'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'live'
  return criterion.struck_by !== null || criterion.done ? 'settled' : 'live'
}

type Laned<T> = { live: T[]; settled: T[] }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>
): Laned<T> => ({
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'settled')
})

type RenderClip = { risk: number; keyDecision: number; outOfScope: number; criterion: number; settled: number }

const clipAt = (perItemClip: number): RenderClip => ({
  risk: Math.min(perItemClip, RISK_TEXT_NATURAL_MAX),
  keyDecision: Math.min(perItemClip, KEY_DECISION_TITLE_NATURAL_MAX),
  outOfScope: Math.min(perItemClip, OUT_OF_SCOPE_TEXT_NATURAL_MAX),
  criterion: Math.min(perItemClip, CRITERION_TEXT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX)
})

const MAX_ITEM_CLIP = Math.max(
  RISK_TEXT_NATURAL_MAX,
  KEY_DECISION_TITLE_NATURAL_MAX,
  OUT_OF_SCOPE_TEXT_NATURAL_MAX,
  CRITERION_TEXT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX
)

const FULL_CLIP: RenderClip = clipAt(MAX_ITEM_CLIP)

type ClipSearch = { briefing: string; passes: number }

const largestFittingClipRender = (
  renderAtClip: (perItemClip: number) => string,
  fits: (briefing: string) => boolean,
  unclipped: string
): ClipSearch => {
  let accepted = MIN_TEXT_CLIP - 1
  let ceiling = MAX_ITEM_CLIP
  let bestFitting: string | null = null
  let passes = 0

  while (accepted < ceiling) {
    const candidate = Math.ceil((accepted + ceiling) / 2)
    const rendered = renderAtClip(candidate)
    passes += 1
    if (fits(rendered)) {
      accepted = candidate
      bestFitting = rendered
    } else {
      ceiling = candidate - 1
    }
  }

  if (bestFitting !== null) return { briefing: bestFitting, passes }
  const floorRender = renderAtClip(MIN_TEXT_CLIP)
  const smallest = floorRender.length < unclipped.length ? floorRender : unclipped
  return { briefing: smallest, passes: passes + 1 }
}

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

  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderRelatedLine)
  const riskLines = risks.live.map((item) => renderRiskLine(item, renderClip.risk))
  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
  const outOfScopeLines = outOfScope.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
  const criterionLines = criteria.map((item) => renderCriterionLine(item, renderClip.criterion))
  const settledLines = [
    ...risks.settled.map((item) => renderSettledRiskLine(item, renderClip.settled)),
    ...keyDecisions.settled.map((item) => renderSettledKeyDecisionLine(item, renderClip.settled))
  ]

  const notShownBulletLines = [
    ...[unreadableDecisionCount]
      .filter((count) => count > 0)
      .map((count) => `- ${count} linked decision records could not be read; their ids are listed under Decisions above`),
    ...[textWasClipped].filter(Boolean).map(() => TEXT_CLIPPED_BULLET)
  ]

  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${escapeStored(thread.title)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    FOCUS_NOT_SET_LINE,
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.slice(0, 1).map(() => '**Active goal:**'),
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.map((value) => escapeStored(value)),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.slice(0, 1).map(() => '**Last session:**'),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.map((value) => escapeStored(value)),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStored(value)),
    ...relatedThreads.slice(0, 1).map(() => ''),
    ...relatedThreads.slice(0, 1).map(() => '**Related:**'),
    ...relatedLines,
    ...riskLines.slice(0, 1).map(() => ''),
    ...riskLines.slice(0, 1).map(() => '**Open risks:**'),
    ...riskLines,
    ...keyDecisionLines.slice(0, 1).map(() => ''),
    ...keyDecisionLines.slice(0, 1).map(() => '**Key decisions:**'),
    ...keyDecisionLines,
    ...outOfScopeLines.slice(0, 1).map(() => ''),
    ...outOfScopeLines.slice(0, 1).map(() => '**Out of scope:**'),
    ...outOfScopeLines,
    ...criterionLines.slice(0, 1).map(() => ''),
    ...criterionLines.slice(0, 1).map(() => '**Completion criteria:**'),
    ...criterionLines,
    ...settledLines.slice(0, 1).map(() => ''),
    ...settledLines.slice(0, 1).map(() => SETTLED_HEADING),
    ...settledLines,
    '',
    '**Decisions:**',
    `- resolved: ${decisionIntegrity.resolved}`,
    ...decisionIntegrity.dangling.map(renderDanglingLine),
    ...decisionIntegrity.quarantined.map(renderQuarantinedLine),
    ...notShownBulletLines.slice(0, 1).map(() => ''),
    ...notShownBulletLines.slice(0, 1).map(() => '**Not shown:**'),
    ...notShownBulletLines,
    ...notShownBulletLines.slice(0, 1).map(() => `See ${clip(notShownAddress, 200)} for the complete record.`)
  ].join('\n')
}

export type BriefingRender = { briefing: string; passes: number; withinBudget: boolean }

export const renderBriefingWithPasses = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const risks = laneSplit(thread.spine.open_risks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)

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

  const finish = (briefing: string, passes: number): BriefingRender => ({
    briefing,
    passes,
    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession)
  })

  const unclipped = renderWith(FULL_CLIP, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)

  const search = largestFittingClipRender(
    (perItemClip) => renderWith(clipAt(perItemClip), true),
    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession),
    unclipped
  )
  return finish(search.briefing, search.passes + 1)
}

export const renderBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): string => renderBriefingWithPasses(thread, decisionIntegrity, pointer, predecessor, hasPreviousSession).briefing
```

Rationale, clause by clause. The seven display-time item caps of ground truth 2.1 are gone, and with
them `capList`, `capCriteria`, `criterionRank`, the three `CRITERION_RANK_*` constants,
`RankedCriterion` and `byRankThenOriginalIndex`, which existed only to serve a cap (`B16`). The
`import * as caps` line is gone because `CRITERIA_SHOWN_MAX` was its only reader. `Laned<T>` changes
from `{ shown, hidden }` to `{ live, settled }`, so `laneFor` orders and never removes (`B17`).
`currentCriterionId` is deleted and `FOCUS_NOT_SET_LINE` states that focus is not set (`B18`). The
settled group renders last, compactly, under `SETTLED_HEADING` (`B19`). The `Not shown` block keeps
two possible entries (`B20`). `BRIEFING_MAX_CHARS`, `RESUME_PAYLOAD_MAX_BYTES`,
`RESUME_PAYLOAD_RESERVE_BYTES`, `resumePayloadBytes`, `fitsBudget`, `clipAt`, `FULL_CLIP`,
`MIN_TEXT_CLIP`, `MAX_ITEM_CLIP` and `largestFittingClipRender` are unchanged in value and shape.

`SETTLED_TEXT_NATURAL_MAX` is new, at 120, and is the compactness `B19` requires. It is a text limit,
not an item cap: every settled entry renders; only its text is shorter than a live entry's. It joins
`clipAt` and `MAX_ITEM_CLIP` so the budget search can shrink it like every other text limit.
`MAX_ITEM_CLIP` stays 500 because 120 is smaller than the largest existing limit, so the search range
and therefore the pass count are unchanged.

#### Step A3 — replace the tests that assert the caps

Ten of these tests assert behaviour the SPEC records as a defect; they are listed by name in ground
truth 2.12. Each is replaced by one asserting the mandated behaviour. No test is deleted, skipped or
focused, and no pass condition is weakened.


File: `test/unit/briefing.test.ts`. 20 edits, applied in this order.

**Edit A3.1** — FIND:

```ts
import {
  renderBriefing,
  renderBriefingWithPasses,
  BRIEFING_HEADING,
  BRIEFING_MAX_CHARS,
  RESUME_PAYLOAD_MAX_BYTES,
```

REPLACE with:

```ts
import {
  renderBriefing,
  renderBriefingWithPasses,
  resumePayloadBytes,
  BRIEFING_HEADING,
  BRIEFING_MAX_CHARS,
  RESUME_PAYLOAD_MAX_BYTES,
```

**Edit A3.2** — FIND:

```ts

test('briefing.renders-exact-output-for-a-full-thread', () => {
  const threadId = rt.ulid()
  const decisionOneId = rt.ulid()
  const riskId = rt.ulid()
  const criterionA = { id: rt.ulid(), ordinal: 1, text: 'first criterion', done: true, kind: 'planned' as const, struck_by: null }
  const criterionB = {
    id: rt.ulid(),
    ordinal: 2,
```

REPLACE with:

```ts

test('briefing.renders-exact-output-for-a-full-thread', () => {
  const threadId = rt.ulid()
  const riskId = rt.ulid()
  const settledRiskId = rt.ulid()
  const liveDecisionId = rt.ulid()
  const settledDecisionId = rt.ulid()
  const criterionA = {
    id: rt.ulid(),
    ordinal: 1,
    text: 'first criterion',
    done: true,
    kind: 'planned' as const,
    struck_by: null
  }
  const criterionB = {
    id: rt.ulid(),
    ordinal: 2,
```

**Edit A3.3** — FIND:

```ts
      active_goal: 'ship the renderer',
      next_step: 'add tests',
      last_session: 'wrote the first draft',
      open_risks: [{ id: riskId, scope: 'renderer', text: 'escaping might be incomplete', refs: [] }],
      key_decisions: [{ id: rt.ulid(), decision_id: decisionOneId, title: 'use postgres', scope: 'storage' }],
      out_of_scope: [{ id: rt.ulid(), text: 'does not cover the CLI' }]
    }
  })

  const pointer: Pointer = { thread_id: threadId, written_at: rt.now(), session_id: 'session-x' }

  const integrity: DecisionIntegrity = { resolved: 1, dangling: [], quarantined: [] }
  const rendered = renderBriefing(thread, integrity, pointer, null)

  const expected = [
```

REPLACE with:

```ts
      active_goal: 'ship the renderer',
      next_step: 'add tests',
      last_session: 'wrote the first draft',
      open_risks: [
        { id: riskId, scope: 'renderer', text: 'escaping might be incomplete', refs: [] },
        { id: settledRiskId, scope: 'renderer', text: 'a risk on a met goal', refs: [], criterion_id: criterionA.id }
      ],
      key_decisions: [
        { id: rt.ulid(), decision_id: liveDecisionId, title: 'use postgres', scope: 'storage' },
        {
          id: rt.ulid(),
          decision_id: settledDecisionId,
          title: 'the escape is applied at render time',
          scope: 'storage',
          criterion_id: criterionA.id
        }
      ],
      out_of_scope: [{ id: rt.ulid(), text: 'does not cover the CLI' }]
    }
  })

  assert.equal(ThreadRecord.parse(thread).ok, true, 'the exact-output fixture must itself be schema-admissible')

  const pointer: Pointer = { thread_id: threadId, written_at: rt.now(), session_id: 'session-x' }

  const integrity: DecisionIntegrity = { resolved: 2, dangling: [], quarantined: [] }
  const rendered = renderBriefing(thread, integrity, pointer, null)

  const expected = [
```

**Edit A3.4** — FIND:

```ts
    '**Status:** open',
    '**Blockage:** none',
    '**Currently being worked:** yes',
    '',
    '**Active goal:**',
    '',
```

REPLACE with:

```ts
    '**Status:** open',
    '**Blockage:** none',
    '**Currently being worked:** yes',
    '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.',
    '',
    '**Active goal:**',
    '',
```

**Edit A3.5** — FIND:

```ts
    `- c1 [done]: first criterion (id ${criterionA.id})`,
    `- c2 [struck]: second criterion (id ${criterionB.id})`,
    '',
    '**Decisions:**',
    '- resolved: 1'
  ].join('\n')

  assert.equal(rendered, expected)
```

REPLACE with:

```ts
    `- c1 [done]: first criterion (id ${criterionA.id})`,
    `- c2 [struck]: second criterion (id ${criterionB.id})`,
    '',
    '**Settled items (on goals already met or struck):**',
    `- risk ${settledRiskId} a risk on a met goal`,
    `- decision ${settledDecisionId} the escape is applied at render time`,
    '',
    '**Decisions:**',
    '- resolved: 2'
  ].join('\n')

  assert.equal(rendered, expected)
```

**Edit A3.6** — FIND:

```ts
    '**Status:** done',
    '**Blocked:** still finishing docs',
    '**Currently being worked:** no',
    '',
    '**Active goal:**',
    '',
```

REPLACE with:

```ts
    '**Status:** done',
    '**Blocked:** still finishing docs',
    '**Currently being worked:** no',
    '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.',
    '',
    '**Active goal:**',
    '',
```

**Edit A3.7** — FIND:

```ts
    '- resolved: 0'
  ].join('\n')
  assert.equal(rendered, expected)
  for (const heading of ['**Related:**', '**Open risks:**', '**Key decisions:**', '**Out of scope:**', '**Completion criteria:**', '**Not shown:**']) {
    assert.equal(rendered.includes(heading), false, `expected ${heading} to be omitted when its list is empty`)
  }
})
```

REPLACE with:

```ts
    '- resolved: 0'
  ].join('\n')
  assert.equal(rendered, expected)
  for (const heading of [
    '**Related:**',
    '**Open risks:**',
    '**Key decisions:**',
    '**Out of scope:**',
    '**Completion criteria:**',
    '**Settled items (on goals already met or struck):**',
    '**Not shown:**'
  ]) {
    assert.equal(rendered.includes(heading), false, `expected ${heading} to be omitted when its list is empty`)
  }
})
```

**Edit A3.8** — FIND:

```ts
const criterionRowCount = (rendered: string): number =>
  rendered.split('\n').filter((line) => CRITERION_ROW_PATTERN.test(line)).length

test('briefing.lane-a-is-the-current-criterions-items-shown-in-full', () => {
  const current = criterion({ ordinal: 1, text: 'the current criterion' })
  const other = criterion({ ordinal: 2, text: 'a later live criterion' })
  const currentRisk = risk({ text: 'risk tied to the current criterion', criterion_id: current.id })
  const otherRisk = risk({ text: 'risk tied to a later criterion', criterion_id: other.id })

  const thread = baseThread({
    completion_criteria: [current, other],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [otherRisk, currentRisk],
      key_decisions: [],
      out_of_scope: []
    }
  })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  const openRisksIndex = rendered.split('\n').indexOf('**Open risks:**')
  assert.notEqual(openRisksIndex, -1)
  assert.equal(
    rendered.split('\n')[openRisksIndex + 1],
    `- ${currentRisk.id} risk tied to the current criterion`,
    'the current criterion risk must render first, in lane A, even though it was recorded last'
  )
})

test('briefing.out-of-scope-overflow-is-capped-and-counted-in-the-tail', () => {
  const outOfScopeItems: OutOfScope[] = Array.from({ length: 12 }, (_, index) => ({
    id: rt.ulid(),
    text: `out of scope item ${index}`
```

REPLACE with:

```ts
const criterionRowCount = (rendered: string): number =>
  rendered.split('\n').filter((line) => CRITERION_ROW_PATTERN.test(line)).length

test('briefing.with-no-focus-declared-every-live-risk-renders-in-the-order-it-was-recorded', () => {
  const first = criterion({ ordinal: 1, text: 'the first criterion' })
  const other = criterion({ ordinal: 2, text: 'a later live criterion' })
  const otherRisk = risk({ text: 'risk tied to a later criterion', criterion_id: other.id })
  const firstRisk = risk({ text: 'risk tied to the first criterion', criterion_id: first.id })

  const thread = baseThread({
    completion_criteria: [first, other],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [otherRisk, firstRisk],
      key_decisions: [],
      out_of_scope: []
    }
  })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  const lines = rendered.split('\n')
  const openRisksIndex = lines.indexOf('**Open risks:**')
  assert.notEqual(openRisksIndex, -1)
  assert.deepEqual(
    [lines[openRisksIndex + 1], lines[openRisksIndex + 2]],
    [`- ${otherRisk.id} risk tied to a later criterion`, `- ${firstRisk.id} risk tied to the first criterion`],
    'with no focus declared there is no lane A: both live risks render as one group, in the order they were recorded'
  )
  assert.ok(
    lines.includes(
      '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'
    ),
    'the briefing must state that focus is not set'
  )
})

test('briefing.every-out-of-scope-item-renders-and-none-is-counted-away', () => {
  const outOfScopeItems: OutOfScope[] = Array.from({ length: 12 }, (_, index) => ({
    id: rt.ulid(),
    text: `out of scope item ${index}`
```

**Edit A3.9** — FIND:

```ts
    }
  })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(rendered.includes('out of scope item 0'))
  assert.ok(rendered.includes('out of scope item 9'))
  assert.equal(
    rendered.includes('out of scope item 10'),
    false,
    'out-of-scope is capped at 10 shown; the 11th item must not render'
  )
  assert.equal(
    rendered.includes('out of scope item 11'),
    false,
    'out-of-scope is capped at 10 shown; the 12th item must not render'
  )
  assert.ok(
    rendered.includes('- 2 out-of-scope items not shown'),
    'the two overflow out-of-scope items must be counted in the not-shown tail'
  )
})

test('briefing.dangling-and-quarantined-overflow-is-capped-and-counted-in-the-tail', () => {
  const thread = baseThread()
  const integrity: DecisionIntegrity = {
    resolved: 0,
```

REPLACE with:

```ts
    }
  })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  for (const item of outOfScopeItems) {
    assert.ok(rendered.includes(item.text), `every out-of-scope item must render; ${item.text} did not`)
  }
  assert.equal(
    rendered.includes('out-of-scope items not shown'),
    false,
    'no out-of-scope item may be counted away; the display-time cap that produced that count is deleted'
  )
})

test('briefing.every-dangling-and-quarantined-decision-id-renders-and-the-tail-counts-the-records-it-could-not-read', () => {
  const thread = baseThread()
  const integrity: DecisionIntegrity = {
    resolved: 0,
```

**Edit A3.10** — FIND:

```ts
  const lines = rendered.split('\n')
  assert.equal(
    lines.filter((line) => line.startsWith('- dangling: ')).length,
    6,
    'dangling decision ids are capped at 6 shown'
  )
  assert.equal(
    lines.filter((line) => line.startsWith('- quarantined: ')).length,
    4,
    'all 4 quarantined decision ids fit under the cap of 6 and must all render'
  )
  assert.ok(
    rendered.includes('- 2 dangling or quarantined decision ids not shown'),
    'the 2 overflow dangling ids must be counted in the not-shown tail, combined with quarantined overflow'
  )
})

test('briefing.lane-c-collapses-a-done-criterions-risk-while-lane-b-shows-an-unanchored-one-in-full', () => {
  const doneCriterion = criterion({ ordinal: 1, text: 'already finished', done: true })
  const settledRisk = risk({ text: 'a risk on a finished criterion', criterion_id: doneCriterion.id })
  const unanchoredRisk = risk({ text: 'a risk naming no criterion at all' })
```

REPLACE with:

```ts
  const lines = rendered.split('\n')
  assert.equal(
    lines.filter((line) => line.startsWith('- dangling: ')).length,
    8,
    'every dangling decision id must render; the display-time cap that withheld them is deleted'
  )
  assert.equal(
    lines.filter((line) => line.startsWith('- quarantined: ')).length,
    4,
    'every quarantined decision id must render'
  )
  assert.equal(
    rendered.includes('dangling or quarantined decision ids not shown'),
    false,
    'no decision id may be counted away by a display cap'
  )
  assert.ok(
    rendered.includes('- 12 linked decision records could not be read; their ids are listed under Decisions above'),
    'the not-shown tail must count the decision records the store could not read'
  )
  assert.ok(
    rendered.includes(`See logbook://thread/${thread.id} for the complete record.`),
    'the not-shown tail must carry the address that resolves to the complete record'
  )
})

test('briefing.a-risk-on-a-met-goal-renders-last-and-compact-under-the-settled-heading', () => {
  const doneCriterion = criterion({ ordinal: 1, text: 'already finished', done: true })
  const settledRisk = risk({ text: 'a risk on a finished criterion', criterion_id: doneCriterion.id })
  const unanchoredRisk = risk({ text: 'a risk naming no criterion at all' })
```

**Edit A3.11** — FIND:

```ts
  })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)

  assert.ok(
    rendered.includes(`- ${unanchoredRisk.id} a risk naming no criterion at all`),
    'an unanchored risk must render in full, in the live lane, never the collapsed one'
  )
  assert.equal(
    rendered.includes(settledRisk.id),
    false,
    'a risk anchored to a done criterion must not print its id or text; it is collapsed'
  )
  assert.ok(
    rendered.includes('- 1 risks not shown'),
    'the collapsed risk on the done criterion must be counted in the not-shown tail'
  )
  assert.ok(
    rendered.includes(`logbook://thread/${thread.id}`),
    'the not-shown tail must name the one address that retrieves the collapsed risk'
  )
})

const CRITERIA_FILLING_EVERY_SHOWN_SLOT = 40

test('briefing.a-risk-on-a-criterion-hidden-by-the-cap-still-collapses-to-lane-c', () => {
  const openCriteria: Criterion[] = Array.from({ length: CRITERIA_FILLING_EVERY_SHOWN_SLOT }, (_, index) =>
    criterion({ ordinal: index + 1, text: `open criterion ${index + 1}` })
  )
  const hiddenDone = criterion({ ordinal: 41, text: 'finished after the shown slots ran out', done: true })
  const settledRisk = risk({ text: 'a risk on a criterion the cap withheld', criterion_id: hiddenDone.id })

  const thread = baseThread({
    completion_criteria: [...openCriteria, hiddenDone],
    spine: {
      active_goal: 'g',
      next_step: 'n',
```

REPLACE with:

```ts
  })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  const lines = rendered.split('\n')

  assert.ok(
    lines.includes(`- ${unanchoredRisk.id} a risk naming no criterion at all`),
    'an unanchored risk must render in full, in the live group'
  )

  const settledIndex = lines.indexOf('**Settled items (on goals already met or struck):**')
  assert.notEqual(settledIndex, -1, 'a risk on a met goal must bring the settled heading with it')
  assert.equal(
    lines[settledIndex + 1],
    `- risk ${settledRisk.id} a risk on a finished criterion`,
    'the settled risk must render compactly, as its id and its text, under the settled heading'
  )
  assert.ok(
    settledIndex > lines.indexOf('**Open risks:**'),
    'the settled group must render after the live groups, never before them'
  )
  assert.equal(
    rendered.includes('risks not shown'),
    false,
    'a risk on a met goal is rendered, never counted away'
  )
})

const CRITERIA_FILLING_EVERY_SHOWN_SLOT = 40

test('briefing.a-criterion-beyond-the-forty-that-the-deleted-cap-once-showed-renders-with-its-settled-risk', () => {
  const openCriteria: Criterion[] = Array.from({ length: CRITERIA_FILLING_EVERY_SHOWN_SLOT }, (_, index) =>
    criterion({ ordinal: index + 1, text: `open criterion ${index + 1}` })
  )
  const beyondTheOldCap = criterion({ ordinal: 41, text: 'finished after the old shown slots ran out', done: true })
  const settledRisk = risk({ text: 'a risk on a criterion the old cap withheld', criterion_id: beyondTheOldCap.id })

  const thread = baseThread({
    completion_criteria: [...openCriteria, beyondTheOldCap],
    spine: {
      active_goal: 'g',
      next_step: 'n',
```

**Edit A3.12** — FIND:

```ts
  })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  const hiddenCriterionRow = /^- c41 \[/

  assert.equal(
    rendered.split('\n').some((line) => hiddenCriterionRow.test(line)),
    false,
    'the done criterion at ordinal 41 must be pushed out of the 40 shown slots by the 40 open ones that outrank it'
  )
  assert.equal(
    rendered.includes(settledRisk.id),
    false,
    'a risk anchored to a done criterion must stay collapsed even when the cap withheld that criterion; resolving anchors against only the shown criteria would leave it unresolved and render it in full'
  )
  assert.ok(
    rendered.includes('- 1 risks not shown'),
    'the risk collapsed against the withheld done criterion must be counted in the not-shown tail'
  )
})

```

REPLACE with:

```ts
  })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)

  assert.ok(
    rendered.split('\n').some((line) => line.startsWith('- c41 [done]: finished after the old shown slots ran out (id ')),
    'the criterion at ordinal 41 must render; the display cap that withheld it is deleted'
  )
  assert.ok(
    rendered.includes(`- risk ${settledRisk.id} a risk on a criterion the old cap withheld`),
    'a risk on a met goal must render compactly under the settled heading, wherever that goal sits in the list'
  )
  assert.equal(
    rendered.includes('completion criteria not shown'),
    false,
    'no criterion may be counted away by a display cap'
  )
})

```

**Edit A3.13** — FIND:

```ts
  )
})

test('briefing.lane-caps-collapse-overflow-into-the-not-shown-tail', () => {
  const live = criterion({ ordinal: 1, text: 'the live criterion' })
  const risks: Risk[] = Array.from({ length: 6 }, (_, index) =>
    risk({ text: `unanchored risk number ${index}` })
  )
  const thread = baseThread({
    completion_criteria: [live],
    spine: { active_goal: 'g', next_step: 'n', last_session: 'l', open_risks: risks, key_decisions: [], out_of_scope: [] }
  })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(rendered.includes('unanchored risk number 0'))
  assert.ok(rendered.includes('unanchored risk number 3'))
  assert.equal(rendered.includes('unanchored risk number 4'), false, 'lane B caps at 4; the 5th unanchored risk must not render')
  assert.ok(rendered.includes('- 2 risks not shown'))
})

test('briefing.omits-the-not-shown-tail-when-nothing-was-cut', () => {
```

REPLACE with:

```ts
  )
})

test('briefing.every-unanchored-risk-renders-and-none-is-counted-away', () => {
  const live = criterion({ ordinal: 1, text: 'the live criterion' })
  const risks: Risk[] = Array.from({ length: 6 }, (_, index) => risk({ text: `unanchored risk number ${index}` }))
  const thread = baseThread({
    completion_criteria: [live],
    spine: { active_goal: 'g', next_step: 'n', last_session: 'l', open_risks: risks, key_decisions: [], out_of_scope: [] }
  })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  for (const item of risks) {
    assert.ok(rendered.includes(item.text), `every risk must render; ${item.text} did not`)
  }
  assert.equal(
    rendered.includes('risks not shown'),
    false,
    'no risk may be counted away; the two lane caps that withheld them are deleted'
  )
})

test('briefing.omits-the-not-shown-tail-when-nothing-was-cut', () => {
```

**Edit A3.14** — FIND:

```ts
  assert.equal(rendered.includes('**Not shown:**'), false)
})

test('briefing.completion-criteria-are-capped-and-open-ones-survive', () => {
  const retired: Criterion[] = Array.from({ length: 199 }, (_, index) =>
    criterion({ ordinal: index + 1, text: 'retired', struck_by: rt.ulid() })
  )
```

REPLACE with:

```ts
  assert.equal(rendered.includes('**Not shown:**'), false)
})

test('briefing.every-completion-criterion-renders-and-none-is-counted-away', () => {
  const retired: Criterion[] = Array.from({ length: 199 }, (_, index) =>
    criterion({ ordinal: index + 1, text: 'retired', struck_by: rt.ulid() })
  )
```

**Edit A3.15** — FIND:

```ts

  assert.equal(
    criterionRowCount(rendered),
    40,
    'the completion criteria list must render at most 40 rows, however many criteria the thread retains'
  )
  assert.ok(
    rendered.includes(survivor.id),
    'the open criterion at ordinal 200 must survive the cap; a plain slice of the first 40 would drop it'
  )
  assert.ok(
    rendered.includes('- 160 completion criteria not shown'),
    'the 160 criteria the cap withheld must be counted in the not-shown tail'
  )
})

```

REPLACE with:

```ts

  assert.equal(
    criterionRowCount(rendered),
    200,
    'every retained criterion must render; the display cap that showed only forty is deleted'
  )
  assert.ok(rendered.includes(survivor.id), 'the open criterion at ordinal 200 must render')
  assert.equal(
    rendered.includes('completion criteria not shown'),
    false,
    'no criterion may be counted away by a display cap'
  )
})

```

**Edit A3.16** — FIND:

```ts
  }
}

test('briefing.renders-a-record-byte-maximal-thread-within-budget', () => {
  const thread = decisionRecordSizedThread()
  const parsed = ThreadRecord.parse(thread)
  assert.equal(parsed.ok, true, 'the constructed fixture must itself be schema-admissible')
```

REPLACE with:

```ts
  }
}

test('briefing.renders-every-item-of-a-record-byte-maximal-thread-and-reports-the-budget-breach', () => {
  const thread = decisionRecordSizedThread()
  const parsed = ThreadRecord.parse(thread)
  assert.equal(parsed.ok, true, 'the constructed fixture must itself be schema-admissible')
```

**Edit A3.17** — FIND:

```ts
    quarantined: Array.from({ length: 50 }, () => rt.ulid())
  }

  const rendered = renderBriefing(thread, integrity, null, predecessor)
  assert.ok(
    rendered.length <= BRIEFING_MAX_CHARS,
    `expected the rendered briefing to be at most ${BRIEFING_MAX_CHARS} characters, got ${rendered.length}`
  )

  const payload = {
    content: [{ type: 'text', text: rendered }],
    structuredContent: { thread_id: thread.id, briefing: rendered, previous_session: null }
  }
  const payloadBytes = Buffer.byteLength(JSON.stringify(payload), 'utf8')
  assert.ok(
    payloadBytes <= RESUME_PAYLOAD_MAX_BYTES,
    `expected the serialised resume_thread payload to be at most ${RESUME_PAYLOAD_MAX_BYTES} bytes, got ${payloadBytes}`
  )

  assert.ok(rendered.includes('**Completion criteria:**'), 'the completion criteria section still renders on a record-byte-maximal thread')
  assert.equal(
    criterionRowCount(rendered),
    40,
    'a record-byte-maximal thread renders exactly 40 criterion rows, the rest withheld to the not-shown tail'
  )
})

```

REPLACE with:

```ts
    quarantined: Array.from({ length: 50 }, () => rt.ulid())
  }

  const render = renderBriefingWithPasses(thread, integrity, null, predecessor)
  const lines = render.briefing.split('\n')

  assert.equal(
    criterionRowCount(render.briefing),
    thread.completion_criteria.length,
    'every criterion of a record-byte-maximal thread renders; no display cap withholds one'
  )
  assert.equal(
    lines.filter((line) => line.startsWith('- dangling: ')).length + lines.filter((line) => line.startsWith('- quarantined: ')).length,
    integrity.dangling.length + integrity.quarantined.length,
    'every dangling and quarantined decision id renders'
  )
  for (const marker of [
    'risks not shown',
    'key decisions not shown',
    'out-of-scope items not shown',
    'completion criteria not shown',
    'dangling or quarantined decision ids not shown'
  ]) {
    assert.equal(render.briefing.includes(marker), false, `no item may be counted away by a display cap; found "${marker}"`)
  }

  assert.equal(
    render.withinBudget,
    false,
    'a record-byte-maximal thread renders past the budget once every item must render, and the renderer must say so rather than hide an item to fit'
  )
  assert.ok(
    render.briefing.length > BRIEFING_MAX_CHARS,
    `the breach this render reports must be real, got ${render.briefing.length} characters against a cap of ${BRIEFING_MAX_CHARS}`
  )
  assert.ok(
    resumePayloadBytes(render.briefing, thread.id, false) > RESUME_PAYLOAD_MAX_BYTES,
    'the reported breach must also be real in bytes'
  )
})

```

**Edit A3.18** — FIND:

```ts

const ASCII_FILL = 'x'
const WORST_REACHABLE_CRITERION_TEXT_LENGTH = 51
const RISK_TEXT_RETAINED_FLOOR = 250

const worstReachableAsciiShape: SweepShape = {
  fill: ASCII_FILL,
```

REPLACE with:

```ts

const ASCII_FILL = 'x'
const WORST_REACHABLE_CRITERION_TEXT_LENGTH = 51
const CLIP_SEARCH_UTILISATION_SLACK_BYTES = 500

const worstReachableAsciiShape: SweepShape = {
  fill: ASCII_FILL,
```

**Edit A3.19** — FIND:

```ts
  return line.length - prefix.length
}

test('briefing.the-clip-search-keeps-most-of-the-risk-text-on-the-worst-reachable-ascii-record', () => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, worstReachableAsciiShape)
  assert.equal(
    ThreadRecord.parse(thread).ok,
    true,
```

REPLACE with:

```ts
  return line.length - prefix.length
}

test('briefing.the-clip-search-lands-just-under-the-resume-payload-cap-on-the-worst-reachable-ascii-record', () => {
  const { thread, predecessor } = buildSweepFixture(rt, worstReachableAsciiShape)
  assert.equal(
    ThreadRecord.parse(thread).ok,
    true,
```

**Edit A3.20** — FIND:

```ts

  assert.ok(
    render.passes > 1,
    `this record must actually enter the clip search, or the retained-text floor below is measuring an unclipped render; got ${render.passes} renders`
  )
  assert.equal(
    render.withinBudget,
    true,
    'the clip search must land this record inside both caps, or the retained-text floor below is bought by breaching the budget'
  )

  const retained = textAfterPrefix(render.briefing, `- ${shownRisk.id} `)
  assert.ok(
    retained >= RISK_TEXT_RETAINED_FLOOR,
    `expected the clip search to keep at least ${RISK_TEXT_RETAINED_FLOOR} characters of the first shown risk, got ${retained}; a one-shot shrink that overshoots the budget keeps far less`
  )
})

```

REPLACE with:

```ts

  assert.ok(
    render.passes > 1,
    `this record must actually enter the clip search, or the utilisation floor below is measuring an unclipped render; got ${render.passes} renders`
  )
  assert.equal(
    render.withinBudget,
    true,
    'the clip search must land this record inside both caps, or the utilisation floor below is bought by breaching the budget'
  )

  const retained = textAfterPrefix(render.briefing, `- ${shownRisk.id} `)
  assert.ok(retained > 0, `the clipped risk text must keep some of its own text, got ${retained}`)
  assert.ok(
    render.briefing.endsWith('for the complete record.'),
    'a clipped render must carry the address that resolves to the complete record'
  )

  const used = resumePayloadBytes(render.briefing, thread.id, true)
  assert.ok(
    used >= RESUME_PAYLOAD_MAX_BYTES - CLIP_SEARCH_UTILISATION_SLACK_BYTES,
    `the clip search must land within ${CLIP_SEARCH_UTILISATION_SLACK_BYTES} bytes of the ${RESUME_PAYLOAD_MAX_BYTES} byte cap, or it overshot and threw text away; got ${used} bytes`
  )
})

```


Rationale: `B16` deletes the caps these tests pinned, `B18` deletes the lane the first pinned, `B19`
gives the settled group its heading and its place, and `B20` reduces the `Not shown` block. Section 3.1
records why `briefing.renders-a-record-byte-maximal-thread-within-budget` becomes a breach-reporting
test rather than a within-budget one, and why the risk-text floor of 250 becomes a budget-utilisation
property.

#### Step A4 — repoint the frontier sweep from "nothing breaches" to "nothing is lost and nothing lies"


File: `test/unit/briefing-frontier-sweep.test.ts`. 6 edits, applied in this order.

**Edit A4.1** — FIND:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, BRIEFING_MAX_CHARS, RESUME_PAYLOAD_MAX_BYTES } from '../../src/render/briefing.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import * as caps from '../../src/schema/caps.ts'
```

REPLACE with:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefingWithPasses, BRIEFING_MAX_CHARS, RESUME_PAYLOAD_MAX_BYTES } from '../../src/render/briefing.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
import * as caps from '../../src/schema/caps.ts'
```

**Edit A4.2** — FIND:

```ts
    'utf8'
  )

type Measured = { chars: number; bytes: number }

const measure = (shape: SweepShape): Measured => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, shape)
  const briefing = renderBriefing(thread, integrity, null, predecessor)
  return { chars: briefing.length, bytes: resumePayloadBytes(thread.id, briefing) }
}

const isAdmissible = (shape: SweepShape): boolean => ThreadRecord.parse(buildSweepFixture(rt, shape).thread).ok
```

REPLACE with:

```ts
    'utf8'
  )

type Measured = {
  chars: number
  bytes: number
  withinBudget: boolean
  itemsHeld: number
  itemsRendered: number
}

const SECTION_HEADINGS = [
  '**Open risks:**',
  '**Key decisions:**',
  '**Out of scope:**',
  '**Completion criteria:**',
  '**Settled items (on goals already met or struck):**'
] as const

const sectionLineCount = (lines: readonly string[], heading: string): number => {
  const headingIndex = lines.indexOf(heading)
  if (headingIndex === -1) return 0
  let count = 0
  for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line === undefined || line.length === 0) break
    count += 1
  }
  return count
}

const CRITERION_ROW_PATTERN = /^- c\d+ \[(?:open|done|struck)\]:/

const measure = (shape: SweepShape): Measured => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, shape)
  const render = renderBriefingWithPasses(thread, integrity, null, predecessor)
  const lines = render.briefing.split('\n')

  const criterionRows = lines.filter((line) => CRITERION_ROW_PATTERN.test(line)).length
  const danglingRows = lines.filter((line) => line.startsWith('- dangling: ')).length
  const quarantinedRows = lines.filter((line) => line.startsWith('- quarantined: ')).length

  const itemsRendered =
    criterionRows +
    sectionLineCount(lines, SECTION_HEADINGS[0]) +
    sectionLineCount(lines, SECTION_HEADINGS[1]) +
    sectionLineCount(lines, SECTION_HEADINGS[2]) +
    sectionLineCount(lines, SECTION_HEADINGS[4]) +
    danglingRows +
    quarantinedRows

  const itemsHeld =
    thread.completion_criteria.length +
    thread.spine.open_risks.length +
    thread.spine.key_decisions.length +
    thread.spine.out_of_scope.length +
    integrity.dangling.length +
    integrity.quarantined.length

  return {
    chars: render.briefing.length,
    bytes: resumePayloadBytes(thread.id, render.briefing),
    withinBudget: render.withinBudget,
    itemsHeld,
    itemsRendered
  }
}

const isAdmissible = (shape: SweepShape): boolean => ThreadRecord.parse(buildSweepFixture(rt, shape).thread).ok
```

**Edit A4.3** — FIND:

```ts
  outcome: Outcome
  chars: number | null
  bytes: number | null
}

const classifiedOutcomes: ReadonlySet<string> = new Set(OUTCOME_CLASSES)
```

REPLACE with:

```ts
  outcome: Outcome
  chars: number | null
  bytes: number | null
  withinBudget: boolean | null
  itemsHeld: number | null
  itemsRendered: number | null
}

const classifiedOutcomes: ReadonlySet<string> = new Set(OUTCOME_CLASSES)
```

**Edit A4.4** — FIND:

```ts
            bulkCount,
            outcome,
            chars: measured === null ? null : measured.chars,
            bytes: measured === null ? null : measured.bytes
          })

          const withinRecordCap = (shape: SweepShape): boolean =>
```

REPLACE with:

```ts
            bulkCount,
            outcome,
            chars: measured === null ? null : measured.chars,
            bytes: measured === null ? null : measured.bytes,
            withinBudget: measured === null ? null : measured.withinBudget,
            itemsHeld: measured === null ? null : measured.itemsHeld,
            itemsRendered: measured === null ? null : measured.itemsRendered
          })

          const withinRecordCap = (shape: SweepShape): boolean =>
```

**Edit A4.5** — FIND:

```ts
  return swept
}

test('briefing.frontier-sweep-finds-no-record-breaching-the-character-or-byte-cap', (t) => {
  assert.equal(Buffer.byteLength(ASCII_FILL, 'utf8'), 1, 'the ASCII fill must be one byte per character')
  assert.equal(Buffer.byteLength(MULTI_BYTE_FILL, 'utf8'), 3, 'the multi-byte fill must be three bytes per character')
  assert.equal(Buffer.byteLength(DELIMITER_FILL, 'utf8'), 1, 'the delimiter fill must be one byte per character')
```

REPLACE with:

```ts
  return swept
}

test('briefing.frontier-sweep-finds-no-record-that-loses-an-item-or-hides-a-budget-breach', (t) => {
  assert.equal(Buffer.byteLength(ASCII_FILL, 'utf8'), 1, 'the ASCII fill must be one byte per character')
  assert.equal(Buffer.byteLength(MULTI_BYTE_FILL, 'utf8'), 3, 'the multi-byte fill must be three bytes per character')
  assert.equal(Buffer.byteLength(DELIMITER_FILL, 'utf8'), 1, 'the delimiter fill must be one byte per character')
```

**Edit A4.6** — FIND:

```ts
  const worstPerFill = FILLS.map((fill) => worstFirst.find((record) => record.fill === fill.name)).filter(
    (record): record is SweptRecord => record !== undefined
  )

  assert.equal(
    breaching.length,
    0,
    [
      `${breaching.length} of ${swept.length} swept records exceeded the ${BRIEFING_MAX_CHARS} character cap or the ${RESUME_PAYLOAD_MAX_BYTES} resume-payload byte cap`,
      ...worstPerFill.map((record) => `worst ${record.fill}: ${describe(record)}`),
      ...worstFirst.slice(0, 5).map((record) => `breaching: ${describe(record)}`)
    ].join('\n')
  )
})
```

REPLACE with:

```ts
  const worstPerFill = FILLS.map((fill) => worstFirst.find((record) => record.fill === fill.name)).filter(
    (record): record is SweptRecord => record !== undefined
  )
  for (const record of worstPerFill) t.diagnostic(`worst ${record.fill}: ${describe(record)}`)

  const losingAnItem = admissible.filter((record) => record.itemsRendered !== record.itemsHeld)
  assert.equal(
    losingAnItem.length,
    0,
    [
      `${losingAnItem.length} of ${admissible.length} swept records rendered fewer items than they hold; no display rule may remove an item`,
      ...losingAnItem.slice(0, 5).map((record) => `losing: ${record.itemsRendered} of ${record.itemsHeld} — ${describe(record)}`)
    ].join('\n')
  )

  const claimingToFit = breaching.filter((record) => record.withinBudget === true)
  assert.equal(
    claimingToFit.length,
    0,
    [
      `${claimingToFit.length} of ${breaching.length} breaching records reported themselves as within budget; a render that does not fit must say so`,
      ...claimingToFit.slice(0, 5).map((record) => `claiming: ${describe(record)}`)
    ].join('\n')
  )

  const silentlyBreaching = admissible.filter(
    (record) => record.withinBudget === true && (record.chars ?? 0) > BRIEFING_MAX_CHARS
  )
  assert.equal(
    silentlyBreaching.length,
    0,
    'no record may report itself within budget while rendering past the character cap'
  )
})
```


Rationale: the sweep's population and its halting census over outcome classes are unchanged. What it
concludes changes, because `B16` makes "no schema-admissible record exceeds a cap" false — measured,
227 of 733 now exceed one. In its place the sweep asserts two properties that are stronger about what
this unit delivers: no swept record renders fewer entries than it holds, and no record that exceeds a
cap reports itself as fitting.

#### Step A5 — add the two censuses that keep the caps deleted

File: `test/unit/briefing-hides-nothing.test.ts`. CREATE. Entire contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { census, type Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

type SliceSite = { file: string; line: number; expression: string; discardsElements: boolean }

const discardsSlicedElements = (call: ts.CallExpression): boolean => {
  const access = call.parent
  if (!ts.isPropertyAccessExpression(access) || access.name.text !== 'map') return false
  const mapCall = access.parent
  if (!ts.isCallExpression(mapCall)) return false
  const callback = mapCall.arguments[0]
  if (callback === undefined || !ts.isArrowFunction(callback)) return false
  return callback.parameters.length === 0
}

const collectSliceSites = (sourceFile: ts.SourceFile): SliceSite[] => {
  const found: SliceSite[] = []
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    const callee = node.expression
    if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== 'slice') return
    found.push({
      file: relativeToRoot(sourceFile.fileName),
      line: lineOf(sourceFile, node),
      expression: node.getText(sourceFile),
      discardsElements: discardsSlicedElements(node)
    })
  })
  return found
}

const classifySliceSite = (site: SliceSite): Classified<SliceSite>['verdict'] | 'unclassifiable' =>
  site.discardsElements ? 'allowed' : 'forbidden'

test('briefing.no-display-time-item-cap-remains-in-the-briefing-renderer', () => {
  const { program } = loadSourceProgram()
  const briefingPath = path.join(REBUILD_ROOT, 'src', 'render', 'briefing.ts')
  const sites = collectSliceSites(sourceFileFor(program, briefingPath))

  assert.ok(
    sites.length > 0,
    'the briefing renderer must contain at least one slice call, or this census is running over an empty population'
  )
  assert.doesNotThrow(
    () => census(sites, classifySliceSite),
    `every slice in the briefing renderer must discard the elements it selects, which is the heading idiom; a slice that keeps them is a display-time item cap:\n${sites
      .filter((site) => !site.discardsElements)
      .map((site) => `${site.file}:${site.line} ${site.expression}`)
      .join('\n')}`
  )
})

test('briefing.no-display-time-item-cap-remains-in-the-briefing-renderer.control.a-slice-that-keeps-its-elements-is-forbidden', () => {
  const synthetic: SliceSite[] = [
    { file: 'src/render/briefing.ts', line: 1, expression: 'items.slice(0, 10)', discardsElements: false }
  ]
  assert.throws(() => census(synthetic, classifySliceSite))
})

const ORDINAL_FIELD = 'ordinal'
const ORDINAL_ROOTS = ['src', 'hooks', 'bin', 'scripts', 'test']
const NON_PROGRAM_SOURCE_EXTENSIONS = ['.mjs', '.cjs', '.js']

type OrdinalUse = 'display-label' | 'field-copy' | 'test-observation' | 'position-comparison' | 'unknown'

type OrdinalSite = { file: string; line: number; expression: string; use: OrdinalUse }

const insideTemplateExpression = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isTemplateExpression(current)) return true
    current = current.parent
  }
  return false
}

const POSITION_COMPARISON_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken
])

const isPositionComparison = (node: ts.Node): boolean => {
  const parent = node.parent
  if (!ts.isBinaryExpression(parent)) return false
  return POSITION_COMPARISON_OPERATORS.has(parent.operatorToken.kind)
}

const isFieldCopy = (node: ts.Node): boolean => {
  const parent = node.parent
  if (!ts.isPropertyAssignment(parent) || parent.initializer !== node) return false
  const name = parent.name
  return (ts.isIdentifier(name) || ts.isStringLiteral(name)) && name.text === ORDINAL_FIELD
}

const isTestObservation = (file: string): boolean => file.startsWith(`test${path.sep}`)

const useOf = (node: ts.Node, file: string): OrdinalUse => {
  if (insideTemplateExpression(node)) return 'display-label'
  if (isFieldCopy(node)) return 'field-copy'
  if (isTestObservation(file)) return 'test-observation'
  if (isPositionComparison(node)) return 'position-comparison'
  return 'unknown'
}

const collectOrdinalSites = (sourceFile: ts.SourceFile): OrdinalSite[] => {
  const file = relativeToRoot(sourceFile.fileName)
  const found: OrdinalSite[] = []
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== ORDINAL_FIELD) return
    found.push({ file, line: lineOf(sourceFile, node), expression: node.getText(sourceFile), use: useOf(node, file) })
  })
  return found
}

const classifyOrdinalSite = (site: OrdinalSite): Classified<OrdinalSite>['verdict'] | 'unclassifiable' => {
  if (site.use === 'display-label' || site.use === 'field-copy' || site.use === 'test-observation') return 'allowed'
  if (site.use === 'position-comparison') return 'forbidden'
  return 'unclassifiable'
}

const listSourceFilesUnder = (root: string): string[] => {
  const absoluteRoot = path.join(REBUILD_ROOT, root)
  if (!existsSync(absoluteRoot)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      if (NON_PROGRAM_SOURCE_EXTENSIONS.includes(path.extname(entry.name))) out.push(full)
    }
  }
  walk(absoluteRoot)
  return out
}

const nonProgramOrdinalSites = (): OrdinalSite[] =>
  ORDINAL_ROOTS.flatMap(listSourceFilesUnder).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        line.includes(`.${ORDINAL_FIELD}`)
          ? [{ file: relativeToRoot(file), line: index + 1, expression: line.trim(), use: 'unknown' as OrdinalUse }]
          : []
      )
  )

const UNASSERTED_ORDINAL_ROOT = `src${path.sep}render${path.sep}`

test('briefing.criterion-ordinal-is-read-only-to-render-a-display-label', (t) => {
  const { program, productionFiles, testFiles } = loadSourceProgram()
  const everyRead = [...productionFiles, ...testFiles]
    .map((file) => sourceFileFor(program, file))
    .flatMap(collectOrdinalSites)
  const outsideTheProgram = nonProgramOrdinalSites()
  const population = [...everyRead, ...outsideTheProgram]

  assert.ok(
    population.length > 0,
    'the tree must read criterion.ordinal at least once, or this census is running over an empty population'
  )
  for (const site of population) t.diagnostic(`${site.file}:${site.line} [${site.use}] ${site.expression}`)

  const forbidden = population.filter((site) => classifyOrdinalSite(site) !== 'allowed')
  for (const site of forbidden) {
    t.diagnostic(`unasserted here, owned elsewhere: ${site.file}:${site.line} ${site.expression}`)
  }

  const underRender = population.filter((site) => site.file.startsWith(UNASSERTED_ORDINAL_ROOT))
  assert.ok(underRender.length > 0, 'the render modules must read criterion.ordinal, or this assertion is vacuous')
  assert.doesNotThrow(
    () => census(underRender, classifyOrdinalSite),
    `every read of criterion.ordinal under src/render must render a display label; any other read infers sequence from position:\n${underRender
      .filter((site) => classifyOrdinalSite(site) !== 'allowed')
      .map((site) => `${site.file}:${site.line} ${site.expression}`)
      .join('\n')}`
  )
})

test('briefing.criterion-ordinal-is-read-only-to-render-a-display-label.control.a-read-outside-a-label-is-forbidden', () => {
  const comparison: OrdinalSite[] = [
    { file: 'src/render/briefing.ts', line: 1, expression: 'candidate.ordinal < best.ordinal', use: 'position-comparison' }
  ]
  assert.throws(() => census(comparison, classifyOrdinalSite))
  const unknown: OrdinalSite[] = [
    { file: 'src/render/briefing.ts', line: 1, expression: 'sortBy(candidate.ordinal)', use: 'unknown' }
  ]
  assert.throws(() => census(unknown, classifyOrdinalSite))
})
```

Rationale: the first census is the standing guard for criterion 1 — it walks every `slice` call in the
briefing renderer and requires each to discard the entries it selects, which is the heading idiom and
is not a cap. A `slice` that keeps its entries is a display-time item cap, and the census halts on it
and names the file, line and expression.

The second census is `S3`. Its population is every read of `Criterion.ordinal` in the tree: every file
in the compiled program, production and test, plus a text sweep of the `.mjs`, `.cjs` and `.js` files
under `src`, `hooks`, `bin`, `scripts` and `test` that the program does not compile. Each read is
classified by rule — a read inside a template literal is a display label, a read copied into a field
named `ordinal` is a field copy, a read in a test file is an observation, a read compared against
another ordinal or against a parsed number picks a goal by position and is forbidden, and anything else
halts the census. Every read is printed with its classification, and the reads this unit declines to
assert are printed again under `unasserted here, owned elsewhere`, so the population is visible in the
test's own output rather than only in this plan. Section 3.5 records which reads those are and why.

Each census carries a control proving it halts, in the idiom `briefing.blocked-renders-its-reason`
already uses in this suite.

### Part B — every shortened value says so

Every step below is applied to the tree as part A left it.

#### Step B1 — bump the version in both manifests

Identical in form to step A1 and restated in full so this part is executable on its own.

1. `node -p "require('./package.json').version"` — expect exit code 0; call what it prints `CURRENT`.
2. `node -p "require('./.claude-plugin/plugin.json').version"` — expect exit code 0, and expect it to
   print exactly `CURRENT`. Any other value means the two manifests disagree: STOP and report; do not
   improvise.
3. This part's type is `feat`: increment MINOR, set PATCH to `0`, call the result `NEXT`.
4. In `package.json`, FIND `  "version": "CURRENT",` and REPLACE with `  "version": "NEXT",`.
5. In `.claude-plugin/plugin.json`, FIND `  "version": "CURRENT",` and REPLACE with `  "version": "NEXT",`.
6. Run `node scripts/check-packaging.mjs`. Expect exit code 0 and no output.

#### Step B2 — create the one clip-marker module


File: `src/render/clip.ts`. CREATE. Entire contents:

```ts
import { clipGraphemes } from './escape.ts'

export const CLIP_MARKER = '...[shortened]'

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

export const CLIP_MARKER_GRAPHEMES = graphemeCount(CLIP_MARKER)

export const clipWithMarker = (text: string, max: number): string => {
  if (!Number.isFinite(max)) return text
  if (graphemeCount(text) <= max) return text
  const budget = max - CLIP_MARKER_GRAPHEMES
  if (budget <= 0) return clipGraphemes(CLIP_MARKER, Math.max(0, max))
  return `${clipGraphemes(text, budget)}${CLIP_MARKER}`
}
```


Rationale: `B24` requires one shared clip-marker implementation and this module is it.
`clipWithMarker` shortens a value only when it does not fit, reserves the marker's own length inside
the caller's limit before shortening, and never returns more graphemes than the limit allows — which
is `O3` stated as code. A non-finite limit is the do-not-shorten case and returns the value untouched,
which is what makes `O1` expressible. The unit that later adds a marker to the session-start banner
imports this module; it does not write a second one.

Why this path and not `src/render/escape.ts`: a later unit in this ladder owns `escape.ts` and edits
it, so a new export placed there would sit inside another unit's file. Why not a module outside
`src/render`: the render census resolves escaping helpers by module path, and `src/render` is where it
already looks.

#### Step B3 — replace the briefing renderer

File: `src/render/briefing.ts`. REPLACE (whole file). Entire new contents:

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored } from './escape.ts'
import { CLIP_MARKER_GRAPHEMES, clipWithMarker } from './clip.ts'

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

export const BRIEFING_HEADING = '# Your Preflight Briefing'
export const BRIEFING_MAX_CHARS = 12000
export const RESUME_PAYLOAD_MAX_BYTES = 24000

const RESUME_PAYLOAD_RESERVE_BYTES = 200
const RESUME_PAYLOAD_TARGET_BYTES = RESUME_PAYLOAD_MAX_BYTES - RESUME_PAYLOAD_RESERVE_BYTES

const BRIEFING_COPIES_IN_RESUME_PAYLOAD = 2
const RESUME_PAYLOAD_SCAFFOLD_BYTES = 114
const PREVIOUS_SESSION_NULL_BYTES = 4
const PREVIOUS_SESSION_LARGEST_BYTES = 82
const PREVIOUS_SESSION_PRESENT_EXTRA_BYTES = PREVIOUS_SESSION_LARGEST_BYTES - PREVIOUS_SESSION_NULL_BYTES
const PREVIOUS_SESSION_ABSENT_EXTRA_BYTES = 0
const PREVIOUS_SESSION_DEFAULT_PRESENT = true
const JSON_STRING_DELIMITER_BYTES = 2

const jsonEscapedByteLen = (text: string): number =>
  Buffer.byteLength(JSON.stringify(text), 'utf8') - JSON_STRING_DELIMITER_BYTES

export const resumePayloadBytes = (
  briefing: string,
  threadId: string,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): number =>
  BRIEFING_COPIES_IN_RESUME_PAYLOAD * jsonEscapedByteLen(briefing) +
  jsonEscapedByteLen(threadId) +
  RESUME_PAYLOAD_SCAFFOLD_BYTES +
  (hasPreviousSession ? PREVIOUS_SESSION_PRESENT_EXTRA_BYTES : PREVIOUS_SESSION_ABSENT_EXTRA_BYTES)

const fitsBudget = (briefing: string, threadId: string, hasPreviousSession: boolean): boolean =>
  briefing.length <= BRIEFING_MAX_CHARS &&
  resumePayloadBytes(briefing, threadId, hasPreviousSession) <= RESUME_PAYLOAD_TARGET_BYTES

const RELATED_TITLE_NATURAL_MAX = 100
const RELATED_SLUG_NATURAL_MAX = 64
const RISK_TEXT_NATURAL_MAX = 500
const KEY_DECISION_TITLE_NATURAL_MAX = 200
const OUT_OF_SCOPE_TEXT_NATURAL_MAX = 300
const CRITERION_TEXT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120

const MIN_TEXT_CLIP = CLIP_MARKER_GRAPHEMES
const NO_CLIP = Number.POSITIVE_INFINITY

const FOCUS_NOT_SET_LINE =
  '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'

const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'

const TEXT_CLIPPED_BULLET =
  '- some text on this briefing was shortened to fit the character budget; every shortened value ends with ...[shortened]'

const clip = (text: string, max: number): string => clipWithMarker(escapeStored(text), max)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderCriterionLine = (criterion: Criterion, textClip: number): string => {
  const text = clip(criterion.text, textClip)
  const label = `- c${criterion.ordinal} [${criterionStatus(criterion)}]:`
  const withText = text.length === 0 ? label : `${label} ${text}`
  return `${withText} (id ${escapeStored(criterion.id)})`
}

const renderRiskLine = (risk: Risk, textClip: number): string => `- ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string => `- ${clip(keyDecision.title, textClip)}`

const renderOutOfScopeLine = (outOfScope: OutOfScope, textClip: number): string => `- ${clip(outOfScope.text, textClip)}`

const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
  `- risk ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderSettledKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- decision ${escapeStored(keyDecision.decision_id)} ${clip(keyDecision.title, textClip)}`

const renderDanglingLine = (decisionId: string): string => `- dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `- quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread, renderClip: RenderClip): string =>
  `- succeeds: ${clip(predecessor.title, renderClip.relatedTitle)} (${clip(predecessor.slug, renderClip.relatedSlug)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

type Lane = 'live' | 'settled'

const laneFor = (criterionId: string | undefined, criteriaById: ReadonlyMap<string, Criterion>): Lane => {
  if (criterionId === undefined) return 'live'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'live'
  return criterion.struck_by !== null || criterion.done ? 'settled' : 'live'
}

type Laned<T> = { live: T[]; settled: T[] }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>
): Laned<T> => ({
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'settled')
})

type RenderClip = {
  relatedTitle: number
  relatedSlug: number
  risk: number
  keyDecision: number
  outOfScope: number
  criterion: number
  settled: number
}

const clipAt = (perItemClip: number): RenderClip => ({
  relatedTitle: Math.min(perItemClip, RELATED_TITLE_NATURAL_MAX),
  relatedSlug: Math.min(perItemClip, RELATED_SLUG_NATURAL_MAX),
  risk: Math.min(perItemClip, RISK_TEXT_NATURAL_MAX),
  keyDecision: Math.min(perItemClip, KEY_DECISION_TITLE_NATURAL_MAX),
  outOfScope: Math.min(perItemClip, OUT_OF_SCOPE_TEXT_NATURAL_MAX),
  criterion: Math.min(perItemClip, CRITERION_TEXT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX)
})

const UNCLIPPED: RenderClip = {
  relatedTitle: NO_CLIP,
  relatedSlug: NO_CLIP,
  risk: NO_CLIP,
  keyDecision: NO_CLIP,
  outOfScope: NO_CLIP,
  criterion: NO_CLIP,
  settled: NO_CLIP
}

const MAX_ITEM_CLIP = Math.max(
  RELATED_TITLE_NATURAL_MAX,
  RELATED_SLUG_NATURAL_MAX,
  RISK_TEXT_NATURAL_MAX,
  KEY_DECISION_TITLE_NATURAL_MAX,
  OUT_OF_SCOPE_TEXT_NATURAL_MAX,
  CRITERION_TEXT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX
)

type ClipSearch = { briefing: string; passes: number }

const largestFittingClipRender = (
  renderAtClip: (perItemClip: number) => string,
  fits: (briefing: string) => boolean,
  unclipped: string
): ClipSearch => {
  let accepted = MIN_TEXT_CLIP - 1
  let ceiling = MAX_ITEM_CLIP
  let bestFitting: string | null = null
  let passes = 0

  while (accepted < ceiling) {
    const candidate = Math.ceil((accepted + ceiling) / 2)
    const rendered = renderAtClip(candidate)
    passes += 1
    if (fits(rendered)) {
      accepted = candidate
      bestFitting = rendered
    } else {
      ceiling = candidate - 1
    }
  }

  if (bestFitting !== null) return { briefing: bestFitting, passes }
  const floorRender = renderAtClip(MIN_TEXT_CLIP)
  const smallest = floorRender.length < unclipped.length ? floorRender : unclipped
  return { briefing: smallest, passes: passes + 1 }
}

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

  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map((item) => renderRelatedLine(item, renderClip))
  const riskLines = risks.live.map((item) => renderRiskLine(item, renderClip.risk))
  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
  const outOfScopeLines = outOfScope.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
  const criterionLines = criteria.map((item) => renderCriterionLine(item, renderClip.criterion))
  const settledLines = [
    ...risks.settled.map((item) => renderSettledRiskLine(item, renderClip.settled)),
    ...keyDecisions.settled.map((item) => renderSettledKeyDecisionLine(item, renderClip.settled))
  ]

  const notShownBulletLines = [
    ...[unreadableDecisionCount]
      .filter((count) => count > 0)
      .map((count) => `- ${count} linked decision records could not be read; their ids are listed under Decisions above`),
    ...[textWasClipped].filter(Boolean).map(() => TEXT_CLIPPED_BULLET)
  ]

  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${escapeStored(thread.title)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    FOCUS_NOT_SET_LINE,
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.slice(0, 1).map(() => '**Active goal:**'),
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.map((value) => escapeStored(value)),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.slice(0, 1).map(() => '**Last session:**'),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.map((value) => escapeStored(value)),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStored(value)),
    ...relatedThreads.slice(0, 1).map(() => ''),
    ...relatedThreads.slice(0, 1).map(() => '**Related:**'),
    ...relatedLines,
    ...riskLines.slice(0, 1).map(() => ''),
    ...riskLines.slice(0, 1).map(() => '**Open risks:**'),
    ...riskLines,
    ...keyDecisionLines.slice(0, 1).map(() => ''),
    ...keyDecisionLines.slice(0, 1).map(() => '**Key decisions:**'),
    ...keyDecisionLines,
    ...outOfScopeLines.slice(0, 1).map(() => ''),
    ...outOfScopeLines.slice(0, 1).map(() => '**Out of scope:**'),
    ...outOfScopeLines,
    ...criterionLines.slice(0, 1).map(() => ''),
    ...criterionLines.slice(0, 1).map(() => '**Completion criteria:**'),
    ...criterionLines,
    ...settledLines.slice(0, 1).map(() => ''),
    ...settledLines.slice(0, 1).map(() => SETTLED_HEADING),
    ...settledLines,
    '',
    '**Decisions:**',
    `- resolved: ${decisionIntegrity.resolved}`,
    ...decisionIntegrity.dangling.map(renderDanglingLine),
    ...decisionIntegrity.quarantined.map(renderQuarantinedLine),
    ...notShownBulletLines.slice(0, 1).map(() => ''),
    ...notShownBulletLines.slice(0, 1).map(() => '**Not shown:**'),
    ...notShownBulletLines,
    ...notShownBulletLines
      .slice(0, 1)
      .map(() => `See ${notShownAddress} for the complete record.`)
  ].join('\n')
}

export type BriefingRender = { briefing: string; passes: number; withinBudget: boolean }

export const renderBriefingWithPasses = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const risks = laneSplit(thread.spine.open_risks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)

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

  const finish = (briefing: string, passes: number): BriefingRender => ({
    briefing,
    passes,
    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession)
  })

  const unclipped = renderWith(UNCLIPPED, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)

  const search = largestFittingClipRender(
    (perItemClip) => renderWith(clipAt(perItemClip), true),
    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession),
    unclipped
  )
  return finish(search.briefing, search.passes + 1)
}

export const renderBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): string => renderBriefingWithPasses(thread, decisionIntegrity, pointer, predecessor, hasPreviousSession).briefing
```

Rationale, clause by clause. `clip` now calls `clipWithMarker`, so every shortened value says it was
shortened (`O3`). `MIN_TEXT_CLIP` becomes the marker's own length, so the search's floor is the
smallest limit at which a marker still fits — below that a shortened value would vanish silently,
which is the case `O3` forbids. `UNCLIPPED` replaces `FULL_CLIP` as the first attempt and shortens
nothing at all, so a briefing that fits renders in full however far its stored text expands when
escaped (`O1`). `RELATED_TITLE_CLIP` and `RELATED_SLUG_CLIP` become `RELATED_TITLE_NATURAL_MAX` and
`RELATED_SLUG_NATURAL_MAX` and join `RenderClip`, because a limit that never enters the search would
shorten the predecessor's title on a briefing that had room for all of it, breaking `O1` on that one
line. The `Not shown` address stops being passed through `clip` and renders whole: an address
shortened to nothing does not resolve, and `O2` requires it to resolve. `TEXT_CLIPPED_BULLET` now
names the marker, so a reader who sees the bullet knows what to look for.

`MAX_ITEM_CLIP` is unchanged at 500 — the two related-thread limits are 100 and 64, both smaller — so
the binary search's range, and therefore the pass count that shipped
`briefing.the-clip-search-converges-within-the-pass-ceiling` bounds at 11, are unchanged.

#### Step B4 — teach the render census the new module


File: `test/contract/render-census.test.ts`. 3 edits, applied in this order.

**Edit B4.1** — FIND:

```ts
  'src/server/prompts.ts'
] as const

const ESCAPE_MODULE_SPECIFIERS = ['./escape.ts', '../render/escape.ts', '../../render/escape.ts']
const ESCAPE_FUNCTION = 'escapeStored'
const CLIP_FUNCTION = 'clipGraphemes'
const ITERATION_CALLBACK_NAMES = new Set(['map', 'flatMap', 'filter', 'forEach', 'find'])
const ARRAY_PRODUCING_NAMES = new Set(['map', 'flatMap'])
const JOIN_METHOD = 'join'
```

REPLACE with:

```ts
  'src/server/prompts.ts'
] as const

const ESCAPE_MODULE_SPECIFIERS = [
  './escape.ts',
  '../render/escape.ts',
  '../../render/escape.ts',
  './clip.ts',
  '../render/clip.ts',
  '../../render/clip.ts'
]
const ESCAPE_FUNCTION = 'escapeStored'
const CLIP_FUNCTION = 'clipGraphemes'
const MARKER_CLIP_FUNCTION = 'clipWithMarker'
const WRAPPING_CLIP_FUNCTIONS = new Set([CLIP_FUNCTION, MARKER_CLIP_FUNCTION])
const ITERATION_CALLBACK_NAMES = new Set(['map', 'flatMap', 'filter', 'forEach', 'find'])
const ARRAY_PRODUCING_NAMES = new Set(['map', 'flatMap'])
const JOIN_METHOD = 'join'
```

**Edit B4.2** — FIND:

```ts
const contextFor = (checker: ts.TypeChecker, sourceFile: ts.SourceFile): Ctx => ({
  checker,
  sourceFile,
  escapeSymbols: findNamedImportSymbols(checker, sourceFile, ESCAPE_MODULE_SPECIFIERS, [ESCAPE_FUNCTION, CLIP_FUNCTION])
})

const unwrap = (node: ts.Node): ts.Node => {
```

REPLACE with:

```ts
const contextFor = (checker: ts.TypeChecker, sourceFile: ts.SourceFile): Ctx => ({
  checker,
  sourceFile,
  escapeSymbols: findNamedImportSymbols(checker, sourceFile, ESCAPE_MODULE_SPECIFIERS, [
    ESCAPE_FUNCTION,
    CLIP_FUNCTION,
    MARKER_CLIP_FUNCTION
  ])
})

const unwrap = (node: ts.Node): ts.Node => {
```

**Edit B4.3** — FIND:

```ts
const isEscapedCall = (ctx: Ctx, node: ts.Node, depth: number): boolean => {
  const called = escapeCallName(ctx, node)
  if (called === ESCAPE_FUNCTION) return true
  if (called !== CLIP_FUNCTION || !ts.isCallExpression(node)) return false
  const wrapped = node.arguments[0]
  return wrapped !== undefined && classifyExpression(ctx, wrapped, depth + 1) === 'escaped'
}
```

REPLACE with:

```ts
const isEscapedCall = (ctx: Ctx, node: ts.Node, depth: number): boolean => {
  const called = escapeCallName(ctx, node)
  if (called === ESCAPE_FUNCTION) return true
  if (called === null || !WRAPPING_CLIP_FUNCTIONS.has(called) || !ts.isCallExpression(node)) return false
  const wrapped = node.arguments[0]
  return wrapped !== undefined && classifyExpression(ctx, wrapped, depth + 1) === 'escaped'
}
```


Rationale: this census halts on any interpolated value it cannot prove is escaped or written by the
server. It resolves a helper only by module path and function name (ground truth 2.11), so every call
to `clipWithMarker` would halt it. The census is taught the new module and the new name, and
`clipWithMarker` is classified exactly as `clipGraphemes` already is: escaped when, and only when, the
value it wraps is itself escaped. That is classifying a new item, which is what a halting census
requires. It is not an allowlist and it does not narrow the population.

`src/render/clip.ts` is not added to `CENSUSED_FILES`. That list is the surfaces that render text to a
model; `src/render/escape.ts`, the other escaping primitive, is not on it either. A primitive is
recognised as an escaper, never censused as a surface.

#### Step B5 — add the clip-marker module's own tests


File: `test/unit/clip.test.ts`. CREATE. Entire contents:

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES, clipWithMarker } from '../../src/render/clip.ts'

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length

const LONG_ASCII = 'x'.repeat(200)
const LONG_CJK = '漢'.repeat(200)
const FAMILY_EMOJI = '\u{1F468}‍\u{1F469}‍\u{1F467}'
const LONG_MULTI_UNIT_GRAPHEMES = FAMILY_EMOJI.repeat(20)

const LIMIT_SWEEP_CEILING = 60

test('clip.a-value-that-fits-its-limit-is-returned-unchanged-and-unmarked', () => {
  for (const text of ['', 'short', LONG_ASCII]) {
    assert.equal(clipWithMarker(text, graphemeCount(text)), text)
    assert.equal(clipWithMarker(text, graphemeCount(text) + 1), text)
  }
})

test('clip.an-infinite-limit-never-shortens-and-never-marks', () => {
  for (const text of [LONG_ASCII, LONG_CJK, LONG_MULTI_UNIT_GRAPHEMES]) {
    assert.equal(clipWithMarker(text, Number.POSITIVE_INFINITY), text)
  }
})

test('clip.a-shortened-value-never-exceeds-its-own-limit-and-carries-the-marker-inside-it', () => {
  for (const text of [LONG_ASCII, LONG_CJK, LONG_MULTI_UNIT_GRAPHEMES]) {
    for (let max = 0; max <= LIMIT_SWEEP_CEILING; max += 1) {
      const clipped = clipWithMarker(text, max)
      assert.ok(
        graphemeCount(clipped) <= max,
        `a value clipped to ${max} graphemes must not exceed that limit, got ${graphemeCount(clipped)}`
      )
      const wasShortened = graphemeCount(text) > max
      if (wasShortened && max >= CLIP_MARKER_GRAPHEMES) {
        assert.ok(clipped.endsWith(CLIP_MARKER), `a value clipped to ${max} graphemes must end with the marker, got ${clipped}`)
      }
      if (!wasShortened) {
        assert.equal(clipped, text, `a value that fits ${max} graphemes must be returned unchanged`)
      }
    }
  }
})

test('clip.a-limit-smaller-than-the-marker-yields-only-as-much-of-the-marker-as-fits', () => {
  for (let max = 0; max < CLIP_MARKER_GRAPHEMES; max += 1) {
    const clipped = clipWithMarker(LONG_ASCII, max)
    assert.equal(clipped, CLIP_MARKER.slice(0, max), `at a limit of ${max} the value must be the marker truncated to fit`)
  }
})

test('clip.the-marker-is-one-grapheme-per-code-unit', () => {
  assert.equal(CLIP_MARKER, '...[shortened]')
  assert.equal(CLIP_MARKER_GRAPHEMES, CLIP_MARKER.length)
})
```


Rationale: these assert `O3` at the helper, over every limit from 0 to 60 and over three text classes
— one byte per character, three bytes per character, and a grapheme spanning several code units. A
shortened value never exceeds its limit, and carries the marker whenever the limit has room for it.

#### Step B6 — tie the clip-search test to the marker


File: `test/unit/briefing.test.ts`. 2 edits, applied in this order.

**Edit B6.1** — FIND:

```ts
  RESUME_PAYLOAD_MAX_BYTES,
  type DecisionIntegrity
} from '../../src/render/briefing.ts'
import { ThreadRecord, type Thread, type Criterion, type Risk, type KeyDecision, type OutOfScope } from '../../src/schema/thread.ts'
import { CRITERIA_MAX_ELEMENTS, KEY_DECISION_TITLE_MAX, OPEN_RISKS_MAX_ELEMENTS, THREAD_SLUG_MAX } from '../../src/schema/caps.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
```

REPLACE with:

```ts
  RESUME_PAYLOAD_MAX_BYTES,
  type DecisionIntegrity
} from '../../src/render/briefing.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { ThreadRecord, type Thread, type Criterion, type Risk, type KeyDecision, type OutOfScope } from '../../src/schema/thread.ts'
import { CRITERIA_MAX_ELEMENTS, KEY_DECISION_TITLE_MAX, OPEN_RISKS_MAX_ELEMENTS, THREAD_SLUG_MAX } from '../../src/schema/caps.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
```

**Edit B6.2** — FIND:

```ts
  )

  const retained = textAfterPrefix(render.briefing, `- ${shownRisk.id} `)
  assert.ok(retained > 0, `the clipped risk text must keep some of its own text, got ${retained}`)
  assert.ok(
    render.briefing.endsWith('for the complete record.'),
    'a clipped render must carry the address that resolves to the complete record'
```

REPLACE with:

```ts
  )

  const retained = textAfterPrefix(render.briefing, `- ${shownRisk.id} `)
  assert.ok(retained > CLIP_MARKER.length, `the clipped risk text must keep some of its own text beside the marker, got ${retained}`)
  assert.ok(
    render.briefing.endsWith('for the complete record.'),
    'a clipped render must carry the address that resolves to the complete record'
```


#### Step B7 — add the `O1` and `O3` receipts

File: `test/unit/briefing-hides-nothing.test.ts`. 2 edits, applied in this order.

**Edit B7.1** — FIND:

```ts
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { census, type Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

type SliceSite = { file: string; line: number; expression: string; discardsElements: boolean }

const discardsSlicedElements = (call: ts.CallExpression): boolean => {
```

REPLACE with:

```ts
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { renderBriefingWithPasses, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES } from '../../src/render/clip.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
import * as caps from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'
import { census, type Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

type SliceSite = { file: string; line: number; expression: string; discardsElements: boolean }

const discardsSlicedElements = (call: ts.CallExpression): boolean => {
```

**Edit B7.2** — FIND:

```ts
  ]
  assert.throws(() => census(unknown, classifyOrdinalSite))
})
```

REPLACE with:

```ts
  ]
  assert.throws(() => census(unknown, classifyOrdinalSite))
})

const ESCAPE_EXPANDING_CHAR = '#'

const criterionOf = (overrides: Partial<Criterion> = {}): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'a criterion',
  done: false,
  kind: 'planned',
  struck_by: null,
  ...overrides
})

const threadOf = (overrides: Partial<Thread> = {}): Thread => ({
  id: rt.ulid(),
  slug: 'hides-nothing-fixture',
  title: 'Hides Nothing Fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the renderer',
    next_step: 'write the tests',
    last_session: 'wrote the renderer',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
})

test('briefing.a-render-that-fits-its-budget-is-clipped-nowhere', () => {
  const predecessor = threadOf({ title: ESCAPE_EXPANDING_CHAR.repeat(caps.THREAD_TITLE_MAX), status: 'done' })
  const thread = threadOf({
    predecessor_id: predecessor.id,
    completion_criteria: [
      criterionOf({ ordinal: 1, text: ESCAPE_EXPANDING_CHAR.repeat(caps.CRITERION_TEXT_MAX) })
    ],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [{ id: rt.ulid(), scope: 's', text: ESCAPE_EXPANDING_CHAR.repeat(caps.RISK_TEXT_MAX), refs: [] }],
      key_decisions: [],
      out_of_scope: []
    }
  })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the escape-expanding fixture must itself be schema-admissible')

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, predecessor)

  assert.equal(render.withinBudget, true, 'this fixture must fit its budget, or it says nothing about a render that fits')
  const criterionText = thread.completion_criteria[0]?.text
  const riskText = thread.spine.open_risks[0]?.text
  if (criterionText === undefined || riskText === undefined) {
    throw new Error('the escape-expanding fixture must carry one criterion and one risk, or there is no full render to check')
  }
  assert.ok(
    render.briefing.includes(escapeStored(criterionText)),
    'a briefing that fits its budget must render the whole criterion text, however far the escape expands it'
  )
  assert.ok(
    render.briefing.includes(escapeStored(riskText)),
    'a briefing that fits its budget must render the whole risk text, however far the escape expands it'
  )
  assert.ok(
    render.briefing.includes(escapeStored(predecessor.title)),
    'a briefing that fits its budget must render the whole predecessor title, which no fixed limit may shorten'
  )
  assert.equal(
    render.briefing.includes(CLIP_MARKER),
    false,
    'a briefing that fits its budget must carry no clip marker'
  )
  assert.equal(
    render.briefing.includes('**Not shown:**'),
    false,
    'a briefing that fits its budget must carry no not-shown block'
  )
  assert.equal(render.passes, 1, 'a briefing that fits its budget must never enter the clip search')
})

const SHORTENING_FIXTURE_CRITERION_COUNT = 60
const SHORTENING_FIXTURE_CRITERION_TEXT_LENGTH = 300

const CRITERION_TEXT_PATTERN = /^- c\d+ \[(?:open|done|struck)\]: (.*) \(id [0-9A-HJKMNP-TV-Z]{26}\)$/
const RISK_TEXT_PATTERN = /^- [0-9A-HJKMNP-TV-Z]{26} (.*)$/

const SHORTENABLE_VALUE_PATTERNS = [CRITERION_TEXT_PATTERN, RISK_TEXT_PATTERN]

const storedValueOf = (line: string): string | null => {
  for (const pattern of SHORTENABLE_VALUE_PATTERNS) {
    const match = pattern.exec(line)
    if (match !== null && match[1] !== undefined) return match[1]
  }
  return null
}

test('briefing.every-shortened-value-carries-the-marker-inside-its-own-limit', () => {
  const criteria: Criterion[] = Array.from({ length: SHORTENING_FIXTURE_CRITERION_COUNT }, (_, index) =>
    criterionOf({ ordinal: index + 1, text: 'x'.repeat(SHORTENING_FIXTURE_CRITERION_TEXT_LENGTH) })
  )
  const thread = threadOf({ completion_criteria: criteria })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the shortening fixture must itself be schema-admissible')

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(render.passes > 1, 'this fixture must enter the clip search, or nothing was shortened')
  assert.equal(render.withinBudget, true, 'the clip search must land this fixture inside its budget')

  const marked = render.briefing
    .split('\n')
    .filter((line) => line.includes(CLIP_MARKER))
    .filter((line) => !line.startsWith('- some text on this briefing was shortened'))
  assert.ok(marked.length > 0, 'the clip search must have shortened at least one value')

  for (const line of marked) {
    assert.equal(line.split(CLIP_MARKER).length - 1, 1, `the marker must appear once on a shortened line, got: ${line}`)
    const value = storedValueOf(line)
    assert.notEqual(value, null, `a line carrying the marker must be a value line this test can read, got: ${line}`)
    assert.ok((value as string).endsWith(CLIP_MARKER), `a shortened value must end with the marker, got: ${value as string}`)
    assert.ok(
      (value as string).length > CLIP_MARKER_GRAPHEMES,
      `a shortened value must keep some of its own text beside the marker, got: ${value as string}`
    )
  }

  assert.ok(
    render.briefing.includes(
      '- some text on this briefing was shortened to fit the character budget; every shortened value ends with ...[shortened]'
    ),
    'the not-shown block must say that text was shortened'
  )
  assert.ok(
    render.briefing.includes(`ends with ${CLIP_MARKER}`),
    'the not-shown bullet must name the same marker the shortened values carry'
  )
  assert.ok(
    render.briefing.includes(`See logbook://thread/${thread.id} for the complete record.`),
    'a shortened render must carry the address that resolves to the complete record'
  )
})
```

Rationale: the first new test is `O1`. Every stored value in its fixture is the character `#`, which
the stored-text escape rewrites to the six characters `U+0023`, so the escaped text is six times the
stored text and far past every natural limit — yet the record fits the budget. The test requires the
criterion text, the risk text and the predecessor title each to appear whole, with no marker and no
`Not shown` block, in a single pass. The second test is `O3`: every marked line carries the marker
once, at the end of the stored value rather than the end of the line, with some of the value's own
text still beside it, and the `Not shown` bullet names the same marker.

### Part C — every item says what it is

Every step below is applied to the tree as part B left it.

#### Step C1 — bump the version in both manifests

Identical in form to step A1 and restated in full so this part is executable on its own.

1. `node -p "require('./package.json').version"` — expect exit code 0; call what it prints `CURRENT`.
2. `node -p "require('./.claude-plugin/plugin.json').version"` — expect exit code 0, and expect it to
   print exactly `CURRENT`. Any other value means the two manifests disagree: STOP and report; do not
   improvise.
3. This part's type is `feat`: increment MINOR, set PATCH to `0`, call the result `NEXT`.
4. In `package.json`, FIND `  "version": "CURRENT",` and REPLACE with `  "version": "NEXT",`.
5. In `.claude-plugin/plugin.json`, FIND `  "version": "CURRENT",` and REPLACE with `  "version": "NEXT",`.
6. Run `node scripts/check-packaging.mjs`. Expect exit code 0 and no output.

#### Step C2 — replace the briefing renderer

File: `src/render/briefing.ts`. REPLACE (whole file). Entire new contents:

```ts
import type { Thread, Criterion, Risk, KeyDecision, OutOfScope, Artifact } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored } from './escape.ts'
import { CLIP_MARKER_GRAPHEMES, clipWithMarker } from './clip.ts'

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

export const BRIEFING_HEADING = '# Your Preflight Briefing'
export const BRIEFING_MAX_CHARS = 12000
export const RESUME_PAYLOAD_MAX_BYTES = 24000

const RESUME_PAYLOAD_RESERVE_BYTES = 200
const RESUME_PAYLOAD_TARGET_BYTES = RESUME_PAYLOAD_MAX_BYTES - RESUME_PAYLOAD_RESERVE_BYTES

const BRIEFING_COPIES_IN_RESUME_PAYLOAD = 2
const RESUME_PAYLOAD_SCAFFOLD_BYTES = 114
const PREVIOUS_SESSION_NULL_BYTES = 4
const PREVIOUS_SESSION_LARGEST_BYTES = 82
const PREVIOUS_SESSION_PRESENT_EXTRA_BYTES = PREVIOUS_SESSION_LARGEST_BYTES - PREVIOUS_SESSION_NULL_BYTES
const PREVIOUS_SESSION_ABSENT_EXTRA_BYTES = 0
const PREVIOUS_SESSION_DEFAULT_PRESENT = true
const JSON_STRING_DELIMITER_BYTES = 2

const jsonEscapedByteLen = (text: string): number =>
  Buffer.byteLength(JSON.stringify(text), 'utf8') - JSON_STRING_DELIMITER_BYTES

export const resumePayloadBytes = (
  briefing: string,
  threadId: string,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): number =>
  BRIEFING_COPIES_IN_RESUME_PAYLOAD * jsonEscapedByteLen(briefing) +
  jsonEscapedByteLen(threadId) +
  RESUME_PAYLOAD_SCAFFOLD_BYTES +
  (hasPreviousSession ? PREVIOUS_SESSION_PRESENT_EXTRA_BYTES : PREVIOUS_SESSION_ABSENT_EXTRA_BYTES)

const fitsBudget = (briefing: string, threadId: string, hasPreviousSession: boolean): boolean =>
  briefing.length <= BRIEFING_MAX_CHARS &&
  resumePayloadBytes(briefing, threadId, hasPreviousSession) <= RESUME_PAYLOAD_TARGET_BYTES

const RELATED_TITLE_NATURAL_MAX = 100
const RELATED_SLUG_NATURAL_MAX = 64
const RISK_TEXT_NATURAL_MAX = 500
const RISK_REF_NATURAL_MAX = 200
const KEY_DECISION_TITLE_NATURAL_MAX = 200
const OUT_OF_SCOPE_TEXT_NATURAL_MAX = 300
const CRITERION_TEXT_NATURAL_MAX = 500
const CRITERION_CHECK_NATURAL_MAX = 500
const CRITERION_RESULT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120
const ARTIFACT_LABEL_NATURAL_MAX = 200
const ARTIFACT_POINTER_NATURAL_MAX = 500

const MIN_TEXT_CLIP = CLIP_MARKER_GRAPHEMES
const NO_CLIP = Number.POSITIVE_INFINITY

const NOT_RECORDED = 'not recorded'

const FOCUS_NOT_SET_LINE =
  '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'

const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'

const TEXT_CLIPPED_BULLET =
  '- some text on this briefing was shortened to fit the character budget; every shortened value ends with ...[shortened]'

const clip = (text: string, max: number): string => clipWithMarker(escapeStored(text), max)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderCriterionLine = (criterion: Criterion, textClip: number): string => {
  const text = clip(criterion.text, textClip)
  const label = `- c${criterion.ordinal} [${criterionStatus(criterion)}]:`
  const withText = text.length === 0 ? label : `${label} ${text}`
  return `${withText} (id ${escapeStored(criterion.id)})`
}

const renderCheckLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.check === 'string'
    ? `  - check: ${clip(criterion.check, textClip)}`
    : `  - check: ${NOT_RECORDED}`

const renderResultStatus = (criterion: Criterion): string => escapeStored(criterion.result_status ?? NOT_RECORDED)

const renderResultLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.result === 'string'
    ? `  - result: ${clip(criterion.result, textClip)} (${renderResultStatus(criterion)})`
    : `  - result: ${NOT_RECORDED} (${renderResultStatus(criterion)})`

const renderCriterionBlock = (criterion: Criterion, renderClip: RenderClip): string =>
  [
    renderCriterionLine(criterion, renderClip.criterion),
    renderCheckLine(criterion, renderClip.criterionCheck),
    ...[criterion].filter((entry) => entry.done).map((entry) => renderResultLine(entry, renderClip.criterionResult))
  ].join('\n')

const renderRiskBlock = (risk: Risk, renderClip: RenderClip): string =>
  [
    `- ${escapeStored(risk.id)} ${clip(risk.text, renderClip.risk)}`,
    ...risk.refs.map((ref) => `  - ref: ${clip(ref, renderClip.riskRef)}`)
  ].join('\n')

const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- ${clip(keyDecision.title, textClip)} (decision ${escapeStored(keyDecision.decision_id)})`

const renderOutOfScopeLine = (outOfScope: OutOfScope, textClip: number): string => `- ${clip(outOfScope.text, textClip)}`

const renderArtifactLine = (artifact: Artifact, renderClip: RenderClip): string =>
  `- ${clip(artifact.label, renderClip.artifactLabel)}: ${clip(artifact.pointer, renderClip.artifactPointer)}`

const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
  `- risk ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderSettledKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- decision ${escapeStored(keyDecision.decision_id)} ${clip(keyDecision.title, textClip)}`

const renderDanglingLine = (decisionId: string): string => `- dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `- quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread, renderClip: RenderClip): string =>
  `- succeeds: ${clip(predecessor.title, renderClip.relatedTitle)} (${clip(predecessor.slug, renderClip.relatedSlug)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

type Lane = 'live' | 'settled'

const laneFor = (criterionId: string | undefined, criteriaById: ReadonlyMap<string, Criterion>): Lane => {
  if (criterionId === undefined) return 'live'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'live'
  return criterion.struck_by !== null || criterion.done ? 'settled' : 'live'
}

type Laned<T> = { live: T[]; settled: T[] }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>
): Laned<T> => ({
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'settled')
})

type RenderClip = {
  relatedTitle: number
  relatedSlug: number
  risk: number
  riskRef: number
  keyDecision: number
  outOfScope: number
  criterion: number
  criterionCheck: number
  criterionResult: number
  settled: number
  artifactLabel: number
  artifactPointer: number
}

const clipAt = (perItemClip: number): RenderClip => ({
  relatedTitle: Math.min(perItemClip, RELATED_TITLE_NATURAL_MAX),
  relatedSlug: Math.min(perItemClip, RELATED_SLUG_NATURAL_MAX),
  risk: Math.min(perItemClip, RISK_TEXT_NATURAL_MAX),
  riskRef: Math.min(perItemClip, RISK_REF_NATURAL_MAX),
  keyDecision: Math.min(perItemClip, KEY_DECISION_TITLE_NATURAL_MAX),
  outOfScope: Math.min(perItemClip, OUT_OF_SCOPE_TEXT_NATURAL_MAX),
  criterion: Math.min(perItemClip, CRITERION_TEXT_NATURAL_MAX),
  criterionCheck: Math.min(perItemClip, CRITERION_CHECK_NATURAL_MAX),
  criterionResult: Math.min(perItemClip, CRITERION_RESULT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX),
  artifactLabel: Math.min(perItemClip, ARTIFACT_LABEL_NATURAL_MAX),
  artifactPointer: Math.min(perItemClip, ARTIFACT_POINTER_NATURAL_MAX)
})

const UNCLIPPED: RenderClip = {
  relatedTitle: NO_CLIP,
  relatedSlug: NO_CLIP,
  risk: NO_CLIP,
  riskRef: NO_CLIP,
  keyDecision: NO_CLIP,
  outOfScope: NO_CLIP,
  criterion: NO_CLIP,
  criterionCheck: NO_CLIP,
  criterionResult: NO_CLIP,
  settled: NO_CLIP,
  artifactLabel: NO_CLIP,
  artifactPointer: NO_CLIP
}

const MAX_ITEM_CLIP = Math.max(
  RELATED_TITLE_NATURAL_MAX,
  RELATED_SLUG_NATURAL_MAX,
  RISK_TEXT_NATURAL_MAX,
  RISK_REF_NATURAL_MAX,
  KEY_DECISION_TITLE_NATURAL_MAX,
  OUT_OF_SCOPE_TEXT_NATURAL_MAX,
  CRITERION_TEXT_NATURAL_MAX,
  CRITERION_CHECK_NATURAL_MAX,
  CRITERION_RESULT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX,
  ARTIFACT_LABEL_NATURAL_MAX,
  ARTIFACT_POINTER_NATURAL_MAX
)

type ClipSearch = { briefing: string; passes: number }

const largestFittingClipRender = (
  renderAtClip: (perItemClip: number) => string,
  fits: (briefing: string) => boolean,
  unclipped: string
): ClipSearch => {
  let accepted = MIN_TEXT_CLIP - 1
  let ceiling = MAX_ITEM_CLIP
  let bestFitting: string | null = null
  let passes = 0

  while (accepted < ceiling) {
    const candidate = Math.ceil((accepted + ceiling) / 2)
    const rendered = renderAtClip(candidate)
    passes += 1
    if (fits(rendered)) {
      accepted = candidate
      bestFitting = rendered
    } else {
      ceiling = candidate - 1
    }
  }

  if (bestFitting !== null) return { briefing: bestFitting, passes }
  const floorRender = renderAtClip(MIN_TEXT_CLIP)
  const smallest = floorRender.length < unclipped.length ? floorRender : unclipped
  return { briefing: smallest, passes: passes + 1 }
}

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

  const artifacts = thread.artifacts ?? []
  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map((item) => renderRelatedLine(item, renderClip))
  const artifactLines = artifacts.map((item) => renderArtifactLine(item, renderClip))
  const riskBlocks = risks.live.map((item) => renderRiskBlock(item, renderClip))
  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
  const outOfScopeLines = outOfScope.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
  const criterionBlocks = criteria.map((item) => renderCriterionBlock(item, renderClip))
  const settledLines = [
    ...risks.settled.map((item) => renderSettledRiskLine(item, renderClip.settled)),
    ...keyDecisions.settled.map((item) => renderSettledKeyDecisionLine(item, renderClip.settled))
  ]

  const notShownBulletLines = [
    ...[unreadableDecisionCount]
      .filter((count) => count > 0)
      .map((count) => `- ${count} linked decision records could not be read; their ids are listed under Decisions above`),
    ...[textWasClipped].filter(Boolean).map(() => TEXT_CLIPPED_BULLET)
  ]

  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${escapeStored(thread.title)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    FOCUS_NOT_SET_LINE,
    ...artifactLines.slice(0, 1).map(() => ''),
    ...artifactLines.slice(0, 1).map(() => '**Artifacts:**'),
    ...artifactLines,
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.slice(0, 1).map(() => '**Active goal:**'),
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.map((value) => escapeStored(value)),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.slice(0, 1).map(() => '**Last session:**'),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.map((value) => escapeStored(value)),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStored(value)),
    ...relatedThreads.slice(0, 1).map(() => ''),
    ...relatedThreads.slice(0, 1).map(() => '**Related:**'),
    ...relatedLines,
    ...riskBlocks.slice(0, 1).map(() => ''),
    ...riskBlocks.slice(0, 1).map(() => '**Open risks:**'),
    ...riskBlocks,
    ...keyDecisionLines.slice(0, 1).map(() => ''),
    ...keyDecisionLines.slice(0, 1).map(() => '**Key decisions:**'),
    ...keyDecisionLines,
    ...outOfScopeLines.slice(0, 1).map(() => ''),
    ...outOfScopeLines.slice(0, 1).map(() => '**Out of scope:**'),
    ...outOfScopeLines,
    ...criterionBlocks.slice(0, 1).map(() => ''),
    ...criterionBlocks.slice(0, 1).map(() => '**Completion criteria:**'),
    ...criterionBlocks,
    ...settledLines.slice(0, 1).map(() => ''),
    ...settledLines.slice(0, 1).map(() => SETTLED_HEADING),
    ...settledLines,
    '',
    '**Decisions:**',
    `- resolved: ${decisionIntegrity.resolved}`,
    ...decisionIntegrity.dangling.map(renderDanglingLine),
    ...decisionIntegrity.quarantined.map(renderQuarantinedLine),
    ...notShownBulletLines.slice(0, 1).map(() => ''),
    ...notShownBulletLines.slice(0, 1).map(() => '**Not shown:**'),
    ...notShownBulletLines,
    ...notShownBulletLines
      .slice(0, 1)
      .map(() => `See ${notShownAddress} for the complete record.`)
  ].join('\n')
}

export type BriefingRender = { briefing: string; passes: number; withinBudget: boolean }

export const renderBriefingWithPasses = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const risks = laneSplit(thread.spine.open_risks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)

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

  const finish = (briefing: string, passes: number): BriefingRender => ({
    briefing,
    passes,
    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession)
  })

  const unclipped = renderWith(UNCLIPPED, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)

  const search = largestFittingClipRender(
    (perItemClip) => renderWith(clipAt(perItemClip), true),
    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession),
    unclipped
  )
  return finish(search.briefing, search.passes + 1)
}

export const renderBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): string => renderBriefingWithPasses(thread, decisionIntegrity, pointer, predecessor, hasPreviousSession).briefing
```

Rationale, clause by clause. `renderKeyDecisionLine` appends `(decision <id>)`, so a reader has the
address of the decision itself (`B21`). `renderRiskBlock` replaces `renderRiskLine` and prints each of
a risk's external pointers as an indented `- ref:` line beneath it, and the briefing prints the
thread's artifacts as their own section above the running summary (`B22`). `renderCriterionBlock`
replaces `renderCriterionLine` at the call site and prints the criterion's check on every render, and
its result with the status of that result when the criterion is done; an absent value prints the words
`not recorded` (`B24`).

`NOT_RECORDED` is never passed through `clip`. It is a fixed twelve-character phrase the server writes,
not a stored value, and shortening it at a tight budget would produce a blank — which is
indistinguishable from an empty string a user actually wrote, the exact confusion the schema rule
forbids.

Five text limits join `RenderClip`: `riskRef`, `criterionCheck`, `criterionResult`, `artifactLabel`
and `artifactPointer`. Every new value a line can carry is therefore inside the budget search, and
`UNCLIPPED` gives each of them the do-not-shorten value, so `O1` still holds over the new fields.
`CRITERION_RESULT_NATURAL_MAX` is 500 while the stored field allows 1000: that bounds only the search,
never the full render, and it keeps `MAX_ITEM_CLIP` at 500 so the pass count that shipped
`briefing.the-clip-search-converges-within-the-pass-ceiling` bounds at 11 is unchanged. A result longer
than 500 characters renders whole whenever the briefing fits, and carries the marker when it does not.

The conditional result line is written as `[criterion].filter(...).map(...)` rather than a ternary
spread. That is not style: the render census resolves a `.filter().map()` chain and halts on a
conditional spread, and every existing conditional section in this file already uses the same idiom.

#### Step C3 — extend the exact-output test to the new fields


File: `test/unit/briefing.test.ts`. 7 edits, applied in this order.

**Edit C3.1** — FIND:

```ts

test('briefing.renders-exact-output-for-a-full-thread', () => {
  const threadId = rt.ulid()
  const riskId = rt.ulid()
  const settledRiskId = rt.ulid()
  const liveDecisionId = rt.ulid()
```

REPLACE with:

```ts

test('briefing.renders-exact-output-for-a-full-thread', () => {
  const threadId = rt.ulid()
  const artifactId = rt.ulid()
  const riskId = rt.ulid()
  const settledRiskId = rt.ulid()
  const liveDecisionId = rt.ulid()
```

**Edit C3.2** — FIND:

```ts
    text: 'first criterion',
    done: true,
    kind: 'planned' as const,
    struck_by: null
  }
  const criterionB = {
```

REPLACE with:

```ts
    text: 'first criterion',
    done: true,
    kind: 'planned' as const,
    check: 'npm test',
    result: '436 tests, 0 fail',
    result_status: 'verified' as const,
    struck_by: null
  }
  const criterionB = {
```

**Edit C3.3** — FIND:

```ts
    status: 'open',
    blocked_by: null,
    completion_criteria: [criterionA, criterionB],
    spine: {
      active_goal: 'ship the renderer',
      next_step: 'add tests',
      last_session: 'wrote the first draft',
      open_risks: [
        { id: riskId, scope: 'renderer', text: 'escaping might be incomplete', refs: [] },
        { id: settledRiskId, scope: 'renderer', text: 'a risk on a met goal', refs: [], criterion_id: criterionA.id }
      ],
      key_decisions: [
```

REPLACE with:

```ts
    status: 'open',
    blocked_by: null,
    completion_criteria: [criterionA, criterionB],
    artifacts: [{ id: artifactId, label: 'the implementation plan', pointer: 'docs/plans/u5.md' }],
    spine: {
      active_goal: 'ship the renderer',
      next_step: 'add tests',
      last_session: 'wrote the first draft',
      open_risks: [
        { id: riskId, scope: 'renderer', text: 'escaping might be incomplete', refs: ['docs/specs/goal-model.md#L120'] },
        { id: settledRiskId, scope: 'renderer', text: 'a risk on a met goal', refs: [], criterion_id: criterionA.id }
      ],
      key_decisions: [
```

**Edit C3.4** — FIND:

```ts
    '**Currently being worked:** yes',
    '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.',
    '',
    '**Active goal:**',
    '',
    'ship the renderer',
```

REPLACE with:

```ts
    '**Currently being worked:** yes',
    '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.',
    '',
    '**Artifacts:**',
    '- the implementation plan: docs/plans/u5.md',
    '',
    '**Active goal:**',
    '',
    'ship the renderer',
```

**Edit C3.5** — FIND:

```ts
    '',
    '**Open risks:**',
    `- ${riskId} escaping might be incomplete`,
    '',
    '**Key decisions:**',
    '- use postgres',
    '',
    '**Out of scope:**',
    '- does not cover the CLI',
    '',
    '**Completion criteria:**',
    `- c1 [done]: first criterion (id ${criterionA.id})`,
    `- c2 [struck]: second criterion (id ${criterionB.id})`,
    '',
    '**Settled items (on goals already met or struck):**',
    `- risk ${settledRiskId} a risk on a met goal`,
```

REPLACE with:

```ts
    '',
    '**Open risks:**',
    `- ${riskId} escaping might be incomplete`,
    '  - ref: docs/specs/goal-model.md#L120',
    '',
    '**Key decisions:**',
    `- use postgres (decision ${liveDecisionId})`,
    '',
    '**Out of scope:**',
    '- does not cover the CLI',
    '',
    '**Completion criteria:**',
    `- c1 [done]: first criterion (id ${criterionA.id})`,
    '  - check: npm test',
    '  - result: 436 tests, 0 fail (verified)',
    `- c2 [struck]: second criterion (id ${criterionB.id})`,
    '  - check: not recorded',
    '',
    '**Settled items (on goals already met or struck):**',
    `- risk ${settledRiskId} a risk on a met goal`,
```

**Edit C3.6** — FIND:

```ts
  assert.equal(rendered, expected)
  for (const heading of [
    '**Related:**',
    '**Open risks:**',
    '**Key decisions:**',
    '**Out of scope:**',
```

REPLACE with:

```ts
  assert.equal(rendered, expected)
  for (const heading of [
    '**Related:**',
    '**Artifacts:**',
    '**Open risks:**',
    '**Key decisions:**',
    '**Out of scope:**',
```

**Edit C3.7** — FIND:

```ts
    thread.completion_criteria.length,
    'every criterion of a record-byte-maximal thread renders; no display cap withholds one'
  )
  assert.equal(
    lines.filter((line) => line.startsWith('- dangling: ')).length + lines.filter((line) => line.startsWith('- quarantined: ')).length,
    integrity.dangling.length + integrity.quarantined.length,
```

REPLACE with:

```ts
    thread.completion_criteria.length,
    'every criterion of a record-byte-maximal thread renders; no display cap withholds one'
  )
  assert.equal(
    lines.filter((line) => line.startsWith('  - check: ')).length,
    thread.completion_criteria.length,
    'every criterion renders its check line, recorded or not'
  )
  assert.equal(
    lines.filter((line) => line.startsWith('- dangling: ')).length + lines.filter((line) => line.startsWith('- quarantined: ')).length,
    integrity.dangling.length + integrity.quarantined.length,
```


#### Step C4 — add the receipts for the new fields

File: `test/unit/briefing-hides-nothing.test.ts`. 4 edits, applied in this order.

**Edit C4.1** — FIND:

```ts
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { renderBriefingWithPasses, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES } from '../../src/render/clip.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
```

REPLACE with:

```ts
import path from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { renderBriefing, renderBriefingWithPasses, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES } from '../../src/render/clip.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord, type Thread, type Criterion } from '../../src/schema/thread.ts'
```

**Edit C4.2** — FIND:

```ts
  const thread = threadOf({
    predecessor_id: predecessor.id,
    completion_criteria: [
      criterionOf({ ordinal: 1, text: ESCAPE_EXPANDING_CHAR.repeat(caps.CRITERION_TEXT_MAX) })
    ],
    spine: {
      active_goal: 'g',
```

REPLACE with:

```ts
  const thread = threadOf({
    predecessor_id: predecessor.id,
    completion_criteria: [
      criterionOf({
        ordinal: 1,
        text: ESCAPE_EXPANDING_CHAR.repeat(caps.CRITERION_TEXT_MAX),
        check: ESCAPE_EXPANDING_CHAR.repeat(caps.CRITERION_CHECK_MAX)
      })
    ],
    spine: {
      active_goal: 'g',
```

**Edit C4.3** — FIND:

```ts

const CRITERION_TEXT_PATTERN = /^- c\d+ \[(?:open|done|struck)\]: (.*) \(id [0-9A-HJKMNP-TV-Z]{26}\)$/
const RISK_TEXT_PATTERN = /^- [0-9A-HJKMNP-TV-Z]{26} (.*)$/

const SHORTENABLE_VALUE_PATTERNS = [CRITERION_TEXT_PATTERN, RISK_TEXT_PATTERN]

const storedValueOf = (line: string): string | null => {
  for (const pattern of SHORTENABLE_VALUE_PATTERNS) {
```

REPLACE with:

```ts

const CRITERION_TEXT_PATTERN = /^- c\d+ \[(?:open|done|struck)\]: (.*) \(id [0-9A-HJKMNP-TV-Z]{26}\)$/
const RISK_TEXT_PATTERN = /^- [0-9A-HJKMNP-TV-Z]{26} (.*)$/
const CHECK_TEXT_PATTERN = /^ {2}- check: (.*)$/

const SHORTENABLE_VALUE_PATTERNS = [CRITERION_TEXT_PATTERN, RISK_TEXT_PATTERN, CHECK_TEXT_PATTERN]

const storedValueOf = (line: string): string | null => {
  for (const pattern of SHORTENABLE_VALUE_PATTERNS) {
```

**Edit C4.4** — FIND:

```ts
    'a shortened render must carry the address that resolves to the complete record'
  )
})
```

REPLACE with:

```ts
    'a shortened render must carry the address that resolves to the complete record'
  )
})

test('briefing.artifacts-render-before-the-spine', () => {
  const thread = threadOf({
    artifacts: [{ id: rt.ulid(), label: 'the implementation plan', pointer: 'docs/plans/u5.md' }]
  })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the artifact fixture must itself be schema-admissible')

  const lines = renderBriefing(thread, EMPTY_INTEGRITY, null, null).split('\n')
  const artifactsAt = lines.indexOf('**Artifacts:**')
  const activeGoalAt = lines.indexOf('**Active goal:**')

  assert.notEqual(artifactsAt, -1, 'a thread carrying artifacts must render an artifacts section')
  assert.equal(lines[artifactsAt + 1], '- the implementation plan: docs/plans/u5.md')
  assert.ok(artifactsAt < activeGoalAt, 'the artifacts section must render before the spine')
})

test('briefing.a-criterion-marked-done-renders-its-result-and-the-status-of-that-result', () => {
  const thread = threadOf({
    completion_criteria: [
      criterionOf({
        ordinal: 1,
        text: 'the store defect is closed',
        done: true,
        check: 'npm test',
        result: 'the reproduction could not be run in this environment',
        result_status: 'unverified-reasoned'
      })
    ]
  })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the result fixture must itself be schema-admissible')

  const lines = renderBriefing(thread, EMPTY_INTEGRITY, null, null).split('\n')
  assert.ok(lines.includes('  - check: npm test'))
  assert.ok(lines.includes('  - result: the reproduction could not be run in this environment (unverified-reasoned)'))
})

test('briefing.a-criterion-with-no-check-or-result-renders-not-recorded-never-blank', () => {
  const thread = threadOf({ completion_criteria: [criterionOf({ ordinal: 1, text: 'a goal', done: true })] })
  const lines = renderBriefing(thread, EMPTY_INTEGRITY, null, null).split('\n')
  assert.ok(lines.includes('  - check: not recorded'))
  assert.ok(lines.includes('  - result: not recorded (not recorded)'))
})
```

#### Step C5 — census the check line across the whole sweep


File: `test/unit/briefing-frontier-sweep.test.ts`. 7 edits, applied in this order.

**Edit C5.1** — FIND:

```ts
  withinBudget: boolean
  itemsHeld: number
  itemsRendered: number
}

const SECTION_HEADINGS = [
```

REPLACE with:

```ts
  withinBudget: boolean
  itemsHeld: number
  itemsRendered: number
  criterionRows: number
  checkRows: number
}

const SECTION_HEADINGS = [
```

**Edit C5.2** — FIND:

```ts
}

const CRITERION_ROW_PATTERN = /^- c\d+ \[(?:open|done|struck)\]:/

const measure = (shape: SweepShape): Measured => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, shape)
```

REPLACE with:

```ts
}

const CRITERION_ROW_PATTERN = /^- c\d+ \[(?:open|done|struck)\]:/
const CHECK_ROW_PATTERN = /^ {2}- check: /

const measure = (shape: SweepShape): Measured => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, shape)
```

**Edit C5.3** — FIND:

```ts
  const lines = render.briefing.split('\n')

  const criterionRows = lines.filter((line) => CRITERION_ROW_PATTERN.test(line)).length
  const danglingRows = lines.filter((line) => line.startsWith('- dangling: ')).length
  const quarantinedRows = lines.filter((line) => line.startsWith('- quarantined: ')).length

```

REPLACE with:

```ts
  const lines = render.briefing.split('\n')

  const criterionRows = lines.filter((line) => CRITERION_ROW_PATTERN.test(line)).length
  const checkRows = lines.filter((line) => CHECK_ROW_PATTERN.test(line)).length
  const danglingRows = lines.filter((line) => line.startsWith('- dangling: ')).length
  const quarantinedRows = lines.filter((line) => line.startsWith('- quarantined: ')).length

```

**Edit C5.4** — FIND:

```ts
    bytes: resumePayloadBytes(thread.id, render.briefing),
    withinBudget: render.withinBudget,
    itemsHeld,
    itemsRendered
  }
}

```

REPLACE with:

```ts
    bytes: resumePayloadBytes(thread.id, render.briefing),
    withinBudget: render.withinBudget,
    itemsHeld,
    itemsRendered,
    criterionRows,
    checkRows
  }
}

```

**Edit C5.5** — FIND:

```ts
  withinBudget: boolean | null
  itemsHeld: number | null
  itemsRendered: number | null
}

const classifiedOutcomes: ReadonlySet<string> = new Set(OUTCOME_CLASSES)
```

REPLACE with:

```ts
  withinBudget: boolean | null
  itemsHeld: number | null
  itemsRendered: number | null
  criterionRows: number | null
  checkRows: number | null
}

const classifiedOutcomes: ReadonlySet<string> = new Set(OUTCOME_CLASSES)
```

**Edit C5.6** — FIND:

```ts
            bytes: measured === null ? null : measured.bytes,
            withinBudget: measured === null ? null : measured.withinBudget,
            itemsHeld: measured === null ? null : measured.itemsHeld,
            itemsRendered: measured === null ? null : measured.itemsRendered
          })

          const withinRecordCap = (shape: SweepShape): boolean =>
```

REPLACE with:

```ts
            bytes: measured === null ? null : measured.bytes,
            withinBudget: measured === null ? null : measured.withinBudget,
            itemsHeld: measured === null ? null : measured.itemsHeld,
            itemsRendered: measured === null ? null : measured.itemsRendered,
            criterionRows: measured === null ? null : measured.criterionRows,
            checkRows: measured === null ? null : measured.checkRows
          })

          const withinRecordCap = (shape: SweepShape): boolean =>
```

**Edit C5.7** — FIND:

```ts
    ].join('\n')
  )

  const claimingToFit = breaching.filter((record) => record.withinBudget === true)
  assert.equal(
    claimingToFit.length,
```

REPLACE with:

```ts
    ].join('\n')
  )

  const missingACheckLine = admissible.filter((record) => record.criterionRows !== record.checkRows)
  assert.equal(
    missingACheckLine.length,
    0,
    [
      `${missingACheckLine.length} of ${admissible.length} swept records rendered a criterion without its check line`,
      ...missingACheckLine.slice(0, 5).map((record) => `missing: ${record.checkRows} checks for ${record.criterionRows} criteria — ${describe(record)}`)
    ].join('\n')
  )

  const claimingToFit = breaching.filter((record) => record.withinBudget === true)
  assert.equal(
    claimingToFit.length,
```


Rationale: `B24` says a criterion renders its check on every render. Asserting that once proves it for
one fixture; asserting it across all 733 swept records proves it for every shape the schema admits, at
no extra render cost, because the sweep already renders each one.

#### Step C6 — update the assertion that pins the key-decision line


File: `test/spawn/decisions.test.ts`. 1 edit, applied in this order.

**Edit C6.1** — FIND:

```ts
    const decisionsAt = lines.indexOf('**Decisions:**')
    assert.notEqual(keyDecisionsAt, -1, 'the briefing must carry a Key decisions section')
    assert.notEqual(decisionsAt, -1, 'the briefing must carry a Decisions section')
    assert.equal(
      lines[keyDecisionsAt + 1],
      '- link decisions into the spine automatically',
      'the Key decisions section must carry the decision title with no intervening update_thread call'
    )
    assert.equal(
      briefing.includes(DECISION_OUTCOME_SENTINEL),
```

REPLACE with:

```ts
    const decisionsAt = lines.indexOf('**Decisions:**')
    assert.notEqual(keyDecisionsAt, -1, 'the briefing must carry a Key decisions section')
    assert.notEqual(decisionsAt, -1, 'the briefing must carry a Decisions section')
    const keyDecisionLine = lines[keyDecisionsAt + 1]
    assert.ok(
      keyDecisionLine !== undefined && keyDecisionLine.startsWith('- link decisions into the spine automatically (decision '),
      `the Key decisions section must carry the decision title with no intervening update_thread call, got: ${String(keyDecisionLine)}`
    )
    assert.ok(
      keyDecisionLine !== undefined && /\(decision [0-9A-HJKMNP-TV-Z]{26}\)$/.test(keyDecisionLine),
      `the Key decisions section must carry the decision id beside the title, got: ${String(keyDecisionLine)}`
    )
    assert.equal(
      briefing.includes(DECISION_OUTCOME_SENTINEL),
```


Rationale: this end-to-end test pinned the key-decision line as a bare title. `B21` adds the decision
identifier, so the assertion is widened to the title prefix and strengthened with a second assertion
that the identifier is present and is a well-formed 26-character identifier. That is not a weakening:
it asserts strictly more than before.

---

## 5. Tests

### 5.1 `test/unit/briefing.test.ts` — modified

The complete list of tests after step A3, C3 and their intermediate edits, with the acceptance
criterion each discharges. Every test body is given in full in section 4 as the REPLACE half of the
edit that produces it.

| Test | Discharges | Part |
| --- | --- | --- |
| `briefing.blocked-renders-its-reason` | unchanged | — |
| `briefing.blockage-none-when-not-blocked` | unchanged | — |
| `briefing.renders-exact-output-for-a-full-thread` | 4, 5, 11, 12, 13 — the whole rendered text, byte for byte | A, C |
| `briefing.omits-empty-list-sections-entirely` | 4, 5 — the focus line always renders; the settled and artifacts headings render only when they have entries | A, C |
| `briefing.pointer-status-is-no-for-a-different-thread` | unchanged | — |
| `briefing.criterion-status-is-open-when-undone-and-unstruck` | unchanged | — |
| `briefing.renders-dangling-and-quarantined-decisions-in-order` | unchanged | — |
| `briefing.escapes-every-free-text-field` | unchanged | — |
| `briefing.with-no-focus-declared-every-live-risk-renders-in-the-order-it-was-recorded` | 4 | A |
| `briefing.every-out-of-scope-item-renders-and-none-is-counted-away` | 1, 6 | A |
| `briefing.every-dangling-and-quarantined-decision-id-renders-and-the-tail-counts-the-records-it-could-not-read` | 1, 6 | A |
| `briefing.a-risk-on-a-met-goal-renders-last-and-compact-under-the-settled-heading` | 3, 5 | A |
| `briefing.a-criterion-beyond-the-forty-that-the-deleted-cap-once-showed-renders-with-its-settled-risk` | 1, 5 | A |
| `briefing.a-risk-naming-a-criterion-that-no-longer-resolves-is-treated-as-unanchored` | unchanged | — |
| `briefing.every-unanchored-risk-renders-and-none-is-counted-away` | 1, 3 | A |
| `briefing.omits-the-not-shown-tail-when-nothing-was-cut` | unchanged | — |
| `briefing.every-completion-criterion-renders-and-none-is-counted-away` | 1 | A |
| `briefing.renders-every-item-of-a-record-byte-maximal-thread-and-reports-the-budget-breach` | 1, 6, 13 | A, C |
| `briefing.an-ordinary-small-thread-renders-in-a-single-pass` | 2 — the search still converges in one pass on an ordinary thread | — |
| `briefing.the-clip-search-converges-within-the-pass-ceiling` | 2 — the search range is unchanged, so its 11-pass bound still holds | — |
| `briefing.the-clip-search-lands-just-under-the-resume-payload-cap-on-the-worst-reachable-ascii-record` | 2, 9 | A, B |
| `briefing.within-budget-is-true-on-an-ordinary-thread-and-false-when-the-render-breaches-a-cap` | unchanged | — |

### 5.2 `test/unit/briefing-hides-nothing.test.ts` — new

Created whole in step A5, extended in steps B7 and C4. Every body appears in section 4.

| Test | Discharges | Part |
| --- | --- | --- |
| `briefing.no-display-time-item-cap-remains-in-the-briefing-renderer` | 1 | A |
| `briefing.no-display-time-item-cap-remains-in-the-briefing-renderer.control.a-slice-that-keeps-its-elements-is-forbidden` | 1 — proves the census halts rather than passing vacuously | A |
| `briefing.criterion-ordinal-is-read-only-to-render-a-display-label` | 7 (`S3`), partly — population tree-wide, assertion over `src/render`, residue printed; section 3.5 | A |
| `briefing.criterion-ordinal-is-read-only-to-render-a-display-label.control.a-read-outside-a-label-is-forbidden` | 7 — proves the census halts on a position comparison and on an unclassifiable read | A |
| `briefing.a-render-that-fits-its-budget-is-clipped-nowhere` | 8 (`O1`) | B |
| `briefing.every-shortened-value-carries-the-marker-inside-its-own-limit` | 9 (`O3`), 6 | B |
| `briefing.artifacts-render-before-the-spine` | 12 | C |
| `briefing.a-criterion-marked-done-renders-its-result-and-the-status-of-that-result` | 13 | C |
| `briefing.a-criterion-with-no-check-or-result-renders-not-recorded-never-blank` | 13 | C |

### 5.3 `test/unit/clip.test.ts` — new

Created whole in step B5.

| Test | Discharges | Part |
| --- | --- | --- |
| `clip.a-value-that-fits-its-limit-is-returned-unchanged-and-unmarked` | 9, 10 | B |
| `clip.an-infinite-limit-never-shortens-and-never-marks` | 8, 10 | B |
| `clip.a-shortened-value-never-exceeds-its-own-limit-and-carries-the-marker-inside-it` | 9, 10 | B |
| `clip.a-limit-smaller-than-the-marker-yields-only-as-much-of-the-marker-as-fits` | 9, 10 | B |
| `clip.the-marker-is-one-grapheme-per-code-unit` | 9 | B |

### 5.4 `test/unit/briefing-frontier-sweep.test.ts` — modified

One test, renamed. Its population, its grid, its halting census over outcome classes and its
diagnostics are unchanged; three assertions replace one.

| Test | Discharges | Part |
| --- | --- | --- |
| `briefing.frontier-sweep-finds-no-record-that-loses-an-item-or-hides-a-budget-breach` | 1, 3, 5, 6 across 733 records; 13 across the same population | A, C |

### 5.5 `test/contract/render-census.test.ts` — modified

Two tests, both unchanged in name and in what they assert. The resolver they share is taught one new
module and one new function name (step B4), which is what keeps criterion 10 from halting the census.

### 5.6 `test/spawn/decisions.test.ts` — modified

One assertion inside `decision.outcome-body-is-absent-from-both-briefing-surfaces` is widened and
strengthened (step C6). Criterion 11 end to end, through a spawned server.

### 5.7 Every acceptance criterion and every assigned invariant has a named test

| Criterion | Invariant | Test that discharges it |
| --- | --- | --- |
| 1 | — | `briefing.no-display-time-item-cap-remains-in-the-briefing-renderer`, plus the four `every-...-renders-and-none-is-counted-away` tests |
| 2 | — | `briefing.an-ordinary-small-thread-renders-in-a-single-pass`, `briefing.the-clip-search-converges-within-the-pass-ceiling` |
| 3 | — | `briefing.frontier-sweep-finds-no-record-that-loses-an-item-or-hides-a-budget-breach` |
| 4 | — | `briefing.with-no-focus-declared-every-live-risk-renders-in-the-order-it-was-recorded` |
| 5 | — | `briefing.a-risk-on-a-met-goal-renders-last-and-compact-under-the-settled-heading` |
| 6 | `O2` | `briefing.every-dangling-and-quarantined-decision-id-renders-and-the-tail-counts-the-records-it-could-not-read`, `briefing.frontier-sweep-finds-no-record-that-loses-an-item-or-hides-a-budget-breach` |
| 7 | `S3` | `briefing.criterion-ordinal-is-read-only-to-render-a-display-label` and its control |
| 8 | `O1` | `briefing.a-render-that-fits-its-budget-is-clipped-nowhere` |
| 9 | `O3` | `briefing.every-shortened-value-carries-the-marker-inside-its-own-limit`, `clip.a-shortened-value-never-exceeds-its-own-limit-and-carries-the-marker-inside-it` |
| 10 | — | `render.no-unescaped-site`, `clip.the-marker-is-one-grapheme-per-code-unit` |
| 11 | — | `briefing.renders-exact-output-for-a-full-thread`, `decision.outcome-body-is-absent-from-both-briefing-surfaces` |
| 12 | — | `briefing.renders-exact-output-for-a-full-thread`, `briefing.artifacts-render-before-the-spine` |
| 13 | — | `briefing.a-criterion-marked-done-renders-its-result-and-the-status-of-that-result`, `briefing.a-criterion-with-no-check-or-result-renders-not-recorded-never-blank`, and the check-line census across all 733 swept records |

---

## 6. Red on the parent

"The parent" means the commit the part's branch was cut from. Part A is cut from the tip of `main`
after the schema unit has merged. Part B is cut from the tip of `main` after part A has merged. Part C
is cut from the tip of `main` after part B has merged. Each command below is run at that tip with the
part's test files already written and its production change **not** applied.

The messages quoted are the ones observed when these tests were run against the corresponding parent
tree during planning. Node version `v26.4.0`.

### 6.1 Part A

```
node --test --experimental-strip-types test/unit/briefing.test.ts
```

Expect a non-zero exit and these ten failures:

```
✖ briefing.renders-exact-output-for-a-full-thread
✖ briefing.omits-empty-list-sections-entirely
✖ briefing.with-no-focus-declared-every-live-risk-renders-in-the-order-it-was-recorded
✖ briefing.every-out-of-scope-item-renders-and-none-is-counted-away
✖ briefing.every-dangling-and-quarantined-decision-id-renders-and-the-tail-counts-the-records-it-could-not-read
✖ briefing.a-risk-on-a-met-goal-renders-last-and-compact-under-the-settled-heading
✖ briefing.a-criterion-beyond-the-forty-that-the-deleted-cap-once-showed-renders-with-its-settled-risk
✖ briefing.every-unanchored-risk-renders-and-none-is-counted-away
✖ briefing.every-completion-criterion-renders-and-none-is-counted-away
✖ briefing.renders-every-item-of-a-record-byte-maximal-thread-and-reports-the-budget-breach
```

Three of the assertion messages, verbatim:

```
AssertionError [ERR_ASSERTION]: every retained criterion must render; the display cap that showed only forty is deleted

40 !== 200
```

```
AssertionError [ERR_ASSERTION]: every dangling decision id must render; the display-time cap that withheld them is deleted

6 !== 8
```

```
AssertionError [ERR_ASSERTION]: a risk on a met goal must bring the settled heading with it
```

Then:

```
node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts
```

Expect a non-zero exit and one failure:

```
✖ briefing.no-display-time-item-cap-remains-in-the-briefing-renderer
  AssertionError [ERR_ASSERTION]: Got unwanted exception: every slice in the briefing renderer must
  discard the elements it selects, which is the heading idiom; a slice that keeps them is a
  display-time item cap:
  src/render/briefing.ts:130 laneA.slice(0, capA)
  src/render/briefing.ts:131 laneB.slice(0, capB)
  src/render/briefing.ts:136 items.slice(0, cap)
```

**`briefing.criterion-ordinal-is-read-only-to-render-a-display-label` passes at the parent, and that
is expected and stated rather than hidden.** Its population is every read of `Criterion.ordinal` in the
tree and it prints all ten with their classification, but the reads it asserts over — those under
`src/render` — are already display labels before this change. The census is a standing guard against
the property being lost, not a receipt for restoring it, so its red cannot be reached at the parent.
Section 3.5 records the three reads it prints but does not assert, and why neither file is this unit's
to change. Its control test proves it halts on a violation rather than passing vacuously,
and its inertness mutation in section 7.7 turns it red on demand.

**Criterion 7 therefore ships under the honesty-ladder status `unverified-reasoned`, for two specific
reasons.** First, the property the census asserts is already true at the parent, so no run at the
parent can produce a red for it, and manufacturing one would mean introducing the violation first.
Second, `S3` is not fully discharged when this unit lands: three of the ten reads the census finds are
position comparisons, in `src/server/tools/record_decision.ts` and `src/domain/criterion-backfill.ts`,
and neither file belongs to this unit — the first is removed by a later unit in this ladder, and the
second has a caller in `scripts/backfill-criterion-id.mjs` so it cannot simply be removed. No proxy
assertion is substituted, no population is narrowed, and every read is printed in the test's own
output. Section 3.5 carries the full table.

### 6.2 Part B

`test/unit/clip.test.ts` and the two new tests in `test/unit/briefing-hides-nothing.test.ts` import
`src/render/clip.ts`, which does not exist at part B's parent. Running them there gives, before any
assertion is reached:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '<repo>/src/render/clip.ts' imported from
<repo>/test/unit/briefing-hides-nothing.test.ts
```

**Substitute procedure.** Apply step B2 alone — create `src/render/clip.ts` and nothing else — and
leave `src/render/briefing.ts` exactly as part A left it. Then run:

```
node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts
```

Expect a non-zero exit and exactly these two failures:

```
✖ briefing.a-render-that-fits-its-budget-is-clipped-nowhere
  AssertionError [ERR_ASSERTION]: a briefing that fits its budget must render the whole criterion
  text, however far the escape expands it

✖ briefing.every-shortened-value-carries-the-marker-inside-its-own-limit
  AssertionError [ERR_ASSERTION]: the clip search must have shortened at least one value
```

The first is `O1` red: the parent's first render attempt shortens a criterion whose escaped text
exceeds 500 characters, on a briefing that had room for all of it. The second is `O3` red: the parent
shortens values without marking any of them, so the test finds no marked line to check.

`test/unit/clip.test.ts` passes under the substitute, because step B2 is the module those tests are
about. That is stated rather than presented as a receipt.

### 6.3 Part C

```
node --test --experimental-strip-types test/unit/briefing.test.ts test/unit/briefing-hides-nothing.test.ts
```

Expect a non-zero exit and these five failures:

```
✖ briefing.renders-exact-output-for-a-full-thread
✖ briefing.renders-every-item-of-a-record-byte-maximal-thread-and-reports-the-budget-breach
✖ briefing.artifacts-render-before-the-spine
✖ briefing.a-criterion-marked-done-renders-its-result-and-the-status-of-that-result
✖ briefing.a-criterion-with-no-check-or-result-renders-not-recorded-never-blank
```

One assertion message, verbatim:

```
AssertionError [ERR_ASSERTION]: a thread carrying artifacts must render an artifacts section
```

Then:

```
node --test --experimental-strip-types test/unit/briefing-frontier-sweep.test.ts
```

Expect a non-zero exit and:

```
✖ briefing.frontier-sweep-finds-no-record-that-loses-an-item-or-hides-a-budget-breach
  AssertionError [ERR_ASSERTION]: 601 of 689 swept records rendered a criterion without its check line
```

The two counts in that message are diagnostics of the fixture grid, not the assertion. What must match
is the sentence `swept records rendered a criterion without its check line` and a first count greater
than zero. Observed during planning: 601 of 689.

Then:

```
node --test --experimental-strip-types test/spawn/decisions.test.ts --test-name-pattern "outcome-body"
```

Expect a non-zero exit and:

```
✖ decision.outcome-body-is-absent-from-both-briefing-surfaces
```

---

## 7. Inertness mutation

One per acceptance criterion that carries a behavioural change. Each was applied to a copy of the
changed tree during planning and the named test was observed to turn red. Apply the mutation, run the
command, see the red, then restore the file exactly.

Restore in every case with: re-apply the whole-file REPLACE for `src/render/briefing.ts` from the
part's step (`A2`, `B3` or `C2`), or for `src/render/clip.ts` from step `B2`.

### 7.1 Criterion 1 and 3 — the caps are gone and the lanes never remove

In `src/render/briefing.ts`, FIND:

```ts
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
```

REPLACE with:

```ts
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live').slice(0, 4),
```

Run `node --test --experimental-strip-types test/unit/briefing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.every-unanchored-risk-renders-and-none-is-counted-away
```

### 7.2 Criterion 4 — the briefing says focus is not set

In `src/render/briefing.ts`, FIND the line `    FOCUS_NOT_SET_LINE,` and delete it.

Run `node --test --experimental-strip-types test/unit/briefing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.renders-exact-output-for-a-full-thread
✖ briefing.omits-empty-list-sections-entirely
✖ briefing.with-no-focus-declared-every-live-risk-renders-in-the-order-it-was-recorded
```

### 7.3 Criterion 5 — the settled group renders

In `src/render/briefing.ts`, FIND:

```ts
    ...settledLines.slice(0, 1).map(() => ''),
    ...settledLines.slice(0, 1).map(() => SETTLED_HEADING),
    ...settledLines,
```

and delete those three lines.

Run `node --test --experimental-strip-types test/unit/briefing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.renders-exact-output-for-a-full-thread
✖ briefing.a-risk-on-a-met-goal-renders-last-and-compact-under-the-settled-heading
✖ briefing.a-criterion-beyond-the-forty-that-the-deleted-cap-once-showed-renders-with-its-settled-risk
```

### 7.4 Criterion 6 — the `Not shown` block keeps its unreadable-record count

In `src/render/briefing.ts`, FIND:

```ts
    ...[unreadableDecisionCount]
      .filter((count) => count > 0)
      .map((count) => `- ${count} linked decision records could not be read; their ids are listed under Decisions above`),
```

and delete those three lines.

Run `node --test --experimental-strip-types test/unit/briefing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.every-dangling-and-quarantined-decision-id-renders-and-the-tail-counts-the-records-it-could-not-read
```

### 7.5 Criterion 8 — the first render attempt shortens nothing

In `src/render/briefing.ts`, inside `UNCLIPPED`, FIND:

```ts
  criterion: NO_CLIP,
  criterionCheck: NO_CLIP,
```

REPLACE with:

```ts
  criterion: CRITERION_TEXT_NATURAL_MAX,
  criterionCheck: NO_CLIP,
```

Run `node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.a-render-that-fits-its-budget-is-clipped-nowhere
  AssertionError [ERR_ASSERTION]: a briefing that fits its budget must carry no clip marker
```

### 7.6 Criteria 9 and 10 — the marker

In `src/render/clip.ts`, FIND:

```ts
  return `${clipGraphemes(text, budget)}${CLIP_MARKER}`
```

REPLACE with:

```ts
  return clipGraphemes(text, max)
```

Run `node --test --experimental-strip-types test/unit/clip.test.ts test/unit/briefing-hides-nothing.test.ts`.
Expect exit code 1 and this failure:

```
✖ clip.a-shortened-value-never-exceeds-its-own-limit-and-carries-the-marker-inside-it
✖ briefing.every-shortened-value-carries-the-marker-inside-its-own-limit
```

### 7.7 Criterion 7 — the ordinal census

In `src/render/briefing.ts`, FIND:

```ts
const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
```

REPLACE with:

```ts
const criterionStatus = (criterion: Criterion): string => {
  if (criterion.ordinal === 0) return 'open'
  if (criterion.struck_by !== null) return 'struck'
```

Run `node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.criterion-ordinal-is-read-only-to-render-a-display-label
  AssertionError [ERR_ASSERTION]: Got unwanted exception: every read of criterion.ordinal under
  src/render must render a display label; any other read infers sequence from position
```

### 7.8 Criterion 11 — the decision identifier

In `src/render/briefing.ts`, FIND:

```ts
  `- ${clip(keyDecision.title, textClip)} (decision ${escapeStored(keyDecision.decision_id)})`
```

REPLACE with:

```ts
  `- ${clip(keyDecision.title, textClip)}`
```

Run `node --test --experimental-strip-types test/unit/briefing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.renders-exact-output-for-a-full-thread
```

### 7.9 Criterion 12 — the artifacts section

In `src/render/briefing.ts`, FIND:

```ts
    ...artifactLines.slice(0, 1).map(() => ''),
    ...artifactLines.slice(0, 1).map(() => '**Artifacts:**'),
    ...artifactLines,
```

and delete those three lines.

Run `node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.artifacts-render-before-the-spine
```

### 7.10 Criterion 12 — the risk references

In `src/render/briefing.ts`, FIND:

```ts
    ...risk.refs.map((ref) => `  - ref: ${clip(ref, renderClip.riskRef)}`)
```

and delete that line.

Run `node --test --experimental-strip-types test/unit/briefing.test.ts`. Expect exit code 1 and this failure:

```
✖ briefing.renders-exact-output-for-a-full-thread
```

### 7.11 Criterion 13 — the check line

In `src/render/briefing.ts`, FIND:

```ts
    renderCheckLine(criterion, renderClip.criterionCheck),
```

and delete that line.

Run `node --test --experimental-strip-types test/unit/briefing-hides-nothing.test.ts test/unit/briefing.test.ts`.
Expect exit code 1 and this failure:

```
✖ briefing.a-criterion-marked-done-renders-its-result-and-the-status-of-that-result
✖ briefing.a-criterion-with-no-check-or-result-renders-not-recorded-never-blank
✖ briefing.renders-exact-output-for-a-full-thread
✖ briefing.renders-every-item-of-a-record-byte-maximal-thread-and-reports-the-budget-breach
```

---

## 8. Full verification

Run these in order, at the end of each part, from the repository root. Never run `npm ci` or
`npm install`: `node_modules` is tracked in this repository and an install rewrites tracked files.

| # | Command | Expected exit | Output that proves it |
| --- | --- | --- | --- |
| 1 | `npm run typecheck` | 0 | no output |
| 2 | `node scripts/check-packaging.mjs` | 0 | no output |
| 3 | `npm test` | 0 | `# fail 0` |

For command 3, and only for command 3, this rule applies:

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

That re-run governs the full-suite gate here only. It is never written into an acceptance criterion,
never into a receipt, and never into section 6. A receipt is decided by one run.

Additionally, at the end of part A and again at the end of part C, run the sweep alone and read its
diagnostics, because they are the measured evidence section 3.1 rests on:

```
node --test --experimental-strip-types test/unit/briefing-frontier-sweep.test.ts
```

Expect exit 0. Expect diagnostic lines of the form:

```
ℹ frontier sweep classified 733 records in <n>ms
ℹ class schema-inadmissible: 38
ℹ class admissible-within-both-caps: 468
ℹ class admissible-breaching-a-cap: 227
```

The three class counts are diagnostics, not assertions. Record whatever numbers the run prints in the
pull request body. A different split is information about the fixture grid, not a failure; the test's
assertions are that no record loses an entry, that every criterion carries a check line, and that no
record reports itself as fitting while exceeding a cap.

The sweep takes roughly 70 seconds on the machine this plan was written on. That is expected.

---

## 9. Commits

Refactor and behaviour change never share a commit. Each part's commits are listed in the order they
are made.

### Part A, on `feat/u5a-briefing-caps-go`

**Commit A-1**

```
chore(briefing): bump the plugin version for the display-cap removal
```

Files: `package.json`, `.claude-plugin/plugin.json`. Contains step A1.

**Commit A-2**

```
feat(briefing): render every item the thread holds
```

Files: `src/render/briefing.ts`. Contains step A2.

**Commit A-3**

```
test(briefing): assert every item renders instead of asserting the caps
```

Files: `test/unit/briefing.test.ts`, `test/unit/briefing-frontier-sweep.test.ts`,
`test/unit/briefing-hides-nothing.test.ts`. Contains steps A3, A4 and A5.

### Part B, on `feat/u5b-clip-marker`

**Commit B-1**

```
chore(briefing): bump the plugin version for the clip marker
```

Files: `package.json`, `.claude-plugin/plugin.json`. Contains step B1.

**Commit B-2**

```
feat(briefing): say so whenever a value is shortened to fit
```

Files: `src/render/clip.ts`, `src/render/briefing.ts`. Contains steps B2 and B3.

**Commit B-3**

```
test(briefing): assert a fitting briefing is shortened nowhere and a shortened value says so
```

Files: `test/contract/render-census.test.ts`, `test/unit/clip.test.ts`,
`test/unit/briefing.test.ts`, `test/unit/briefing-hides-nothing.test.ts`. Contains steps B4 to B7.

### Part C, on `feat/u5c-item-detail`

**Commit C-1**

```
chore(briefing): bump the plugin version for the item detail
```

Files: `package.json`, `.claude-plugin/plugin.json`. Contains step C1.

**Commit C-2**

```
feat(briefing): render decision ids, risk references, artifacts and criterion checks
```

Files: `src/render/briefing.ts`. Contains step C2.

**Commit C-3**

```
test(briefing): assert the new item detail renders on every surface that carries it
```

Files: `test/unit/briefing.test.ts`, `test/unit/briefing-hides-nothing.test.ts`,
`test/unit/briefing-frontier-sweep.test.ts`, `test/spawn/decisions.test.ts`. Contains steps C3 to C6.

---

## 10. Pull request

### 10.1 The split, decided here and measured

The diff each part authors was measured by applying that part's own steps to a throwaway copy of the
tree and diffing it, never estimated.

| Part | Production | Test | Total |
| --- | --- | --- | --- |
| A | 177 | 585 | **762** |
| B | 95 | 215 | **310** |
| C | 91 | 111 | **202** |
| Whole unit, unsplit | 363 | 911 | **1274** |

**Ruled: split into three.** 1274 changed lines is 3.2 times the 400-line ceiling. Parts B and C sit
under the ceiling. Part A does not, and the exception is claimed and shown rather than asserted:

- Part A's receipt is that no swept record renders fewer entries than it holds. That is red until the
  four lane caps, the three list caps and the settled group all land, because each one alone still
  leaves entries unrendered.
- Shipping the cap deletion without the settled group leaves entries on a met or struck goal withheld
  and the receipt permanently red.
- Shipping the settled group without the cap deletion leaves the four per-list count lines live and
  the receipt permanently red.
- Deleting the guess of which goal is being worked without deleting the caps is not expressible: the
  two lane caps are per-lane, and removing the lane leaves them with nothing to bound.
- Reducing the `Not shown` block without deleting the caps deletes count lines that are still needed.

So every smaller cut of part A leaves a permanent red, which is what the ceiling's exception is for.
Part A's pull request body states its size and names that reason, so a reviewer learns it from the
pull request rather than from the Files Changed tab. Its composition is 177 production lines against
585 test lines.

**Rejected:** four or more parts. The only further cut inside part A is the one shown above to destroy
the receipt. **Rejected:** one pull request for the whole unit, on the grounds that it is all one
function. Parts B and C each have their own red at their own parent, so no receipt is destroyed by
separating them, and the ceiling therefore binds.

**Why the three parts share one document rather than one document each.** All three edit overlapping
regions of a single 300-line function in `src/render/briefing.ts`, and all three read from the same
ground truth in section 2. Three separate documents would carry three copies of that ground truth and
of the acceptance list, and three copies drift. Each part instead gets its own version step, its own
ordered step list, its own red on the parent with the exact expected failure text, its own inertness
mutations, its own verification, its own `pr-create` invocation and its own ordering stop condition,
and nothing in any of them says "see the block for the other one". One implementer executes all three
in sequence on one unit's surface.

### 10.2 Part A

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u5a-briefing-caps-go --base main \
  --title "feat(briefing): render every item the thread holds" \
  --what "The briefing now prints every risk, key decision, out-of-scope statement, completion criterion and unreadable decision id the thread holds." \
  --what "Items on a goal that is already met or struck print last, compactly, under a heading naming them settled, instead of not printing at all." \
  --what "The briefing states that no focus is set, and orders items by the order they were recorded rather than by a guess at which goal is being worked." \
  --why "Seven counters in the renderer filtered lists a person had already curated, and a second rule hid every item attached to a finished goal at every size." \
  --why "Nothing recorded which goal was being worked, so the renderer guessed it as the first unfinished one, which is wrong for anyone who does not work top to bottom." \
  --risk "A thread near the largest size the store accepts now prints past the reply size limit. The renderer reports that it does not fit and the server logs it; nothing is hidden to make it fit." \
  --verified "npm run typecheck - exit 0" \
  --verified "npm test - fail 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "frontier sweep over 733 generated threads - no thread printed fewer items than it holds" \
  --not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run" \
  --not-verified "npm run mutate - not run" \
  --not-verified "diff size against the 400-line review target - 762 lines, not divisible without leaving a test permanently red"
```

The `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line belongs
in the invocation only when the full-suite gate above actually used its one permitted re-run. A run
that passed on its first attempt omits that line entirely. Never write a `--verified` line for a check
that was not run.

### 10.3 Part B

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u5b-clip-marker --base main \
  --title "feat(briefing): say so whenever a value is shortened to fit" \
  --what "Any value the briefing shortens to fit its size limit now ends with a visible marker, so a reader can tell what they are seeing is not the whole thing." \
  --what "A briefing that fits its size limit is now printed with nothing shortened at all, including text that grows several times over when special characters are made safe to display." \
  --what "The address that retrieves the full record is no longer shortened, so it always resolves." \
  --why "The briefing shortened text silently. One line at the end said some text somewhere had been shortened, without saying which, and a reader had no way to tell a shortened value from a complete one." \
  --why "The first attempt at printing already shortened long values before checking whether it needed to, so briefings that had room for everything lost text anyway." \
  --verified "npm run typecheck - exit 0" \
  --verified "npm test - fail 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run" \
  --not-verified "npm run mutate - not run"
```

### 10.4 Part C

```
node ~/.claude/lib/git/pr.mjs pr-create \
  --repo SatanshuMishra/logbook --head feat/u5c-item-detail --base main \
  --title "feat(briefing): render decision ids, risk references and criterion checks" \
  --what "A key decision now prints the identifier of the decision record it links to, so a reader can open that record without guessing an address." \
  --what "A risk prints the external references recorded against it, and a thread prints the artifacts it produced, above its running summary." \
  --what "A completion criterion prints how it is checked, and prints what was observed and whether that observation was verified once it is marked done. An unrecorded value prints as not recorded rather than as a blank." \
  --why "Three recorded fields reached no reader: a key decision's identifier was dropped though it sat in the same object, a risk's references were stored and printed nowhere, and a thread had nowhere to put the files it produced." \
  --why "A finished goal said nothing about how anyone knew it was finished." \
  --verified "npm run typecheck - exit 0" \
  --verified "npm test - fail 0" \
  --verified "node scripts/check-packaging.mjs - exit 0" \
  --verified "check line census over 733 generated threads - every criterion printed one" \
  --not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run" \
  --not-verified "npm run mutate - not run"
```

### 10.5 Rules that bind every one of the three

Each of the three invocations above is expected to exit 0 and to print the URL of the pull request it
opened. A non-zero exit means the tool rejected a field value: read the rejection, correct that one
value, and run it again. Never route around a rejection with `gh`.

- Pull requests are opened only by `node ~/.claude/lib/git/pr.mjs pr-create`. Ad-hoc `gh pr create`,
  `gh api` posts to the pulls endpoint and the GitHub tool's create call are denied at the gate.
- Every value is passed as one ordinary argument. Never a file path, never an `@`-prefixed value,
  never a shell redirection.
- A title and body are fixed at creation. Never run `gh pr edit`.
- Merging is not part of this plan.

---

## 11. Stop conditions

Each is a specific divergence that invalidates this plan. For each: what you see, the command that
shows it, and what to do.

### 11.1 The write-time size limit is not where this plan expects it

The thread criterion `01M135QS1C1FRG2JV7DFCK2TKH` requires the write-time limit that replaces the
removed display caps to have been sized against the largest existing thread record **before** any
display cap is deleted. That sizing belongs to the schema unit, which measured the largest live thread
record at 39079 bytes and left the limit at 65536, giving 1.68 times headroom. This plan does not
re-measure it and does not re-size it.

Before step A2, run:

```
node -p "require('fs').readFileSync('src/schema/caps.ts','utf8').match(/THREAD_RECORD_SERIALISED_MAX_BYTES = \d+/)[0]"
```

Expect exit code 0 and the output `THREAD_RECORD_SERIALISED_MAX_BYTES = 65536`. On any other output,
or on any non-zero exit, **STOP and report; do not improvise.** The bound this plan's measurements were taken against is not the bound in the tree, and
every number in section 3.1 is against the wrong limit.

Nothing in this plan hides an item at display time to keep any budget. That is the defect the unit
exists to remove, and a plan step that appears to do it is a defect in the plan.

### 11.2 The schema unit's third part has not landed

Before step A2, run:

```
node -e "const t=require('fs').readFileSync('src/schema/thread.ts','utf8');const need=['check?: string | null | undefined','result_status?: ResultStatus | null | undefined','artifacts?: Artifact[] | undefined'];const missing=need.filter(n=>!t.includes(n));console.log(missing.length===0?'present':'missing: '+missing.join(' | '))"
```

Expect exit code 0 and the output `present`. On any other output, or on any non-zero exit, **STOP and
report; do not improvise.** Part C reads all three
of those fields, and part A's whole-file replacement of the renderer is authored against a
`Criterion` and a `Thread` that carry them.

### 11.3 The two version manifests disagree with each other

Before any version step, run:

```
node -e "const a=require('./package.json').version,b=require('./.claude-plugin/plugin.json').version;console.log(a===b?'match '+a:'MISMATCH '+a+' vs '+b)"
```

Expect exit code 0 and an output beginning `match `. An output beginning `MISMATCH`, or any non-zero
exit, is the stop: **STOP and report; do not improvise.**

A version merely **higher** than the `2.0.0` baseline named in section 0 is not a stop condition. It
means the ladder moved ahead of this plan, and the read-then-increment in steps A1, B1 and C1 already
handles it.

### 11.4 A part's parent does not contain the part before it

Part B is cut from a `main` that already contains part A. Part C is cut from a `main` that already
contains part B. Before starting part B, run:

```
node -p "require('fs').readFileSync('src/render/briefing.ts','utf8').includes('SETTLED_HEADING') ? 'part A present' : 'part A ABSENT'"
```

Expect exit code 0 and the output `part A present`. On the output `part A ABSENT`, or on any non-zero
exit, **STOP and report; do not improvise.**

Before starting part C, run:

```
node -p "require('fs').existsSync('src/render/clip.ts') ? 'part B present' : 'part B ABSENT'"
```

Expect exit code 0 and the output `part B present`. On the output `part B ABSENT`, or on any non-zero
exit, **STOP and report; do not improvise.**

### 11.5 A FIND string does not match

Every FIND block in section 4 was copied from the real file and checked to occur exactly once. If a
FIND does not match, or matches more than once, the tree is not the tree this plan was authored
against. **STOP and report; do not improvise.** Do not adjust the FIND string, and do not apply the
REPLACE at a different site.

### 11.6 The suite is red for anything other than the one tracked failure

    Run: npm test
    If the ONLY failing test is `concurrent.distinct-ids` in `test/spawn/decisions.test.ts`,
    that is the tracked store-materialisation defect, not this change. Re-run `npm test` once.
    If it passes on the re-run, proceed, and record in the pull request body a
    `--not-verified "concurrent.distinct-ids - known tracked failure, passed on re-run"` line.
    If it fails twice, or if ANY other test fails, STOP and report; do not improvise,
    and do not edit, skip, focus or delete any test.

### 11.7 The render census halts

If `render.no-unescaped-site` fails after any step, the census could not prove that some interpolated
value reaches the model escaped. **STOP and report; do not improvise.** Do not add a file to, or
remove a file from, `CENSUSED_FILES`, and do not widen the classifier beyond the single change step B4
specifies. The census halting is the census working.

### 11.8 A test would have to be weakened to go green

If any step here leads you toward deleting a test, marking it skipped, marking it focused, lowering a
numeric assertion, or narrowing a census population to reach a green, **STOP and report; do not
improvise.** Section 3.1 already records the one place where a shipped assertion stops being true and
what replaces it; anything beyond that is outside this plan.
