import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderBriefingWithPasses,
  BRIEFING_MAX_CHARS,
  BUDGET_EXCEEDED_BULLET,
  RELATED_TITLE_FLOOR,
  RELATED_SLUG_FLOOR,
  RISK_TEXT_FLOOR,
  RISK_REF_FLOOR,
  KEY_DECISION_TITLE_FLOOR,
  OUT_OF_SCOPE_TEXT_FLOOR,
  CRITERION_TEXT_FLOOR,
  CRITERION_CHECK_FLOOR,
  CRITERION_RESULT_FLOOR,
  CRITERION_SETTLED_BY_FLOOR,
  LAST_SESSION_TEXT_FLOOR,
  ARTIFACT_LABEL_FLOOR,
  ARTIFACT_POINTER_FLOOR,
  type DecisionIntegrity
} from '../../src/render/briefing.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { ThreadRecord, type Thread, type Criterion, type Risk, type KeyDecision, type OutOfScope, type Artifact } from '../../src/schema/thread.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { itemCountOverBudgetThread } from '../support/briefing-item-count-over-budget-fixture.ts'
import {
  THREAD_TITLE_MAX,
  THREAD_SLUG_MAX,
  RISK_TEXT_MAX,
  RISK_REF_MAX,
  KEY_DECISION_TITLE_MAX,
  OUT_OF_SCOPE_TEXT_MAX,
  CRITERION_TEXT_MAX,
  CRITERION_CHECK_MAX,
  CRITERION_RESULT_MAX,
  CRITERION_SETTLED_BY_MAX,
  SESSION_BODY_MAX,
  ARTIFACT_LABEL_MAX,
  ARTIFACT_POINTER_MAX
} from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemeCount = (text: string): number => Array.from(GRAPHEME_SEGMENTER.segment(text)).length
const expectedFloorRender = (rawText: string, floor: number): number => Math.min(graphemeCount(escapeStored(rawText)), floor)

const sectionLines = (page: string, heading: string): string[] => {
  const lines = page.split('\n')
  const headingAt = lines.indexOf(heading)
  if (headingAt === -1) return []
  const after = lines.slice(headingAt + 1)
  const contentStart = after.findIndex((line) => line.length > 0)
  if (contentStart === -1) return []
  const rest = after.slice(contentStart)
  const blankAt = rest.findIndex((line) => line.length === 0)
  return blankAt === -1 ? rest : rest.slice(0, blankAt)
}

const ARTIFACTS_HEADING = '**Artifacts:**'
const RELATED_HEADING = '**Related:**'
const RISKS_HEADING = '**Open risks:**'
const KEY_DECISIONS_HEADING = '**Key decisions:**'
const OUT_OF_SCOPE_HEADING = '**Out of scope:**'
const CRITERIA_HEADING = '**Completion criteria:**'
const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'
const LAST_SESSION_HEADING = '**Last session:**'

const ULID_GROUP = '[0-9A-HJKMNP-TV-Z]{26}'
const CRITERION_TEXT_LINE = new RegExp(
  `^- c\\d+ \\[(?:open|done|struck)\\] \\[(?:confirmed|proposed|unsettled)\\]: (.*) \\(id ${ULID_GROUP}\\)$`
)
const CHECK_LINE = /^ {2}- check: (.*)$/
const RESULT_LINE = /^ {2}- result: (.*) \((?:verified|unverified-reasoned|not recorded)\)$/
const SETTLED_BY_LINE = /^ {2}- settled by: (.*)$/
const RISK_LINE = new RegExp(`^- ${ULID_GROUP} (.*)$`)
const RISK_REF_LINE = /^ {2}- ref: (.*)$/
const KEY_DECISION_LINE = new RegExp(`^- (.*) \\(decision ${ULID_GROUP}\\)$`)
const OUT_OF_SCOPE_LINE = /^- (.*)$/
const ARTIFACT_LINE = /^- (.*?): (.*)$/
const SESSION_ENTRY_LINE = new RegExp(`^- ${ULID_GROUP} (.*)$`)
const SETTLED_RISK_LINE = new RegExp(`^- risk ${ULID_GROUP} (.*)$`)
const SETTLED_DECISION_LINE = new RegExp(`^- decision ${ULID_GROUP} (.*)$`)
const RELATED_LINE = /^- succeeds: (.*) \((.*)\)$/

const capturesIn = (lines: readonly string[], pattern: RegExp, group: number): string[] =>
  lines.flatMap((line) => {
    const matched = pattern.exec(line)
    const value = matched === null ? undefined : matched[group]
    return value === undefined ? [] : [value]
  })

type FieldSpec = { name: string; floor: number; heading: string; pattern: RegExp; group: number; rawText: string }

const measureRendered = (page: string, spec: FieldSpec): number[] =>
  capturesIn(sectionLines(page, spec.heading), spec.pattern, spec.group).map(graphemeCount)

const assertEveryFieldAtLeastFloor = (page: string, specs: readonly FieldSpec[], label: string): void => {
  for (const spec of specs) {
    const rendered = measureRendered(page, spec)
    assert.ok(
      rendered.length > 0,
      `${label} must render at least one ${spec.name}, or this measurement passes over an empty population; found none under heading ${JSON.stringify(spec.heading)}`
    )
    const expected = expectedFloorRender(spec.rawText, spec.floor)
    for (const value of rendered) {
      assert.ok(
        value >= expected,
        `on ${label} a rendered ${spec.name} kept ${value} graphemes, below the guaranteed floor of ${expected} (the smaller of its stored escaped length and its floor of ${spec.floor})`
      )
    }
  }
}

const largestFloorMargin = (page: string, specs: readonly FieldSpec[]): { name: string; margin: number; rendered: number } => {
  let best = { name: 'none', margin: Number.NEGATIVE_INFINITY, rendered: 0 }
  for (const spec of specs) {
    for (const value of measureRendered(page, spec)) {
      const margin = value - spec.floor
      if (margin > best.margin) best = { name: spec.name, margin, rendered: value }
    }
  }
  return best
}

type Fixture = { thread: Thread; predecessor: Thread; entries: SessionEntry[]; specs: FieldSpec[] }

type FloorRawText = (floor: number, cap: number) => string

const SLUG_SAFE_FILL_CHAR = 'a'
const slugSafeFillFor = (floor: number, cap: number): string => SLUG_SAFE_FILL_CHAR.repeat(Math.min(floor, cap))

const buildFloorFixture = (rawTextFor: FloorRawText, sessionRawText?: string, sessionEntryCount: number = 1): Fixture => {
  const relatedTitleText = rawTextFor(RELATED_TITLE_FLOOR, THREAD_TITLE_MAX)
  const relatedSlugText = slugSafeFillFor(RELATED_SLUG_FLOOR, THREAD_SLUG_MAX)
  const riskText = rawTextFor(RISK_TEXT_FLOOR, RISK_TEXT_MAX)
  const settledRiskText = rawTextFor(RISK_TEXT_FLOOR, RISK_TEXT_MAX)
  const riskRefText = rawTextFor(RISK_REF_FLOOR, RISK_REF_MAX)
  const keyDecisionText = rawTextFor(KEY_DECISION_TITLE_FLOOR, KEY_DECISION_TITLE_MAX)
  const settledKeyDecisionText = rawTextFor(KEY_DECISION_TITLE_FLOOR, KEY_DECISION_TITLE_MAX)
  const outOfScopeText = rawTextFor(OUT_OF_SCOPE_TEXT_FLOOR, OUT_OF_SCOPE_TEXT_MAX)
  const criterionText = rawTextFor(CRITERION_TEXT_FLOOR, CRITERION_TEXT_MAX)
  const criterionCheckText = rawTextFor(CRITERION_CHECK_FLOOR, CRITERION_CHECK_MAX)
  const criterionResultText = rawTextFor(CRITERION_RESULT_FLOOR, CRITERION_RESULT_MAX)
  const criterionSettledByText = rawTextFor(CRITERION_SETTLED_BY_FLOOR, CRITERION_SETTLED_BY_MAX)
  const artifactLabelText = rawTextFor(ARTIFACT_LABEL_FLOOR, ARTIFACT_LABEL_MAX)
  const artifactPointerText = rawTextFor(ARTIFACT_POINTER_FLOOR, ARTIFACT_POINTER_MAX)
  const sessionBodyText = sessionRawText ?? rawTextFor(LAST_SESSION_TEXT_FLOOR, SESSION_BODY_MAX)

  const anchorCriterion: Criterion = {
    id: rt.ulid(),
    ordinal: 1,
    text: criterionText,
    done: true,
    kind: 'planned',
    check: criterionCheckText,
    result: criterionResultText,
    result_status: 'verified',
    struck_by: null,
    settledness: 'confirmed',
    settled_by: criterionSettledByText
  }

  const liveRisk: Risk = { id: rt.ulid(), scope: 'floors', text: riskText, refs: [riskRefText], retired: false }
  const settledRisk: Risk = {
    id: rt.ulid(),
    scope: 'floors',
    text: settledRiskText,
    refs: [],
    retired: false,
    criterion_id: anchorCriterion.id
  }
  const liveKeyDecision: KeyDecision = { id: rt.ulid(), decision_id: rt.ulid(), title: keyDecisionText, scope: 'floors' }
  const settledKeyDecision: KeyDecision = {
    id: rt.ulid(),
    decision_id: rt.ulid(),
    title: settledKeyDecisionText,
    scope: 'floors',
    criterion_id: anchorCriterion.id
  }
  const outOfScope: OutOfScope = { id: rt.ulid(), text: outOfScopeText }
  const artifact: Artifact = { id: rt.ulid(), label: artifactLabelText, pointer: artifactPointerText, retired: false }

  const predecessor: Thread = {
    id: rt.ulid(),
    slug: relatedSlugText,
    title: relatedTitleText,
    status: 'done',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: '',
      next_step: '',
      landed: '',
      last_session: '',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }

  const thread: Thread = {
    id: rt.ulid(),
    slug: 'floor-fixture',
    title: 'a fixture stressing every clip-governed field at once',
    status: 'open',
    blocked_by: null,
    predecessor_id: predecessor.id,
    completion_criteria: [anchorCriterion],
    artifacts: [artifact],
    spine: {
      active_goal: 'stress every clip-governed field at once',
      next_step: 'measure the floors',
      landed: '',
      last_session: '',
      open_risks: [liveRisk, settledRisk],
      key_decisions: [liveKeyDecision, settledKeyDecision],
      out_of_scope: [outOfScope]
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }

  const entries: SessionEntry[] = Array.from({ length: sessionEntryCount }, () => rt.ulid())
    .sort()
    .map((id) => ({ id, thread_id: thread.id, actor: 'claude', body: sessionBodyText, created_at: rt.now() }))

  const specs: FieldSpec[] = [
    { name: 'related title', floor: RELATED_TITLE_FLOOR, heading: RELATED_HEADING, pattern: RELATED_LINE, group: 1, rawText: relatedTitleText },
    { name: 'related slug', floor: RELATED_SLUG_FLOOR, heading: RELATED_HEADING, pattern: RELATED_LINE, group: 2, rawText: relatedSlugText },
    { name: 'risk text', floor: RISK_TEXT_FLOOR, heading: RISKS_HEADING, pattern: RISK_LINE, group: 1, rawText: riskText },
    { name: 'risk reference', floor: RISK_REF_FLOOR, heading: RISKS_HEADING, pattern: RISK_REF_LINE, group: 1, rawText: riskRefText },
    { name: 'settled risk text', floor: RISK_TEXT_FLOOR, heading: SETTLED_HEADING, pattern: SETTLED_RISK_LINE, group: 1, rawText: settledRiskText },
    { name: 'key decision title', floor: KEY_DECISION_TITLE_FLOOR, heading: KEY_DECISIONS_HEADING, pattern: KEY_DECISION_LINE, group: 1, rawText: keyDecisionText },
    {
      name: 'settled key decision title',
      floor: KEY_DECISION_TITLE_FLOOR,
      heading: SETTLED_HEADING,
      pattern: SETTLED_DECISION_LINE,
      group: 1,
      rawText: settledKeyDecisionText
    },
    { name: 'out of scope text', floor: OUT_OF_SCOPE_TEXT_FLOOR, heading: OUT_OF_SCOPE_HEADING, pattern: OUT_OF_SCOPE_LINE, group: 1, rawText: outOfScopeText },
    { name: 'criterion text', floor: CRITERION_TEXT_FLOOR, heading: CRITERIA_HEADING, pattern: CRITERION_TEXT_LINE, group: 1, rawText: criterionText },
    { name: 'criterion check', floor: CRITERION_CHECK_FLOOR, heading: CRITERIA_HEADING, pattern: CHECK_LINE, group: 1, rawText: criterionCheckText },
    { name: 'criterion result', floor: CRITERION_RESULT_FLOOR, heading: CRITERIA_HEADING, pattern: RESULT_LINE, group: 1, rawText: criterionResultText },
    {
      name: 'criterion settled by',
      floor: CRITERION_SETTLED_BY_FLOOR,
      heading: CRITERIA_HEADING,
      pattern: SETTLED_BY_LINE,
      group: 1,
      rawText: criterionSettledByText
    },
    { name: 'artifact label', floor: ARTIFACT_LABEL_FLOOR, heading: ARTIFACTS_HEADING, pattern: ARTIFACT_LINE, group: 1, rawText: artifactLabelText },
    { name: 'artifact pointer', floor: ARTIFACT_POINTER_FLOOR, heading: ARTIFACTS_HEADING, pattern: ARTIFACT_LINE, group: 2, rawText: artifactPointerText },
    { name: 'last session text', floor: LAST_SESSION_TEXT_FLOOR, heading: LAST_SESSION_HEADING, pattern: SESSION_ENTRY_LINE, group: 1, rawText: sessionBodyText }
  ]

  return { thread, predecessor, entries, specs }
}

const FLOOR_MARGIN_GRAPHEMES = 250
const STEALER_GRAPHEMES = SESSION_BODY_MAX
const ESCAPE_EXPLODING_SESSION_ENTRY_COUNT = 12
const ESCAPE_TOKEN_MAX_GRAPHEMES = 8

const marginedWithinCap = (floor: number, cap: number): string => 'x'.repeat(Math.min(floor + FLOOR_MARGIN_GRAPHEMES, cap))

const assertRecordAdmissible = (fixture: Fixture): void => {
  assert.equal(ThreadRecord.parse(fixture.thread).ok, true, 'the floors fixture thread must itself be schema-admissible, or the renderer would never be handed it')
  assert.equal(
    ThreadRecord.parse(fixture.predecessor).ok,
    true,
    'the floors fixture predecessor must itself be schema-admissible, or the renderer would never be handed it'
  )
  for (const entry of fixture.entries) {
    assert.equal(SessionRecord.parse(entry).ok, true, 'every floors fixture session entry must itself be schema-admissible, or the renderer would never be handed it')
  }
}

test('briefing.floors-are-honoured-and-not-everything-sits-on-its-floor-under-budget-pressure', () => {
  const fixture = buildFloorFixture(marginedWithinCap, 'x'.repeat(STEALER_GRAPHEMES))
  assertRecordAdmissible(fixture)

  const render = renderBriefingWithPasses(fixture.thread, EMPTY_INTEGRITY, null, fixture.predecessor, true, fixture.entries)

  assert.ok(
    render.passes > 1,
    `this fixture must actually enter the clip search, or the floor measurements below are taken on an unclipped render that never competed for space; got ${render.passes} render pass(es)`
  )

  assertEveryFieldAtLeastFloor(render.briefing, fixture.specs, 'a briefing under ordinary budget pressure')

  const winner = largestFloorMargin(render.briefing, fixture.specs)
  assert.ok(
    winner.margin > 0,
    `at least one field must render strictly more than its floor once the budget has slack, or an implementation that pins every field to its floor forever would pass every other check in this file; the best margin found was ${winner.margin} graphemes on ${winner.name}, which is not above zero`
  )
})

test('briefing.floors-are-honoured-in-escaped-graphemes-when-stored-text-explodes-under-escaping', () => {
  const fixture = buildFloorFixture((floor) => '<'.repeat(floor), '<'.repeat(SESSION_BODY_MAX), ESCAPE_EXPLODING_SESSION_ENTRY_COUNT)
  assertRecordAdmissible(fixture)
  const render = renderBriefingWithPasses(fixture.thread, EMPTY_INTEGRITY, null, fixture.predecessor, true, fixture.entries)

  assert.ok(
    render.passes > 1,
    `an escape-exploding fixture must actually enter the clip search, or the floor measurements below are taken on an unclipped render that never competed for space; got ${render.passes} render pass(es)`
  )

  for (const spec of fixture.specs) {
    const rawEscapedLength = graphemeCount(escapeStored(spec.rawText))
    if (spec.name === 'related slug') {
      assert.equal(
        rawEscapedLength,
        spec.floor,
        `the related slug is constrained to characters matching the thread slug pattern, none of which escapeStored ever grows, so an admissible slug can only ever sit at exactly its floor of ${spec.floor} graphemes and never explode past it; got ${rawEscapedLength}`
      )
      continue
    }
    assert.ok(
      rawEscapedLength > spec.floor,
      `the escape fixture for ${spec.name} must itself escape to more graphemes than its floor of ${spec.floor}, or this fixture is not exercising the escape-growth path it claims to; the stored text of ${spec.rawText.length} raw characters escaped to only ${rawEscapedLength} graphemes`
    )
  }

  assertEveryFieldAtLeastFloor(render.briefing, fixture.specs, 'a briefing whose stored text explodes under the stored-text escape')

  const relatedTitleSpec = fixture.specs.find((spec) => spec.name === 'related title')
  if (relatedTitleSpec === undefined) {
    throw new Error('the escape-exploding fixture must carry a related title spec, or the floor-reaching check below has nothing to measure')
  }
  const [relatedTitleRendered] = measureRendered(render.briefing, relatedTitleSpec)
  assert.notEqual(relatedTitleRendered, undefined, 'the escape-exploding fixture must render exactly one related title line to measure')
  assert.ok(
    (relatedTitleRendered as number) < RELATED_TITLE_FLOOR + ESCAPE_TOKEN_MAX_GRAPHEMES,
    `this fixture must force the render down near the related title floor of ${RELATED_TITLE_FLOOR} graphemes to prove the floor-and-round-up path is actually exercised rather than trivially satisfied from slack; got ${relatedTitleRendered as number} graphemes`
  )
})

test('briefing.floors-are-honoured-in-graphemes-rather-than-utf16-code-units', () => {
  const multiUnitGrapheme = '\u{1F600}'
  assert.equal(
    graphemeCount(multiUnitGrapheme),
    1,
    'the fixture character must itself be exactly one grapheme, or this fixture is not testing the code-unit-versus-grapheme distinction it claims to'
  )
  assert.ok(
    multiUnitGrapheme.length > 1,
    'the fixture character must itself span more than one UTF-16 code unit, or this fixture is not testing the code-unit-versus-grapheme distinction it claims to'
  )

  const multiUnitCodeUnitsPerGrapheme = multiUnitGrapheme.length
  const graphemesAdmissibleUnderCap = (cap: number): number => Math.floor(cap / multiUnitCodeUnitsPerGrapheme)
  const multiUnitRawTextFor: FloorRawText = (floor, cap) =>
    multiUnitGrapheme.repeat(Math.min(floor + FLOOR_MARGIN_GRAPHEMES, graphemesAdmissibleUnderCap(cap)))

  const fixture = buildFloorFixture(
    multiUnitRawTextFor,
    multiUnitGrapheme.repeat(graphemesAdmissibleUnderCap(SESSION_BODY_MAX))
  )
  assertRecordAdmissible(fixture)
  const render = renderBriefingWithPasses(fixture.thread, EMPTY_INTEGRITY, null, fixture.predecessor, true, fixture.entries)

  assert.ok(
    render.passes > 1,
    `this fixture must actually enter the clip search, or the floor measurements below are taken on an unclipped render that never competed for space; got ${render.passes} render pass(es)`
  )

  assertEveryFieldAtLeastFloor(render.briefing, fixture.specs, 'a briefing filled with a multi-code-unit grapheme')

  for (const spec of fixture.specs) {
    for (const line of sectionLines(render.briefing, spec.heading)) {
      const matched = spec.pattern.exec(line)
      const captured = matched === null ? undefined : matched[spec.group]
      if (captured === undefined) continue
      assert.equal(
        captured.length % 2,
        0,
        `a rendered ${spec.name} must never split the fixture's two-code-unit grapheme in half, or the renderer clipped by code unit rather than by grapheme; got a captured value of ${captured.length} UTF-16 code units`
      )
    }
  }
})

const OVER_SUBSCRIBED_CRITERIA_COUNT = Math.ceil(BRIEFING_MAX_CHARS / CRITERION_TEXT_FLOOR) + 10

const buildOverSubscribedFixture = (criteriaCount: number, artifactLabel: string = 'x'.repeat(ARTIFACT_LABEL_FLOOR)): Thread => {
  const criteria: Criterion[] = Array.from({ length: criteriaCount }, (_unused, index) => ({
    id: rt.ulid(),
    ordinal: index + 1,
    text: 'x'.repeat(CRITERION_TEXT_FLOOR),
    done: false,
    kind: 'planned',
    struck_by: null,
    settledness: 'proposed'
  }))

  const risk: Risk = { id: rt.ulid(), scope: 'floors', text: 'x'.repeat(RISK_TEXT_FLOOR), refs: [], retired: false }
  const keyDecision: KeyDecision = { id: rt.ulid(), decision_id: rt.ulid(), title: 'x'.repeat(KEY_DECISION_TITLE_FLOOR), scope: 'floors' }
  const outOfScope: OutOfScope = { id: rt.ulid(), text: 'x'.repeat(OUT_OF_SCOPE_TEXT_FLOOR) }
  const artifact: Artifact = {
    id: rt.ulid(),
    label: artifactLabel,
    pointer: 'x'.repeat(ARTIFACT_POINTER_FLOOR),
    retired: false
  }

  return {
    id: rt.ulid(),
    slug: 'over-subscribed-floors',
    title: 'a fixture where even every floor together cannot fit the reply budget',
    status: 'open',
    blocked_by: null,
    completion_criteria: criteria,
    artifacts: [artifact],
    spine: {
      active_goal: 'confirm the over-budget bullet appears when floors alone overflow the reply budget',
      next_step: 'render this thread and read withinBudget off the result',
      landed: '',
      last_session: '',
      open_risks: [risk],
      key_decisions: [keyDecision],
      out_of_scope: [outOfScope]
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
}

test('briefing.floors-hold-and-the-budget-is-reported-exceeded-when-item-count-overflows-them-all', () => {
  const thread = buildOverSubscribedFixture(OVER_SUBSCRIBED_CRITERIA_COUNT)
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the over-subscribed-floors fixture must itself be schema-admissible, or the renderer would never be handed it')
  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, null)

  assert.equal(
    render.withinBudget,
    false,
    `a thread whose every field at its floor already exceeds the budget must report as outside it, got a render of ${render.briefing.length} characters reported as within budget`
  )

  assert.ok(
    render.briefing.includes(BUDGET_EXCEEDED_BULLET),
    `an over-budget briefing must carry the exact over-budget sentence on the page, or the reader has no indication the content was floored rather than complete; the page carried no line reading ${JSON.stringify(BUDGET_EXCEEDED_BULLET)}`
  )

  const criterionRendered = capturesIn(sectionLines(render.briefing, CRITERIA_HEADING), CRITERION_TEXT_LINE, 1).map(graphemeCount)
  assert.equal(
    criterionRendered.length,
    OVER_SUBSCRIBED_CRITERIA_COUNT,
    `every one of the ${OVER_SUBSCRIBED_CRITERIA_COUNT} criteria must still render a text line even in the over-subscribed case, got ${criterionRendered.length}`
  )
  for (const rendered of criterionRendered) {
    assert.equal(
      rendered,
      CRITERION_TEXT_FLOOR,
      `an over-subscribed criterion text must render at exactly its floor of ${CRITERION_TEXT_FLOOR} graphemes, got ${rendered}`
    )
  }

  const riskRendered = capturesIn(sectionLines(render.briefing, RISKS_HEADING), RISK_LINE, 1).map(graphemeCount)
  assert.ok(riskRendered.length > 0, 'the over-subscribed fixture must render at least one risk, or this measurement passes over an empty population')
  for (const rendered of riskRendered) {
    assert.equal(rendered, RISK_TEXT_FLOOR, `an over-subscribed risk text must render at exactly its floor of ${RISK_TEXT_FLOOR} graphemes, got ${rendered}`)
  }

  const keyDecisionRendered = capturesIn(sectionLines(render.briefing, KEY_DECISIONS_HEADING), KEY_DECISION_LINE, 1).map(graphemeCount)
  assert.ok(
    keyDecisionRendered.length > 0,
    'the over-subscribed fixture must render at least one key decision, or this measurement passes over an empty population'
  )
  for (const rendered of keyDecisionRendered) {
    assert.equal(
      rendered,
      KEY_DECISION_TITLE_FLOOR,
      `an over-subscribed key decision title must render at exactly its floor of ${KEY_DECISION_TITLE_FLOOR} graphemes, got ${rendered}`
    )
  }

  const outOfScopeRendered = capturesIn(sectionLines(render.briefing, OUT_OF_SCOPE_HEADING), OUT_OF_SCOPE_LINE, 1).map(graphemeCount)
  assert.ok(
    outOfScopeRendered.length > 0,
    'the over-subscribed fixture must render at least one out-of-scope entry, or this measurement passes over an empty population'
  )
  for (const rendered of outOfScopeRendered) {
    assert.equal(
      rendered,
      OUT_OF_SCOPE_TEXT_FLOOR,
      `an over-subscribed out-of-scope entry must render at exactly its floor of ${OUT_OF_SCOPE_TEXT_FLOOR} graphemes, got ${rendered}`
    )
  }

  const artifactLabelRendered = capturesIn(sectionLines(render.briefing, ARTIFACTS_HEADING), ARTIFACT_LINE, 1).map(graphemeCount)
  const artifactPointerRendered = capturesIn(sectionLines(render.briefing, ARTIFACTS_HEADING), ARTIFACT_LINE, 2).map(graphemeCount)
  assert.ok(
    artifactLabelRendered.length > 0 && artifactPointerRendered.length > 0,
    'the over-subscribed fixture must render at least one artifact, or this measurement passes over an empty population'
  )
  for (const rendered of artifactLabelRendered) {
    assert.equal(
      rendered,
      ARTIFACT_LABEL_FLOOR,
      `an over-subscribed artifact label must render at exactly its floor of ${ARTIFACT_LABEL_FLOOR} graphemes, got ${rendered}`
    )
  }
  for (const rendered of artifactPointerRendered) {
    assert.equal(
      rendered,
      ARTIFACT_POINTER_FLOOR,
      `an over-subscribed artifact pointer must render at exactly its floor of ${ARTIFACT_POINTER_FLOOR} graphemes, got ${rendered}`
    )
  }
})

test('briefing.an-over-budget-render-with-nothing-shortened-carries-no-shortened-text-bullet', () => {
  const thread = itemCountOverBudgetThread(rt)
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the item-count-over-budget fixture must itself be schema-admissible')

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, null)
  assert.equal(
    render.withinBudget,
    false,
    `this fixture must actually breach the budget through item count alone, got a render of ${render.briefing.length} characters reported as within budget`
  )

  assert.equal(
    render.briefing.includes(CLIP_MARKER),
    false,
    `nothing in this fixture is long enough to ever be shortened, so no ${CLIP_MARKER} marker should appear anywhere on the page`
  )
  assert.equal(
    render.briefing.includes(
      '- some text on this briefing was shortened to fit the size budget for one reply; every shortened value ends with ...[shortened]'
    ),
    false,
    'the shortened-text bullet must not appear when nothing on the page was actually shortened, or the reader is told a falsehood about what happened to their content'
  )
  assert.ok(
    render.briefing.includes(BUDGET_EXCEEDED_BULLET),
    'the over-budget bullet must still appear when the render genuinely breaches the budget, even though nothing was shortened'
  )
})

const CLAMP_ARTIFACT_LABEL_ESCAPE_TOKEN_PREFIX_LENGTH = 183
const CLAMP_ARTIFACT_LABEL_TRAILING_LENGTH = 12
const CLAMP_ARTIFACT_LABEL_RAW =
  'x'.repeat(CLAMP_ARTIFACT_LABEL_ESCAPE_TOKEN_PREFIX_LENGTH) + '<' + 'y'.repeat(CLAMP_ARTIFACT_LABEL_TRAILING_LENGTH)

test('briefing.a-clip-floor-clamped-field-does-not-trip-the-shortened-text-bullet', () => {
  const escapedLabel = escapeStored(CLAMP_ARTIFACT_LABEL_RAW)
  const rawEscapedLength = graphemeCount(escapedLabel)
  assert.ok(
    rawEscapedLength > ARTIFACT_LABEL_FLOOR,
    `the fixture label must escape to more graphemes than its floor of ${ARTIFACT_LABEL_FLOOR}, or this fixture is not exercising the round-up-past-the-floor clamp it claims to; escaped to ${rawEscapedLength} graphemes`
  )

  const thread = buildOverSubscribedFixture(OVER_SUBSCRIBED_CRITERIA_COUNT, CLAMP_ARTIFACT_LABEL_RAW)
  assert.equal(
    ThreadRecord.parse(thread).ok,
    true,
    'the clip-floor-clamp fixture thread must itself be schema-admissible, or the renderer would never be handed it'
  )

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, null)
  assert.equal(
    render.withinBudget,
    false,
    `this fixture must breach the reply budget through item count alone, or the artifact label never reaches its clip floor to exercise the clamp; got a render of ${render.briefing.length} characters reported as within budget`
  )

  const artifactLabelRendered = capturesIn(sectionLines(render.briefing, ARTIFACTS_HEADING), ARTIFACT_LINE, 1)
  assert.equal(artifactLabelRendered.length, 1, 'the clip-floor-clamp fixture must render exactly one artifact line to measure')
  assert.equal(
    artifactLabelRendered[0],
    escapedLabel,
    `clipWithMarkerFloor's own clamp must return the artifact label unchanged once the rounded-up candidate is no shorter than the original; expected the untouched escaped label of ${rawEscapedLength} graphemes, got ${graphemeCount(artifactLabelRendered[0] ?? '')} graphemes`
  )

  assert.equal(
    render.briefing.includes(CLIP_MARKER),
    false,
    `clipWithMarkerFloor's clamp returned every field on this render unchanged, so no ${CLIP_MARKER} marker should appear anywhere on the page`
  )
  assert.equal(
    render.briefing.includes(
      '- some text on this briefing was shortened to fit the size budget for one reply; every shortened value ends with ...[shortened]'
    ),
    false,
    'the shortened-text bullet must not appear when the clip floor clamp returned every value unchanged, or the reader is told a falsehood about what happened to their content'
  )
})

test('briefing.every-floor-is-at-most-the-write-cap-it-governs', () => {
  const pairs: Array<{ name: string; floor: number; cap: number }> = [
    { name: 'related title floor vs thread title cap', floor: RELATED_TITLE_FLOOR, cap: THREAD_TITLE_MAX },
    { name: 'related slug floor vs thread slug cap', floor: RELATED_SLUG_FLOOR, cap: THREAD_SLUG_MAX },
    { name: 'risk text floor vs risk text cap', floor: RISK_TEXT_FLOOR, cap: RISK_TEXT_MAX },
    { name: 'risk reference floor vs risk reference cap', floor: RISK_REF_FLOOR, cap: RISK_REF_MAX },
    { name: 'key decision title floor vs key decision title cap', floor: KEY_DECISION_TITLE_FLOOR, cap: KEY_DECISION_TITLE_MAX },
    { name: 'out of scope text floor vs out of scope text cap', floor: OUT_OF_SCOPE_TEXT_FLOOR, cap: OUT_OF_SCOPE_TEXT_MAX },
    { name: 'criterion text floor vs criterion text cap', floor: CRITERION_TEXT_FLOOR, cap: CRITERION_TEXT_MAX },
    { name: 'criterion check floor vs criterion check cap', floor: CRITERION_CHECK_FLOOR, cap: CRITERION_CHECK_MAX },
    { name: 'criterion result floor vs criterion result cap', floor: CRITERION_RESULT_FLOOR, cap: CRITERION_RESULT_MAX },
    { name: 'criterion settled by floor vs criterion settled by cap', floor: CRITERION_SETTLED_BY_FLOOR, cap: CRITERION_SETTLED_BY_MAX },
    { name: 'last session text floor vs session body cap', floor: LAST_SESSION_TEXT_FLOOR, cap: SESSION_BODY_MAX },
    { name: 'artifact label floor vs artifact label cap', floor: ARTIFACT_LABEL_FLOOR, cap: ARTIFACT_LABEL_MAX },
    { name: 'artifact pointer floor vs artifact pointer cap', floor: ARTIFACT_POINTER_FLOOR, cap: ARTIFACT_POINTER_MAX }
  ]

  for (const pair of pairs) {
    assert.ok(
      pair.floor <= pair.cap,
      `the ${pair.name} must hold floor <= cap, or the renderer promises a rendered length the store can never hold; got floor ${pair.floor} and cap ${pair.cap}`
    )
  }
})
