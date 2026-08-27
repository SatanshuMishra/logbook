# PLAN: the resumption briefing is styled, and its criteria list is bounded

Status: SHIPPED. Parent commit `1e04924`, suite green 421/421 at approval. All units are merged to
`main`; `A2` landed via pull request 92, merge commit `9d4d3be`.
Ladder: three units, `A1`, `A1B` and `A2`, shipped in that order — not the two this line originally
named. `A1B`, the byte-denominated budget guard (section 7), was inserted between `A1` and `A2` after
measurement showed the enforced character cap could not imply the asserted byte cap. `A2` depends on
`A1`'s headroom and on `A1B`'s guard being in place.

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

Applied only after A1's headroom exists, and — per the section 7 amendment inserted after A1 shipped —
only after A1B's byte-denominated guard is in place too. Measured at cap 40: 10,572 chars and 21,466
bytes, leaving 1,428 chars and 2,534 bytes. That headroom figure predates A1B; section 8 records the
measured cost of A2's shipped token set against the byte-guarded baseline instead.

### The token set

| Line family | Before | After |
|---|---|---|
| header, 7 lines | `Thread: v` | `**Thread:** v` |
| section labels, 7 | `Open risks:` | `**Open risks:**` |
| before each label | none | one blank line |
| criterion row | `c1 [open] id: t` | `- c1 [open] id: t` |
| decisions rows | `resolved: N` | `- resolved: N` |
| not-shown tail | `See addr ...` | `See addr ...` (unchanged) |
| risk, key-decision, out-of-scope, related rows | already `- ` | unchanged |

**Two corrections to this table, made against the shipped code.** This plan originally gave the header
row's After column as `` `- **Thread:** v` `` and the not-shown-tail row's After column as
`` `- See addr ...` ``. Neither shipped. Header lines carry a bold label only, with no leading `- `
(`src/render/briefing.ts:252-258`; the fixture expectation at `test/unit/briefing.test.ts:130-136` shows
`'**Thread:** Ship the renderer'`, not a bulleted form). The "See ... for the complete record." sentence
is untouched by the restyle — no bold, no bullet (`src/render/briefing.ts:282`) — because it is a
sentence, not a label.

Criterion and decision rows must become bullets: consecutive non-blank lines are one paragraph in
CommonMark, so 40 plain `c1 ...` lines, or repeated `resolved:`/`dangling:`/`quarantined:` rows, under a
bold label reproduce the wall this unit removes.

This paragraph originally continued "...for the same reason the header must," implying the header row
also needed a bullet. It does not, in the shipped code. The header is a fixed set of seven lines that
never grows with record size, so it was never the row family this unit's O(1) constraint (section 1) was
written to protect, and the corrected table row above shows it stayed bold-only. Whether an unbulleted,
un-blank-line-separated header still reads cleanly under whatever markdown host renders the briefing was
not re-verified as part of this correction; the shipped shape is stated as fact, not endorsed as
sufficient.

No `#` is emitted anywhere. Bold labels do not match `forgery.test.ts:48`'s
`STRUCTURAL_MARKER_AT_LINE_START` because that pattern requires whitespace or end-of-line after the
marker and `**Open` has `*` in that position. Both facts were confirmed by running those regexes against
every new line shape.

### The construction shape — not specified here, and load-bearing once implemented

This plan named the token set (above) but never specified how the blank line and the label were meant
to be assembled inside the renderer's line array. The shipped renderer builds each conditional section
as a pair of separate `.map()` spreads — one emitting the blank line, one emitting the bold label —
each closing over a one-element `.slice(0, 1)` so it contributes at most one line when the section is
present and none when it is empty. Shipped shape, verified at `src/render/briefing.ts:262-264` (the
`Open risks` section is one instance of a pattern repeated at `:259-282` for every section, including
the always-present `Decisions` pair at `:274-275`, which uses plain literals instead of a spread because
that section never varies):

    ...risks.shown.slice(0, 1).map(() => ''),
    ...risks.shown.slice(0, 1).map(() => '**Open risks:**'),
    ...riskLines,

A `flatMap` whose callback returns an array literal — `...sections.flatMap((section) => ['',
section.label, ...section.lines])` — was tried and rejected during implementation; it is not, and never
was, in the shipped file. Per the A2 handoff's execution record
(`docs/plans/2026-08-26-briefing-markdown-styling-A2-HANDOFF.md`, "RULING 3"), building that shape and
running the `render.no-unescaped-site` census against it halted the census. Independently confirmed
against the shipped census file: the resolver requires every element of an iteration callback's returned
array literal to individually resolve (`test/contract/render-census.test.ts:229-238`), a spread element
(`...section.lines`) inside that literal does not, and the whole literal — and so the site — becomes
unclassifiable. The shipped map-pair shape does not trip this: each callback returns a bare string
literal, which the census classifies as server-authored with no further resolution needed
(`test/contract/render-census.test.ts:292`, `:371-375`). The handoff itself flags that the *count* of
unclassifiable sites it measured under the rejected flatMap form (1) does not match an earlier estimate
(6) that had circulated for it; only the direction — flatMap-with-array-literal halts the census,
map-pair does not — is established by execution, and only the map-pair shape shipped.

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
unchanged. C1 does not reach this diff: prior unit U2 split the thread resource, so the renderer has a
single production caller.

**Correction, made after A1B shipped.** This sentence originally named `renderBriefing` at
`src/server/tools/resume_thread.ts:85`. Neither is current. A1B's byte-budget search needs the pass
count and the fits-budget flag that the plain wrapper discards, so `resume_thread.ts` calls
`renderBriefingWithPasses` directly (`src/server/tools/resume_thread.ts:86-92`), and `renderBriefing`
is now a thin wrapper around it with no production caller of its own
(`src/render/briefing.ts:338-344`) — it is called only from test files. The single-caller property C1
relies on still holds; it now holds of `renderBriefingWithPasses`, not of the name this section
originally used.

## 6. Filed, not folded

| Item | Evidence |
|---|---|
| **A0a** - the render has no post-shrink cap re-check. `src/render/briefing.ts:243-255` returns the shrunk render without re-measuring it, so scaffolding alone can silently exceed budget. Pre-existing; neither unit creates it. Measured across seven adversarial fixtures at cap 40 the post-shrink render landed 506 to 590 chars under the cap, so neither unit needs it. | `src/render/briefing.ts:243-255` |
| **A0b** (CLOSED - MOOT) - `shrunkClip` never clamps `perItemClip` to `FULL_CLIP`. Unreachable while the write-boundary escape invariant holds; fed inflated natural lengths it produced a 130,881-char render. Becomes live the moment any render-side escape lands. **Closed as moot by unit A1B.** `shrunkClip` no longer exists, and it was the only expression that computed a clip from arithmetic on text lengths. Every clip value is now built by one clamping constructor that applies a minimum against each field's own natural maximum, honouring all four different maxima - risk 500, key decision 200, out-of-scope 300, criterion 500 - and even the unclipped render goes through it. The search range is bounded above by those maxima, and the search re-measures every candidate render against both caps, which the single-shot shrink never did. | `src/render/briefing.ts:134-147` |
| **A0c** - five header fields are never clipped: `title`, `blocked_by`, `active_goal`, `next_step`, `last_session`. They are the only unbounded contributors to the render. | `src/render/briefing.ts:183-189` |
| **A0d** - `test/unit/briefing.test.ts:231` (corrected from `:216`, which this plan originally cited and which is a fixture line, against shipped `main`) asserts no `#` anywhere, but passes by fixture luck: every probe is a single leading `#` and `escapeStored` escapes only a line's first character (`src/render/escape.ts:35`). A stored `## x` leaves a mid-line `#`. Harmless, since headings need line start, but the census reads stronger than it is. | `test/unit/briefing.test.ts:231` |
| **A0e** - mid-line markdown in stored values becomes live once the briefing is markdown. `escapeStored` handles line-leading only. The security-consequential characters are `[` and `<`; `*`, `_`, backtick and `~` are fidelity only, and CommonMark renders unmatched delimiters literally. A render-side escape is measured at 31,417 chars / 63,174 bytes, a 2.6x cap violation, and requires A0b and A0c first. | `src/render/escape.ts:22-38` |
| **A0f** - styling the twins is out of scope: `renderThreadDetail` (`src/server/resource-render.ts:69`) and `renderRoster` (`src/render/roster.ts:75`, corrected from `:65` against shipped `main`) have the same wall and are unchanged by this ladder. | - |
| **A0g** (CLOSED) - the resume payload can exceed its byte cap on ordinary schema-admissible records, and this unit widens the set of records that do. The briefing is serialised into the reply twice, once as `content[0].text` and once as `structuredContent.briefing`, so payload bytes run at roughly `2 x (chars + lines) + 130`. With `BRIEFING_MAX_CHARS = 12000` and `RESUME_PAYLOAD_MAX_BYTES = 24000` the true character ceiling that satisfies the byte cap is about 11,935 minus the line count, not 12,000 - and the renderer checks the character cap only, never the byte cap. Two plain-ASCII fixtures, each `ThreadRecord.parse` ok, measure the two halves of this. **Fixture 1, on which the parent PASSES and this unit's head FAILS**, so this unit does make more records breach: record 47,158 of 65,536 bytes, shaped as 140 criteria at 60 characters of text, 20 risks at 500, 20 key decisions at 50 and 20 out-of-scope at 300. Parent 11,471/12,000 chars PASS and 23,436/24,000 bytes PASS; head 11,995/12,000 chars PASS but 24,284/24,000 bytes FAIL by 284. A grid over schema-admissible plain-ASCII records found 1,239 such configurations, and a randomised run over 2,088 admissible records found 14 byte-cap regressions and zero character-cap regressions. **Fixture 2, on which BOTH the parent and this unit's head FAIL**, so the breach is also reachable pre-existing: record 63,098 of 65,536 bytes, shaped as 200 criteria with 99-character text, all `done: false` and `struck_by: null`, ordinals 1-200; 40 risks with 102-character text, all anchored to `criteria[0]`; 20 key decisions with 102-character titles, all anchored to `criteria[0]`; 40 out-of-scope at 102; `title` 200; `slug` 64; `blocked_by` 500; `active_goal`, `next_step` and `last_session` 500 each; 50 dangling and 50 quarantined decision ids; and a predecessor with a 200-character title and a 64-character slug. Parent 11,747 chars, 262 lines, 24,156/24,000 bytes FAIL by 156; head 11,998 chars, 102 lines, 24,338/24,000 bytes FAIL by 338. Anchoring to `criteria[0]` is the lever. A lane is where the renderer files a risk or a key decision: lane A is the items anchored to the criterion currently being worked, lane B is everything unanchored or anchored elsewhere but still live, lane C is items anchored to a done or struck criterion, which collapse. `criteria[0]` is the current criterion, so anchored items fill lane A at its caps of 8 risks and 10 key decisions rather than lane B's 4 and 5. The text lengths are tuned so the render lands just under the character cap and takes the unclipped path; longer text trips clipping, which pulls the render back and hides the breach. **The claim that the numbers are identical on the parent is disproved by fixture 1.** The honest statement is that the breach is reachable on the parent, and that this unit widens the set of records that reach it. Neither fixture's worst case is proven global: both came from bounded sweeps, so each is a lower bound on the true worst case. This is not A0a. A0a is the missing post-shrink re-check, measured at 506 to 590 characters of margin against the CHARACTER cap; the byte cap has no such margin. **Closed by unit A1B, on branch `fix/briefing-byte-budget-guard`.** The renderer now enforces the byte cap at runtime, through an exact payload-size predictor plus a convergent binary search on the per-item text clip. A frontier-sweep census test was RED on the parent commit `bfdc68a` - exit 1, with 224 of 498 swept records breaching, worst ASCII 24,310 bytes and worst CJK 67,130 bytes - and is GREEN on the fix, exit 0. Across an exhaustive 26,310-record admissible grid, breaches went from 6,357 to zero, and the worst render after the fix sits 278 bytes under the 24,000-byte cap. Suite 430 passing, exit 0; typecheck exit 0. | `src/render/briefing.ts:12-13`, `:277-280`, `src/server/tools/resume_thread.ts:89`, `:92` |
| **A0h** - the `done`-before-`struck` rank ordering is unasserted. Swapping the rank constants for `done` and `struck` leaves every test green, because the shipped fixture is 199 struck criteria plus one open one (`test/unit/briefing.test.ts:464-467`) and carries no done criterion at all, so rank 1 is never exercised. The code is correct as shipped; this is a coverage gap, not a defect. | `src/render/briefing.ts:107-115` |
| **A0i** - original-ordinal-order emission is unasserted. `capCriteria` selects the 40 lowest-ranked criteria and then emits them in original ordinal order, so the reader sees ascending ordinals with gaps where retired items dropped out. Replacing that emission with a rank-order sort leaves every test green. Correct as shipped; a coverage gap, not a defect. | `src/render/briefing.ts:122-138` |
| **A0j** - `criterionStatus` is typed `string`, so a fourth status would silently rank as struck. It returns `string` rather than a closed union of the three statuses `open`, `done` and `struck`, so a status added later falls through the rank lookup, is treated as the lowest priority, and hides behind the cap with no compile error. | `src/render/briefing.ts:41-44` |
| **A0k** - nothing pins the shown cap to the schema invariant. `CRITERIA_SHOWN_MAX` now derives from `caps.CRITERIA_MAX_ELEMENTS`, and that derivation is what makes the safety claim true: a cap of 40 is safe only because that invariant bounds un-struck criteria, so every open and every done criterion always fits. No test fails if someone reverts it to a bare `40`, because the two expressions evaluate identically today. | `src/render/briefing.ts:29`, `src/schema/caps.ts:12` |
| **A0l** - the schema's per-field caps are not jointly satisfiable. `ThreadRecord.parse` enforces a whole-record cap, `THREAD_RECORD_SERIALISED_MAX_BYTES = 65536`. Two hundred completion criteria consume 60,419 of those 65,536 bytes with EMPTY text, which is 92 percent of the record budget, leaving roughly 5,117 bytes against about 200 bytes per character of criterion text and about 302 bytes per key decision. Measured admissible frontier at 200 criteria, `parse.ok` true at every row: 0 key decisions allow 25 characters of criterion text (65,419 bytes); 5 allow 18 (65,528 bytes); 10 allow 10 (65,438 bytes); 16 allow 1 (65,450 bytes); 17 or more are inadmissible at any text length. The shipped fixture sits on the 5-key-decision row of that frontier (`test/unit/briefing.test.ts:487-488`). The consequence: no schema-admissible record can hold the retention maximum of criteria alongside criterion text at its 500-character cap or key decisions at their 200-element cap. Pre-existing; this unit neither creates nor fixes it. | `src/schema/thread.ts:133-146`, `src/schema/caps.ts:39` |
| **A0m** - the suite has no render-maximal fixture. The size fixture maximises RECORD bytes, not RENDERED output, and the test consuming it was honestly renamed to say so: `briefing.renders-a-record-byte-maximal-thread-within-budget`. Its risks and key decisions carry no `criterion_id`, so they fall to lane B and only 4 and 5 of them render; anchoring them to the current criterion fills lane A at its caps of 8 and 10 and yields a strictly larger render. That gap is what lets A0g pass the suite. A working seed for such a fixture is the 140/60/20/20/20 shape recorded in A0g. | `test/unit/briefing.test.ts:490-531`, `src/render/briefing.ts:18-23` |
| **A0n** - the text clip is counted in graphemes while the budget is counted in bytes. A grapheme is one reader-visible character, which may be a base letter plus any number of marks stacked on it; its size in bytes is unbounded. A base letter followed by 499 combining marks is one grapheme but 999 bytes, so a clip of 1 and a clip of 500 produce identical output for that item, and the search has only two reachable states: drop the item, or pay 999 bytes for it. Measured on one schema-admissible record - 41,148 record bytes against the 65,536 cap; 12 criteria, 12 risks, 12 out-of-scope and 12 key decisions, each at its schema text cap - the parent rendered 62,714 payload bytes, 2.6x the cap, while unit A1B renders 2,794 bytes, 11.6 percent of the budget, retaining only 908 characters of item text against 15,908. The cap holds, but 94 percent of the item text is discarded and roughly 21,000 bytes of budget go unused, so every criterion, risk, key decision and out-of-scope item renders with empty text. The same root cause degrades any legitimate combining-mark-heavy script - Hebrew with niqqud, Arabic with diacritics, Devanagari, Thai - proportionally rather than totally. Highest-priority filed item. | `src/render/briefing.ts` (the clip constructor), `src/render/escape.ts:40-44` |
| **A0o** - truncating an escape token can yield a well-formed token naming a different character. The stored-text escape rewrites an unsafe character into a `U+XXXX` token of at least four hex digits. A five-digit token cut by one character is still well formed and names a different character: `U+1D173` becomes `U+1D17` at a clip of 6. Misleading only, and not currently exploitable, because nothing anywhere in `src/` decodes these tokens - there is no `fromCodePoint`, no `parseInt(..., 16)` and no unescape on this path. The related threat, that truncation could re-enable a character the escape neutralised, was tested and CLEARED: the escape emits pure ASCII, so cutting it can only ever yield an ASCII prefix, verified across a right-to-left override, three zero-width spaces and a line separator at every clip length 1 through 7. | `src/render/escape.ts:17-20`, `src/render/briefing.ts:60` |
| **A0p** - clipping manufactures unbalanced delimiters that were balanced in storage. Measured: `<span>hello</span>` clipped to 6 yields `<span>`, and `[label](https://example.test)` clipped to 10 yields `[label](ht`. This is NOT A0e: A0e files delimiters already present in a stored value, while this files delimiters CREATED by the clip itself. It is inert while the briefing is plain text, and becomes live under A2, which makes the briefing markdown. A2's replacement acceptance criterion 4 re-runs the A1B frontier sweep with the markdown token set applied. This item originally said the sweep's two fills are uniform `x` and a single repeated multi-byte character, neither containing any delimiter. That premise is now stale: a third fill shipped afterward, `DELIMITER_FILL = '_'` (`test/unit/briefing-frontier-sweep.test.ts:20`), a genuine mid-line CommonMark emphasis delimiter. The conclusion is not stale, for a different reason: the sweep's only assertion is that no rendered record exceeds the character or byte cap (`test/unit/briefing-frontier-sweep.test.ts:324-332`); nothing in it checks whether clipping left a syntactically unbalanced delimiter, under any fill. So this criterion as written still cannot detect this class. Routed to A2 as an input to its token-set design. | `src/render/briefing.ts:60` |
| **A0q** - the frontier sweep does not vary grapheme density or the escape-expanding fill class. At the time A1B shipped, both swept fills were exactly one grapheme per UTF-16 code unit and both passed through the stored-text escape unchanged, so neither the axis behind A0n nor the sixfold growth of the escape-expanding class was ever exercised. Unit A1B DECLARED both exclusions rather than adding a third fill, and made each declaration a checked invariant that reddens if a fill ever stops having the stated property; adding the fills themselves would redden the sweep against defects deliberately left filed. **Updated after A2**: a third fill, the delimiter character `_`, was added during A2's implementation (`test/unit/briefing-frontier-sweep.test.ts:20-26`). It satisfies both of the same declared invariants, checked for every fill in a loop (`:251-263`), so the exclusion is still declared and the coverage gap this item files — the escape-expanding class and grapheme-density variation are still never swept — remains open. Only the fill count changed, from two to three. | `test/support/briefing-sweep-fixture.ts`, `test/unit/briefing-frontier-sweep.test.ts` |
| **A0r** - a render whose unclippable scaffolding alone exceeds the budget is still returned over cap. When even a clip of zero does not fit, the search has nothing left to give. Unit A1B makes this OBSERVABLE rather than silent - the render reports `withinBudget: false`, and the resume tool logs `briefing.budget-exceeded` with the measured character and byte counts - but does not make it fit, which would be a separate ladder. Measured on a schema-admissible record whose five never-clipped header fields carry characters the escape expands sixfold: 13,458 characters and roughly 27,000 payload bytes, against caps of 12,000 and 24,000. That record is admissible to the store and served to the renderer, though it is not reachable through `open_thread`, because every write boundary escapes before storing. This is the surviving residual of A0a combined with A0c, narrowed but not eliminated: the search now re-measures every candidate, which the single-shot shrink never did. | `src/render/briefing.ts` (the search fallback), `src/server/tools/resume_thread.ts` |
| **A0s** - the over-budget fallback compares character length, not byte length. On the one path where every byte matters, the fallback picks the shorter of the unclipped render and the zero-clip render by counting characters. A render can in principle be longer in characters yet smaller in bytes, when clipping removes multi-byte text and adds ASCII scaffolding lines. No case in a 240-point grid or in five degenerate fixtures exhibited the divergence, so this is theoretical today. | `src/render/briefing.ts` (the search fallback) |
| **A0t** - collapsing the empty-pool guard costs nine redundant renders on that path. A thread with nothing clippable and an over-budget render previously returned in one render, and now runs the full binary search, ten renders, to return a briefing proven byte-identical to the one-render answer. It stays inside the asserted pass ceiling of 11. The zero-clip render is also computed twice, once as the search's final candidate and once in the fallback, so one render is recoverable by capturing it inside the loop. | `src/render/briefing.ts` (the clip search) |
| **A0u** - the grapheme segmenter is rebuilt on every clip call. The clip helper constructs a fresh text segmenter each time it is called, roughly 900 times per resume once the convergent search runs up to ten passes over every shown item. This is the bulk of the measured 30.6 ms worst-case render, against 1.8 ms before the search existed. Hoisting the segmenter to module scope is a one-line change with no behavioural effect, but no profile isolating it has been taken. | `src/render/escape.ts:40-44` |
| **A0v** - three copies of the reply-envelope shape remain hand-built in the suite. Unit A1B added an assertion pinning the payload-size predictor to the envelope the server actually serialises, so adding a field to the resume tool's output schema now reddens a test rather than silently admitting an over-cap payload. Two older tests still hand-build the envelope JSON themselves instead of calling the predictor, so the duplication that made the drift possible is reduced but not retired. | `test/unit/briefing.test.ts`, `test/unit/briefing-frontier-sweep.test.ts` |
| **A0w** - the public render surface exposes a pass count that invites a change-detector. The renderer returns the number of render passes so the one-pass common path can be asserted rather than assumed. That number is an internal cost measure on a public type, and a future test asserting an exact value on a non-trivial thread would fail on any benign search improvement. The two shipped tests avoid this: one asserts exactly 1 on an ordinary thread, which is a behavioural guarantee, and the other asserts a ceiling of 11 rather than an exact count. | `src/render/briefing.ts` (the render result type) |
| **A0x** - the clip search probes a value one below its minimum, and the search result type duplicates the render result type. The search seeds its lower bound at one below the minimum clip so that a zero clip is reachable, with no clamp preventing a negative value from reaching the clip constructor; the constructor's own minimum makes this harmless today. Separately, the search returns a shape structurally identical to the public render result, so the two can drift apart. Both are tidiness, not defects. | `src/render/briefing.ts` (the clip search) |
| **A0y** - the project has no scoped verification command. Section 4 mandates `npm run typecheck` and `npm test` as the per-unit gate, and there is no `/verify-logbook` command to narrow that to the changed surface, so every unit runs the full suite whatever it touched. There is also no linter configured in the project at all - no ESLint and no `lint` script - so the gate is a type check and a test run and nothing else. A separate unit, not A1B's. | `package.json`, absence of `.claude/commands/verify-*.md` |
| **A0z** - the plan's worst-reachable fixture is under-specified, and its recorded figure is stale. Section 7's table row for "worst reachable, 40 criteria at 51" records the shape but not enough of it to rebuild: with risks left unanchored that shape converges in a single pass at 23,238 bytes and never clips at all, so it can demonstrate nothing about content preservation. It enters the clip search only when risks are anchored to the criterion currently being worked, which fills the eight-item lane rather than the four-item one. The section 7 figure of 392 characters of retained risk text does not reproduce; the measured value on the anchored variant is 278, most of the difference being the 78 bytes the payload-size prediction now reserves for the previous-session field. The direction of the plan's claim holds; the number is stale. | `docs/plans/2026-08-26-briefing-markdown-styling-PLAN.md` section 7 |

# 7. Unit A1B — the budget guard is byte-denominated and convergent

Inserted between A1 and A2 after measurement. Sections 0-5 are unchanged; this section adds a unit and
does not alter A1's ceiling, which was met and shipped.

## Why this exists

`BRIEFING_MAX_CHARS = 12000` is enforced at runtime (`src/render/briefing.ts:238-255`).
`RESUME_PAYLOAD_MAX_BYTES = 24000` is asserted only in the suite and never at runtime. The enforced
guard cannot imply the asserted one:

- For ASCII, `bytes = 2 x chars + 2 x newlines + 140`. A render at exactly 12,000 chars with 91 newlines
  is 24,322 bytes. **No render with even one newline can sit at the character cap and satisfy the byte
  cap.** The gap is at least 161 characters.
- For multi-byte text the character cap cannot bound bytes at all. 11,995 characters of CJK render to
  **61,886 bytes**, 2.6x the cap. `escapeStored` passes ordinary non-ASCII through and the write-boundary
  caps count characters, not bytes.

Measured populations of records that pass the enforced cap and breach the asserted one:

| Population | breaching | worst case |
|---|---:|---|
| Schema-admissible, 9,780 points swept | 247 | 11,984 chars / 24,278 bytes |
| Tool-reachable, 14,210 points swept | **338** | **11,988 chars / 24,284 bytes** |

The tool-reachable worst case is 40 open criteria with 51-character text and no key decisions - an
ordinary large thread. `clipped` is false on every one of them, so the shrink pass never fires.

A1 widened this. On the security review's fixture the parent passes at 23,436 bytes and A1 fails at
24,284; a randomised run over 2,088 admissible records found 14 byte-cap regressions and zero character
regressions. With 200 rows the fixed per-row scaffolding was large and the single-shot shrink undershot;
with 40 rows the shrink reaches its target and lands in the dead band. A1B closes A0g.

## The design

**Part 1, an exact byte predictor in the renderer.** The reply shape is fixed, so its size is computable:

```
payloadBytes = 2 x jsonEscapedByteLen(briefing) + jsonEscapedByteLen(threadId) + 114
```

Verified exact on 8 of 8 renders across ASCII, CJK and Latin-1, including the suite fixture, which it
predicted at 23,790 against an actual 23,790. Unlike the character proxy it sees multi-byte text.

**Part 2, a convergent search.** Replace the single-shot shrink with a binary search on the per-item
clip, keeping the largest clip whose render satisfies BOTH caps. Measured against the cliff it replaces:

| Case | A1 shipped | single-shot shrink | convergent |
|---|---|---|---|
| Suite record-byte-maximal | 23,790 pass | 24,174 fail | **24,000 pass**, risk text 453 |
| Worst reachable, 40 criteria at 51 | **24,284 fail** | 18,106 pass, risk text 116 | **23,994 pass**, risk text 392 |
| CJK, 40 criteria at 51 | **61,244 fail** | **41,562 fail** | **23,790 pass** |

Content preservation is 3.4x better than the cliff on the worst reachable record. Cost is 20.1 ms against
1.8 ms on the worst thread, 11 passes against 1; an ordinary thread still converges in a single pass.
`resume_thread` is called once per session pickup.

**Reserve.** Target 23,800 bytes, not 24,000. The convergent search lands the suite-maximal case at
exactly 24,000, and a knife-edge equality is fragile against any later change.

## A1B acceptance criteria (the ceiling)

1. A frontier-sweep census test exists. It sweeps the admissible parameter grid - criteria count,
   criterion text length, key-decision count - at the record byte ceiling, in ASCII and in a multi-byte
   fill, and asserts zero rendered records exceed either cap. **It declares the grid it covered and halts
   on anything it cannot classify.** A pinned count or a sampled allowlist is forbidden.
2. That sweep is RED on the parent commit, finding at least one breaching record. Measured today: 338
   tool-reachable records, worst 24,284 bytes, plus a CJK record at 61,244 bytes.
3. Two inertness mutations each turn it RED, run and then reverted: reverting the byte predictor to the
   character proxy must redden the CJK record, and reverting the convergent search to the single-shot
   shrink must redden the 40-criteria-at-51-characters record.
4. An ordinary small thread still converges in one pass, asserted rather than assumed.
5. `npm run typecheck` exits 0 and `npm test` exits 0 with at least 423 passing.

## Amendments to this section, made after measurement

**Entry 1 - acceptance criterion 3's second mutation was replaced.** As originally written, criterion 3
required that reverting the convergent search to the single-shot shrink turn the 40-criteria-at-51-characters
ASCII record RED. Measurement showed it does not, and this section's own table already recorded the
single-shot shrink as PASSING that row at 18,106 bytes, so the criterion contradicted its own document and
was unsatisfiable as written. The replacement, verbatim:

> Reverting the convergent search to the single-shot shrink must turn the sweep RED on multi-byte input, and
> must measurably destroy content on ASCII input, asserted by a test.

Observed against the replacement: the mutation turns the sweep RED with 182 breaching records, every one of
them multi-byte; and on ASCII it cuts the retained risk text on the worst reachable record from 278
characters to 80 while the record still fits both caps, so no cap assertion catches it. A
content-preservation floor of 250 characters - set from the measured 278, with 28 characters of slack - is
now asserted, and was demonstrated RED under that mutation. Criterion 3's first mutation, reverting the
payload-size predictor to the character proxy, is unchanged, and was observed RED as specified, at 67,316
bytes on the multi-byte record.

**Entry 2 - this section's description of the payload-size prediction is superseded by the code.** The
section states a fixed constant of 114 bytes, verified exact. The shipped predictor instead takes whether the
reply's previous-session field is present, and adds 114 bytes when it is absent or 192 when it is present,
because that field is either the four bytes of a null or an 82-byte object of two fixed-length identifiers.
It is exact on both branches, measured at zero error across four fixtures times both branches, and it
defaults to the present branch, so that any caller which omits the argument over-predicts rather than
under-predicts. The earlier flat 192 was replaced because it permanently over-predicted by 78 bytes whenever
the field was null, which cost roughly 59 characters of reader-facing content on the common path.

**Entry 3 - acceptance criterion 1's fill count is superseded; a third fill shipped, during A2.** As
written above, criterion 1 names two fills, ASCII and multi-byte. The shipped sweep sweeps three:
`ASCII_FILL = 'x'`, `MULTI_BYTE_FILL = '漢'` and `DELIMITER_FILL = '_'`
(`test/unit/briefing-frontier-sweep.test.ts:18-26`), each with its own byte-width assertion
(`:242-244`). The third fill was not part of A1B; it was added later, during the A2 unit, per the A2
handoff's "RULING 1," which required the character to be drawn from `_`, `[` or `]` specifically —
those three pass the same escape-passthrough and one-grapheme-per-UTF-16-unit invariants this sweep
already declared for the first two, while `*`, a backtick and `~` do not, because
`MARKDOWN_LEADING_CHARS` rewrites them into an escape token (`src/render/escape.ts:7`). A0q below,
filed when this section was written, names the two-fill state as an open gap; it is corrected there to
the current count without closing the gap it describes.

The rest of section 7 is unchanged. Where this section and the code disagree, the code wins.

# 8. Amendment to A2, made before A2 started

A2's acceptance criterion 4 in section 3 read "both caps hold on the genuinely maximal fixture". It is
withdrawn and replaced. It named a fixture that maximises neither cap, and it made a single fixture the
thing that establishes a population-wide property, which is a sample wearing a census costume.

> **A2 AC4 (replacement).** With A1B's guard in place, the frontier sweep from A1B criterion 1 is re-run
> with the markdown token set applied and still finds zero records exceeding either cap. A2 adds no
> trimming to its token set to achieve this.

Measured basis: A2's full token set costs 185 characters and 384 payload bytes, not the ~260 and ~534
estimated in section 3. The breakdown is 77 characters O(1) - 7 header items, 7 section labels, 7 blank
lines - and 108 characters across 54 row bullets. With A1B in place the full set lands untrimmed.

Section 3's remaining criteria 1, 2, 3 and 5 stand unchanged.
