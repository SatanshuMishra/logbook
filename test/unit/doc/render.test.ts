import assert from 'node:assert/strict'
import { test } from 'node:test'

const OPENED_AT = new Date(Date.UTC(2026, 9, 14, 8, 0, 0)).toISOString()

const SLUG = 'fix-login'
const WORKING_COPY = '/Users/someone/.logbook/logbook-a1b2c3d4e5f6/fix-login.md'

type Bodies = {
  goal: readonly string[]
  doneWhen: readonly string[]
  whereThingsStand: readonly string[]
  nextStep: readonly string[]
  decisions: readonly string[]
  risks: readonly string[]
  settled: readonly string[]
  details: readonly string[]
}

const DEFAULT_BODIES: Bodies = {
  goal: ['Let people sign in again.'],
  doneWhen: [
    '- [ ] c1 The page loads',
    '- [ ] c2 The form posts',
    '- [x] c3 Errors show evidence: seen in the browser'
  ],
  whereThingsStand: ['The form posts to the old endpoint.'],
  nextStep: ['Point the form at the new endpoint.'],
  decisions: ['- D1 Keep the session cookie', '- D2 Serve the page from /login'],
  risks: ['- R1 The cache may hold the old page'],
  settled: ['- S1 The login page stays at /login'],
  details: ['- Spec: docs/specs/login.md']
}

const documentText = (options: { status?: string; nextIds?: string; bodies?: Partial<Bodies> } = {}): string => {
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
  const lines = [
    '# fix-login: Fix the login page',
    `Status: ${options.status ?? 'active'}`,
    `Updated: ${OPENED_AT}`,
    `Next ids: ${options.nextIds ?? 'c4 D3 R2 S2'}`,
    '',
    ...sections.flatMap(([name, body], index) => [
      `## ${name}`,
      '',
      ...body,
      ...(body.length > 0 && index < sections.length - 1 ? [''] : [])
    ])
  ]
  return `${lines.join('\n')}\n`
}

test('render.new-document-without-criteria-or-details', async () => {
  const { newDocument } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const text = newDocument({
    slug: 'fix-login',
    title: 'Fix the login page',
    goal: 'Let people sign in again.',
    nextStep: 'Point the form at the new endpoint.',
    criteria: [],
    details: [],
    now: OPENED_AT
  })
  assert.deepEqual(checkStructure(text, SLUG), [])
  assert.equal(
    text,
    [
      '# fix-login: Fix the login page',
      'Status: active',
      `Updated: ${OPENED_AT}`,
      'Next ids: c1 D1 R1 S1',
      '',
      '## Goal',
      '',
      'Let people sign in again.',
      '',
      '## Done when',
      '',
      '## Where things stand',
      '',
      'Not started.',
      '',
      '## Next step',
      '',
      'Point the form at the new endpoint.',
      '',
      '## Decisions in force',
      '',
      '## Open risks',
      '',
      '## Settled, do not reopen',
      '',
      '## Where the details live',
      ''
    ].join('\n')
  )
})

test('render.new-document-with-one-criterion', async () => {
  const { newDocument } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const text = newDocument({
    slug: 'fix-login',
    title: 'Fix the login page',
    goal: 'Let people sign in again.',
    nextStep: 'Point the form at the new endpoint.',
    criteria: ['The page loads'],
    details: ['Spec: docs/specs/login.md'],
    now: OPENED_AT
  })
  assert.deepEqual(checkStructure(text, SLUG), [])
  const lines = text.split('\n')
  assert.ok(lines.includes('- [ ] c1 The page loads'), text)
  assert.ok(lines.includes('- Spec: docs/specs/login.md'), text)
  assert.ok(lines.includes('Next ids: c2 D1 R1 S1'), text)
  const parsed = parseDocument(text)
  assert.deepEqual(
    parsed.items.map((item) => [item.id, item.section, item.box, item.text]),
    [['c1', 'Done when', ' ', 'The page loads']]
  )
  assert.deepEqual(
    parsed.sections.find((section) => section.name === 'Where the details live')?.body,
    ['', '- Spec: docs/specs/login.md']
  )
})

test('render.new-document-keeps-criteria-order', async () => {
  const { newDocument } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const text = newDocument({
    slug: 'fix-login',
    title: 'Fix the login page',
    goal: 'Let people sign in again.',
    nextStep: 'Point the form at the new endpoint.',
    criteria: ['b', 'a', 'c'],
    details: [],
    now: OPENED_AT
  })
  assert.deepEqual(checkStructure(text, SLUG), [])
  assert.deepEqual(parseDocument(text).sections.find((section) => section.name === 'Done when')?.body, [
    '',
    '- [ ] c1 b',
    '- [ ] c2 a',
    '- [ ] c3 c',
    ''
  ])
  assert.ok(text.split('\n').includes('Next ids: c4 D1 R1 S1'), text)
})

test('render.new-document-writes-each-text-on-one-line', async () => {
  const { newDocument } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const text = newDocument({
    slug: 'fix-login',
    title: 'Fix  the login page\n',
    goal: 'first line\n## Next step\nthird',
    nextStep: 'Point the form at the new endpoint.',
    criteria: ['a\n- D1 forged'],
    details: [],
    now: OPENED_AT
  })
  const lines = text.split('\n')
  assert.equal(lines[0], '# fix-login: Fix the login page')
  assert.ok(lines.includes('first line ## Next step third'), text)
  assert.ok(lines.includes('- [ ] c1 a - D1 forged'), text)
  assert.deepEqual(checkStructure(text, SLUG), [])
  const parsed = parseDocument(text)
  assert.equal(parsed.sections.length, 8)
  assert.equal(parsed.items.length, 1)
})

test('render.new-document-writes-plain-text-as-given', async () => {
  const { newDocument, oneLine } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const texts = {
    title: 'Fix the login page',
    goal: 'Let people sign in again.',
    nextStep: 'Point the form at the new endpoint.',
    criterion: 'The page loads',
    detail: 'Spec: docs/specs/login.md'
  }
  const text = newDocument({
    slug: 'fix-login',
    title: texts.title,
    goal: texts.goal,
    nextStep: texts.nextStep,
    criteria: [texts.criterion],
    details: [texts.detail],
    now: OPENED_AT
  })
  assert.deepEqual(checkStructure(text, SLUG), [])
  const lines = text.split('\n')
  assert.ok(lines.includes('# fix-login: Fix the login page'), text)
  assert.ok(lines.includes('Let people sign in again.'), text)
  assert.ok(lines.includes('Point the form at the new endpoint.'), text)
  assert.ok(lines.includes('- [ ] c1 The page loads'), text)
  assert.ok(lines.includes('- Spec: docs/specs/login.md'), text)
  assert.deepEqual(Object.values(texts).map(oneLine), Object.values(texts))
})

test('render.edit-sets-the-status', async () => {
  const { setStatus } = await import('../../../src/doc/render.ts')
  const result = setStatus(documentText(), 'waiting: the owner reviews the pull request')
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(result.text, documentText({ status: 'waiting: the owner reviews the pull request' }))
  assert.equal(result.id, null)
  assert.equal(result.noteLine, null)
})

test('render.edit-replaces-a-section-body', async () => {
  const { replaceSection } = await import('../../../src/doc/render.ts')
  const result = replaceSection(documentText(), 'Next step', ['Run the build.'])
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(result.text, documentText({ bodies: { nextStep: ['Run the build.'] } }))
})

test('render.edit-adds-an-item-at-the-next-id', async () => {
  const { addItem } = await import('../../../src/doc/render.ts')
  const result = addItem(documentText({ nextIds: 'c4 D3 R2 S2' }), 'D', 'Use Postgres: it is already deployed')
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(result.id, 'D3')
  assert.equal(
    result.text,
    documentText({
      nextIds: 'c4 D4 R2 S2',
      bodies: {
        decisions: [
          '- D1 Keep the session cookie',
          '- D2 Serve the page from /login',
          '- D3 Use Postgres: it is already deployed'
        ]
      }
    })
  )
  const second = addItem(result.text, 'D', 'Keep the old endpoint for a week')
  assert.ok(second.ok, JSON.stringify(second))
  assert.equal(second.id, 'D4')
  assert.ok(second.text.split('\n').includes('Next ids: c4 D5 R2 S2'), second.text)
})

test('render.edit-adds-the-first-item-of-a-section', async () => {
  const { addItem } = await import('../../../src/doc/render.ts')
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const result = addItem(
    documentText({ nextIds: 'c4 D3 R1 S2', bodies: { risks: [] } }),
    'R',
    'The cache may hold the old page'
  )
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(result.id, 'R1')
  assert.deepEqual(parseDocument(result.text).sections.find((section) => section.name === 'Open risks')?.body, [
    '',
    '- R1 The cache may hold the old page',
    ''
  ])
  assert.equal(
    result.text,
    documentText({ nextIds: 'c4 D3 R2 S2', bodies: { risks: ['- R1 The cache may hold the old page'] } })
  )
})

test('render.edit-ticks-strikes-and-reopens', async () => {
  const { tickCriterion, strikeCriterion, reopenCriterion } = await import('../../../src/doc/render.ts')
  const ticked = tickCriterion(documentText(), 'c1', 'tests pass')
  assert.ok(ticked.ok, JSON.stringify(ticked))
  assert.equal(ticked.id, 'c1')
  const struck = strikeCriterion(ticked.text, 'c2', 'dropped')
  assert.ok(struck.ok, JSON.stringify(struck))
  assert.equal(struck.id, 'c2')
  const reopened = reopenCriterion(struck.text, 'c3', 'regressed')
  assert.ok(reopened.ok, JSON.stringify(reopened))
  assert.equal(reopened.id, 'c3')
  assert.equal(
    reopened.text,
    documentText({
      bodies: {
        doneWhen: [
          '- [x] c1 The page loads evidence: tests pass',
          '- [~] c2 The form posts struck: dropped',
          '- [ ] c3 Errors show evidence: seen in the browser reopened: regressed'
        ]
      }
    })
  )
})

test('render.edit-removes-an-item-with-its-note-line', async () => {
  const { removeItem } = await import('../../../src/doc/render.ts')
  const result = removeItem(
    documentText({
      nextIds: 'c4 D3 R3 S2',
      bodies: { risks: ['- R1 The cache may hold the old page', '- R2 The old endpoint may stay up'] }
    }),
    'R1',
    'the migration ran'
  )
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(result.noteLine, 'Removed: R1 because the migration ran')
  assert.equal(
    result.text,
    documentText({ nextIds: 'c4 D3 R3 S2', bodies: { risks: ['- R2 The old endpoint may stay up'] } })
  )
  assert.ok(!result.text.split('\n').some((line) => line.startsWith('- R1 ')), result.text)
})

test('render.edit-refuses-an-unknown-id', async () => {
  const { tickCriterion } = await import('../../../src/doc/render.ts')
  const options = {
    nextIds: 'c3 D3 R2 S2',
    bodies: { doneWhen: ['- [ ] c1 The page loads', '- [ ] c2 The form posts'] }
  }
  const text = documentText(options)
  const result = tickCriterion(text, 'c9', 'tests pass')
  assert.equal(result.ok, false)
  assert.ok(!result.ok)
  assert.equal(result.id, 'c9')
  assert.match(result.message, /\bc9\b/)
  assert.equal(Object.hasOwn(result, 'text'), false)
  assert.equal(text, documentText(options))
})

test('render.new-document-escapes-heading-and-marker-lines', async () => {
  const { newDocument } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const { parseDocument } = await import('../../../src/doc/document.ts')
  const text = newDocument({
    slug: 'fix-login',
    title: 'Fix the login page',
    goal: '## Notes from the owner',
    nextStep: '  =======\n',
    criteria: ['<<<<<<< HEAD'],
    details: ['>>>>>>> theirs'],
    now: OPENED_AT
  })
  const lines = text.split('\n')
  assert.ok(lines.includes('\\## Notes from the owner'), text)
  assert.ok(lines.includes('\\======='), text)
  assert.ok(lines.includes('- [ ] c1 <<<<<<< HEAD'), text)
  assert.ok(lines.includes('- >>>>>>> theirs'), text)
  assert.deepEqual(checkStructure(text, SLUG), [])
  assert.equal(parseDocument(text).sections.length, 8)
  assert.ok(!lines.some((line) => line === '=======' || line.startsWith('<<<<<<<') || line.startsWith('>>>>>>>')), text)
})

test('render.edit-replace-escapes-heading-and-marker-lines', async () => {
  const { replaceSection } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const result = replaceSection(documentText(), 'Next step', ['Run  the\nbuild.', '## Notes', '||||||| base', '======='])
  assert.ok(result.ok, JSON.stringify(result))
  assert.equal(
    result.text,
    documentText({ bodies: { nextStep: ['Run the build.', '\\## Notes', '\\||||||| base', '\\======='] } })
  )
  assert.deepEqual(checkStructure(result.text, SLUG), [])
})

test('render.escapes-a-marker-written-alone', async () => {
  const { newDocument, replaceSection } = await import('../../../src/doc/render.ts')
  const { checkStructure } = await import('../../../src/doc/check.ts')
  const created = newDocument({
    slug: 'fix-login',
    title: 'Fix the login page',
    goal: '<<<<<<<',
    nextStep: '>>>>>>>',
    criteria: [],
    details: [],
    now: OPENED_AT
  })
  const createdLines = created.split('\n')
  assert.ok(createdLines.includes('\\<<<<<<<'), created)
  assert.ok(createdLines.includes('\\>>>>>>>'), created)
  assert.ok(!createdLines.includes('<<<<<<<') && !createdLines.includes('>>>>>>>'), created)
  assert.deepEqual(checkStructure(created, SLUG), [])
  const replaced = replaceSection(documentText(), 'Where things stand', ['|||||||', '>>>>>>>', 'plain'])
  assert.ok(replaced.ok, JSON.stringify(replaced))
  assert.equal(
    replaced.text,
    documentText({ bodies: { whereThingsStand: ['\\|||||||', '\\>>>>>>>', 'plain'] } })
  )
  assert.deepEqual(checkStructure(replaced.text, SLUG), [])
})

test('render.edit-refuses-an-item-when-its-letter-is-used-up', async () => {
  const { addItem } = await import('../../../src/doc/render.ts')
  const options = {
    nextIds: 'c2 D9007199254740991 R2 S2',
    bodies: { decisions: ['- D9007199254740990 Keep the session cookie'] }
  }
  const text = documentText(options)
  const result = addItem(text, 'D', 'Use Postgres')
  assert.equal(result.ok, false)
  assert.ok(!result.ok)
  assert.match(result.message, /the D ids of this thread are used up/)
  assert.equal(text, documentText(options))
})

test('render.user-line-for-each-status', async () => {
  const { userLine } = await import('../../../src/doc/render.ts')
  const statuses = ['active', 'blocked: x', 'waiting: y', 'parked', 'done', 'abandoned: z']
  assert.deepEqual(
    statuses.map((status) => userLine(documentText({ status }), WORKING_COPY)),
    [
      `Logbook: Fix the login page - active. Next: Point the form at the new endpoint. Full state: ${WORKING_COPY}`,
      `Logbook: Fix the login page - blocked: x. Next: Point the form at the new endpoint. Full state: ${WORKING_COPY}`,
      `Logbook: Fix the login page - waiting: y. Next: Point the form at the new endpoint. Full state: ${WORKING_COPY}`,
      `Logbook: Fix the login page - parked. Next: Point the form at the new endpoint. Full state: ${WORKING_COPY}`,
      `Logbook: Fix the login page - done. Next: Point the form at the new endpoint. Full state: ${WORKING_COPY}`,
      `Logbook: Fix the login page - abandoned: z. Next: Point the form at the new endpoint. Full state: ${WORKING_COPY}`
    ]
  )
})

test('render.first-sentence-of-several', async () => {
  const { userLine, rosterLine } = await import('../../../src/doc/render.ts')
  const text = documentText({ bodies: { nextStep: ['Run the build. Then ship it.'] } })
  assert.ok(userLine(text, WORKING_COPY).includes('Next: Run the build. Full state: '), userLine(text, WORKING_COPY))
  assert.ok(rosterLine(text).endsWith('Next: Run the build.'), rosterLine(text))
})

test('render.first-sentence-of-one', async () => {
  const { userLine, rosterLine } = await import('../../../src/doc/render.ts')
  const text = documentText({ bodies: { nextStep: ['Ask the owner which database'] } })
  assert.ok(
    userLine(text, WORKING_COPY).includes('Next: Ask the owner which database. Full state: '),
    userLine(text, WORKING_COPY)
  )
  assert.ok(rosterLine(text).endsWith('Next: Ask the owner which database'), rosterLine(text))
})

test('render.first-sentence-cut-at-a-line-break', async () => {
  const { firstSentence, rosterLine } = await import('../../../src/doc/render.ts')
  const text = documentText({ bodies: { nextStep: ['Check the run', 'then resume it'] } })
  assert.ok(rosterLine(text).endsWith('Next: Check the run'), rosterLine(text))
  assert.equal(firstSentence('Check the run\nthen resume it'), 'Check the run')
})

test('render.first-sentence-of-an-empty-next-step', async () => {
  const { rosterLine, userLine } = await import('../../../src/doc/render.ts')
  const text = documentText({ bodies: { nextStep: [] } })
  assert.ok(rosterLine(text).endsWith('Next: none'), rosterLine(text))
  assert.ok(userLine(text, WORKING_COPY).includes('Next: none. Full state: '), userLine(text, WORKING_COPY))
})

test('render.roster-line', async () => {
  const { rosterLine } = await import('../../../src/doc/render.ts')
  const text = documentText({ status: 'parked', bodies: { nextStep: ['Ship it.'] } })
  assert.equal(rosterLine(text), 'fix-login - parked - Next: Ship it.')
})
