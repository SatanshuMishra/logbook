# A2 implementation handoff: briefing Markdown restyle

Branch: `feat/briefing-markdown-styling`
Repository: `/Users/satanshumishra/Documents/DevLabs/logbook`

## How to read this document

Terms used throughout, defined once:

- **Briefing** — the plain-text block the plugin returns when a thread is resumed. It is built by
  one function in one file and handed to the model as text.
- **Emission site** — a single place in the source where a piece of that text is produced.
- **Anchor** — a test assertion that names an exact piece of briefing text. Change the text and the
  anchor fails.
- **Census** — a test that walks a closed list of items and halts on any item it cannot classify. It
  is not a sample and it has no pinned count.
- **Fill** — a single character repeated to manufacture a large test record.

Everything below carries a `path:line`. Every measured claim was produced by running the command
shown. Two facts are marked UNVERIFIED and are the only ones not established by execution.

## Verification environment used to produce this document

The whole repository was copied to a scratchpad at
`/private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/0da6d1b4-a5bf-47ab-856f-387d40f3cc9e/scratchpad/probe`,
the restyle and the repairs were applied there, and the suite was run there. The real working tree
was never modified and is clean apart from one untracked test file.

Three tests fail in that copy for a reason unrelated to this work: the copy excludes `.git`, and
those tests need a real git repository. They are `cutover.old-tree-absent`
(`test/contract/cutover-old-tree-absent.test.ts:74`), `install.serves-new-server`
(`test/spawn/install.test.ts:82`) and `install.no-build-output-was-materialised`
(`test/spawn/install.test.ts:156`). All three were confirmed passing in the real repository:

    node --test test/contract/cutover-old-tree-absent.test.ts test/spawn/install.test.ts
    # 4 tests, 4 pass, 0 fail

Ignore them. They are not yours.

---

# 1. The token-set site map

All sites are in `/Users/satanshumishra/Documents/DevLabs/logbook/src/render/briefing.ts`.

## 1a. Header lines — seven rendered lines from seven source sites

Five are inline template expressions in the assembly array. Two are produced by helper functions
that each carry two string literals, because the line's wording depends on a value.

| # | `path:line` | Field rendered | Exact current source expression |
|---|---|---|---|
| 1 | `src/render/briefing.ts:252` | `thread.title` | ``  `Thread: ${escapeStored(thread.title)}`  `` |
| 2 | `src/render/briefing.ts:253` | `thread.status` | ``  `Status: ${escapeStored(thread.status)}`  `` |
| 3 | `src/render/briefing.ts:254` | `thread.blocked_by`, via helper | `renderBlockage(thread.blocked_by)` |
| 4 | `src/render/briefing.ts:255` | pointer vs `thread.id`, via helper | `renderPointerStatus(pointer, thread.id)` |
| 5 | `src/render/briefing.ts:256` | `thread.spine.active_goal` | ``  `Active goal: ${escapeStored(thread.spine.active_goal)}`  `` |
| 6 | `src/render/briefing.ts:257` | `thread.spine.next_step` | ``  `Next step: ${escapeStored(thread.spine.next_step)}`  `` |
| 7 | `src/render/briefing.ts:258` | `thread.spine.last_session` | ``  `Last session: ${escapeStored(thread.spine.last_session)}`  `` |

The two helpers, with their literals, are the real edit points for rows 3 and 4.

`src/render/briefing.ts:89-90`

    const renderBlockage = (blockedBy: string | null): string =>
      blockedBy === null ? 'Blockage: none' : `Blocked: ${escapeStored(blockedBy)}`

`src/render/briefing.ts:92-93`

    const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
      pointer !== null && pointer.thread_id === threadId ? 'Currently being worked: yes' : 'Currently being worked: no'

Note the asymmetry at `:89-90`: the label itself changes with the value. Unblocked renders
`Blockage:` and blocked renders `Blocked:`. Both are separate labels and both need styling.

## 1b. Section labels — seven sites

Each is a bare string literal inside a `.map(() => ...)` spread whose only job is to emit the label
once when the section is non-empty.

| # | `path:line` | Exact current literal |
|---|---|---|
| 1 | `src/render/briefing.ts:259` | `'Related:'` |
| 2 | `src/render/briefing.ts:261` | `'Open risks:'` |
| 3 | `src/render/briefing.ts:263` | `'Key decisions:'` |
| 4 | `src/render/briefing.ts:265` | `'Out of scope:'` |
| 5 | `src/render/briefing.ts:267` | `'Completion criteria:'` |
| 6 | `src/render/briefing.ts:269` | `'Decisions:'` |
| 7 | `src/render/briefing.ts:273` | `'Not shown:'` |

`'Decisions:'` at `:269` is the one unconditional label. The other six are conditional.

## 1c. The criterion row — one site

`src/render/briefing.ts:74-75`

    const renderCriterionLine = (criterion: Criterion, textClip: number): string =>
      `c${criterion.ordinal} [${criterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${clip(criterion.text, textClip)}`

This is the only row family in the whole renderer that does not already begin with `- `. It gains
one.

## 1d. The three decision-integrity rows — three sites

| # | `path:line` | Exact current source expression |
|---|---|---|
| 1 | `src/render/briefing.ts:270` | ``  `resolved: ${decisionIntegrity.resolved}`  `` |
| 2 | `src/render/briefing.ts:83` | ``  const renderDanglingLine = (decisionId: string): string => `dangling: ${escapeStored(decisionId)}`  `` |
| 3 | `src/render/briefing.ts:84` | ``  const renderQuarantinedLine = (decisionId: string): string => `quarantined: ${escapeStored(decisionId)}`  `` |

## 1e. The not-shown tail — one site

`src/render/briefing.ts:275`

    ...notShownBulletLines.slice(0, 1).map(() => `See ${clip(notShownAddress, 200)} for the complete record.`)

This is a sentence, not a label. It takes no bold and no bullet. It is listed so you do not
accidentally style it.

## 1f. Row families that ALREADY start with `- ` — do NOT change these

Six families, ten emission expressions. Every one of these already renders a Markdown list item.
Adding another `- ` would double the marker and break the render.

| Family | `path:line` | Exact current source expression |
|---|---|---|
| Risk row | `src/render/briefing.ts:77` | ``  `- ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`  `` |
| Key-decision row | `src/render/briefing.ts:79` | ``  `- ${clip(keyDecision.title, textClip)}`  `` |
| Out-of-scope row | `src/render/briefing.ts:81` | ``  `- ${clip(outOfScope.text, textClip)}`  `` |
| Related row | `src/render/briefing.ts:86-87` | ``  `- succeeds: ${clip(predecessor.title, RELATED_TITLE_CLIP)} (${clip(predecessor.slug, RELATED_SLUG_CLIP)})`  `` |
| Text-clipped bullet | `src/render/briefing.ts:64-65` | `'- some criterion, risk, key decision or out-of-scope text was shortened to fit the character budget'` |
| Not-shown bullets (5 expressions) | `src/render/briefing.ts:241`, `:242`, `:243`, `:244`, `:247` | ``  `- ${count} risks not shown` ``, ``  `- ${count} key decisions not shown` ``, ``  `- ${count} out-of-scope items not shown` ``, ``  `- ${count} completion criteria not shown` ``, ``  `- ${count} dangling or quarantined decision ids not shown`  `` |

## 1g. Measured totals

- Sites that change: **19** (7 header + 7 label + 1 criterion row + 3 integrity rows + 1 tail
  sentence left alone = 18 changed, 1 inspected-and-left).
  Precisely: 18 changed, and `:275` inspected and deliberately unchanged.
- Emission expressions that must NOT change: **10**, across **6** families.

---

# 2. The complete breaking-anchor census

Established by execution, not by reading. Method: apply the full restyle in the probe copy, run
`npm test`, diff the failure set against the baseline failure set.

    # baseline (restyle NOT applied): 431 tests, 427 pass, 4 fail
    # restyled:                       431 tests, 415 pass, 16 fail

Subtracting the 3 environment artifacts and the 1 acceptance test that is *supposed* to be red on
the baseline, the restyle breaks exactly **13 tests**, spread over **4 files**.

The architect's list missed `test/store/lineage.test.ts`. It is item 12 below and it is real — it
was observed failing.

## 2a. `test/unit/briefing.test.ts` — 10 breaking anchors

### 1. `test/unit/briefing.test.ts:92`

Test: `briefing.blockage-none-when-not-blocked` (declared at `:89`).

    assert.ok(rendered.split('\n').includes('Blockage: none'))

Breaks because: exact whole-line match. The line becomes `**Blockage:** none`.

Repair: replace `'Blockage: none'` with `'**Blockage:** none'`.

### 2. `test/unit/briefing.test.ts:129-148`

Test: `briefing.renders-exact-output-for-a-full-thread` (declared at `:95`).

This is a full-document equality assertion at `:150` (`assert.equal(rendered, expected)`), so every
one of the 18 changed sites lands here at once, plus the new blank lines. Current expected block:

    const expected = [
      'Thread: Ship the renderer',
      'Status: open',
      'Blockage: none',
      'Currently being worked: yes',
      'Active goal: ship the renderer',
      'Next step: add tests',
      'Last session: wrote the first draft',
      'Open risks:',
      `- ${riskId} escaping might be incomplete`,
      'Key decisions:',
      '- use postgres',
      'Out of scope:',
      '- does not cover the CLI',
      'Completion criteria:',
      `c1 [done] ${criterionA.id}: first criterion`,
      `c2 [struck] ${criterionB.id}: second criterion`,
      'Decisions:',
      'resolved: 1'
    ].join('\n')

Breaks because: every header, every label, the two criterion rows and the resolved row all change,
and four blank lines are inserted.

Repair — this exact block, verified green:

    const expected = [
      '**Thread:** Ship the renderer',
      '**Status:** open',
      '**Blockage:** none',
      '**Currently being worked:** yes',
      '**Active goal:** ship the renderer',
      '**Next step:** add tests',
      '**Last session:** wrote the first draft',
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
      `- c1 [done] ${criterionA.id}: first criterion`,
      `- c2 [struck] ${criterionB.id}: second criterion`,
      '',
      '**Decisions:**',
      '- resolved: 1'
    ].join('\n')

Note there is no blank line before `**Related:**` here because this fixture has no predecessor, so
that section does not render at all.

### 3. `test/unit/briefing.test.ts:156-166`

Test: `briefing.omits-empty-list-sections-entirely` (declared at `:153`).

Second full-document equality assertion, at `:167`. Current expected block:

    const expected = [
      'Thread: Empty Thread',
      'Status: done',
      'Blocked: still finishing docs',
      'Currently being worked: no',
      'Active goal: ship the thing',
      'Next step: write the tests',
      'Last session: wrote the renderer',
      'Decisions:',
      'resolved: 0'
    ].join('\n')

Repair — verified green:

    const expected = [
      '**Thread:** Empty Thread',
      '**Status:** done',
      '**Blocked:** still finishing docs',
      '**Currently being worked:** no',
      '**Active goal:** ship the thing',
      '**Next step:** write the tests',
      '**Last session:** wrote the renderer',
      '',
      '**Decisions:**',
      '- resolved: 0'
    ].join('\n')

This fixture exercises the blocked branch of `renderBlockage`, so it is the one place `Blocked:`
appears in a unit assertion.

### 4. `test/unit/briefing.test.ts:168`

Same test as item 3, separate assertion.

    for (const heading of ['Related:', 'Open risks:', 'Key decisions:', 'Out of scope:', 'Completion criteria:', 'Not shown:']) {

Breaks because: this is a negative check that each label is absent. Left unrepaired it would pass
vacuously forever, because the unstyled strings can never appear again. That makes it a test that
cannot fail — the same defect Ruling 4 addresses elsewhere. Repair it even though its failure mode
here is the loud one (`Out of scope:` is a substring of nothing after restyle, but `Decisions:` is
a substring of `**Decisions:**`, which is what actually turns it red).

Repair: bold all six.

    for (const heading of ['**Related:**', '**Open risks:**', '**Key decisions:**', '**Out of scope:**', '**Completion criteria:**', '**Not shown:**']) {

### 5. `test/unit/briefing.test.ts:177`

Test: `briefing.pointer-status-is-no-for-a-different-thread` (declared at `:173`).

    assert.ok(rendered.split('\n').includes('Currently being worked: no'))

Repair: `'**Currently being worked:** no'`.

### 6. `test/unit/briefing.test.ts:184`

Test: `briefing.criterion-status-is-open-when-undone-and-unstruck` (declared at `:180`).

    assert.ok(rendered.split('\n').includes(`c1 [open] ${criterion.id}: not started yet`))

Repair: prefix `- ` inside the template.

    assert.ok(rendered.split('\n').includes(`- c1 [open] ${criterion.id}: not started yet`))

### 7. `test/unit/briefing.test.ts:196-200`

Test: `briefing.renders-dangling-and-quarantined-decisions-in-order` (declared at `:187`).

    const decisionsIndex = lines.indexOf('Decisions:')
    assert.equal(lines[decisionsIndex + 1], 'resolved: 0')
    assert.equal(lines[decisionsIndex + 2], 'dangling: dangling-one')
    assert.equal(lines[decisionsIndex + 3], 'dangling: dangling-two')
    assert.equal(lines[decisionsIndex + 4], 'quarantined: quarantined-one')

Breaks because: the `indexOf` returns -1 AND all four row shapes change.

Repair:

    const decisionsIndex = lines.indexOf('**Decisions:**')
    assert.equal(lines[decisionsIndex + 1], '- resolved: 0')
    assert.equal(lines[decisionsIndex + 2], '- dangling: dangling-one')
    assert.equal(lines[decisionsIndex + 3], '- dangling: dangling-two')
    assert.equal(lines[decisionsIndex + 4], '- quarantined: quarantined-one')

The relative offsets are unchanged. No blank line is inserted between `**Decisions:**` and its rows.

### 8. `test/unit/briefing.test.ts:246`

Shared helper, consumed by two tests (items 10 and 11).

    const CRITERION_ROW_PATTERN = /^c\d+ \[(open|done|struck)\] /

Breaks because: anchored at `^`, so the new `- ` prefix defeats it. Measured effect —
`criterionRowCount` returned **0** where 40 was expected, in both consumers.

Repair:

    const CRITERION_ROW_PATTERN = /^- c\d+ \[(open|done|struck)\] /

### 9. `test/unit/briefing.test.ts:270`

Test: `briefing.lane-a-is-the-current-criterions-items-shown-in-full` (declared at `:251`).

    const openRisksIndex = rendered.split('\n').indexOf('Open risks:')

Breaks because: returns -1, and the very next line `:271` asserts it is not -1.

Repair: `'**Open risks:**'`. The `+ 1` offset at `:273` stays correct — the blank line goes
*before* the label, not after it.

### 10. `test/unit/briefing.test.ts:323` and `:328`

Test: `briefing.dangling-and-quarantined-overflow-is-capped-and-counted-in-the-tail` (declared at
`:313`).

    lines.filter((line) => line.startsWith('dangling: ')).length,
    ...
    lines.filter((line) => line.startsWith('quarantined: ')).length,

Breaks because: `startsWith` against a now-prefixed row. Measured — returned 0 where 6 was
expected.

Repair: `'- dangling: '` and `'- quarantined: '`.

## 2b. `test/unit/briefing.test.ts` — two further sites inside already-listed tests

### 11. `test/unit/briefing.test.ts:468`

Test: `briefing.omits-the-not-shown-tail-when-nothing-was-cut` (declared at `:455`).

    assert.equal(rendered.includes('Not shown:'), false)

This one **did not appear in the failure list** — it passes both before and after, because
`Not shown:` is a substring of `**Not shown:**` only when the tail renders, and in this fixture the
tail does not render. But leaving it unrepaired makes it a test that can no longer catch a
regression where the tail renders styled. Repair it:

    assert.equal(rendered.includes('**Not shown:**'), false)

Classification: **survives-unchanged today, repair anyway** for the same reason as Ruling 4.

### 12. `test/unit/briefing.test.ts:569`

Test: `briefing.renders-a-record-byte-maximal-thread-within-budget` (declared at `:541`).

    assert.ok(rendered.includes('Completion criteria:'), 'the completion criteria section still renders on a record-byte-maximal thread')

Breaks together with `:571` (the `criterionRowCount` consumer from item 8).

Repair: `'**Completion criteria:**'`.

## 2c. `test/store/lineage.test.ts` — 1 breaking anchor (MISSED BY THE ARCHITECT)

### 13. `test/store/lineage.test.ts:61`

Test: `lineage.briefing-renders-the-predecessor-it-was-opened-with` (declared at `:35`).

    const relatedIndex = lines.indexOf('Related:')

Observed failure:

    AssertionError: Expected "actual" to be strictly unequal to: -1
      at test/store/lineage.test.ts:62

Breaks because: `indexOf` returns -1, and `:62` asserts it is not -1.

Repair: `'**Related:**'`.

`:63` — `assert.equal(lines[relatedIndex + 1], '- succeeds: The thread that came first (came-first)')`
— **survives unchanged**. The related row already starts with `- ` and the blank line precedes the
label rather than following it, so the `+ 1` offset still lands on the row. Do not touch `:63`.

## 2d. `test/spawn/decisions.test.ts` — 1 breaking anchor

### 14. `test/spawn/decisions.test.ts:303-304`

Test: `decision.outcome-body-is-absent-from-both-briefing-surfaces` (declared at `:276`).

    const keyDecisionsAt = lines.indexOf('Key decisions:')
    const decisionsAt = lines.indexOf('Decisions:')

Observed failure:

    AssertionError: the briefing must carry a Key decisions section
      at test/spawn/decisions.test.ts:305

Repair:

    const keyDecisionsAt = lines.indexOf('**Key decisions:**')
    const decisionsAt = lines.indexOf('**Decisions:**')

`:308` — `assert.equal(lines[keyDecisionsAt + 1], '- link decisions into the spine automatically')` —
**survives unchanged**, same offset reasoning as lineage `:63`. Do not touch it.

## 2e. `test/spawn/resume.test.ts` — 1 breaking anchor (two assertions)

### 15. `test/spawn/resume.test.ts:361` and `:369`

Test: `resume_thread.spawn.contract` (declared at `:343`).

    structured.briefing.includes(`Thread: ${fixtureTitle}`),
    ...
    structured.briefing.includes('Currently being worked: yes'),

Observed failure:

    AssertionError: the returned briefing must carry the resumed thread's own title, proving it was
    rendered rather than stubbed
      at test/spawn/resume.test.ts:360

Repair:

    structured.briefing.includes(`**Thread:** ${fixtureTitle}`),
    ...
    structured.briefing.includes('**Currently being worked:** yes'),

`:365` — `structured.briefing.includes(fixtureCriterion)` — **survives unchanged**. It matches the
criterion *text*, not the row prefix.

## 2f. Anchors that SURVIVE UNCHANGED — do not "fix" these

Each was observed passing with the full restyle applied. Touching them is churn at best and a
correctness regression at worst.

| `path:line` | Assertion | Why it survives |
|---|---|---|
| `test/unit/briefing.test.ts:225` | `assert.equal(rendered.includes('#'), false)` | The restyle introduces `*`, `-` and blank lines, never `#`. **The architect cited `:216` for this. That is wrong — `:216` is `out_of_scope: [{ id: rt.ulid(), text: '# oos heading' }]`, a fixture line. The assertion is at `:225`.** |
| `test/unit/briefing.test.ts:274` | ``assert.equal(..., `- ${currentRisk.id} risk tied to the current criterion`)`` | Risk rows already carry `- `; only the `indexOf` above it (item 9) breaks |
| `test/unit/briefing.test.ts:295-310` | out-of-scope overflow substring checks and `'- 2 out-of-scope items not shown'` | Matches item text and an already-bulleted tail line |
| `test/unit/briefing.test.ts:333` | `'- 2 dangling or quarantined decision ids not shown'` | Already-bulleted tail line |
| `test/unit/briefing.test.ts:358`, `:362`, `:367`, `:371` | lane-C collapse assertions | Risk rows already `- `; tail already `- `; address unstyled |
| `test/unit/briefing.test.ts:406`, `:411` | risk-collapse assertions in the hidden-cap test | Same |
| `test/unit/briefing.test.ts:434` | ``rendered.includes(`- ${wrongTagRisk.id} a risk naming an unknown criterion`)`` | Risk row already `- ` |
| `test/unit/briefing.test.ts:449-452` | lane-cap overflow checks | Substring and already-bulleted tail |
| `test/unit/briefing.test.ts:486`, `:490` | survivor id and `'- 160 completion criteria not shown'` | Id substring; already-bulleted tail |
| `test/unit/briefing.test.ts:554-567` | character-cap and byte-cap assertions | Numeric budget checks, not text shapes. **Note: the restyle adds bytes. Both still passed.** |
| `test/store/lineage.test.ts:63` | `'- succeeds: ...'` | Already `- `; offset preserved |
| `test/spawn/decisions.test.ts:308` | `'- link decisions into the spine automatically'` | Already `- `; offset preserved |
| `test/spawn/resume.test.ts:365` | `includes(fixtureCriterion)` | Matches text, not prefix |
| `test/unit/roster.test.ts:85`, `:102`, `:288-290`, `:327-331` | `Thread:`, `Blocked:`, `Blockage: none`, `Next step:` | **Different renderer.** These belong to `src/render/roster.ts`, which this unit does not touch. Leave the roster alone entirely. |
| all of `test/spawn/forgery.test.ts` | see section 3 | see section 3 |
| all of `test/unit/briefing-frontier-sweep.test.ts` | see section 4 | passes on the restyled renderer |

### The special case: a survivor that must still be repaired

`test/unit/briefing.test.ts:398` survives — and that is exactly the problem. See Ruling 4 in
section 5. It is listed here so you do not classify it as "survives, leave it".

---

# 3. The `forgery.test.ts` finding

## What this file does

`test/spawn/forgery.test.ts` proves that text a user stored in a thread cannot forge Markdown
structure in the rendered briefing — that a malicious title cannot inject a heading or a list
marker that the server did not author.

It works by rendering two briefings, one from a hostile fixture and one from a benign control, and
comparing their *structure*. Two patterns do the work:

`test/spawn/forgery.test.ts:47`

    const HEADING_AT_LINE_START = /^[ \t]*#/

`test/spawn/forgery.test.ts:48`

    const STRUCTURAL_MARKER_AT_LINE_START = /^[ \t]*(#{1,6}|[-*+>]|`{3}|~{3}|\d+[.)])(?=\s|$)/

The comparison is at `test/spawn/forgery.test.ts:267-271`:

    assert.deepEqual(
      markerSequenceOf(hostile),
      markerSequenceOf(control),
      `${surface}: the stored payload introduced a line-start structural marker the server did not author`
    )

## Executed result: which restyled line shapes match

Every restyled line shape was run against both patterns.

| Restyled line shape | `STRUCTURAL_MARKER_AT_LINE_START` | `HEADING_AT_LINE_START` |
|---|---|---|
| `**Thread:** Ship the renderer` | no match | false |
| `**Status:** open` | no match | false |
| `**Blockage:** none` | no match | false |
| `**Blocked:** still finishing docs` | no match | false |
| `**Currently being worked:** yes` | no match | false |
| `**Active goal:** ship it` | no match | false |
| `**Next step:** add tests` | no match | false |
| `**Last session:** wrote a draft` | no match | false |
| `` (the new blank line) | no match | false |
| `**Related:**` | no match | false |
| `**Open risks:**` | no match | false |
| `**Key decisions:**` | no match | false |
| `**Out of scope:**` | no match | false |
| `**Completion criteria:**` | no match | false |
| `**Decisions:**` | no match | false |
| `**Not shown:**` | no match | false |
| `See logbook://thread/01ABC for the complete record.` | no match | false |
| `- succeeds: A title (a-slug)` | **matches, captures `-`** | false |
| `- 01ABC a risk` | **matches, captures `-`** | false |
| `- c1 [open] 01ABC: text` | **matches, captures `-`** | false |
| `- resolved: 1` | **matches, captures `-`** | false |
| `- dangling: 01ABC` | **matches, captures `-`** | false |
| `- quarantined: 01ABC` | **matches, captures `-`** | false |
| `- 2 risks not shown` | **matches, captures `-`** | false |

## Why the bold lines do not match

The alternation `[-*+>]` matches exactly **one** `*`. The lookahead `(?=\s|$)` then demands
whitespace or end-of-line immediately after it. In `**Thread:**` the character after the first `*`
is another `*`, so the lookahead fails and the whole pattern fails. This is the property the plan
already relied on — see `docs/plans/2026-08-26-briefing-markdown-styling-PLAN.md:122`.

The blank line does not match because `^[ \t]*` consumes nothing and the alternation then has no
character to match.

## Verdict

**`test/spawn/forgery.test.ts` needs NO change.**

Three reasons, all observed:

1. No restyled line begins with `#`, so every `headingLinesOf` assertion still yields the empty
   array (`:252-260`).
2. The marker sequence is compared hostile-against-control, and both sides are produced by the same
   restyled renderer. New `-` markers appear in both sequences at the same indices, so the
   `deepEqual` at `:267` still holds.
3. The line-count assertion at `:261-266` compares hostile to control, and the restyle adds the
   same number of blank lines to both.

Confirmed by execution: all five tests in the file passed with the full restyle applied, inside the
431-test run.

**Guard rail for the implementer:** the marker comparison is hostile-vs-control, so it would only
break if the restyle made the *number of sections* depend on field content. It does not — the
blank-line and label spreads key off `.shown.length`, which is a count, not text. Do not introduce
a section whose presence depends on what a string contains.

---

# 4. The frontier sweep fill mechanism

File: `/Users/satanshumishra/Documents/DevLabs/logbook/test/unit/briefing-frontier-sweep.test.ts`
Fixture builder: `/Users/satanshumishra/Documents/DevLabs/logbook/test/support/briefing-sweep-fixture.ts`

## What the sweep is

It manufactures thread records across a grid of shapes, renders each one, and asserts that no
rendered briefing exceeds either of two budgets — a character cap and a byte cap. A "fill" is the
single character it repeats to pad every text field to its schema limit.

## How a fill is declared

`test/unit/briefing-frontier-sweep.test.ts:18-24`

    const ASCII_FILL = 'x'
    const MULTI_BYTE_FILL = '漢'

    const FILLS = [
      { name: 'ascii', char: ASCII_FILL },
      { name: 'cjk', char: MULTI_BYTE_FILL }
    ] as const

Two constants, then one `as const` array of `{ name, char }` pairs. That is the entire declaration
surface.

## How a fill is consumed — five sites

| `path:line` | What it does |
|---|---|
| `test/unit/briefing-frontier-sweep.test.ts:152` | `for (const fill of FILLS)` — the outermost loop of the grid |
| `test/unit/briefing-frontier-sweep.test.ts:248` | `for (const fill of FILLS)` — the invariant loop that asserts both declared exclusions |
| `test/unit/briefing-frontier-sweep.test.ts:287` | diagnostic line naming the fill dimension |
| `test/unit/briefing-frontier-sweep.test.ts:309` | per-fill assertion that the fill produced at least one admissible record |
| `test/unit/briefing-frontier-sweep.test.ts:317` | `worstPerFill`, used only to build the failure message |

The character reaches the fixture through `SweepShape.fill`
(`test/support/briefing-sweep-fixture.ts:7`) and is repeated by `fillOf` at
`test/support/briefing-sweep-fixture.ts:34`.

## The declared-grid mechanism

The grid is a nested product of five dimensions, built at
`test/unit/briefing-frontier-sweep.test.ts:152-155`: fill, anchoring, criteria count, key-decision
count — and then, per combination, a computed set of criterion text lengths from
`criterionTextLengthsFor` (`:102-147`). Adding a fill multiplies the whole grid by the number of
fills.

Measured, on the restyled renderer:

    # two fills
    node --test test/unit/briefing-frontier-sweep.test.ts
    # 526 records classified in 9890ms, 1 test, 1 pass

    # three fills
    node --test test/unit/briefing-frontier-sweep.test.ts
    # 819 records classified in 18726ms, 1 test, 1 pass

So a third fill costs roughly **+293 records and +9 seconds**. The sweep passes at three fills on
the restyled renderer. This is measured, not predicted.

## What must be updated for a third fill

Exactly two edits, plus two wording repairs (section 5, Ruling 1):

1. Add the constant beside `MULTI_BYTE_FILL` at
   `test/unit/briefing-frontier-sweep.test.ts:19`, and add its `{ name, char }` entry to `FILLS` at
   `:21-24`.
2. Add its byte-width assertion after `:241` — see the gap below.

Nothing else. All five consumption sites iterate `FILLS` and pick the new entry up automatically.
This was confirmed by running the three-fill sweep green.

## The two declared invariants, quoted verbatim

Both live in the loop at `test/unit/briefing-frontier-sweep.test.ts:248-260`. Any new fill must
satisfy both, because the sweep *declares* them as its exclusions.

Invariant 1 — escape passthrough, `test/unit/briefing-frontier-sweep.test.ts:249-253`:

    assert.equal(
      escapeStored(fill.char),
      fill.char,
      `the ${fill.name} fill must pass through the stored-text escape unchanged, which is the exclusion this sweep declares for the escape-expanding fill class`
    )

Invariant 2 — grapheme density, `test/unit/briefing-frontier-sweep.test.ts:255-259`:

    assert.equal(
      Array.from(graphemeSegmenter.segment(probe)).length,
      probe.length,
      `a run of the ${fill.name} fill must carry one grapheme per UTF-16 unit, which is the exclusion this sweep declares for grapheme density`
    )

## The byte-width assertion gap at `:240-241`

`test/unit/briefing-frontier-sweep.test.ts:240-241`

    assert.equal(Buffer.byteLength(ASCII_FILL, 'utf8'), 1, 'the ASCII fill must be one byte per character')
    assert.equal(Buffer.byteLength(MULTI_BYTE_FILL, 'utf8'), 3, 'the multi-byte fill must be three bytes per character')

These name their constants directly instead of iterating `FILLS`. A third fill added to `FILLS`
therefore arrives with **no byte assertion at all** — silently. That is the gap. The byte width is
the whole reason the fill dimension exists (the byte cap is one of the two budgets), so an
unasserted fill width is an unpinned premise.

Add one line for the new fill, in the same style.

## Cap satisfaction: aggregate, not per fill

This matters for how you read a failure.

- The cap assertion is **aggregate**: `test/unit/briefing-frontier-sweep.test.ts:321-329` asserts
  `breaching.length === 0` over *all* swept records, regardless of fill.
- The only **per-fill** assertion is `:309-314`, and it asserts merely that each fill produced at
  least one schema-admissible record — that the fill was exercised at all, not that it stayed
  within budget.
- `worstPerFill` at `:316-319` is **diagnostic only**. It shapes the failure message at `:326`; it
  asserts nothing.

Consequence: if the new fill breaches a cap, the failure message says "N of 819 swept records
exceeded..." and you must read the `worst <fill>:` lines to learn which fill it was.

---

# 5. The four rulings, as binding implementation steps

These override the original brief. They are instructions, not options.

## RULING 1 — the third sweep fill is `_`, `[` or `]` ONLY

**Do:** pick the new fill character from `_`, `[`, `]`. Nothing else.

**Do NOT** use `*`, a backtick, or `~`.

**Why, measured.** Those three are members of `MARKDOWN_LEADING_CHARS` at
`/Users/satanshumishra/Documents/DevLabs/logbook/src/render/escape.ts:7`:

    const MARKDOWN_LEADING_CHARS = new Set(['#', '-', '*', '+', '>', '`', '~'])

`escapeStored` rewrites them into a `U+XXXX` token, which grows the text roughly sixfold. That is
precisely the "escape-expanding fill class" the sweep declares it does **not** sweep, so such a
fill would violate the invariant at `test/unit/briefing-frontier-sweep.test.ts:249-253`. Changing
what the sweep claims about that class is a different unit of work.

Executed evidence:

    node --input-type=module -e "import { escapeStored } from './src/render/escape.ts'; ..."

    "_" escape="_"       passthrough=true  bytes=1 utf16=1 graphemes=4
    "[" escape="["       passthrough=true  bytes=1 utf16=1 graphemes=4
    "]" escape="]"       passthrough=true  bytes=1 utf16=1 graphemes=4
    "*" escape="U+002A"  passthrough=false bytes=1 utf16=1 graphemes=4
    "`" escape="U+0060"  passthrough=false bytes=1 utf16=1 graphemes=4
    "~" escape="U+007E"  passthrough=false bytes=1 utf16=1 graphemes=4

All three permitted characters pass **both** declared invariants unchanged: escape passthrough and
one grapheme per UTF-16 unit.

**Also do (1a):** add the missing byte-width assertion. After
`test/unit/briefing-frontier-sweep.test.ts:241`, add one assertion for the new fill, matching the
existing style. Verified green with `_`:

    const DELIMITER_FILL = '_'
    ...
    assert.equal(Buffer.byteLength(DELIMITER_FILL, 'utf8'), 1, 'the delimiter fill must be one byte per character')

**Also do (1b):** reword the two `SWEEP_FIXTURE_NOT_SWEPT` entries that say "both swept fills".
With three fills the phrase is factually false, and it is printed verbatim as a declaration of
coverage at `test/unit/briefing-frontier-sweep.test.ts:302`
(`t.diagnostic(\`not swept: ${excluded}\`)`). A false coverage declaration is worse than none.

The two entries, at
`/Users/satanshumishra/Documents/DevLabs/logbook/test/support/briefing-sweep-fixture.ts:29` and
`:30`, currently read:

    'the escape-expanding fill class, meaning characters the stored-text escape rewrites into a U+XXXX token and so grows roughly sixfold; both swept fills pass through that escape unchanged, so no swept record carries one',
    'grapheme density, meaning how many UTF-16 code units one reader-visible character spans; both swept fills are exactly one code unit per grapheme, so every swept record has a grapheme count equal to its character count'

Replace "both swept fills" with wording that does not assert a count — for example "every swept
fill". Keep the rest of each sentence intact.

## RULING 2 — `test/unit/briefing-styling-cost.test.ts` is this unit's acceptance test

**Do:** keep it. Do not delete it. Do not treat it as an intruder or as stray work.

It arrived from a parallel `test-engineer` dispatch and it is **acceptance criterion 1**.

It is currently untracked. `git status --short` reports:

    ?? test/unit/briefing-styling-cost.test.ts

Observed current failure, re-runnable:

    node --test test/unit/briefing-styling-cost.test.ts

    ✖ briefing.styling-cost-is-a-function-of-sections-not-of-record-count
      AssertionError: expected the rendered briefing to carry at least one "**" bold marker, got 0
        at test/unit/briefing-styling-cost.test.ts:66:10

What it asserts, in plain words: the briefing carries at least one bold marker
(`test/unit/briefing-styling-cost.test.ts:66-69`), and the *number* of bold markers is identical at
5 criteria and at 40 criteria (`:70-74`). That second assertion is the real constraint — it forbids
styling individual rows in bold, because that would make the count grow with the record.

Consequence for your implementation: **bold goes on headers and section labels only, never on a
row.** The criterion row gets `- `, not `**`.

Confirmed green under the restyle described in this document.

## RULING 3 — mandate the map-pair blank-line shape

**REQUIRED shape** — two separate `.map()` spreads per section, one emitting the blank line and one
emitting the label:

    ...risks.shown.slice(0, 1).map(() => ''),
    ...risks.shown.slice(0, 1).map(() => '**Open risks:**'),
    ...riskLines,

**FORBIDDEN shape** — a `flatMap` whose callback returns an array literal:

    ...sections.filter((section) => section.present).flatMap((section) => ['', section.label, ...section.lines]),

**Why, measured.** Both shapes were applied to the renderer in the probe copy and
`render.no-unescaped-site` was run against each.

    node --test test/contract/render-census.test.ts

| Shape | Result |
|---|---|
| baseline, unmodified | 2 tests, **2 pass**, 0 fail |
| forbidden `flatMap` array-literal | 2 tests, 1 pass, **1 fail** |
| required map-pair spreads | 2 tests, **2 pass**, 0 fail |

The exact halt under the forbidden shape:

    render.no-unescaped-site: 1 of 118 interpolation sites reach the model unescaped
    src/render/briefing.ts:267 ['', section.label, ...section.lines]

The census cannot resolve a spread element inside an array literal back to its terminal values, so
it classifies the whole literal as unclassifiable and halts.

**Honest discrepancy, recorded:** the ruling states the flatMap form halted with **6** unclassifiable
sites. The formulation measured here halted with **1**. The direction is identical and confirmed —
the flatMap form halts, the map-pair form does not — but the count depends on how the flatMap is
written. Ship the map-pair shape; do not rely on the number 6.

**Where the blank line goes:** *before* the label, never after it. This is load-bearing. Several
surviving assertions read `lines[labelIndex + 1]` and expect the first row
(`test/store/lineage.test.ts:63`, `test/spawn/decisions.test.ts:308`,
`test/unit/briefing.test.ts:273`). Putting the blank line after the label would break all three and
they are currently listed as survivors.

**Where a blank line is NOT inserted:** between `**Decisions:**` and its rows. See item 7 of the
census — the offsets `+1` through `+4` at `test/unit/briefing.test.ts:197-200` are repaired to keep
those exact offsets.

## RULING 4 — repair `test/unit/briefing.test.ts:398-404` even though it passes

**Do:** change the pattern at `test/unit/briefing.test.ts:398`.

    const hiddenCriterionRow = /^c41 \[/

to

    const hiddenCriterionRow = /^- c41 \[/

**Why.** The assertion at `:400-404` is a *negative* one — it asserts criterion 41 is NOT rendered:

    assert.equal(
      rendered.split('\n').some((line) => hiddenCriterionRow.test(line)),
      false,
      'the done criterion at ordinal 41 must be pushed out of the 40 shown slots by the 40 open ones that outrank it'
    )

After the restyle a rendered criterion row reads `- c41 [...`. The pattern `/^c41 \[/` is anchored
at `^`, so it can never match that. The assertion would then pass **even if criterion 41 were
rendered** — a test that cannot fail, which proves nothing.

Confirmed by execution: with the full restyle applied and this pattern left alone, the test
`briefing.a-risk-on-a-criterion-hidden-by-the-cap-still-collapses-to-lane-c`
(`test/unit/briefing.test.ts:378`) **did not appear in the failure list** — it passed silently and
vacuously. That silence is the defect.

The same reasoning applies to census item 4 (`:168`) and item 11 (`:468`). Repair all three.

---

# 6. `render.no-unescaped-site`

## What it is

A census that proves no user-supplied text reaches the model without passing through the escape
function. "Escape" here means `escapeStored`
(`/Users/satanshumishra/Documents/DevLabs/logbook/src/render/escape.ts:22`), which neutralises
characters that could forge Markdown structure or carry invisible control codes.

## Where it lives

- The test: `/Users/satanshumishra/Documents/DevLabs/logbook/test/contract/render-census.test.ts:483`
- The closed list of files it covers: `test/contract/render-census.test.ts:16-24`. `src/render/briefing.ts` is the first entry, at `:17`.
- The classifier: `test/contract/render-census.test.ts:371-375`
- The failure-message builder: `test/contract/render-census.test.ts:379-385`

Run it with:

    node --test test/contract/render-census.test.ts

## How it works

It parses the TypeScript source, finds every place a value is interpolated into a string — template
literals (`:328-331`), string concatenations (`:333-339`) and `.join()` calls (`:347-350`) — and
classifies each one into exactly three buckets (`test/contract/render-census.test.ts:33`):

- `escaped` — the value passes through `escapeStored` or `clipGraphemes` wrapping it
- `server-authored` — the value is a literal the server wrote, or a number or boolean
- `unclassifiable` — anything else

## What makes it halt

`test/contract/render-census.test.ts:371-375`:

    export const classifySite = (site: Site): Classified<Site>['verdict'] | 'unclassifiable' => {
      if (site.classification === 'escaped') return 'allowed'
      if (site.classification === 'server-authored') return 'allowed'
      return 'unclassifiable'
    }

Anything that is not provably escaped or provably server-authored halts the census. This is by
design: it is a closed census, so it fails on what it cannot prove rather than passing on what it
did not check.

The resolver gives up in specific structural situations. The one that bites here is at
`test/contract/render-census.test.ts:229-238`: when resolving an iteration callback parameter it
requires every terminal to be an **array literal whose elements each resolve**, and it returns
`null` — meaning unclassifiable — the moment an element does not resolve. A spread element
(`...section.lines`) inside such a literal does not resolve.

There is also a depth limit, `MAX_RESOLUTION_DEPTH = 12` at
`test/contract/render-census.test.ts:31`, beyond which everything is unclassifiable
(`:314-315`). Deeply nested helper indirection will halt it too.

## The exact construction shape that passes

Verified green, 2 tests / 2 pass, with the full restyle applied:

    ...relatedThreads.slice(0, 1).map(() => ''),
    ...relatedThreads.slice(0, 1).map(() => '**Related:**'),
    ...relatedLines,
    ...risks.shown.slice(0, 1).map(() => ''),
    ...risks.shown.slice(0, 1).map(() => '**Open risks:**'),
    ...riskLines,
    ...keyDecisions.shown.slice(0, 1).map(() => ''),
    ...keyDecisions.shown.slice(0, 1).map(() => '**Key decisions:**'),
    ...keyDecisionLines,
    ...outOfScope.shown.slice(0, 1).map(() => ''),
    ...outOfScope.shown.slice(0, 1).map(() => '**Out of scope:**'),
    ...outOfScopeLines,
    ...criteria.shown.slice(0, 1).map(() => ''),
    ...criteria.shown.slice(0, 1).map(() => '**Completion criteria:**'),
    ...criterionLines,
    '',
    '**Decisions:**',
    `- resolved: ${decisionIntegrity.resolved}`,
    ...dangling.shown.map(renderDanglingLine),
    ...quarantined.shown.map(renderQuarantinedLine),
    ...notShownBulletLines.slice(0, 1).map(() => ''),
    ...notShownBulletLines.slice(0, 1).map(() => '**Not shown:**'),
    ...notShownBulletLines,
    ...notShownBulletLines.slice(0, 1).map(() => `See ${clip(notShownAddress, 200)} for the complete record.`)

Each callback returns a **bare string literal**. The census classifies a bare literal as
`server-authored` directly (`test/contract/render-census.test.ts:292`) with no resolution needed.
That is why this shape is safe and the array-literal shape is not.

The `**Decisions:**` block uses plain literals rather than `.map()` spreads because that section is
unconditional — it always renders.

---

# 7. Order of work, and the receipt

## Suggested order

1. Apply the renderer change (section 1), using the mandated shape from Ruling 3 / section 6.
2. Run the acceptance test. It must go green.
3. Apply the 15 test repairs (section 2).
4. Apply Ruling 4's three cannot-fail repairs (census items 4, 11, and `:398`).
5. Apply Ruling 1 (the third fill, its byte assertion, and the two wording repairs).
6. Run the full suite.

## The receipt this work must produce

Run and read, do not infer:

    node --test test/unit/briefing-styling-cost.test.ts   # acceptance criterion 1
    node --test test/contract/render-census.test.ts       # the census must stay 2/2
    npm test                                              # the whole suite

Measured expected end state, from the probe copy with everything applied:

    431 tests, 428 pass, 3 fail

...where those 3 are the `.git`-dependent copy artifacts named at the top of this document, which
pass in the real repository. In the real repository the expected end state is **431 tests, 431 pass,
0 fail**.

Note the total stays 431 because the acceptance test was already counted in the baseline — it was
present and red, not absent.

## Two facts marked UNVERIFIED

1. **UNVERIFIED** — the exact character to use for the third fill. Ruling 1 permits `_`, `[` or `]`
   and all three were measured to satisfy both invariants. `_` was the one actually run through the
   three-fill sweep (819 records, green). If you choose `[` or `]`, the invariants still hold by
   measurement but the full sweep was not run with them.
2. **UNVERIFIED** — whether `docs/plans/2026-08-26-briefing-markdown-styling-PLAN.md` needs updating
   to match the shipped shape. Not inspected as part of this census; it is documentation, not a
   gate.
