import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rollupReviewQueue, renderMigrationReport } from '../../../src/migrate/review-report.mjs'

const ULID_A = '01JZ000000000000000000000A'

function entry(overrides) {
  return {
    id: ULID_A, record_type: 'decision', source_path: 'decisions/x.md',
    flag_class: 'MANUAL', reason: 'no Thread-Id', suggestion: 'assign at review', resolution_status: 'open',
    ...overrides,
  }
}

test('an open or HALT entry blocks done', () => {
  assert.equal(rollupReviewQueue({ schema_version: 1, store: 's', entries: [entry({})] }).blocksDone, true)
  const halt = rollupReviewQueue({ schema_version: 1, store: 's', entries: [entry({ flag_class: 'HALT', resolution_status: 'resolved' })] })
  assert.equal(halt.blocksDone, true)
})

test('a fully resolved, non-HALT queue clears cutover', () => {
  const roll = rollupReviewQueue({
    schema_version: 1, store: 's',
    entries: [entry({ flag_class: 'LOSSY', resolution_status: 'resolved' })],
  })
  assert.equal(roll.blocksDone, false)
  assert.equal(roll.byClass.LOSSY, 1)
  assert.equal(roll.counts.resolved, 1)
})

test('renderMigrationReport surfaces verification, the snapshot path, and the cutover verdict', () => {
  const md = renderMigrationReport({
    store: '/s',
    plan: { baseline_counts: { threads: 2, decisions: 1, sessions: 3, bindings: 0 } },
    verification: { v1: { ok: true }, v2: { ok: true }, v3: { ok: true }, v4: null, v5: { ok: true } },
    queue: { schema_version: 1, store: 's', entries: [entry({ flag_class: 'HALT' })] },
    snapshot: '/abs/_migration/v1-source.tgz',
  })
  assert.match(md, /# Migration report/)
  assert.match(md, /V1 counts: true/)
  assert.match(md, /pre-apply snapshot: \/abs\/_migration\/v1-source\.tgz/)
  assert.match(md, /Cutover: BLOCKED/)
})
