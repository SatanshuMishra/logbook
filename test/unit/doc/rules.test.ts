import assert from 'node:assert/strict'
import { test } from 'node:test'

const PATH = '/home/u/.logbook/repo-0123456789ab/fix-login.md'

const INSTRUCTIONS =
  'Read that file first if you have not read it in this context, then change it with the Edit tool and do not print the document.'

const RULE_PHRASES: readonly string[] = [
  'Describe the present only.',
  'Where things stand says only where the work is now: a finished step leaves it, and its proof goes on the criterion it ticks as evidence.',
  'As the document grows, finished-step detail in Where things stand gives way first, then decisions and risks that no longer constrain future work.',
  'Where the details live names each file or document once with what it holds, never the steps or commits that changed it.',
  'State each fact in one place only, in as few words as hold it.',
  'No timeline and no clock times.',
  'Tick a criterion only with "evidence: <what proves it>".',
  'Strike a criterion only with [~] and "struck: <reason>".',
  'Never delete a criterion.',
  'Reword a criterion only citing the new decision that changed it.',
  'Keep a decision or a risk only while it still constrains future work; otherwise remove it, or move it to Settled, do not reopen under a new id.',
  'Remove every line that belongs to an option the owner did not take.',
  'New ids start at the Next ids numbers and no number is reused.',
  'End with a last section "## This update" holding one line that says what changed and one line "Removed: <id> because <reason>" for each id you removed.'
]

const MORE_CRITERIA_PATTERN = /^\((\d+) more open criteria are under Done when in the file\.\)$/m

const documentWith = (doneWhen: readonly string[]): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
    'Next ids: c400 D1 R1 S1',
    '',
    '## Goal',
    '',
    'Let people sign in again.',
    '',
    '## Done when',
    '',
    ...doneWhen,
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

const manyCriteria = (count: number): { document: string; lines: string[] } => {
  const wordings = Array.from({ length: count }, (_, index) => `Criterion ${index + 1} holds `.padEnd(80, 'w'))
  return {
    document: documentWith(wordings.map((wording, index) => `- [ ] c${index + 1} ${wording}`)),
    lines: wordings.map((wording, index) => `- c${index + 1} ${wording}`)
  }
}

const assertEveryRule = (text: string): void => {
  for (const phrase of RULE_PHRASES) assert.ok(text.includes(phrase), `missing rule phrase: ${phrase}`)
}

test('rules.request-after-a-milestone', async () => {
  const { updateRequest } = await import('../../../src/doc/rules.ts')
  const text = updateRequest({
    path: PATH,
    documentText: documentWith([
      '- [ ] c1 The login page loads',
      '- [x] c2 The old endpoint is gone evidence: the route table lists no old endpoint'
    ]),
    reason: { kind: 'milestone', detail: 'Bash: git commit -m fix' }
  })
  assert.ok(text.includes(PATH))
  assert.ok(text.includes('git commit -m fix'))
  assert.ok(text.includes('Read'))
  assert.ok(text.includes('Edit tool'))
  assert.ok(text.includes('do not print'))
  assert.ok(text.includes('- c1 The login page loads'))
  assert.ok(!text.includes('c2'))
  assertEveryRule(text)
})

test('rules.request-at-the-end-of-a-turn', async () => {
  const { updateRequest } = await import('../../../src/doc/rules.ts')
  const text = updateRequest({
    path: PATH,
    documentText: documentWith([
      '- [x] c1 The login page loads evidence: the login test passes',
      '- [~] c2 The old endpoint answers struck: D1 retired it'
    ]),
    reason: { kind: 'turn-changed' }
  })
  assert.ok(text.includes(PATH))
  assert.ok(text.includes('the turn changed something'))
  assert.ok(text.includes('No open criteria.'))
  assert.ok(!text.includes('c1'))
  assertEveryRule(text)
})

test('rules.request-when-blocked-and-the-user-wrote', async () => {
  const { updateRequest } = await import('../../../src/doc/rules.ts')
  const text = updateRequest({
    path: PATH,
    documentText: documentWith(['- [ ] c1 The login page loads']),
    reason: { kind: 'blocked-user-wrote', status: 'waiting: the owner picks' }
  })
  assert.ok(text.includes(PATH))
  assert.ok(text.includes('"waiting: the owner picks"'))
  assert.ok(text.includes("if the user's message settled it, update the Status line"))
  assertEveryRule(text)
})

test('rules.request-to-tidy-a-converted-document', async () => {
  const { tidyRequest } = await import('../../../src/doc/rules.ts')
  const text = tidyRequest({
    path: PATH,
    documentText: documentWith(['- [ ] c1 The login page loads', '- [ ] c7 The session survives a restart'])
  })
  assert.ok(text.includes(PATH))
  assert.ok(text.includes('converted from the old ledger'))
  assert.ok(text.includes('Rewrite it'))
  assert.ok(text.includes('under these rules'))
  assert.ok(text.includes('keeping every id'))
  assert.ok(text.includes('do not print'))
  assertEveryRule(text)
})

test('rules.request-gives-way-to-many-criteria', async () => {
  const { updateRequest } = await import('../../../src/doc/rules.ts')
  const { document, lines } = manyCriteria(300)
  const text = updateRequest({
    path: PATH,
    documentText: document,
    reason: { kind: 'milestone', detail: 'Bash: git commit -m fix' }
  })
  assert.ok(text.length <= 9500, `text is ${text.length} characters`)
  assert.ok(text.includes(PATH))
  assert.ok(text.includes(INSTRUCTIONS))
  assert.ok(text.includes('git commit -m fix'))
  assertEveryRule(text)
  const shown = text.split('\n').filter((line) => /^- c\d+ /.test(line))
  assert.ok(shown.length > 0)
  assert.ok(shown.length < 300)
  assert.deepEqual(shown, lines.slice(0, shown.length))
  const more = MORE_CRITERIA_PATTERN.exec(text)
  assert.notEqual(more, null)
  assert.equal(more?.[0], `(${300 - shown.length} more open criteria are under Done when in the file.)`)
  const nextLine = lines[shown.length] ?? ''
  assert.ok(text.length + nextLine.length > 9500)
})

test('rules.request-cuts-a-long-reason', async () => {
  const { updateRequest } = await import('../../../src/doc/rules.ts')
  const { document } = manyCriteria(300)
  const detail = Array.from({ length: 4000 }, (_, index) => `w${index} `)
    .join('')
    .slice(0, 20000)
  assert.equal(detail.length, 20000)
  const text = updateRequest({ path: PATH, documentText: document, reason: { kind: 'milestone', detail } })
  assert.ok(text.length <= 9500, `text is ${text.length} characters`)
  assert.ok(text.includes(`${detail.slice(0, 300)}...`))
  assert.ok(!text.includes(detail.slice(0, 301)))
  assert.ok(text.includes(PATH))
  assert.ok(text.includes(INSTRUCTIONS))
  assertEveryRule(text)
  assert.match(text, MORE_CRITERIA_PATTERN)
})

test('rules.name-the-stale-line-rule', async () => {
  const { updateRequest } = await import('../../../src/doc/rules.ts')
  const text = updateRequest({
    path: PATH,
    documentText: documentWith(['- [ ] c1 The login page loads']),
    reason: { kind: 'milestone', detail: 'Bash: git commit -m fix' }
  })
  assert.ok(text.includes('Remove every line that belongs to an option the owner did not take.'))
})

test('rules.finished-steps-leave-where-things-stand', async () => {
  const { updateRequest } = await import('../../../src/doc/rules.ts')
  const text = updateRequest({
    path: PATH,
    documentText: documentWith(['- [ ] c1 The login page loads']),
    reason: { kind: 'milestone', detail: 'Bash: git commit -m fix' }
  })
  const lines = text.split('\n')
  const start = lines.indexOf('- Describe the present only.')
  assert.ok(start >= 0, 'the text holds the line "- Describe the present only."')
  assert.deepEqual(lines.slice(start + 1, start + 5), [
    '- Where things stand says only where the work is now: a finished step leaves it, and its proof goes on the criterion it ticks as evidence.',
    '- As the document grows, finished-step detail in Where things stand gives way first, then decisions and risks that no longer constrain future work.',
    '- Where the details live names each file or document once with what it holds, never the steps or commits that changed it.',
    '- State each fact in one place only, in as few words as hold it.'
  ])
  assert.ok(!text.includes('Finished work becomes one line naming where its proof is.'))
})
