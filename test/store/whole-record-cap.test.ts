import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import { commitThread } from '../../src/server/tool-support.ts'
import { toolRefusal } from '../../src/server/errors.ts'
import * as caps from '../../src/schema/caps.ts'
import type { KeyDecision, Thread } from '../../src/schema/thread.ts'

const withStore = (fn: (store: Store, rt: Runtime) => void): void => {
  withRepo((repo) => {
    const pluginDataHome = mkdtempSync(join(tmpdir(), 'logbook-whole-record-cap-data-'))
    const pluginData = join(pluginDataHome, 'plugin-data')
    mkdirSync(pluginData)
    try {
      const rt = testRuntime({
        env: { HOME: process.env.HOME, PATH: process.env.PATH, CLAUDE_PLUGIN_DATA: pluginData },
        cwd: repo
      })
      const opened = openStore(rt, repo)
      if (!opened.ok) {
        throw new Error(`whole-record-cap fixture: could not open the store: ${opened.message}`)
      }
      fn(opened.value, rt)
    } finally {
      rmSync(pluginDataHome, { recursive: true, force: true })
    }
  })
}

const baseThread = (rt: Runtime): Thread => ({
  id: rt.ulid(),
  slug: 'whole-record-cap-fixture',
  title: 'whole record cap fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [
    { id: rt.ulid(), ordinal: 1, text: 'a criterion for the whole-record cap fixture', done: false, kind: 'planned', struck_by: null }
  ],
  spine: {
    active_goal: 'prove the byte cap refusal names the field and the number',
    next_step: 'read the refusal',
    landed: '',
    last_session: 'none',
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const maxLengthEntry = (rt: Runtime): KeyDecision => ({
  id: rt.ulid(),
  decision_id: rt.ulid(),
  title: 't'.repeat(caps.KEY_DECISION_TITLE_MAX),
  scope: 'c'.repeat(caps.KEY_DECISION_SCOPE_MAX)
})

const firstTextOf = (result: { content: { type: string }[] }): string => {
  const [first] = result.content
  assert.ok(first !== undefined && first.type === 'text', 'expected the rendered refusal to carry a text content block')
  return (first as { type: 'text'; text: string }).text
}

test('whole-record-cap.refusal-names-the-largest-field-and-the-observed-bytes', () => {
  withStore((store, rt) => {
    const base = baseThread(rt)
    const saturated: Thread = {
      ...base,
      spine: {
        ...base.spine,
        key_decisions: Array.from({ length: caps.KEY_DECISIONS_MAX_ELEMENTS }, () => maxLengthEntry(rt))
      }
    }

    const observed = Buffer.byteLength(JSON.stringify(saturated), 'utf8')
    assert.ok(
      observed > caps.THREAD_RECORD_SERIALISED_MAX_BYTES,
      `the fixture must exceed the whole-record byte cap to exercise the refusal; observed ${observed}`
    )
    assert.equal(
      saturated.spine.key_decisions.length,
      caps.KEY_DECISIONS_MAX_ELEMENTS,
      'the fixture must stay within the element cap so the byte cap is the only limit it breaks'
    )

    const attempt = commitThread(store, saturated, 'whole-record cap probe')

    assert.equal(attempt.ok, false, 'committing a thread record over the whole-record byte cap must be refused')
    if (attempt.ok) return

    assert.equal(attempt.refusal.field, 'thread')
    assert.equal(attempt.refusal.retryable, true)

    const rendered = firstTextOf(toolRefusal(attempt.refusal))
    assert.match(rendered, /spine\.key_decisions/, 'the refusal must name the field that grew')
    assert.match(rendered, new RegExp(String(observed)), 'the refusal must state the observed byte count')
    assert.match(
      rendered,
      new RegExp(String(caps.THREAD_RECORD_SERIALISED_MAX_BYTES)),
      'the refusal must state the cap it measured against'
    )
  })
})

test('whole-record-cap.a-record-under-the-cap-still-commits', () => {
  withStore((store, rt) => {
    const attempt = commitThread(store, baseThread(rt), 'whole-record cap control')
    assert.equal(attempt.ok, true, 'a thread record well under the byte cap must still commit')
  })
})
