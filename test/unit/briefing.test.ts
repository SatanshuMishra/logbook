import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import { renderBriefing, BRIEFING_MAX_CHARS, RESUME_PAYLOAD_MAX_BYTES, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { ThreadRecord, type Thread, type Criterion, type Risk, type KeyDecision, type OutOfScope } from '../../src/schema/thread.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, sourceFileFor } from '../support/source-census.ts'

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
  assert.ok(rendered.split('\n').includes('Blockage: none'))
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

  assert.equal(rendered, expected)
})

test('briefing.omits-empty-list-sections-entirely', () => {
  const thread = baseThread({ title: 'Empty Thread', status: 'done', blocked_by: 'still finishing docs' })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
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
  assert.equal(rendered, expected)
  for (const heading of ['Related:', 'Open risks:', 'Key decisions:', 'Out of scope:', 'Completion criteria:', 'Not shown:']) {
    assert.equal(rendered.includes(heading), false, `expected ${heading} to be omitted when its list is empty`)
  }
})

test('briefing.pointer-status-is-no-for-a-different-thread', () => {
  const thread = baseThread()
  const pointer: Pointer = { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'someone-else' }
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, pointer, null)
  assert.ok(rendered.split('\n').includes('Currently being worked: no'))
})

test('briefing.criterion-status-is-open-when-undone-and-unstruck', () => {
  const criterion = { id: rt.ulid(), ordinal: 1, text: 'not started yet', done: false, kind: 'planned' as const, struck_by: null }
  const thread = baseThread({ completion_criteria: [criterion] })
  const rendered = renderBriefing(thread, EMPTY_INTEGRITY, null, null)
  assert.ok(rendered.split('\n').includes(`c1 [open] ${criterion.id}: not started yet`))
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
  const decisionsIndex = lines.indexOf('Decisions:')
  assert.equal(lines[decisionsIndex + 1], 'resolved: 0')
  assert.equal(lines[decisionsIndex + 2], 'dangling: dangling-one')
  assert.equal(lines[decisionsIndex + 3], 'dangling: dangling-two')
  assert.equal(lines[decisionsIndex + 4], 'quarantined: quarantined-one')
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
  assert.equal(rendered.includes('#'), false)
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
  const openRisksIndex = rendered.split('\n').indexOf('Open risks:')
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
    lines.filter((line) => line.startsWith('dangling: ')).length,
    6,
    'dangling decision ids are capped at 6 shown'
  )
  assert.equal(
    lines.filter((line) => line.startsWith('quarantined: ')).length,
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
  assert.equal(rendered.includes('Not shown:'), false)
})

const decisionRecordSizedThread = (): Thread => {
  const text = (n: number): string => 'x'.repeat(n)
  const criteria: Criterion[] = Array.from({ length: 200 }, (_, index) => ({
    id: rt.ulid(),
    ordinal: index + 1,
    text: text(10),
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
  const keyDecisions: KeyDecision[] = []
  const outOfScope: OutOfScope[] = Array.from({ length: 40 }, () => ({ id: rt.ulid(), text: text(300) }))
  return {
    id: rt.ulid(),
    slug: 'a'.repeat(30),
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

test('briefing.renders-the-largest-schema-admissible-thread-within-budget', () => {
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

  assert.ok(rendered.includes('Completion criteria:'), 'every one of the 200 criteria is listed, never dropped')
  assert.equal(
    rendered.split('\n').filter((line) => line.startsWith('c')).length,
    200,
    'all 200 retained criteria must render, one line each, none omitted'
  )
})
