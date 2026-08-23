import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import { renderBriefing } from '../../src/render/briefing.ts'
import type { Thread } from '../../src/schema/thread.ts'
import type { Decision } from '../../src/schema/decision.ts'
import type { Pointer } from '../../src/domain/pointer.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, sourceFileFor } from '../support/source-census.ts'

const rt = testRuntime()

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
const INTERPOLATION_MARKER = '${'

type BlockedCandidate = { line: number; hasInterpolation: boolean }

const collectBlockedCandidates = (sourceFile: ts.SourceFile): BlockedCandidate[] => {
  const found: BlockedCandidate[] = []
  const lines = sourceFile.text.split('\n')
  forEachDescendant(sourceFile, (node) => {
    const isLiteralWithText =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    if (!isLiteralWithText) return
    const raw = node.getText(sourceFile)
    if (!BLOCKED_WORD_PATTERN.test(raw)) return
    const line = lineOf(sourceFile, node)
    const lineText = lines[line - 1] ?? ''
    found.push({ line, hasInterpolation: lineText.includes(INTERPOLATION_MARKER) })
  })
  return found
}

const classifyBlockedCandidate = (candidate: BlockedCandidate): Classified<BlockedCandidate>['verdict'] | 'unclassifiable' =>
  candidate.hasInterpolation ? 'allowed' : 'forbidden'

test('briefing.blocked-renders-its-reason', () => {
  const thread = baseThread({ blocked_by: 'waiting on the infra approval' })
  const rendered = renderBriefing(thread, [], null)
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
  const rendered = renderBriefing(thread, [], null)
  assert.ok(rendered.split('\n').includes('Blockage: none'))
})

test('briefing.renders-exact-output-for-a-full-thread', () => {
  const threadId = rt.ulid()
  const decisionOne: Decision = {
    id: rt.ulid(),
    thread_id: threadId,
    title: 'use postgres',
    context: 'needed a database',
    options: ['postgres', 'sqlite'],
    outcome: 'chose postgres for durability',
    commit: null,
    supersedes: [],
    created_at: rt.now()
  }
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
      open_risks: [{ id: rt.ulid(), scope: 'renderer', text: 'escaping might be incomplete', refs: [] }],
      key_decisions: [{ id: rt.ulid(), decision_id: decisionOne.id, title: 'use postgres', scope: 'storage' }],
      out_of_scope: [{ id: rt.ulid(), text: 'does not cover the CLI' }]
    }
  })

  const pointer: Pointer = { thread_id: threadId, written_at: rt.now(), session_id: 'session-x' }

  const rendered = renderBriefing(thread, [decisionOne], pointer)

  const expected = [
    'Thread: Ship the renderer',
    'Status: open',
    'Blockage: none',
    'Currently being worked: yes',
    'Active goal: ship the renderer',
    'Next step: add tests',
    'Last session: wrote the first draft',
    'Open risks:',
    '- escaping might be incomplete',
    'Key decisions:',
    '- use postgres',
    'Out of scope:',
    '- does not cover the CLI',
    'Completion criteria:',
    'c1 [done] first criterion',
    'c2 [struck] second criterion',
    'Decisions:',
    '- use postgres: chose postgres for durability'
  ].join('\n')

  assert.equal(rendered, expected)
})

test('briefing.renders-headers-only-when-lists-are-empty', () => {
  const thread = baseThread({ title: 'Empty Thread', status: 'done', blocked_by: 'still finishing docs' })
  const rendered = renderBriefing(thread, [], null)
  const expected = [
    'Thread: Empty Thread',
    'Status: done',
    'Blocked: still finishing docs',
    'Currently being worked: no',
    'Active goal: ship the thing',
    'Next step: write the tests',
    'Last session: wrote the renderer',
    'Open risks:',
    'Key decisions:',
    'Out of scope:',
    'Completion criteria:',
    'Decisions:'
  ].join('\n')
  assert.equal(rendered, expected)
})

test('briefing.pointer-status-is-no-for-a-different-thread', () => {
  const thread = baseThread()
  const pointer: Pointer = { thread_id: rt.ulid(), written_at: rt.now(), session_id: 'someone-else' }
  const rendered = renderBriefing(thread, [], pointer)
  assert.ok(rendered.split('\n').includes('Currently being worked: no'))
})

test('briefing.criterion-status-is-open-when-undone-and-unstruck', () => {
  const thread = baseThread({
    completion_criteria: [
      { id: rt.ulid(), ordinal: 1, text: 'not started yet', done: false, kind: 'planned', struck_by: null }
    ]
  })
  const rendered = renderBriefing(thread, [], null)
  assert.ok(rendered.split('\n').includes('c1 [open] not started yet'))
})

test('briefing.renders-multiple-decisions-in-order', () => {
  const thread = baseThread()
  const first: Decision = {
    id: rt.ulid(),
    thread_id: thread.id,
    title: 'first',
    context: '',
    options: [],
    outcome: 'outcome one',
    commit: null,
    supersedes: [],
    created_at: rt.now()
  }
  const second: Decision = {
    id: rt.ulid(),
    thread_id: thread.id,
    title: 'second',
    context: '',
    options: [],
    outcome: 'outcome two',
    commit: null,
    supersedes: [],
    created_at: rt.now()
  }
  const rendered = renderBriefing(thread, [first, second], null)
  const lines = rendered.split('\n')
  const decisionsIndex = lines.indexOf('Decisions:')
  assert.equal(lines[decisionsIndex + 1], '- first: outcome one')
  assert.equal(lines[decisionsIndex + 2], '- second: outcome two')
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
  const decision: Decision = {
    id: rt.ulid(),
    thread_id: thread.id,
    title: '# decision title',
    context: '',
    options: [],
    outcome: '# outcome heading',
    commit: null,
    supersedes: [],
    created_at: rt.now()
  }
  const rendered = renderBriefing(thread, [decision], null)
  assert.equal(rendered.includes('#'), false)
})
