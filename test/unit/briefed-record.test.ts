import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BRIEFED_THREADS_MAX, readBriefed, recordBriefed } from '../../src/domain/briefed.ts'
import type { StoreLayout } from '../../src/store/layout.ts'
import { testRuntime } from '../support/runtime.ts'

const THREAD_A = '01M0NDPM0ACCR9CD68PMHYWGGD'
const THREAD_B = '01M0NDPM0ACCR9CD68PMHYWGGE'

const withLayout = (fn: (layout: StoreLayout) => void): void => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-briefed-record-'))
  const state = join(home, 'state')
  mkdirSync(state)
  try {
    fn({ root: home, records: join(home, 'records'), state, projectRoot: home })
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}

test('briefed.a-recorded-thread-reads-back-for-the-same-session', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    recordBriefed(rt, layout, THREAD_A)
    assert.deepEqual([...readBriefed(rt, layout)], [THREAD_A])
  })
})

test('briefed.a-second-thread-joins-the-first-without-displacing-it', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    recordBriefed(rt, layout, THREAD_A)
    recordBriefed(rt, layout, THREAD_B)
    assert.deepEqual([...readBriefed(rt, layout)], [THREAD_A, THREAD_B])
  })
})

test('briefed.recording-the-same-thread-twice-stores-it-once', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    recordBriefed(rt, layout, THREAD_A)
    recordBriefed(rt, layout, THREAD_A)
    assert.deepEqual([...readBriefed(rt, layout)], [THREAD_A])
  })
})

test('briefed.a-different-session-reads-nothing-and-takes-the-record-over', () => {
  withLayout((layout) => {
    recordBriefed(testRuntime({ sessionId: 'session-one' }), layout, THREAD_A)
    const second = testRuntime({ sessionId: 'session-two' })
    assert.deepEqual([...readBriefed(second, layout)], [])
    recordBriefed(second, layout, THREAD_B)
    assert.deepEqual([...readBriefed(second, layout)], [THREAD_B])
  })
})

test('briefed.an-absent-record-reads-as-nothing-briefed', () => {
  withLayout((layout) => {
    assert.deepEqual([...readBriefed(testRuntime({ sessionId: 'session-one' }), layout)], [])
  })
})

test('briefed.a-malformed-record-reads-as-nothing-briefed', () => {
  const malformed = [
    'not json at all',
    '[]',
    '{"session_id":"session-one"}',
    '{"session_id":"","thread_ids":[]}',
    '{"session_id":"session-one","thread_ids":"01M0NDPM0ACCR9CD68PMHYWGGD"}',
    '{"session_id":"session-one","thread_ids":["not-a-ulid"]}'
  ]
  for (const contents of malformed) {
    withLayout((layout) => {
      writeFileSync(join(layout.state, 'briefed.json'), contents)
      assert.deepEqual(
        [...readBriefed(testRuntime({ sessionId: 'session-one' }), layout)],
        [],
        `expected a record reading ${contents} to brief this session on nothing`
      )
    })
  }
})

test('briefed.the-cap-drops-the-oldest-thread-first', () => {
  withLayout((layout) => {
    const rt = testRuntime({ sessionId: 'session-one' })
    const ids = Array.from(
      { length: BRIEFED_THREADS_MAX + 1 },
      (_value, index) => `01M0NDPM0ACCR9CD68PMHY${String(index).padStart(4, '0')}`
    )
    for (const id of ids) recordBriefed(rt, layout, id)
    const stored = [...readBriefed(rt, layout)]
    assert.equal(stored.length, BRIEFED_THREADS_MAX)
    assert.equal(stored.includes(ids[0] as string), false)
    assert.equal(stored.includes(ids[ids.length - 1] as string), true)
  })
})
