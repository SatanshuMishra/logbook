import assert from 'node:assert/strict'
import { test } from 'node:test'

const OLD_TIME = new Date(Date.UTC(2026, 9, 14, 8, 0, 0)).toISOString()
const ACCEPT_TIME = new Date(Date.UTC(2026, 9, 14, 9, 30, 0)).toISOString()

const TITLE_LINE = '# fix-login: Fix the login page'

type Bodies = {
  goal: string[]
  doneWhen: string[]
  whereThingsStand: string[]
  nextStep: string[]
  decisions: string[]
  risks: string[]
  settled: string[]
  details: string[]
}

const DEFAULT_BODIES: Bodies = {
  goal: ['Let people sign in again.'],
  doneWhen: ['- [ ] c1 The page loads'],
  whereThingsStand: ['The form posts to the old endpoint.'],
  nextStep: ['Point the form at the new endpoint.'],
  decisions: ['- D1 Keep the session cookie'],
  risks: ['- R1 The cache may hold the old page'],
  settled: ['- S1 The login page stays at /login'],
  details: ['- Spec: docs/specs/login.md']
}

const DEFAULT_HEADER: readonly string[] = [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2']

const buildDocument = (
  options: { header?: readonly string[]; bodies?: Partial<Bodies>; note?: readonly string[] } = {}
): string => {
  const bodies = { ...DEFAULT_BODIES, ...options.bodies }
  const sections: readonly (readonly [string, readonly string[]])[] = [
    ['Goal', bodies.goal],
    ['Done when', bodies.doneWhen],
    ['Where things stand', bodies.whereThingsStand],
    ['Next step', bodies.nextStep],
    ['Decisions in force', bodies.decisions],
    ['Open risks', bodies.risks],
    ['Settled, do not reopen', bodies.settled],
    ['Where the details live', bodies.details]
  ]
  const noteLines = options.note === undefined ? [] : ['## This update', '', ...options.note, '']
  return [
    ...(options.header ?? DEFAULT_HEADER),
    '',
    ...sections.flatMap(([name, body]) => [`## ${name}`, '', ...body, '']),
    ...noteLines
  ].join('\n')
}

test('document.reads-the-title-line', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(buildDocument({ header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2'] }))
  assert.equal(parsed.slug, 'fix-login')
  assert.equal(parsed.title, 'Fix the login page')
})

test('document.reads-the-status-line', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(
    buildDocument({
      header: [TITLE_LINE, 'Status: blocked: the owner picks a database', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2']
    })
  )
  assert.equal(parsed.status?.kind, 'blocked')
  assert.equal(parsed.status?.reason, 'the owner picks a database')
  assert.equal(parsed.statusLine, 2)
})

test('document.reads-the-updated-line', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const time = new Date(Date.UTC(2026, 9, 13, 17, 45, 12, 250)).toISOString()
  const parsed = parseDocument(
    buildDocument({ header: [TITLE_LINE, 'Status: active', `Updated: ${time}`, 'Next ids: c2 D2 R2 S2'] })
  )
  assert.equal(parsed.updated, time)
})

test('document.reads-the-next-ids-line', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(
    buildDocument({ header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c3 D6 R4 S5'] })
  )
  assert.deepEqual(parsed.nextIds, { c: 3, D: 6, R: 4, S: 5 })
})

test('document.reads-the-sections-in-order', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const text = [
    TITLE_LINE,
    'Status: active',
    `Updated: ${OLD_TIME}`,
    'Next ids: c1 D1 R1 S1',
    '',
    '## Goal',
    'Let people sign in again.',
    '## Done when',
    'Nothing is agreed yet.',
    '## Where things stand',
    'The form posts to the old endpoint.',
    '## Next step',
    'Point the form at the new endpoint.',
    '## Decisions in force',
    'None taken yet.',
    '## Open risks',
    'None known yet.',
    '## Settled, do not reopen',
    'Nothing settled yet.',
    '## Where the details live',
    'Only in this document.',
    ''
  ].join('\n')
  const parsed = parseDocument(text)
  assert.deepEqual(parsed.sections, [
    { name: 'Goal', line: 6, body: ['Let people sign in again.'] },
    { name: 'Done when', line: 8, body: ['Nothing is agreed yet.'] },
    { name: 'Where things stand', line: 10, body: ['The form posts to the old endpoint.'] },
    { name: 'Next step', line: 12, body: ['Point the form at the new endpoint.'] },
    { name: 'Decisions in force', line: 14, body: ['None taken yet.'] },
    { name: 'Open risks', line: 16, body: ['None known yet.'] },
    { name: 'Settled, do not reopen', line: 18, body: ['Nothing settled yet.'] },
    { name: 'Where the details live', line: 20, body: ['Only in this document.'] }
  ])
  assert.deepEqual(parsed.items, [])
  assert.deepEqual(parsed.badLines, [])
  assert.equal(parsed.note, null)
})

test('document.reads-a-criterion-item', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(
    buildDocument({
      bodies: {
        doneWhen: [
          '- [x] c2 The page loads evidence: test login.loads passed',
          '- [~] c3 Old flow struck: replaced by D1',
          '- [ ] c4 Errors show',
          '- c5 No box'
        ]
      }
    })
  )
  assert.deepEqual(
    parsed.items.filter((item) => item.section === 'Done when'),
    [
      {
        id: 'c2',
        letter: 'c',
        number: 2,
        box: 'x',
        text: 'The page loads evidence: test login.loads passed',
        section: 'Done when',
        line: 12
      },
      { id: 'c3', letter: 'c', number: 3, box: '~', text: 'Old flow struck: replaced by D1', section: 'Done when', line: 13 },
      { id: 'c4', letter: 'c', number: 4, box: ' ', text: 'Errors show', section: 'Done when', line: 14 },
      { id: 'c5', letter: 'c', number: 5, box: null, text: 'No box', section: 'Done when', line: 15 }
    ]
  )
  assert.deepEqual(parsed.badLines, [])
})

test('document.reads-decision-risk-and-settled-items', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(
    buildDocument({
      bodies: {
        decisions: ['- D1 Use Postgres'],
        risks: ['- R2 The cache may hold the old page'],
        settled: ['- S3 The login page stays at /login']
      }
    })
  )
  assert.deepEqual(
    parsed.items.filter((item) => item.letter !== 'c'),
    [
      { id: 'D1', letter: 'D', number: 1, box: null, text: 'Use Postgres', section: 'Decisions in force', line: 24 },
      { id: 'R2', letter: 'R', number: 2, box: null, text: 'The cache may hold the old page', section: 'Open risks', line: 28 },
      {
        id: 'S3',
        letter: 'S',
        number: 3,
        box: null,
        text: 'The login page stays at /login',
        section: 'Settled, do not reopen',
        line: 32
      }
    ]
  )
})

test('document.keeps-the-section-of-a-misplaced-item', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(buildDocument({ bodies: { risks: ['- D4 Use Postgres'] } }))
  assert.deepEqual(
    parsed.items.filter((item) => item.id === 'D4'),
    [{ id: 'D4', letter: 'D', number: 4, box: null, text: 'Use Postgres', section: 'Open risks', line: 28 }]
  )
  assert.deepEqual(parsed.badLines, [])
})

test('document.reports-a-list-line-matching-no-item-form', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(
    buildDocument({
      bodies: { decisions: ['- use Postgres', '- D0 zero', '- D01 leading zero', '- E1 unknown letter'] }
    })
  )
  assert.deepEqual(parsed.badLines, [
    { line: 24, text: '- use Postgres', section: 'Decisions in force' },
    { line: 25, text: '- D0 zero', section: 'Decisions in force' },
    { line: 26, text: '- D01 leading zero', section: 'Decisions in force' },
    { line: 27, text: '- E1 unknown letter', section: 'Decisions in force' }
  ])
  assert.deepEqual(
    parsed.items.filter((item) => item.section === 'Decisions in force'),
    []
  )
})

test('document.reports-conflict-marker-lines', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(
    buildDocument({
      bodies: {
        whereThingsStand: [
          '<<<<<<< ours',
          'The form posts to the old endpoint.',
          '||||||| base',
          'The form posts nowhere.',
          '=======',
          'The form posts to the new endpoint.',
          '>>>>>>> theirs'
        ]
      }
    })
  )
  assert.deepEqual(parsed.conflictLines, [
    { line: 16, text: '<<<<<<< ours' },
    { line: 18, text: '||||||| base' },
    { line: 20, text: '=======' },
    { line: 22, text: '>>>>>>> theirs' }
  ])
})

test('document.reads-a-marker-written-alone-as-a-conflict-line', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(buildDocument({ bodies: { whereThingsStand: ['<<<<<<<', '|||||||', '>>>>>>>'] } }))
  assert.deepEqual(parsed.conflictLines, [
    { line: 16, text: '<<<<<<<' },
    { line: 17, text: '|||||||' },
    { line: 18, text: '>>>>>>>' }
  ])
})

test('document.splits-off-the-update-note', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(buildDocument({ note: ['Moved the risk.', 'Removed: R1 because it passed'] }))
  assert.deepEqual(
    parsed.sections.map((section) => section.name),
    [
      'Goal',
      'Done when',
      'Where things stand',
      'Next step',
      'Decisions in force',
      'Open risks',
      'Settled, do not reopen',
      'Where the details live'
    ]
  )
  assert.equal(parsed.note, 'Moved the risk.\nRemoved: R1 because it passed')
  assert.equal(parsed.noteLine, 38)
})

test('document.reads-only-item-numbers-it-can-count-past', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const parsed = parseDocument(
    buildDocument({
      bodies: { decisions: ['- D9007199254740990 last', '- D9007199254740991 over', '- D99999999999999999999 big'] }
    })
  )
  assert.deepEqual(
    parsed.items.filter((item) => item.section === 'Decisions in force'),
    [
      {
        id: 'D9007199254740990',
        letter: 'D',
        number: 9007199254740990,
        box: null,
        text: 'last',
        section: 'Decisions in force',
        line: 24
      }
    ]
  )
  assert.deepEqual(parsed.badLines, [
    { line: 25, text: '- D9007199254740991 over', section: 'Decisions in force' },
    { line: 26, text: '- D99999999999999999999 big', section: 'Decisions in force' }
  ])
})

test('document.reads-next-ids-per-letter', async () => {
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const nextIdsLines = [
    'Next ids: c3 D99999999999999999999 R4 S5',
    'Next ids: c3 R4 S5',
    'Next ids: c3 D2 D7 R4 S5',
    'Next ids: c3 Dx R4 S5'
  ]
  for (const nextIdsLine of nextIdsLines) {
    const parsed = parseDocument(
      buildDocument({
        header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, nextIdsLine],
        bodies: { decisions: ['- D1 Keep the session cookie', '- D4 Use Postgres'] }
      })
    )
    assert.deepEqual(parsed.nextIds, { c: 3, D: 5, R: 4, S: 5 }, nextIdsLine)
  }
})

test('document.normalise-removes-the-update-note', async () => {
  const { normaliseDocument } = await import('../../../src/doc/document.ts')
  const version = buildDocument({ note: ['Moved the risk.', 'Removed: R9 because it passed'] })
  const result = normaliseDocument(version, {
    acceptedAt: ACCEPT_TIME,
    previousNextIds: { c: 2, D: 1, R: 1, S: 1 }
  })
  assert.ok(!result.includes('## This update'), result)
  assert.ok(!result.includes('Moved the risk.'), result)
  assert.ok(!result.includes('Removed: R9 because it passed'), result)
  assert.equal(
    result,
    buildDocument({
      header: [TITLE_LINE, 'Status: active', `Updated: ${ACCEPT_TIME}`, 'Next ids: c2 D2 R2 S2']
    })
  )
})

test('document.normalise-without-a-note-changes-only-the-header-lines', async () => {
  const { normaliseDocument } = await import('../../../src/doc/document.ts')
  const version = buildDocument({
    header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c1 D1 R1 S1']
  })
  const result = normaliseDocument(version, {
    acceptedAt: ACCEPT_TIME,
    previousNextIds: { c: 2, D: 2, R: 2, S: 2 }
  })
  const before = version.split('\n')
  const after = result.split('\n')
  assert.equal(after.length, before.length)
  const differing = after.flatMap((line, index) => (line === before[index] ? [] : [index + 1]))
  assert.deepEqual(differing, [3, 4])
  assert.equal(after[2], `Updated: ${ACCEPT_TIME}`)
  assert.equal(after[3], 'Next ids: c2 D2 R2 S2')
})

test('document.normalise-sets-the-updated-line', async () => {
  const { normaliseDocument } = await import('../../../src/doc/document.ts')
  const version = buildDocument({
    header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2']
  })
  const result = normaliseDocument(version, {
    acceptedAt: ACCEPT_TIME,
    previousNextIds: { c: 2, D: 2, R: 2, S: 2 }
  })
  assert.equal(result.split('\n')[2], `Updated: ${ACCEPT_TIME}`)
  assert.ok(!result.includes(OLD_TIME), result)
})

test('document.normalise-raises-next-ids-past-the-highest-id', async () => {
  const { normaliseDocument } = await import('../../../src/doc/document.ts')
  const version = buildDocument({
    header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c2 D1 R1 S1'],
    bodies: {
      doneWhen: ['- [ ] c1 The page loads', '- [ ] c2 Errors show'],
      decisions: ['- D1 Keep the session cookie', '- D2 Use Postgres'],
      risks: ['- R1 The cache may hold the old page'],
      settled: ['Nothing settled yet.']
    }
  })
  const result = normaliseDocument(version, {
    acceptedAt: ACCEPT_TIME,
    previousNextIds: { c: 2, D: 1, R: 1, S: 1 }
  })
  assert.equal(result.split('\n')[3], 'Next ids: c3 D3 R2 S1')
})

test('document.normalise-never-lowers-next-ids', async () => {
  const { normaliseDocument } = await import('../../../src/doc/document.ts')
  const version = buildDocument({
    header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c1 D1 R1 S1'],
    bodies: {
      doneWhen: ['- [ ] c1 The page loads'],
      decisions: ['- D1 Keep the session cookie'],
      risks: ['None known yet.'],
      settled: ['Nothing settled yet.']
    }
  })
  const result = normaliseDocument(version, {
    acceptedAt: ACCEPT_TIME,
    previousNextIds: { c: 5, D: 4, R: 3, S: 2 }
  })
  assert.equal(result.split('\n')[3], 'Next ids: c5 D4 R3 S2')
})

test('document.normalise-inserts-missing-header-lines', async () => {
  const { normaliseDocument } = await import('../../../src/doc/document.ts')
  const version = buildDocument({ header: [TITLE_LINE, 'Status: active'] })
  const result = normaliseDocument(version, {
    acceptedAt: ACCEPT_TIME,
    previousNextIds: { c: 2, D: 2, R: 2, S: 2 }
  })
  assert.deepEqual(result.split('\n').slice(0, 5), [
    TITLE_LINE,
    'Status: active',
    `Updated: ${ACCEPT_TIME}`,
    'Next ids: c2 D2 R2 S2',
    ''
  ])
  assert.equal(
    result,
    buildDocument({
      header: [TITLE_LINE, 'Status: active', `Updated: ${ACCEPT_TIME}`, 'Next ids: c2 D2 R2 S2']
    })
  )
})

test('document.normalise-keeps-the-version-ending', async () => {
  const { normaliseDocument } = await import('../../../src/doc/document.ts')
  const header = [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c1 D1 R1 S1']
  const acceptedHeader = [TITLE_LINE, 'Status: active', `Updated: ${ACCEPT_TIME}`, 'Next ids: c2 D2 R2 S2']
  const options = { acceptedAt: ACCEPT_TIME, previousNextIds: { c: 2, D: 2, R: 2, S: 2 } }
  const differingLines = (left: readonly string[], right: readonly string[]): number[] =>
    left.flatMap((line, index) => (line === right[index] ? [] : [index + 1]))

  const blankEnding = `${buildDocument({ header })}\n\n`
  assert.ok(blankEnding.endsWith('- Spec: docs/specs/login.md\n\n\n'), blankEnding)
  const blankResult = normaliseDocument(blankEnding, options)
  const blankBefore = blankEnding.split('\n')
  const blankAfter = blankResult.split('\n')
  assert.equal(blankAfter.length, blankBefore.length)
  assert.deepEqual(differingLines(blankAfter, blankBefore), [3, 4])
  assert.ok(blankResult.endsWith('- Spec: docs/specs/login.md\n\n\n'), blankResult)
  assert.equal(blankResult, `${buildDocument({ header: acceptedHeader })}\n\n`)

  const noBreak = buildDocument({ header }).slice(0, -1)
  assert.ok(noBreak.endsWith('- Spec: docs/specs/login.md'), noBreak)
  const noBreakResult = normaliseDocument(noBreak, options)
  assert.ok(noBreakResult.endsWith('- Spec: docs/specs/login.md\n'), noBreakResult)
  const noBreakBefore = noBreak.split('\n')
  const noBreakAfter = noBreakResult.slice(0, -1).split('\n')
  assert.equal(noBreakAfter.length, noBreakBefore.length)
  assert.deepEqual(differingLines(noBreakAfter, noBreakBefore), [3, 4])
  assert.equal(noBreakResult, buildDocument({ header: acceptedHeader }))
})

test('document.commit-message-takes-the-note-summary', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  const newText = buildDocument({
    bodies: { doneWhen: ['- [x] c1 The page loads evidence: test login.loads passed'] },
    note: ['Ticked c1.']
  })
  assert.equal(commitMessage('fix-login', oldText, newText), 'update fix-login: Ticked c1.')
})

test('document.commit-message-keeps-the-removed-lines', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  const newText = buildDocument({
    bodies: { risks: ['None known yet.'] },
    note: ['Retired a risk.', 'Removed: R1 because the migration ran']
  })
  assert.equal(
    commitMessage('fix-login', oldText, newText),
    'update fix-login: Retired a risk.\n\nRemoved: R1 because the migration ran'
  )
})

test('document.commit-message-names-changed-sections-without-a-note', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  const newText = buildDocument({
    bodies: {
      nextStep: ['Run the build.'],
      risks: ['- R1 The cache may hold the old page', '- R2 The build may time out']
    }
  })
  assert.equal(commitMessage('fix-login', oldText, newText), 'update fix-login: changed Next step, Open risks')
})

test('document.commit-message-treats-a-blank-note-as-absent', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  const newText = buildDocument({
    bodies: { whereThingsStand: ['The form posts to the new endpoint.'] },
    note: ['', '   ', '']
  })
  assert.equal(commitMessage('fix-login', oldText, newText), 'update fix-login: changed Where things stand')
})

test('document.commit-message-names-the-title-and-status', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument({
    header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2'],
    bodies: { nextStep: ['Point the form at the new endpoint.'] }
  })
  const newText = buildDocument({
    header: ['# fix-login: Fix the sign-in page', 'Status: parked', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2'],
    bodies: { nextStep: ['Run the build.'] }
  })
  assert.equal(commitMessage('fix-login', oldText, newText), 'update fix-login: changed the title, Status, Next step')
})

test('document.commit-message-names-the-lines-above-goal', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  const withOwner = buildDocument({
    header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2', 'Owner: sam']
  })
  const withSecondStatus = buildDocument({
    header: [TITLE_LINE, 'Status: active', `Updated: ${OLD_TIME}`, 'Next ids: c2 D2 R2 S2', 'Status: parked']
  })
  assert.equal(commitMessage('fix-login', oldText, withOwner), 'update fix-login: changed the lines above Goal')
  assert.equal(commitMessage('fix-login', oldText, withSecondStatus), 'update fix-login: changed the lines above Goal')
})

test('document.commit-message-names-a-section-whose-heading-changed', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  const newText = oldText.replace('## Goal\n', '## Goal \n')
  assert.ok(newText.includes('\n## Goal \n'), newText)
  assert.equal(commitMessage('fix-login', oldText, newText), 'update fix-login: changed Goal')
})

test('document.commit-message-says-only-blank-lines', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  const newText = oldText.replace(
    '## Goal\n\nLet people sign in again.\n\n## Done when',
    '## Goal\nLet people sign in again.\n## Done when'
  )
  assert.notEqual(newText, oldText)
  assert.equal(commitMessage('fix-login', oldText, newText), 'update fix-login: changed only blank lines')
})

test('document.commit-message-says-nothing-but-the-header-lines', async () => {
  const { commitMessage } = await import('../../../src/doc/document.ts')
  const oldText = buildDocument()
  assert.ok(oldText.endsWith('- Spec: docs/specs/login.md\n'), oldText)
  const withoutFinalBreak = oldText.slice(0, -1)
  const withEmptyNote = `${oldText}\n## This update\n`
  assert.equal(
    commitMessage('fix-login', oldText, withoutFinalBreak),
    'update fix-login: changed nothing but the Updated and Next ids lines'
  )
  assert.equal(
    commitMessage('fix-login', oldText, withEmptyNote),
    'update fix-login: changed nothing but the Updated and Next ids lines'
  )
})
