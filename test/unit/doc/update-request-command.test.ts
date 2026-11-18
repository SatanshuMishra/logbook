import assert from 'node:assert/strict'
import { test } from 'node:test'
import { updateRequest } from '../../../src/doc/rules.ts'

const PATH = '/home/u/.logbook/repo-0123456789ab/fix-login.md'
const COMMAND_OPENING = "logbook update_thread --args - <<'EOF'"
const COMMAND_CLOSING = 'EOF'
const PROVISIONAL_LINE =
  'Logbook picked this thread up at session start; record only work that belongs to thread fix-login.'

const FIX_LOGIN = [
  '# fix-login: Fix the login page',
  'Status: active',
  'Next ids: c2 D1 R1 S1',
  '',
  '## Goal',
  '',
  'Let people sign in again.',
  '',
  '## Done when',
  '',
  '- [ ] c1 The login page loads',
  '',
  '## Where things stand',
  '',
  'The form posts to the old endpoint.',
  '',
  '## Next step',
  '',
  'Point the form at the new endpoint.',
  ''
].join('\n')

const MILESTONE = { kind: 'milestone', detail: 'Bash: git commit -m fix' } as const

test('update-request-command.request-gives-the-logbook-command', () => {
  const text = updateRequest({ path: PATH, documentText: FIX_LOGIN, reason: MILESTONE })
  const lines = text.split('\n')
  const opening = lines.indexOf(COMMAND_OPENING)

  assert.ok(opening >= 0, text)
  const payload = JSON.parse(lines[opening + 1] ?? '') as Record<string, unknown>
  assert.equal(payload.thread_id, 'fix-login')
  assert.ok('next_step' in payload && 'edits' in payload && 'note' in payload, text)
  assert.equal(lines[opening + 2], COMMAND_CLOSING)
  assert.ok(!text.includes('Edit tool'), text)
  assert.ok(!lines.includes(PROVISIONAL_LINE), text)
})

test('update-request-command.provisional-request-limits-what-to-record', () => {
  const text = updateRequest({ path: PATH, documentText: FIX_LOGIN, reason: MILESTONE, provisional: true })

  assert.ok(text.split('\n').includes(PROVISIONAL_LINE), text)
})
