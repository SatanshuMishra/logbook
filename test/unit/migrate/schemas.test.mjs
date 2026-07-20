import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateThreadMap,
  validateDecisionMap,
  validateSessionMap,
  validateReviewQueue,
  validatePlanArtifact,
} from '../../../src/migrate/schemas.mjs'

const ULID = '01JZ0000000000000000000000'

test('threadMap accepts a well-formed map and records the created_at rung', () => {
  const map = {
    schema_version: 1,
    store: 'Users-x-project',
    entries: [
      { slug: 'my-thread', id: ULID, created_at: '2026-06-30T12:00:00Z', created_at_rung: 2, title: 'My Thread' },
    ],
  }
  assert.equal(validateThreadMap(map), map)
})

test('threadMap rejects an out-of-range created_at rung', () => {
  const map = {
    schema_version: 1,
    store: 'x',
    entries: [{ slug: 's', id: ULID, created_at: '2026-06-30T12:00:00Z', created_at_rung: 5, title: 't' }],
  }
  assert.throws(() => validateThreadMap(map), /created_at_rung|enum/)
})

test('threadMap rejects a non-ULID id', () => {
  const map = {
    schema_version: 1,
    store: 'x',
    entries: [{ slug: 's', id: 'not-a-ulid', created_at: '2026-06-30T12:00:00Z', created_at_rung: 1, title: 't' }],
  }
  assert.throws(() => validateThreadMap(map), /pattern|id/)
})

test('decisionMap accepts NNNN + nullable thread_id', () => {
  const map = {
    schema_version: 1,
    store: 'x',
    entries: [
      { old_filename: '2026-06-30-a.md', nnnn: '0001', slug: 'a', thread_id: ULID },
      { old_filename: '2026-06-30-b.md', nnnn: '0002', slug: 'b', thread_id: null },
    ],
  }
  assert.equal(validateDecisionMap(map), map)
})

test('decisionMap rejects a non-4-digit NNNN', () => {
  const map = {
    schema_version: 1,
    store: 'x',
    entries: [{ old_filename: 'f.md', nnnn: '12', slug: 'a', thread_id: null }],
  }
  assert.throws(() => validateDecisionMap(map), /nnnn|pattern/)
})

test('sessionMap accepts a routed path and lossy_time flag', () => {
  const map = {
    schema_version: 1,
    store: 'x',
    entries: [
      {
        old_path: 'sessions/2026-06-30-01-a.md',
        new_path: `sessions/${ULID}/2026-06-30T00-01-00Z--migrated.md`,
        thread_id: ULID,
        lossy_time: true,
      },
    ],
  }
  assert.equal(validateSessionMap(map), map)
})

test('reviewQueue accepts each flag class and rejects an unknown one', () => {
  const good = {
    schema_version: 1,
    store: 'x',
    entries: [
      { id: ULID, record_type: 'decision', source_path: 'decisions/x.md', flag_class: 'MANUAL', reason: 'no Thread-Id', suggestion: 'assign at review', resolution_status: 'open' },
    ],
  }
  assert.equal(validateReviewQueue(good), good)
  const bad = { ...good, entries: [{ ...good.entries[0], flag_class: 'WHATEVER' }] }
  assert.throws(() => validateReviewQueue(bad), /flag_class|enum/)
})

test('planArtifact accepts a full dry-run plan', () => {
  const plan = {
    schema_version: 1,
    tool_version: '0.0.0',
    store_path: '/abs/store',
    project_key: 'x',
    backend: 'orphan-branch',
    source_inventory_hash: 'a'.repeat(64),
    baseline_counts: { threads: 1, decisions: 2, sessions: 3, bindings: 0 },
    source_checksums: [{ path: 'threads/t.md', sha256: 'b'.repeat(64) }],
    thread_map: { schema_version: 1, store: 'x', entries: [] },
    decision_map: { schema_version: 1, store: 'x', entries: [] },
    session_map: { schema_version: 1, store: 'x', entries: [] },
    binding_plan: [],
    cross_ref_rewrites: [{ surface: 1, old: 'decisions/a.md', new: '0001-a', class: 'DERIVED', status: 'resolved' }],
    review_queue: { schema_version: 1, store: 'x', entries: [] },
    flags: { lossy: 0, manual: 0, halt: 0 },
    verification: { v1: null, v2: null, v3: null, v4: null, v5: null },
  }
  assert.equal(validatePlanArtifact(plan), plan)
})

test('planArtifact rejects an unknown backend and a short inventory hash', () => {
  const base = {
    schema_version: 1, tool_version: '0.0.0', store_path: '/s', project_key: 'x',
    backend: 'orphan-branch', source_inventory_hash: 'a'.repeat(64),
    baseline_counts: { threads: 0, decisions: 0, sessions: 0, bindings: 0 },
    source_checksums: [], thread_map: { schema_version: 1, store: 'x', entries: [] },
    decision_map: { schema_version: 1, store: 'x', entries: [] },
    session_map: { schema_version: 1, store: 'x', entries: [] },
    binding_plan: [], cross_ref_rewrites: [],
    review_queue: { schema_version: 1, store: 'x', entries: [] },
    flags: { lossy: 0, manual: 0, halt: 0 },
    verification: { v1: null, v2: null, v3: null, v4: null, v5: null },
  }
  assert.throws(() => validatePlanArtifact({ ...base, backend: 'sqlite' }), /backend|enum/)
  assert.throws(() => validatePlanArtifact({ ...base, source_inventory_hash: 'short' }), /source_inventory_hash|pattern/)
})
