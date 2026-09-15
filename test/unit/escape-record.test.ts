import test from 'node:test'
import assert from 'node:assert/strict'
import { escapeStoredRecord } from '../../src/schema/escape-record.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { BindingRecord, type Binding } from '../../src/schema/binding.ts'

const hostile = (label: string): string => `<${label}`
const escaped = (label: string): string => `U+003C${label}`

const VALID_SLUG = 'a-slug'
const VALID_SHA = '0123456789abcdef0123456789abcdef01234567'

const hostileThread: Thread = {
  id: hostile('id'),
  slug: VALID_SLUG,
  title: hostile('title'),
  status: 'open',
  blocked_by: hostile('blocked_by'),
  predecessor_id: hostile('predecessor_id'),
  completion_criteria: [
    {
      id: hostile('criterion.id'),
      ordinal: 1,
      text: hostile('criterion.text'),
      done: true,
      kind: 'planned',
      check: hostile('criterion.check'),
      result: hostile('criterion.result'),
      result_status: 'verified',
      struck_by: hostile('criterion.struck_by'),
      settledness: 'confirmed',
      settled_by: hostile('criterion.settled_by')
    }
  ],
  artifacts: [{ id: hostile('artifact.id'), label: hostile('artifact.label'), pointer: hostile('artifact.pointer'), retired: false }],
  spine: {
    active_goal: hostile('active_goal'),
    next_step: hostile('next_step'),
    next_step_criterion_id: hostile('next_step_criterion_id'),
    landed: hostile('landed'),
    last_session: hostile('last_session'),
    open_risks: [
      {
        id: hostile('risk.id'),
        scope: hostile('risk.scope'),
        text: hostile('risk.text'),
        refs: [hostile('risk.ref')],
        criterion_id: hostile('risk.criterion_id'),
        retired: false
      }
    ],
    key_decisions: [
      {
        id: hostile('key_decision.id'),
        decision_id: hostile('key_decision.decision_id'),
        title: hostile('key_decision.title'),
        scope: hostile('key_decision.scope'),
        criterion_id: hostile('key_decision.criterion_id')
      }
    ],
    out_of_scope: [{ id: hostile('out_of_scope.id'), text: hostile('out_of_scope.text') }]
  },
  created_at: hostile('created_at'),
  updated_at: hostile('updated_at')
}

const threadAsTheToolsStoreIt: Thread = {
  ...hostileThread,
  title: escaped('title'),
  blocked_by: escaped('blocked_by'),
  completion_criteria: [
    {
      ...(hostileThread.completion_criteria[0] as Thread['completion_criteria'][number]),
      text: escaped('criterion.text'),
      check: escaped('criterion.check'),
      result: escaped('criterion.result'),
      settled_by: escaped('criterion.settled_by')
    }
  ],
  artifacts: [{ id: hostile('artifact.id'), label: escaped('artifact.label'), pointer: escaped('artifact.pointer'), retired: false }],
  spine: {
    ...hostileThread.spine,
    active_goal: escaped('active_goal'),
    next_step: escaped('next_step'),
    landed: escaped('landed'),
    last_session: escaped('last_session'),
    open_risks: [
      {
        id: hostile('risk.id'),
        scope: escaped('risk.scope'),
        text: escaped('risk.text'),
        refs: [escaped('risk.ref')],
        criterion_id: hostile('risk.criterion_id'),
        retired: false
      }
    ],
    key_decisions: [
      {
        id: hostile('key_decision.id'),
        decision_id: hostile('key_decision.decision_id'),
        title: escaped('key_decision.title'),
        scope: escaped('key_decision.scope'),
        criterion_id: hostile('key_decision.criterion_id')
      }
    ],
    out_of_scope: [{ id: hostile('out_of_scope.id'), text: escaped('out_of_scope.text') }]
  }
}

const hostileDecision: Decision = {
  id: hostile('id'),
  thread_id: hostile('thread_id'),
  title: hostile('title'),
  context: hostile('context'),
  options: [hostile('option.one'), hostile('option.two')],
  outcome: hostile('outcome'),
  commit: VALID_SHA,
  supersedes: [hostile('supersedes')],
  created_at: hostile('created_at')
}

const hostileSession: SessionEntry = {
  id: hostile('id'),
  thread_id: hostile('thread_id'),
  actor: hostile('actor'),
  body: hostile('body'),
  created_at: hostile('created_at')
}

const hostileBinding: Binding = {
  id: hostile('id'),
  thread_id: hostile('thread_id'),
  branch: hostile('branch'),
  created_at: hostile('created_at')
}

test('escape-record.a-thread-is-escaped-in-exactly-the-fields-the-thread-writing-tools-escape', () => {
  assert.deepEqual(escapeStoredRecord(ThreadRecord, hostileThread), threadAsTheToolsStoreIt)
})

test('escape-record.a-decision-is-escaped-in-exactly-the-fields-record-decision-escapes', () => {
  assert.deepEqual(escapeStoredRecord(DecisionRecord, hostileDecision), {
    ...hostileDecision,
    title: escaped('title'),
    context: escaped('context'),
    options: [escaped('option.one'), escaped('option.two')],
    outcome: escaped('outcome')
  })
})

test('escape-record.a-session-entry-is-escaped-in-exactly-the-fields-log-session-event-escapes', () => {
  assert.deepEqual(escapeStoredRecord(SessionRecord, hostileSession), { ...hostileSession, actor: escaped('actor'), body: escaped('body') })
})

test('escape-record.a-binding-is-escaped-in-exactly-the-field-bind-branch-escapes', () => {
  assert.deepEqual(escapeStoredRecord(BindingRecord, hostileBinding), { ...hostileBinding, branch: escaped('branch') })
})

test('escape-record.a-record-already-escaped-is-stored-unchanged', () => {
  assert.deepEqual(escapeStoredRecord(ThreadRecord, threadAsTheToolsStoreIt), threadAsTheToolsStoreIt)
})

test('escape-record.absent-and-null-text-fields-stay-absent-and-null', () => {
  const sparse: Thread = {
    ...threadAsTheToolsStoreIt,
    blocked_by: null,
    completion_criteria: [{ id: hostile('criterion.id'), ordinal: 1, text: 'plain', done: false, kind: 'planned', check: null, struck_by: null }]
  }
  const stored = escapeStoredRecord(ThreadRecord, sparse)
  assert.equal(stored.blocked_by, null)
  assert.deepEqual(stored.completion_criteria, sparse.completion_criteria)
  assert.equal(Object.hasOwn(stored.completion_criteria[0] as object, 'result'), false)
})
