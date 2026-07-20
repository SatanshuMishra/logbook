import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mintThreadMap, mintDecisionMap } from '../../../src/migrate/identity.mjs'

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

test('thread ids sort by created_at and are all valid ULIDs', () => {
  const map = mintThreadMap('store-x', [
    { slug: 'late', created_at: '2026-06-10T00:00:00Z', created_at_rung: 1, title: 'Late' },
    { slug: 'early', created_at: '2026-06-01T00:00:00Z', created_at_rung: 2, title: 'Early' },
  ])
  const ids = map.entries.map((e) => e.id)
  assert.ok(ids.every((id) => ULID_RE.test(id)))
  const early = map.entries.find((e) => e.slug === 'early')
  const late = map.entries.find((e) => e.slug === 'late')
  assert.ok(early.id < late.id)
})

test('same-millisecond threads still mint distinct monotonic ids', () => {
  const map = mintThreadMap('store-x', [
    { slug: 'a', created_at: '2026-06-01T00:00:00Z', created_at_rung: 1, title: 'A' },
    { slug: 'b', created_at: '2026-06-01T00:00:00Z', created_at_rung: 1, title: 'B' },
  ])
  const [a, b] = map.entries
  assert.notEqual(a.id, b.id)
  assert.ok(a.id < b.id)
})

test('re-mint resolves an existing slug instead of minting a new id', () => {
  const first = mintThreadMap('s', [{ slug: 'keep', created_at: '2026-06-01T00:00:00Z', created_at_rung: 1, title: 'Keep' }])
  const keptId = first.entries[0].id
  const second = mintThreadMap('s', [
    { slug: 'keep', created_at: '2026-06-01T00:00:00Z', created_at_rung: 1, title: 'Keep' },
    { slug: 'new', created_at: '2026-06-02T00:00:00Z', created_at_rung: 1, title: 'New' },
  ], first)
  assert.equal(second.entries.find((e) => e.slug === 'keep').id, keptId)
  assert.equal(second.entries.length, 2)
})

test('decision NNNN is a zero-padded running max over (date, filename)', () => {
  const map = mintDecisionMap('s', [
    { old_filename: '2026-06-02-b.md', date: '2026-06-02', slug: 'b', thread_id: null },
    { old_filename: '2026-06-01-a.md', date: '2026-06-01', slug: 'a', thread_id: null },
  ])
  assert.deepEqual(map.entries.map((e) => [e.nnnn, e.slug]), [['0001', 'a'], ['0002', 'b']])
})

test('mintDecisionMap normalizes a non-kebab slug and falls back to "decision" on empty', () => {
  const map = mintDecisionMap('s', [
    { old_filename: '2026-06-01-a.md', date: '2026-06-01', slug: 'Foo Bar!', thread_id: null },
    { old_filename: '2026-06-02-b.md', date: '2026-06-02', slug: '!!!', thread_id: null },
  ])
  assert.equal(map.entries.find((e) => e.old_filename === '2026-06-01-a.md').slug, 'foo-bar')
  assert.equal(map.entries.find((e) => e.old_filename === '2026-06-02-b.md').slug, 'decision')
})

test('re-mint continues decision numbering from the prior max', () => {
  const first = mintDecisionMap('s', [{ old_filename: '2026-06-01-a.md', date: '2026-06-01', slug: 'a', thread_id: null }])
  const second = mintDecisionMap('s', [
    { old_filename: '2026-06-01-a.md', date: '2026-06-01', slug: 'a', thread_id: null },
    { old_filename: '2026-06-03-c.md', date: '2026-06-03', slug: 'c', thread_id: null },
  ], first)
  assert.deepEqual(second.entries.map((e) => e.nnnn), ['0001', '0002'])
})
