import assert from 'node:assert/strict'
import { test } from 'node:test'
import { tidyRequest, updateRequest } from '../../../src/doc/rules.ts'

const PATH = '/home/u/.logbook/repo-0123456789ab/fix-login.md'
const SECTION_RULE_START = 'End with a last section "## This update"'
const NOTE_RULE =
  'Send one note line that says what changed and one note line "Removed: <id> because <reason>" for each id you removed; logbook writes the note under "## This update", so no edit adds that section.'

const documentText = [
  '# fix-login: Fix the login page',
  'Status: active',
  'Next ids: c2 D2 R1 S1',
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

const ruleLines = (request: string): string[] =>
  request
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2))

test('update-rules-note.update-request-puts-the-removed-lines-in-note', () => {
  const request = updateRequest({ path: PATH, documentText, reason: { kind: 'turn-changed' } })
  const rules = ruleLines(request)
  assert.ok(rules.includes(NOTE_RULE), request)
  assert.equal(
    rules.some((rule) => rule.startsWith(SECTION_RULE_START)),
    false,
    request
  )
})

test('update-rules-note.tidy-request-on-the-edit-path-keeps-the-section-rule', () => {
  const rules = ruleLines(tidyRequest({ path: PATH, documentText }))
  assert.ok(
    rules.some((rule) => rule.startsWith(SECTION_RULE_START)),
    rules.join('\n')
  )
  assert.equal(rules.includes(NOTE_RULE), false)
})
