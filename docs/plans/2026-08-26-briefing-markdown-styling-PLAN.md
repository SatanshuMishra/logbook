# PLAN: the resumption briefing is styled, and its criteria list is bounded

Status: APPROVED. Parent commit `1e04924`, suite green 421/421.
Ladder: two units, `A1` and `A2`, shipped in that order. `A2` depends on `A1`'s headroom.

## 0. What is wrong

`resume_thread` returns finished text the assistant echoes verbatim. That text carries no markdown, so
every consecutive line collapses into one paragraph when the harness renders it as GitHub-flavoured
markdown. The reader gets a wall.

Styling it is blocked by arithmetic, not by the verbatim-echo hook. Measured on the parent:

| Render | chars (cap 12000) | payload bytes (cap 24000) |
|---|---:|---:|
| parent | 11,549 | 23,728 |
| naive markdown restyle, uncapped criteria | 12,049 | 24,740 |

The briefing is emitted twice per reply, at `src/server/tools/resume_thread.ts:89` and `:92`, so a
character costs two payload bytes. A closed formula reproduced all four measured points exactly:

```
payload bytes = 2 x chars + 2 x newlines + 140
```

The payload cap binds before the character cap: 451 chars of character headroom is only 272 bytes,
which is 136 ordinary characters.

## 1. The governing rule

**Styling cost is O(1) in the number of records, never O(n).** The naive restyle's 500-char cost splits
into 180 chars of fixed styling and 320 chars of per-row prefixes across 160 surplus criterion rows.
That 320 is the O(n) term and it is the whole defect.

## 2. A1 — the completion-criteria list is bounded

Criteria are the only list the renderer never caps. Risks, key decisions, out-of-scope items and
dangling or quarantined decision ids all carry a cap and a `Not shown:` bullet.

### The cap value

`CRITERIA_SHOWN_MAX = 40`, derived from `caps.CRITERIA_MAX_ELEMENTS = 40` at `src/schema/caps.ts:12`,
enforced against un-struck criteria at `src/domain/criteria.ts:126-134` and applied to the initial list
at `src/server/tools/open_thread.ts:32`. Retention allows 200 (`caps.ts:13`), but every criterion beyond
40 can only be struck. A cap of 40 that ranks un-struck first therefore shows every open and every done
criterion on any thread reachable through the tools.

The budget ceiling was measured separately at 63 rows. 40 is chosen over 63 because the surplus can only
ever be retired work, and because a cap derived from the domain invariant never needs re-deriving when
criterion text grows.

### The selection rule

Rank `open` 0, `done` 1, `struck` 2. Tie-break on original array index, which equals ordinal order via
`recomputeOrdinals` at `src/domain/criteria.ts:111-112`. Select the lowest-ranked 40, then render them in
original ordinal order so the reader sees ascending `c1, c3, c7` with gaps where retired items dropped.

`currentCriterionId` needs no special case: it is defined at `src/render/briefing.ts:67-70` as the first
un-struck, not-done criterion, so it is already rank 0's lowest index.

Overflow bullet, one line, deliberately plain: `- N completion criteria not shown`. A wording such as
"settled criteria" would be false on a hand-written or synced record carrying 200 open criteria, which
the schema admits even though the tools refuse to create it.

### What must NOT move

| Component | Rule |
|---|---|
| `currentCriterionId` (`:67-70`) | computed over the FULL array |
| `criteriaById` map (`:216`) | built over the FULL array |
| `laneFor` / `laneSplit` (`:72-98`) | unchanged |
| `capList` (`:100-103`) | unchanged, and NOT reused for criteria |

The `criteriaById` map is the trap. A risk anchored to a hidden done criterion must still resolve to
lane C and collapse. Build the map from the shown subset and it falls through `laneFor`'s
`if (criterion === undefined) return 'B'` at `:78` and renders in full, inverting the assertion at
`test/unit/briefing.test.ts:324`.

### What must move

`clippablePoolCount` (`:119`) and `clippablePoolNaturalTextLen` (`:127`) currently read
`thread.completion_criteria.length`. Left alone they divide the clip budget across 200 items while 40
render, over-clipping text roughly fivefold. No existing test catches this.

### A1 acceptance criteria (the ceiling)

1. A test named `briefing.completion-criteria-are-capped-and-open-ones-survive` exists, is RED on parent
   `1e04924` and GREEN on the fix. Fixture: 199 struck criteria at ordinals 1-199 and one open criterion
   at ordinal 200. It asserts exactly 40 criterion rows, that the ordinal-200 open criterion's id is
   present, and that the tail carries `- 160 completion criteria not shown`.
2. Two inertness mutations each turn that test RED, verified by running them and then reverting:
   removing the cap, and replacing the ranked cap with a plain `slice(0, 40)`.
3. `test/unit/briefing.test.ts:324` still passes, verified by running it, proving `criteriaById` was not
   narrowed to the shown subset.
4. `decisionRecordSizedThread` (`test/unit/briefing.test.ts:417-453`) is made genuinely maximal:
   criterion text at the 500 cap, `key_decisions` populated to its 200 cap, `slug` at its 64 cap. The
   fixture is currently not maximal and hides the true parent margin of 138 payload bytes.
5. `npm run typecheck` exits 0 and `npm test` exits 0 with at least 421 passing.

## 3. A2 — the briefing is styled as markdown

Applied only after A1's headroom exists. Measured at cap 40: 10,572 chars and 21,466 bytes, leaving
1,428 chars and 2,534 bytes.

### The token set

| Line family | Before | After |
|---|---|---|
| header, 7 lines | `Thread: v` | `- **Thread:** v` |
| section labels, 7 | `Open risks:` | `**Open risks:**` |
| before each label | none | one blank line |
| criterion row | `c1 [open] id: t` | `- c1 [open] id: t` |
| decisions rows | `resolved: N` | `- resolved: N` |
| not-shown tail | `See addr ...` | `- See addr ...` |
| risk, key-decision, out-of-scope, related rows | already `- ` | unchanged |

Criterion and decision rows must become bullets for the same reason the header must: consecutive
non-blank lines are one paragraph in CommonMark, so 40 plain `c1 ...` lines under a bold label
reproduce the wall this unit removes.

No `#` is emitted anywhere. Bold labels do not match `forgery.test.ts:48`'s
`STRUCTURAL_MARKER_AT_LINE_START` because that pattern requires whitespace or end-of-line after the
marker and `**Open` has `*` in that position. Both facts were confirmed by running those regexes against
every new line shape.

### A2 acceptance criteria (the ceiling)

1. A test named `briefing.styling-cost-is-a-function-of-sections-not-of-record-count` exists, is RED on
   the A1 head and GREEN on the fix. It renders two threads identical but for criterion count, 5 against
   40, and asserts the bold-marker count is greater than zero and identical across both.
2. Two inertness mutations each turn that test RED, verified then reverted: reverting bold labels to
   plain, and making any criterion row emit an O(n) styling token.
3. `rendered.includes('#')` is false, and `test/spawn/forgery.test.ts` passes unchanged.
4. Both caps hold on the genuinely maximal fixture from A1 criterion 4, asserted in the suite.
5. `npm run typecheck` exits 0 and `npm test` exits 0 with at least 421 passing.

## 4. Verification

Per unit: `npm run typecheck` and `npm test`, both exit 0. **Never `npm install` or `npm ci`** -
`node_modules` is tracked and `yaml` is hand-vendored.

Per merge, by hand, because `main` has no branch protection, no required checks, and no workflow that
triggers on the trunk:

```
git merge-base --is-ancestor <merged-head> origin/main
git checkout <merge-commit-sha> && npm run typecheck && npm test
```

A2 is stacked on A1. A1 merges first, its branch is deleted, the ref is confirmed gone, and only then
does A2 merge.

## 5. Standing constraints

Constraints C2 through C8 of `docs/plans/2026-08-26-briefing-scoping-repair-PLAN.md` section 5 apply
unchanged. C1 does not reach this diff: prior unit U2 split the thread resource, so `renderBriefing` now
has a single production caller at `src/server/tools/resume_thread.ts:85`.

## 6. Filed, not folded

| Item | Evidence |
|---|---|
| **A0a** - the render has no post-shrink cap re-check. `src/render/briefing.ts:243-255` returns the shrunk render without re-measuring it, so scaffolding alone can silently exceed budget. Pre-existing; neither unit creates it. Measured across seven adversarial fixtures at cap 40 the post-shrink render landed 506 to 590 chars under the cap, so neither unit needs it. | `src/render/briefing.ts:243-255` |
| **A0b** - `shrunkClip` never clamps `perItemClip` to `FULL_CLIP`. Unreachable while the write-boundary escape invariant holds; fed inflated natural lengths it produced a 130,881-char render. Becomes live the moment any render-side escape lands. | `src/render/briefing.ts:134-147` |
| **A0c** - five header fields are never clipped: `title`, `blocked_by`, `active_goal`, `next_step`, `last_session`. They are the only unbounded contributors to the render. | `src/render/briefing.ts:183-189` |
| **A0d** - `test/unit/briefing.test.ts:216` asserts no `#` anywhere, but passes by fixture luck: every probe is a single leading `#` and `escapeStored` escapes only a line's first character (`src/render/escape.ts:35`). A stored `## x` leaves a mid-line `#`. Harmless, since headings need line start, but the census reads stronger than it is. | `test/unit/briefing.test.ts:216` |
| **A0e** - mid-line markdown in stored values becomes live once the briefing is markdown. `escapeStored` handles line-leading only. The security-consequential characters are `[` and `<`; `*`, `_`, backtick and `~` are fidelity only, and CommonMark renders unmatched delimiters literally. A render-side escape is measured at 31,417 chars / 63,174 bytes, a 2.6x cap violation, and requires A0b and A0c first. | `src/render/escape.ts:22-38` |
| **A0f** - styling the twins is out of scope: `renderThreadDetail` (`src/server/resource-render.ts:69`) and `renderRoster` (`src/render/roster.ts:65`) have the same wall and are unchanged by this ladder. | - |
