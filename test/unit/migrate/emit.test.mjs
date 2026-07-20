import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  emitThread, resolveMigratedStatus, demoteSpine,
  emitDecision, emitSession, emitBinding,
  emitDemotionSession, emitProvenanceSnapshot, emitProjectMdFold, selectAnchorThread,
} from '../../../src/migrate/emit.mjs'

const ULID_A = '01JZ000000000000000000000A'
const ULID_B = '01JZ000000000000000000000B'
const ISO = '2026-06-01T00:02:00Z'

function baseSpine() {
  return { status: 'paused', active_goal: 'ship', next_step: 'do', open_risks: [], key_decisions: [], out_of_scope: [] }
}

test('emitThread produces a schema_version 1 Thread that passes the frozen validator', () => {
  const t = emitThread(
    { id: ULID_A, slug: 'x', title: 'X', status: 'paused', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-02T00:00:00Z' },
    { spine: baseSpine(), completion_criteria: [], external_refs: [] },
    {},
  )
  assert.equal(t.schema_version, 1)
  assert.equal(t.id, ULID_A)
  assert.equal(t.parent_id, null)
  assert.equal(t.blocked_by, null)
  assert.equal(t.closure_statement, null)
  assert.equal(t.updated_at, '2026-06-02T00:00:00Z')
})

test('emitThread recomputes spine.status from the migrated status and wires refs', () => {
  const zombie = emitThread(
    { id: ULID_B, slug: 'z', title: 'Z', status: 'paused', createdAt: '2026-06-01T00:00:00Z', updatedAt: '2026-06-02T00:00:00Z' },
    { spine: { ...baseSpine(), status: 'active' }, completion_criteria: [], external_refs: [] },
    { parent_id: ULID_A, predecessor_id: ULID_A },
  )
  assert.equal(zombie.spine.status, 'paused')
  assert.equal(zombie.parent_id, ULID_A)
  assert.equal(zombie.predecessor_id, ULID_A)
})

test('emitThread defaults updated_at to created_at when absent', () => {
  const t = emitThread(
    { id: ULID_A, slug: 'x', title: 'X', status: 'blocked', createdAt: '2026-06-01T00:00:00Z' },
    { spine: baseSpine(), completion_criteria: [], external_refs: [] },
    {},
  )
  assert.equal(t.updated_at, '2026-06-01T00:00:00Z')
})

test('emitThread rejects an invalid timestamp at the frozen boundary', () => {
  assert.throws(
    () => emitThread(
      { id: ULID_A, slug: 'x', title: 'X', status: 'paused', createdAt: 'not-a-timestamp', updatedAt: '2026-06-02T00:00:00Z' },
      { spine: baseSpine(), completion_criteria: [], external_refs: [] },
      {},
    ),
    /created_at|schema validation/,
  )
})

test('resolveMigratedStatus demotes a zombie active thread to paused', () => {
  assert.deepEqual(resolveMigratedStatus('active'), { status: 'paused', demoted: true })
  assert.deepEqual(resolveMigratedStatus('blocked'), { status: 'blocked', demoted: false })
  assert.deepEqual(resolveMigratedStatus('weird'), { status: 'paused', demoted: true })
})

test('emitBinding produces a BranchBinding with NO schema_version field', () => {
  const b = emitBinding({ id: ULID_B, threadId: ULID_A, repo: '/r', branch: 'feat/x', createdAt: '2026-06-01T00:00:00Z' })
  assert.equal('schema_version' in b, false)
  assert.equal(b.status, 'active')
  assert.equal(b.closed_at, null)
  assert.equal(b.closed_reason, null)
  assert.equal(b.trailer_present, false)
})

test('emitDecision renders the frozen decision format and requires a resolved thread', () => {
  const d = emitDecision(
    { nnnn: '0001', slug: 'pick' },
    { title: 'Pick', context: 'why', options: ['a', 'b'], outcome: 'a', date: '2026-06-01' },
    ULID_A,
  )
  assert.ok(d.markdown.startsWith('---\nStatus: accepted'))
  assert.match(d.markdown, /# 0001\. Pick/)
  assert.match(d.markdown, new RegExp(`Thread-Id: ${ULID_A}`))
  assert.equal(d.nnnn, '0001')
  assert.throws(() => emitDecision({ nnnn: '0002', slug: 'orphan' }, { title: 'O', options: [] }, null), /ReviewQueue/)
})

test('emitDecision tolerates missing context/outcome/date on a sparse v1 decision', () => {
  const d = emitDecision({ nnnn: '0003', slug: 'sparse' }, { title: 'Sparse', options: [] }, ULID_A)
  assert.match(d.markdown, /# 0003\. Sparse/)
  assert.match(d.markdown, /## Context/)
  assert.match(d.markdown, /## Outcome/)
})

test('emitSession byte-copies the source verbatim', () => {
  const src = Buffer.from('# session\nline\n', 'utf8')
  const s = emitSession({ new_path: `sessions/${ULID_A}/2026-06-01T00-01-00Z--migrated.md` }, src)
  assert.equal(Buffer.compare(s.bytes, src), 0)
  assert.notEqual(s.bytes, src)
  assert.match(s.path, /--migrated\.md$/)
})

test('emitDemotionSession stamps actor migrated', () => {
  const s = emitDemotionSession(ULID_A, ISO, ['status was active'])
  assert.equal(s.actor, 'migrated')
  assert.equal(s.threadId, ULID_A)
  assert.match(s.markdown, /Actor: migrated/)
  assert.match(s.markdown, /- status was active/)
})

test('demoteSpine caps scalars and count-caps non-exempt arrays but leaves key_decisions count intact', () => {
  const big = 'x'.repeat(600)
  const decisions = Array.from({ length: 25 }, (_, i) => `d${i}`)
  const risks = Array.from({ length: 25 }, (_, i) => `r${i}`)
  const { spine, overflow } = demoteSpine({ ...baseSpine(), active_goal: big, key_decisions: decisions, open_risks: risks })
  assert.equal(spine.active_goal.length, 500)
  assert.equal(spine.key_decisions.length, 25)
  assert.equal(spine.open_risks.length, 20)
  assert.ok(overflow.some((o) => o.startsWith('active_goal: ')))
  assert.ok(overflow.some((o) => o.startsWith('open_risks: ')))
})

test('demoteSpine applies the 300-char item cap even to count-exempt key_decisions', () => {
  const longItem = 'k'.repeat(400)
  const { spine } = demoteSpine({ ...baseSpine(), key_decisions: [longItem] })
  assert.equal(spine.key_decisions[0].length, 300)
})

test('emitProvenanceSnapshot embeds verbatim source, orphan fields, and a Source-SHA256 line', () => {
  const src = '# Auth refactor\npriority: high\nsome body\n'
  const expected = createHash('sha256').update(Buffer.from(src, 'utf8')).digest('hex')
  const s = emitProvenanceSnapshot(ULID_A, ISO, {
    sourceMarkdown: src,
    orphanFields: ['priority: high'],
    spineOverflow: ['active_goal: <trimmed tail>'],
  })
  assert.equal(s.actor, 'migration-v1')
  assert.equal(s.threadId, ULID_A)
  assert.match(s.markdown, new RegExp(`Source-SHA256: ${expected}`))
  assert.ok(s.markdown.includes(src))
  assert.match(s.markdown, /priority: high/)
  assert.match(s.markdown, /active_goal: <trimmed tail>/)
})

test('emitProjectMdFold preserves PROJECT.md verbatim (no 80-line truncation) with a sha256', () => {
  const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
  const expected = createHash('sha256').update(Buffer.from(long, 'utf8')).digest('hex')
  const f = emitProjectMdFold(ULID_A, ISO, long)
  assert.equal(f.threadId, ULID_A)
  assert.equal(f.actor, 'migration-v1')
  assert.ok(f.markdown.includes(long))
  assert.match(f.markdown, new RegExp(`Source-SHA256: ${expected}`))
  assert.throws(() => emitProjectMdFold(null, ISO, long), /anchorThreadId/)
})

test('selectAnchorThread picks the earliest created_at with a deterministic id tie-break', () => {
  const entries = [
    { slug: 'b', id: ULID_B, created_at: '2026-06-02T00:00:00Z' },
    { slug: 'a', id: ULID_A, created_at: '2026-06-01T00:00:00Z' },
  ]
  assert.equal(selectAnchorThread(entries), ULID_A)
  const tie = [
    { slug: 'y', id: ULID_B, created_at: '2026-06-01T00:00:00Z' },
    { slug: 'x', id: ULID_A, created_at: '2026-06-01T00:00:00Z' },
  ]
  assert.equal(selectAnchorThread(tie), ULID_A)
  assert.throws(() => selectAnchorThread([]), /no threads/)
})
