import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import {
  renderBriefing,
  renderBriefingWithPasses,
  BRIEFING_MAX_CHARS,
  RESUME_PAYLOAD_MAX_BYTES,
  type DecisionIntegrity
} from '../../src/render/briefing.ts'
import { ThreadRecord, type Thread, type Criterion, type Risk, type KeyDecision, type OutOfScope } from '../../src/schema/thread.ts'
import { CRITERIA_MAX_ELEMENTS, KEY_DECISION_TITLE_MAX, OPEN_RISKS_MAX_ELEMENTS, THREAD_SLUG_MAX } from '../../src/schema/caps.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, sourceFileFor } from '../support/source-census.ts'
import { buildSweepFixture, type SweepShape } from '../support/briefing-sweep-fixture.ts'
import { overBudgetThread } from '../support/briefing-over-budget-fixture.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const baseThread = (overrides: Partial<Thread> = {}): Thread => ({
  id: rt.ulid(),
  slug: 'briefing-fixture',
  title: 'Fixture Thread',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'ship the thing',
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

const BLOCKED_WORD_PATTERN = /\bblocked\b/i

type BlockedCandidate = { line: number; hasInterpolation: boolean }

const isTemplateSpanPart = (node: ts.Node): boolean =>
  ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)

const belongsToInterpolatedTemplate = (node: ts.Node): boolean =>
  isTemplateSpanPart(node) && ts.isTemplateExpression(node.parent)

const collectBlockedCandidates = (sourceFile: ts.SourceFile): BlockedCandidate[] => {
  const found: BlockedCandidate[] = []
  forEachDescendant(sourceFile, (node) => {
    const isLiteralWithText =
      ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || isTemplateSpanPart(node)
    if (!isLiteralWithText) return
    const raw = node.getText(sourceFile)
    if (!BLOCKED_WORD_PATTERN.test(raw)) return
    const line = lineOf(sourceFile, node)
    found.push({ line, hasInterpolation: belongsToInterpolatedTemplate(node) })
  })
  return found
}

const classifyBlockedCandidate = (candidate: BlockedCandidate): Classified<BlockedCandidate>['verdict'] | 'unclassifiable' =>
  candidate.hasInterpolation ? 'allowed' : 'forbidden'

test('briefing.blocked-renders-its-reason', () => {
  const thread = baseThread({ blocked_by: 'waiting on the infra approval' })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(rendered.split('\n').some((line) => line.includes('waiting on the infra approval')))

  const { program } = loadSourceProgram()
  const briefingPath = path.join(REBUILD_ROOT, 'src', 'render', 'briefing.ts')
  const sourceFile = sourceFileFor(program, briefingPath)
  const candidates = collectBlockedCandidates(sourceFile)
  assert.ok(candidates.length > 0, 'expected at least one occurrence of the word blocked in briefing.ts')
  assert.doesNotThrow(() => census(candidates, classifyBlockedCandidate))

  const synthetic: BlockedCandidate[] = [{ line: 1, hasInterpolation: false }]
  assert.throws(() => census(synthetic, classifyBlockedCandidate))
})

test('briefing.blockage-none-when-not-blocked', () => {
  const thread = baseThread({ blocked_by: null })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(rendered.split('\n').includes('**Blockage:** none'))
})

test('briefing.renders-exact-output-for-a-full-thread', () => {
  const threadId = rt.ulid()
  const decisionOneId = rt.ulid()
  const riskId = rt.ulid()
  const criterionA = { id: rt.ulid(), ordinal: 1, text: 'first criterion', done: true, kind: 'planned' as const, struck_by: null }
  const criterionB = {
    id: rt.ulid(),
    ordinal: 2,
    text: 'second criterion',
    done: false,
    kind: 'detour' as const,
    struck_by: rt.ulid()
  }
  const thread = baseThread({
    id: threadId,
    title: 'Ship the renderer',
    status: 'open',
    blocked_by: null,
    completion_criteria: [criterionA, criterionB],
    spine: {
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
    '# Your Preflight Briefing',
    '',
    '**Thread:** Ship the renderer',
    '**Status:** open',
    '**Blockage:** none',
    '**Currently being worked:** yes',
    '',
    '**Active goal:**',
    '',
    'ship the renderer',
    '',
    '**Last session:**',
    '',
    'wrote the first draft',
    '',
    '**Next step:**',
    '',
    'add tests',
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
    `- c1 [done]: first criterion (${criterionA.id})`,
    `- c2 [struck]: second criterion (${criterionB.id})`,
    '',
    '**Decisions:**',
    '- resolved: 1'
  ].join('\n')

  assert.equal(rendered, expected)
})

test('briefing.omits-empty-list-sections-entirely', () => {
  const thread = baseThread({ title: 'Empty Thread', status: 'done', blocked_by: 'still finishing docs' })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  const expected = [
    '# Your Preflight Briefing',
    '',
    '**Thread:** Empty Thread',
    '**Status:** done',
    '**Blocked:** still finishing docs',
    '**Currently being worked:** no',
    '',
    '**Active goal:**',
    '',
    'ship the thing',
    '',
    '**Last session:**',
    '',
    'wrote the renderer',
    '',
    '**Next step:**',
    '',
    'write the tests',
    '',
    '**Decisions:**',
    '- resolved: 0'
  ].join('\n')
  assert.equal(rendered, expected)
  for (const heading of ['**Related:**', '**Open risks:**', '**Key decisions:**', '**Out of scope:**', '**Completion criteria:**', '**Not shown:**']) {
    assert.equal(rendered.includes(heading), false, `expected ${heading} to be omitted when its list is empty`)
  }
})

test('briefing.pointer-status-is-no-for-a-different-thread', () => {
  const thread = baseThread()
  const pointer: Pointer = { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'someone-else' }
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)
  assert.ok(rendered.split('\n').includes('**Currently being worked:** no'))
})

test('briefing.criterion-status-is-open-when-undone-and-unstruck', () => {
  const criterion = { id: rt.ulid(), ordinal: 1, text: 'not started yet', done: false, kind: 'planned' as const, struck_by: null }
  const thread = baseThread({ completion_criteria: [criterion] })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(rendered.split('\n').includes(`- c1 [open]: not started yet (${criterion.id})`))
})

test('briefing.renders-dangling-and-quarantined-decisions-in-order', () => {
  const thread = baseThread()
  const integrity: DecisionIntegrity = {
    resolved: 0,
    dangling: ['dangling-one', 'dangling-two'],
    quarantined: ['quarantined-one']
  }
  const rendered = renderBriefing(thread, integrity, null, null)
  const lines = rendered.split('\n')
  const decisionsIndex = lines.indexOf('**Decisions:**')
  assert.equal(lines[decisionsIndex + 1], '- resolved: 0')
  assert.equal(lines[decisionsIndex + 2], '- dangling: dangling-one')
  assert.equal(lines[decisionsIndex + 3], '- dangling: dangling-two')
  assert.equal(lines[decisionsIndex + 4], '- quarantined: quarantined-one')
})

test('briefing.escapes-every-free-text-field', () => {
  const thread = baseThread({
    title: '# heading attempt',
    blocked_by: '# blocked heading',
    completion_criteria: [
      { id: rt.ulid(), ordinal: 1, text: '# criterion heading', done: false, kind: 'planned', struck_by: null }
    ],
    spine: {
      active_goal: '# goal heading',
      next_step: '# next heading',
      last_session: '# session heading',
      open_risks: [{ id: rt.ulid(), scope: 's', text: '# risk heading', refs: [] }],
      key_decisions: [{ id: rt.ulid(), decision_id: rt.ulid(), title: '# decision heading', scope: 's' }],
      out_of_scope: [{ id: rt.ulid(), text: '# oos heading' }]
    }
  })
  const integrity: DecisionIntegrity = {
    resolved: 0,
    dangling: ['# dangling heading'],
    quarantined: ['# quarantined heading']
  }
  const rendered = renderBriefing(thread, integrity, null, null)
  const [firstLine, ...restLines] = rendered.split('\n')
  assert.equal(firstLine, '# Your Preflight Briefing')
  assert.equal(restLines.join('\n').includes('#'), false)
})

const criterion = (overrides: Partial<Criterion> = {}): Criterion => ({
  id: rt.ulid(),
  ordinal: 1,
  text: 'a criterion',
  done: false,
  kind: 'planned',
  struck_by: null,
  ...overrides
})

const risk = (overrides: Partial<Risk> = {}): Risk => ({
  id: rt.ulid(),
  scope: 'x',
  text: 'a risk',
  refs: [],
  ...overrides
})

const CRITERION_ROW_PATTERN = /^- c\d+ \[(open|done|struck)\]: /

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
  }))
  const thread = baseThread({
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [],
      key_decisions: [],
      out_of_scope: outOfScopeItems
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
    dangling: Array.from({ length: 8 }, (_, index) => `dangling-${index}`),
    quarantined: Array.from({ length: 4 }, (_, index) => `quarantined-${index}`)
  }
  const rendered = renderBriefing(thread, integrity, null, null)
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

  const thread = baseThread({
    completion_criteria: [doneCriterion],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [settledRisk, unanchoredRisk],
      key_decisions: [],
      out_of_scope: []
    }
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
      last_session: 'l',
      open_risks: [settledRisk],
      key_decisions: [],
      out_of_scope: []
    }
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

test('briefing.a-risk-naming-a-criterion-that-no-longer-resolves-is-treated-as-unanchored', () => {
  const onlyCriterion = criterion({ ordinal: 1, text: 'the only criterion', done: true })
  const wrongTagRisk = risk({ text: 'a risk naming an unknown criterion', criterion_id: rt.ulid() })

  const thread = baseThread({
    completion_criteria: [onlyCriterion],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [wrongTagRisk],
      key_decisions: [],
      out_of_scope: []
    }
  })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(
    rendered.includes(`- ${wrongTagRisk.id} a risk naming an unknown criterion`),
    'a missing or wrong tag must never hide an item; it must render in full in the live lane'
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
  const thread = baseThread({
    completion_criteria: [criterion()],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      last_session: 'l',
      open_risks: [risk()],
      key_decisions: [],
      out_of_scope: []
    }
  })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.equal(rendered.includes('**Not shown:**'), false)
})

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

const CRITERION_TEXT_AT_RECORD_BYTE_CEILING = 18
const KEY_DECISIONS_AT_RECORD_BYTE_CEILING = 5

const decisionRecordSizedThread = (): Thread => {
  const text = (n: number): string => 'x'.repeat(n)
  const criteria: Criterion[] = Array.from({ length: 200 }, (_, index) => ({
    id: rt.ulid(),
    ordinal: index + 1,
    text: text(CRITERION_TEXT_AT_RECORD_BYTE_CEILING),
    done: false,
    kind: 'planned',
    struck_by: null
  }))
  const risks: Risk[] = Array.from({ length: 40 }, () => ({
    id: rt.ulid(),
    scope: 'x',
    text: text(500),
    refs: []
  }))
  const keyDecisions: KeyDecision[] = Array.from({ length: KEY_DECISIONS_AT_RECORD_BYTE_CEILING }, () => ({
    id: rt.ulid(),
    decision_id: rt.ulid(),
    title: text(KEY_DECISION_TITLE_MAX),
    scope: 'x'
  }))
  const outOfScope: OutOfScope[] = Array.from({ length: 40 }, () => ({ id: rt.ulid(), text: text(300) }))
  return {
    id: rt.ulid(),
    slug: 'a'.repeat(THREAD_SLUG_MAX),
    title: text(200),
    status: 'open',
    blocked_by: text(500),
    completion_criteria: criteria,
    spine: {
      active_goal: text(500),
      next_step: text(500),
      last_session: text(500),
      open_risks: risks,
      key_decisions: keyDecisions,
      out_of_scope: outOfScope
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
}

test('briefing.renders-a-record-byte-maximal-thread-within-budget', () => {
  const thread = decisionRecordSizedThread()
  const parsed = ThreadRecord.parse(thread)
  assert.equal(parsed.ok, true, 'the constructed fixture must itself be schema-admissible')

  const predecessor = baseThread({ title: 'x'.repeat(200), slug: 'a'.repeat(60) })
  const integrity: DecisionIntegrity = {
    resolved: 5,
    dangling: Array.from({ length: 50 }, () => rt.ulid()),
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

const ordinarySmallThread = (): Thread =>
  baseThread({
    title: 'Guard the briefing byte budget',
    completion_criteria: [
      criterion({ ordinal: 1, text: 'the renderer enforces the resume payload byte cap', done: true }),
      criterion({ ordinal: 2, text: 'the frontier sweep finds no breaching record' }),
      criterion({ ordinal: 3, text: 'the common path still converges in one pass' })
    ],
    spine: {
      active_goal: 'make the briefing budget guard byte-denominated',
      next_step: 'assert the ordinary path never enters the clip search',
      last_session: 'replaced the single-shot shrink with a convergent search',
      open_risks: [risk({ text: 'the character cap cannot bound multi-byte output' })],
      key_decisions: [],
      out_of_scope: [{ id: rt.ulid(), text: 'the pre-cutover ledger records stay frozen' }]
    }
  })

test('briefing.an-ordinary-small-thread-renders-in-a-single-pass', () => {
  const thread = ordinarySmallThread()
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the ordinary fixture must itself be schema-admissible')

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, null)

  assert.equal(
    render.passes,
    1,
    `an ordinary small thread must satisfy both caps on the unclipped attempt and never enter the clip search, got ${render.passes} renders`
  )
})

const CLIP_SEARCH_PASS_CEILING = 11

test('briefing.the-clip-search-converges-within-the-pass-ceiling', () => {
  const thread = decisionRecordSizedThread()
  const predecessor = baseThread({ title: 'x'.repeat(200), slug: 'a'.repeat(60) })
  const integrity: DecisionIntegrity = {
    resolved: 5,
    dangling: Array.from({ length: 50 }, () => rt.ulid()),
    quarantined: Array.from({ length: 50 }, () => rt.ulid())
  }

  const render = renderBriefingWithPasses(thread, integrity, null, predecessor)

  assert.ok(
    render.passes > 1,
    'a record-byte-maximal thread must actually enter the clip search, or the ceiling below is unexercised'
  )
  assert.ok(
    render.passes <= CLIP_SEARCH_PASS_CEILING,
    `the clip search must converge within ${CLIP_SEARCH_PASS_CEILING} renders, got ${render.passes}`
  )
})

const ASCII_FILL = 'x'
const WORST_REACHABLE_CRITERION_TEXT_LENGTH = 51
const RISK_TEXT_RETAINED_FLOOR = 250

const worstReachableAsciiShape: SweepShape = {
  fill: ASCII_FILL,
  anchored: true,
  criteriaCount: CRITERIA_MAX_ELEMENTS,
  keyDecisionCount: 0,
  criterionTextLength: WORST_REACHABLE_CRITERION_TEXT_LENGTH,
  bulkCount: OPEN_RISKS_MAX_ELEMENTS
}

const textAfterPrefix = (rendered: string, prefix: string): number => {
  const line = rendered.split('\n').find((candidate) => candidate.startsWith(prefix))
  if (line === undefined) {
    throw new Error(`expected the rendered briefing to carry a line beginning "${prefix}", found none`)
  }
  return line.length - prefix.length
}

test('briefing.the-clip-search-keeps-most-of-the-risk-text-on-the-worst-reachable-ascii-record', () => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, worstReachableAsciiShape)
  assert.equal(
    ThreadRecord.parse(thread).ok,
    true,
    'the worst-reachable ascii fixture must itself be schema-admissible, or it says nothing about records the store can hold'
  )
  const shownRisk = thread.spine.open_risks[0]
  if (shownRisk === undefined) {
    throw new Error('the worst-reachable ascii fixture must carry at least one risk, or there is no retained text to measure')
  }

  const render = renderBriefingWithPasses(thread, EMPTY_INTEGRITY, null, predecessor)

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

test('briefing.within-budget-is-true-on-an-ordinary-thread-and-false-when-the-render-breaches-a-cap', () => {
  const ordinary = renderBriefingWithPasses(ordinarySmallThread(), EMPTY_INTEGRITY, null, null)
  assert.equal(
    ordinary.withinBudget,
    true,
    `an ordinary small thread must report as within budget, got a render of ${ordinary.briefing.length} characters`
  )
  assert.ok(
    ordinary.briefing.length <= BRIEFING_MAX_CHARS,
    `the ordinary render must sit inside the character cap for that report to be true, got ${ordinary.briefing.length}`
  )

  const degenerate = overBudgetThread(rt)
  assert.equal(
    ThreadRecord.parse(degenerate).ok,
    true,
    'the over-budget fixture must itself be schema-admissible, or the renderer would never be handed it'
  )

  const breaching = renderBriefingWithPasses(degenerate, EMPTY_INTEGRITY, null, null)
  assert.ok(
    breaching.briefing.length > BRIEFING_MAX_CHARS,
    `the over-budget fixture must actually render past the ${BRIEFING_MAX_CHARS} character cap, got ${breaching.briefing.length}`
  )
  assert.equal(
    breaching.withinBudget,
    false,
    `a render past the character cap must report as outside budget, got a render of ${breaching.briefing.length} characters reported as within budget`
  )
})
