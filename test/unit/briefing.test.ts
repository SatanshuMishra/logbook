import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import {
  renderBriefing,
  renderBriefingWithPasses,
  resumePayloadBytes,
  BRIEFING_HEADING,
  BRIEFING_MAX_CHARS,
  RESUME_PAYLOAD_MAX_BYTES,
  type DecisionIntegrity
} from '../../src/render/briefing.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'
import { ThreadRecord, type Thread, type Criterion, type Risk, type KeyDecision, type OutOfScope } from '../../src/schema/thread.ts'
import { CRITERIA_MAX_ELEMENTS, KEY_DECISION_TITLE_MAX, RISKS_PER_CALL_MAX_ELEMENTS, THREAD_SLUG_MAX } from '../../src/schema/caps.ts'
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
    landed: '',
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
  const artifactId = rt.ulid()
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
    check: 'npm test',
    result: '436 tests, 0 fail',
    result_status: 'verified' as const,
    struck_by: null
  }
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
    artifacts: [{ id: artifactId, label: 'the implementation plan', pointer: 'docs/plans/u5.md', retired: false }],
    spine: {
      active_goal: 'ship the renderer',
      next_step: 'add tests',
      landed: '',
      last_session: 'wrote the first draft',
      open_risks: [
        {
          id: riskId,
          scope: 'renderer',
          text: 'escaping might be incomplete',
          refs: ['docs/specs/goal-model.md#L120'],
          retired: false
        },
        {
          id: settledRiskId,
          scope: 'renderer',
          text: 'a risk on a met goal',
          refs: [],
          criterion_id: criterionA.id,
          retired: false
        }
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
    BRIEFING_HEADING,
    '',
    '**Thread:** Ship the renderer',
    '**Status:** open',
    '**Blockage:** none',
    '**Currently being worked:** yes',
    'Artifacts carry the route this thread is following. The goals are what the work must satisfy: check what lands against them as it lands, not only at the end.',
    '',
    '**Artifacts:**',
    '- the implementation plan: docs/plans/u5.md',
    '',
    '**Active goal:**',
    '',
    'ship the renderer',
    '',
    '**Last session:**',
    '',
    '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead',
    'wrote the first draft',
    '',
    '**Next step:**',
    '',
    'add tests',
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
    `- decision ${settledDecisionId} the escape is applied at render time`,
    '',
    '**Decisions:**',
    '- resolved: 2'
  ].join('\n')

  assert.equal(rendered, expected)
})

test('briefing.omits-empty-list-sections-entirely', () => {
  const thread = baseThread({ title: 'Empty Thread', status: 'done', blocked_by: 'still finishing docs' })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  const expected = [
    BRIEFING_HEADING,
    '',
    '**Thread:** Empty Thread',
    '**Status:** done',
    '**Blocked:** still finishing docs',
    '**Currently being worked:** no',
    'Artifacts carry the route this thread is following. The goals are what the work must satisfy: check what lands against them as it lands, not only at the end.',
    '',
    '**Active goal:**',
    '',
    'ship the thing',
    '',
    '**Last session:**',
    '',
    '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead',
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
  for (const heading of [
    '**Related:**',
    '**Artifacts:**',
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

test('briefing.renders-no-focus-line', () => {
  const thread = baseThread()
  const pointer: Pointer = { thread_id: thread.id, written_at: '2026-09-05T00:00:00.000Z', session_id: 'session-a' }

  const briefing = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)

  assert.equal(briefing.includes('**Focus:**'), false)
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
  assert.ok(rendered.split('\n').includes(`- c1 [open]: not started yet (id ${criterion.id})`))
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
      landed: '',
      last_session: '# session heading',
      open_risks: [{ id: rt.ulid(), scope: 's', text: '# risk heading', refs: [], retired: false }],
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
  assert.equal(firstLine, BRIEFING_HEADING)
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
  retired: false,
  ...overrides
})

const CRITERION_ROW_PATTERN = /^- c\d+ \[(open|done|struck)\]: /

const criterionRowCount = (rendered: string): number =>
  rendered.split('\n').filter((line) => CRITERION_ROW_PATTERN.test(line)).length

test('briefing.live-risks-render-in-the-order-they-were-recorded', () => {
  const first = criterion({ ordinal: 1, text: 'the first criterion' })
  const other = criterion({ ordinal: 2, text: 'a later live criterion' })
  const otherRisk = risk({ text: 'risk tied to a later criterion', criterion_id: other.id })
  const firstRisk = risk({ text: 'risk tied to the first criterion', criterion_id: first.id })

  const thread = baseThread({
    completion_criteria: [first, other],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      landed: '',
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
    'live risks render as one group, in the order they were recorded'
  )
})

test('briefing.every-out-of-scope-item-renders-and-none-is-counted-away', () => {
  const outOfScopeItems: OutOfScope[] = Array.from({ length: 12 }, (_, index) => ({
    id: rt.ulid(),
    text: `out of scope item ${index}`
  }))
  const thread = baseThread({
    spine: {
      active_goal: 'g',
      next_step: 'n',
      landed: '',
      last_session: 'l',
      open_risks: [],
      key_decisions: [],
      out_of_scope: outOfScopeItems
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
    dangling: Array.from({ length: 8 }, (_, index) => `dangling-${index}`),
    quarantined: Array.from({ length: 4 }, (_, index) => `quarantined-${index}`)
  }
  const rendered = renderBriefing(thread, integrity, null, null)
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

  const thread = baseThread({
    completion_criteria: [doneCriterion],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      landed: '',
      last_session: 'l',
      open_risks: [settledRisk, unanchoredRisk],
      key_decisions: [],
      out_of_scope: []
    }
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
      landed: '',
      last_session: 'l',
      open_risks: [settledRisk],
      key_decisions: [],
      out_of_scope: []
    }
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

test('briefing.a-risk-naming-a-criterion-that-no-longer-resolves-is-treated-as-unanchored', () => {
  const onlyCriterion = criterion({ ordinal: 1, text: 'the only criterion', done: true })
  const wrongTagRisk = risk({ text: 'a risk naming an unknown criterion', criterion_id: rt.ulid() })

  const thread = baseThread({
    completion_criteria: [onlyCriterion],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      landed: '',
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

test('briefing.every-unanchored-risk-renders-and-none-is-counted-away', () => {
  const live = criterion({ ordinal: 1, text: 'the live criterion' })
  const risks: Risk[] = Array.from({ length: 6 }, (_, index) => risk({ text: `unanchored risk number ${index}` }))
  const thread = baseThread({
    completion_criteria: [live],
    spine: { active_goal: 'g', next_step: 'n', landed: '', last_session: 'l', open_risks: risks, key_decisions: [], out_of_scope: [] }
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
  const thread = baseThread({
    completion_criteria: [criterion()],
    spine: {
      active_goal: 'g',
      next_step: 'n',
      landed: '',
      last_session: 'l',
      open_risks: [risk()],
      key_decisions: [],
      out_of_scope: []
    }
  })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.equal(rendered.includes('**Not shown:**'), false)
})

test('briefing.every-completion-criterion-renders-and-none-is-counted-away', () => {
  const retired: Criterion[] = Array.from({ length: 199 }, (_, index) =>
    criterion({ ordinal: index + 1, text: 'retired', struck_by: rt.ulid() })
  )
  const survivor = criterion({ ordinal: 200, text: 'still open' })
  const thread = baseThread({ completion_criteria: [...retired, survivor] })

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)

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

const CRITERION_TEXT_AT_RECORD_BYTE_CEILING = 14
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
    refs: [],
    retired: false
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
      landed: '',
      last_session: text(500),
      open_risks: risks,
      key_decisions: keyDecisions,
      out_of_scope: outOfScope
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
}

test('briefing.renders-every-item-of-a-record-byte-maximal-thread-and-reports-the-budget-breach', () => {
  const thread = decisionRecordSizedThread()
  const parsed = ThreadRecord.parse(thread)
  assert.equal(parsed.ok, true, 'the constructed fixture must itself be schema-admissible')

  const predecessor = baseThread({ title: 'x'.repeat(200), slug: 'a'.repeat(60) })
  const integrity: DecisionIntegrity = {
    resolved: 5,
    dangling: Array.from({ length: 50 }, () => rt.ulid()),
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
    lines.filter((line) => line.startsWith('  - check: ')).length,
    thread.completion_criteria.length,
    'every criterion renders its check line, recorded or not'
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
      landed: '',
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
const WORST_REACHABLE_CRITERION_TEXT_LENGTH = 100

const worstReachableAsciiShape: SweepShape = {
  fill: ASCII_FILL,
  anchored: true,
  criteriaCount: CRITERIA_MAX_ELEMENTS,
  keyDecisionCount: 0,
  criterionTextLength: WORST_REACHABLE_CRITERION_TEXT_LENGTH,
  bulkCount: RISKS_PER_CALL_MAX_ELEMENTS
}

const RESUME_PAYLOAD_RESERVE_BYTES = 200

const maxActivelyClippedItems = (shape: SweepShape): number =>
  shape.criteriaCount +
  shape.criteriaCount +
  1 +
  shape.bulkCount +
  shape.bulkCount +
  shape.bulkCount +
  shape.keyDecisionCount +
  1

const briefingCopiesInResumePayload = (): number => {
  const threadId = 'x'.repeat(THREAD_SLUG_MAX)
  const shorter = resumePayloadBytes('x'.repeat(100), threadId, true)
  const longer = resumePayloadBytes('x'.repeat(200), threadId, true)
  return (longer - shorter) / 100
}

const clipSearchStepBytes = (shape: SweepShape): number => briefingCopiesInResumePayload() * maxActivelyClippedItems(shape)

const CLIP_SEARCH_UTILISATION_SLACK_BYTES = RESUME_PAYLOAD_RESERVE_BYTES + clipSearchStepBytes(worstReachableAsciiShape) - 1

const textAfterPrefix = (rendered: string, prefix: string): number => {
  const line = rendered.split('\n').find((candidate) => candidate.startsWith(prefix))
  if (line === undefined) {
    throw new Error(`expected the rendered briefing to carry a line beginning "${prefix}", found none`)
  }
  return line.length - prefix.length
}

test('briefing.the-clip-search-lands-just-under-the-resume-payload-cap-on-the-worst-reachable-ascii-record', () => {
  const { thread, predecessor } = buildSweepFixture(rt, worstReachableAsciiShape)
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
    `this record must actually enter the clip search, or the utilisation floor below is measuring an unclipped render; got ${render.passes} renders`
  )
  assert.equal(
    render.withinBudget,
    true,
    'the clip search must land this record inside both caps, or the utilisation floor below is bought by breaching the budget'
  )

  const retained = textAfterPrefix(render.briefing, `- ${shownRisk.id} `)
  assert.ok(retained > CLIP_MARKER.length, `the clipped risk text must keep some of its own text beside the marker, got ${retained}`)
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

const LANDED_TEXT = 'the landed block renders above the next step'

const CONTINUATION_RULE =
  'Artifacts carry the route this thread is following. The goals are what the work must satisfy: check what lands against them as it lands, not only at the end.'

test('briefing.renders-landed-before-the-next-step', () => {
  const base = baseThread()
  const thread = baseThread({ spine: { ...base.spine, landed: LANDED_TEXT } })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the landed fixture must itself be schema-admissible')

  const lines = renderBriefing(thread, EMPTY_INTEGRITY, null, null).split('\n')
  const landedHeadingAt = lines.indexOf('**Landed:**')
  const landedTextAt = lines.indexOf(LANDED_TEXT)
  const nextStepAt = lines.indexOf('**Next step:**')

  assert.ok(
    landedHeadingAt > -1,
    `the briefing must carry a landed block, or what has already landed is invisible to the next session; got ${JSON.stringify(lines)}`
  )
  assert.ok(
    landedTextAt > landedHeadingAt,
    `the stored landed text must render under the landed heading, got the heading at ${landedHeadingAt} and the text at ${landedTextAt}`
  )
  assert.ok(
    nextStepAt > landedTextAt,
    `the briefing must read state then action: landed before the next step, got landed at ${landedHeadingAt} and the next step at ${nextStepAt}`
  )
})

test('briefing.renders-the-continuation-rule', () => {
  const base = baseThread()
  const thread = baseThread({
    artifacts: [{ id: rt.ulid(), label: 'the implementation plan', pointer: 'docs/plans/u5.md', retired: false }],
    spine: { ...base.spine, landed: LANDED_TEXT }
  })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the continuation-rule fixture must itself be schema-admissible')

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)

  assert.ok(
    rendered.includes(CONTINUATION_RULE),
    `the briefing must state verbatim how the artifacts and the goals are to be used; got ${JSON.stringify(rendered)}`
  )
})

test('briefing.a-retired-artifact-renders-nowhere', () => {
  const live = { id: rt.ulid(), label: 'the route being followed', pointer: 'docs/plans/live.md', retired: false }
  const retired = { id: rt.ulid(), label: 'the route already abandoned', pointer: 'docs/plans/retired.md', retired: true }
  const thread = baseThread({ artifacts: [live, retired] })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the artifact retirement fixture must itself be schema-admissible')

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)

  assert.ok(
    rendered.split('\n').includes(`- ${live.label}: ${live.pointer}`),
    `a live artifact must still render in full, or this test would pass against a renderer that drops every artifact; got ${JSON.stringify(rendered)}`
  )
  assert.equal(
    rendered.includes(retired.label),
    false,
    `a retired artifact must not render its label, or the briefing keeps pointing at a route the thread has left; got ${JSON.stringify(rendered)}`
  )
  assert.equal(
    rendered.includes(retired.pointer),
    false,
    `a retired artifact must not render its pointer; got ${JSON.stringify(rendered)}`
  )
})

test('briefing.a-retired-risk-renders-nowhere', () => {
  const base = baseThread()
  const live = risk({ text: 'a risk the thread is still carrying' })
  const retired = risk({ text: 'a risk that has since been retired', retired: true })
  const thread = baseThread({ spine: { ...base.spine, open_risks: [live, retired] } })
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the risk retirement fixture must itself be schema-admissible')

  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)

  assert.ok(
    rendered.split('\n').includes(`- ${live.id} ${live.text}`),
    `a live risk must still render in full, or this test would pass against a renderer that drops every risk; got ${JSON.stringify(rendered)}`
  )
  assert.equal(
    rendered.includes(retired.text),
    false,
    `a retired risk must not render its text, or a settled worry keeps costing the next session attention; got ${JSON.stringify(rendered)}`
  )
  assert.equal(
    rendered.includes(retired.id),
    false,
    `a retired risk must not render its id; got ${JSON.stringify(rendered)}`
  )
})
