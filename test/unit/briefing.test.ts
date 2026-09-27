import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import { renderStepBriefing, BRIEFING_HEADING } from '../../src/render/briefing.ts'
import { ThreadRecord, type Thread, type Criterion, type Risk } from '../../src/schema/thread.ts'
import type { Decision } from '../../src/schema/decision.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { testRuntime } from '../support/runtime.ts'
import { withCriterionFixture } from '../support/criterion-fixture.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, sourceFileFor } from '../support/source-census.ts'

const rt = testRuntime()

const OTHER_RECORDS_HEADING =
  '**Other records on this thread** (one line each; name one in a next step to see it in full, or read a decision at logbook://decision/{id}):'
const OTHER_THREADS_LINE =
  '**Other threads:** search_ledger lists and searches the records on every thread, closed ones included.'

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
    next_step_records: [],
    landed: '',
    last_session: '',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now(),
  ...overrides
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

const decision = (threadId: string, overrides: Partial<Decision> = {}): Decision => ({
  id: rt.ulid(),
  thread_id: threadId,
  title: 'a decision',
  context: 'a context',
  options: [],
  outcome: 'an outcome',
  commit: null,
  supersedes: [],
  created_at: rt.now(),
  ...overrides
})

const entry = (threadId: string, body: string): SessionEntry => ({
  id: rt.ulid(),
  thread_id: threadId,
  actor: 'claude',
  body,
  created_at: rt.now()
})

const pointerFor = (threadId: string): Pointer => ({ thread_id: threadId, written_at: rt.now(), session_id: 'briefing-session' })

const storeHolding = (fixtureRt: Runtime, changes: RecordChange[]): Store => {
  const opened = openStore(fixtureRt, fixtureRt.cwd)
  if (!opened.ok) throw new Error(`briefing fixture: the store did not open: ${opened.message}`)
  const committed = opened.value.commit(changes, 'test: seed the briefing fixture')
  if (!committed.ok) throw new Error(`briefing fixture: the seed did not commit: ${committed.detail}`)
  return opened.value
}

const briefingOf = async (
  thread: Thread,
  pointer: Pointer | null = null,
  extra: RecordChange[] = []
): Promise<string> => {
  assert.equal(ThreadRecord.parse(thread).ok, true, 'the briefing fixture thread must itself be schema-admissible')
  const rendered: string[] = []
  await withCriterionFixture(async (fixtureRt) => {
    const store = storeHolding(fixtureRt, [{ kind: 'thread', record: thread }, ...extra])
    rendered.push(renderStepBriefing(store, thread, pointer, { resolved: 0, dangling: [], quarantined: [] }, 0))
  })
  const [briefing] = rendered
  if (briefing === undefined) throw new Error('briefing fixture: nothing was rendered')
  return briefing
}

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

test('briefing.blocked-renders-its-reason', async () => {
  const rendered = await briefingOf(baseThread({ blocked_by: 'waiting on the infra approval' }))
  assert.ok(rendered.split('\n').includes('**Blocked:** waiting on the infra approval'))

  const { program } = loadSourceProgram()
  const briefingPath = path.join(REBUILD_ROOT, 'src', 'render', 'briefing.ts')
  const sourceFile = sourceFileFor(program, briefingPath)
  const candidates = collectBlockedCandidates(sourceFile)
  assert.ok(candidates.length > 0, 'expected at least one occurrence of the word blocked in briefing.ts')
  assert.doesNotThrow(() => census(candidates, classifyBlockedCandidate))

  const synthetic: BlockedCandidate[] = [{ line: 1, hasInterpolation: false }]
  assert.throws(() => census(synthetic, classifyBlockedCandidate))
})

test('briefing.blockage-none-when-not-blocked', async () => {
  const rendered = await briefingOf(baseThread({ blocked_by: null }))
  assert.ok(rendered.split('\n').includes('**Blockage:** none'))
})

test('briefing.renders-exact-output-for-a-full-thread', async () => {
  const threadId = rt.ulid()
  const doneCriterion = criterion({
    ordinal: 1,
    text: 'first criterion',
    done: true,
    check: 'npm test',
    result: '436 tests, 0 fail',
    result_status: 'verified'
  })
  const struckCriterion = criterion({ ordinal: 2, text: 'second criterion', kind: 'detour', struck_by: rt.ulid() })
  const liveRisk = risk({ text: 'the census may miss a site', criterion_id: doneCriterion.id })
  const retiredRisk = risk({ text: 'a retired worry', retired: true })
  const liveArtifactId = rt.ulid()
  const noteId = rt.ulid()
  const named = decision(threadId, {
    title: 'Render the step first',
    context: 'the briefing buried the step',
    options: ['whole thread', 'step first'],
    outcome: 'step first'
  })
  const superseded = decision(threadId, {
    title: 'Split the renderer',
    context: 'src/render/briefing.ts was large',
    outcome: 'split it'
  })
  const matched = decision(threadId, {
    title: 'Keep the renderer in one file',
    context: 'src/render/briefing.ts holds every display',
    outcome: 'one file'
  })
  const other = decision(threadId, {
    title: 'Escape every stored value',
    outcome: 'escape on display',
    supersedes: [superseded.id]
  })
  const otherThread = baseThread({ slug: 'other-thread', title: 'Another thread', status: 'done' })
  const foreign = decision(otherThread.id, { title: 'A ruling on another thread', context: 'src/render/briefing.ts elsewhere' })
  const thread = baseThread({
    id: threadId,
    title: 'Ship the renderer',
    completion_criteria: [doneCriterion, struckCriterion],
    artifacts: [
      { id: liveArtifactId, label: 'the implementation plan', pointer: 'docs/plans/u5.md', retired: false },
      { id: rt.ulid(), label: 'a retired artifact', pointer: 'docs/old.md', retired: true }
    ],
    spine: {
      active_goal: 'ship the renderer',
      next_step: 'apply the ruling in src/render/briefing.ts',
      next_step_records: [named.id],
      landed: 'landed the first half',
      last_session: 'wrote the renderer',
      open_risks: [liveRisk, retiredRisk],
      key_decisions: [],
      out_of_scope: [{ id: noteId, text: 'capping the next step' }]
    }
  })

  const rendered = await briefingOf(thread, pointerFor(threadId), [
    { kind: 'thread', record: otherThread },
    ...[named, superseded, matched, other, foreign].map((record): RecordChange => ({ kind: 'decision', record })),
    { kind: 'session', record: entry(threadId, 'read the renderer') },
    { kind: 'session', record: entry(threadId, '') },
    { kind: 'session', record: entry(otherThread.id, 'an entry on another thread') }
  ])

  assert.equal(
    rendered,
    [
      BRIEFING_HEADING,
      '',
      '**Thread:** Ship the renderer',
      '**Status:** open',
      '**Blockage:** none',
      '**Currently being worked:** yes',
      '',
      '**Goal:**',
      '',
      '> ship the renderer',
      '',
      '**Next step:**',
      '',
      '> apply the ruling in src/render/briefing.ts',
      '',
      '**What this step needs:**',
      '',
      'Records this step needs:',
      '',
      `Decision ${named.id} (thread briefing-fixture, open)`,
      'Title: Render the step first',
      'Context: the briefing buried the step',
      'Options:',
      '- whole thread',
      '- step first',
      'Outcome: step first',
      '',
      'Matched by file name, because this step names src/render/briefing.ts:',
      '',
      `Decision ${matched.id} (thread briefing-fixture, open)`,
      'Title: Keep the renderer in one file',
      'Context: src/render/briefing.ts holds every display',
      'Options:',
      'Outcome: one file',
      '',
      `Decision ${foreign.id} (thread other-thread, done)`,
      'Title: A ruling on another thread',
      'Context: src/render/briefing.ts elsewhere',
      'Options:',
      'Outcome: an outcome',
      '',
      OTHER_RECORDS_HEADING,
      '',
      `- decision ${other.id}: Escape every stored value`,
      `- risk ${liveRisk.id}: the census may miss a site (bears on criterion ${doneCriterion.id})`,
      `- criterion ${doneCriterion.id}: c1 [done] [proposed] first criterion`,
      `- artifact ${liveArtifactId}: the implementation plan -> docs/plans/u5.md`,
      `- out-of-scope ${noteId}: capping the next step`,
      '',
      `**Session log:** 2 entries at logbook://sessions/${threadId}`,
      '',
      OTHER_THREADS_LINE
    ].join('\n')
  )
})

test('briefing.pointer-status-is-no-for-a-different-thread', async () => {
  const thread = baseThread()
  const elsewhere = await briefingOf(thread, pointerFor(rt.ulid()))
  const unheld = await briefingOf(thread, null)
  assert.ok(elsewhere.split('\n').includes('**Currently being worked:** no'))
  assert.ok(unheld.split('\n').includes('**Currently being worked:** no'))
})

test('briefing.escapes-every-free-text-field', async () => {
  const threadId = rt.ulid()
  const named = decision(threadId, {
    title: '# decision heading',
    context: '# context heading',
    options: ['# option heading'],
    outcome: '# outcome heading'
  })
  const thread = baseThread({
    id: threadId,
    title: '# heading attempt',
    blocked_by: '# blocked heading',
    completion_criteria: [criterion({ text: '# criterion heading', check: '# check heading' })],
    artifacts: [{ id: rt.ulid(), label: '# artifact heading', pointer: '# pointer heading', retired: false }],
    spine: {
      active_goal: '# goal heading',
      next_step: '# next heading',
      next_step_records: [named.id],
      landed: '',
      last_session: '',
      open_risks: [risk({ text: '# risk heading' })],
      key_decisions: [],
      out_of_scope: [{ id: rt.ulid(), text: '# oos heading' }]
    }
  })
  const rendered = await briefingOf(thread, null, [
    { kind: 'decision', record: named },
    { kind: 'decision', record: decision(threadId, { title: '# listed decision heading' }) }
  ])
  const [firstLine, ...restLines] = rendered.split('\n')
  assert.equal(firstLine, BRIEFING_HEADING)
  assert.equal(restLines.join('\n').includes('#'), false, rendered)
})

test('briefing.a-step-naming-no-records-says-so-and-an-empty-thread-says-a-definition-of-done-is-owed', async () => {
  const lines = (await briefingOf(baseThread())).split('\n')
  const needsAt = lines.indexOf('**What this step needs:**')
  const otherAt = lines.indexOf(OTHER_RECORDS_HEADING)
  assert.deepEqual(lines.slice(needsAt + 1, needsAt + 3), ['', 'This step names no records.'])
  assert.deepEqual(lines.slice(otherAt + 1, otherAt + 3), [
    '',
    '- no open or done completion criterion is recorded; a definition of done is still owed'
  ])
})

test('briefing.a-named-id-that-no-longer-resolves-is-named-as-unreadable', async () => {
  const threadId = rt.ulid()
  const named = decision(threadId, { title: 'the ruling that still exists', outcome: 'keep it' })
  const vanished = rt.ulid()
  const thread = baseThread({
    id: threadId,
    spine: { ...baseThread().spine, next_step_records: [vanished, named.id] }
  })
  const rendered = await briefingOf(thread, null, [{ kind: 'decision', record: named }])
  assert.ok(rendered.includes(`Decision ${named.id} `), 'the id that resolves must still be shown in full')
  assert.ok(
    rendered.includes(`Named by this step but not readable now: ${vanished}`),
    'an id that no longer resolves must be named as unreadable, never dropped without a word'
  )
})

test('briefing.a-record-named-twice-is-shown-once', async () => {
  const anchored = criterion({ text: 'the anchored criterion', check: 'the anchored check' })
  const base = baseThread({ completion_criteria: [anchored] })
  const thread: Thread = {
    ...base,
    spine: { ...base.spine, next_step_records: [anchored.id, anchored.id], next_step_criterion_id: anchored.id }
  }
  const rendered = await briefingOf(thread)
  assert.equal(rendered.split(`Criterion ${anchored.id} `).length - 1, 1, 'a record named more than once must be shown once')
  assert.equal(rendered.includes(`- criterion ${anchored.id}:`), false, 'a record shown in full must not be listed again')
})

test('briefing.a-named-record-on-another-thread-is-shown-in-full-and-never-listed', async () => {
  const otherThread = baseThread({ slug: 'gateway-502-incident', title: 'the gateway incident', status: 'done' })
  const ruling = decision(otherThread.id, { title: 'Cap the gateway timeout', outcome: 'at most 3000 ms' })
  const base = baseThread()
  const thread: Thread = { ...base, spine: { ...base.spine, next_step_records: [ruling.id] } }
  const rendered = await briefingOf(thread, null, [
    { kind: 'thread', record: otherThread },
    { kind: 'decision', record: ruling }
  ])
  assert.ok(rendered.includes(`Decision ${ruling.id} (thread gateway-502-incident, done)`), rendered)
  assert.ok(rendered.includes('Outcome: at most 3000 ms'), rendered)
  const otherAt = rendered.indexOf(OTHER_RECORDS_HEADING)
  assert.equal(rendered.slice(otherAt).includes(ruling.id), false, 'a record on another thread is never listed')
})
