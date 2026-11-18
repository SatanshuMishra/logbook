import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runHookProcess } from '../support/run-hook.ts'

const SESSION_FALLBACK_WARNING = 'runtime.session-id-fallback'

test('hook-runtime-after-input-check.malformed-stdin-reports-only-the-failure', async () => {
  const run = await runHookProcess({ hook: 'io-probe', event: '{not json' })
  assert.equal(run.code, 1)
  assert.equal(run.stderr.includes(SESSION_FALLBACK_WARNING), false, `stderr was ${JSON.stringify(run.stderr)}`)
  assert.ok(run.stderr.startsWith('io-probe failed:'), `stderr was ${JSON.stringify(run.stderr)}`)
})

test('hook-runtime-after-input-check.event-without-session-or-cwd-writes-no-stderr', async () => {
  const events = [{}, { session_id: 's1' }, { cwd: '/' }, { session_id: '', cwd: '/' }]
  for (const event of events) {
    const run = await runHookProcess({ hook: 'io-probe', event })
    assert.equal(run.code, 0, run.stderr)
    assert.equal(run.stdout, '{}')
    assert.equal(run.stderr, '', `stderr for ${JSON.stringify(event)} was ${JSON.stringify(run.stderr)}`)
  }
})
