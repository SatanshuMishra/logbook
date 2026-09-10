import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, BRIEFING_HEADING, type DecisionIntegrity } from '../../src/render/briefing.ts'
import { escapeStoredBlock, toEscaped } from '../../src/render/escape.ts'
import type { Thread } from '../../src/schema/thread.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import { testRuntime } from '../support/runtime.ts'

const rt = testRuntime()

const EMPTY_INTEGRITY: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }

const NO_SESSION_ENTRIES: readonly SessionEntry[] = []
const HAS_PREVIOUS_SESSION = false

const STORED_LINE_BREAK = toEscaped('\n')
const ESCAPED_HEADING_MARKER = toEscaped('#')
const MARKDOWN_HEADING_LINE = /^[ \t]*#/
const BLANK_LINE = ''
const NO_TOKEN_OCCURRENCES = 0

const LEGACY_LAST_SESSION_MARKER =
  '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead'

type SpineBlockKey = 'active_goal' | 'last_session' | 'landed' | 'next_step'

type SpineBlockField = {
  key: SpineBlockKey
  slug: string
  name: string
  label: string
  serverAuthoredLines: readonly string[]
}

const SPINE_BLOCK_FIELDS: readonly SpineBlockField[] = [
  {
    key: 'active_goal',
    slug: 'active-goal',
    name: 'active goal',
    label: '**Active goal:**',
    serverAuthoredLines: []
  },
  {
    key: 'last_session',
    slug: 'last-session',
    name: 'last session',
    label: '**Last session:**',
    serverAuthoredLines: [LEGACY_LAST_SESSION_MARKER]
  },
  {
    key: 'landed',
    slug: 'landed',
    name: 'landed',
    label: '**Landed:**',
    serverAuthoredLines: []
  },
  {
    key: 'next_step',
    slug: 'next-step',
    name: 'next step',
    label: '**Next step:**',
    serverAuthoredLines: []
  }
]

const singleLineFor = (field: SpineBlockField): string => `the stored ${field.name} that carries no line break`
const openingLineFor = (field: SpineBlockField): string => `the ${field.name} opening line`
const closingLineFor = (field: SpineBlockField): string => `the ${field.name} closing line`
const forgedHeadingFor = (field: SpineBlockField): string => `## Forged ${field.name}`
const renderedForgedHeadingFor = (field: SpineBlockField): string => `${ESCAPED_HEADING_MARKER}# Forged ${field.name}`

const EMPTY_SPINE_VALUES: Record<SpineBlockKey, string> = {
  active_goal: '',
  last_session: '',
  landed: '',
  next_step: ''
}

const spineValuesWith = (field: SpineBlockField, storedValue: string): Record<SpineBlockKey, string> =>
  SPINE_BLOCK_FIELDS.reduce<Record<SpineBlockKey, string>>(
    (values, entry) => ({ ...values, [entry.key]: entry.key === field.key ? storedValue : singleLineFor(entry) }),
    EMPTY_SPINE_VALUES
  )

const threadWith = (values: Record<SpineBlockKey, string>): Thread => ({
  id: rt.ulid(),
  slug: 'spine-block-line-break-fixture',
  title: 'Spine Block Line Break Fixture',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: values.active_goal,
    next_step: values.next_step,
    landed: values.landed,
    last_session: values.last_session,
    open_risks: [],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const renderStoredValue = (field: SpineBlockField, storedValue: string): string =>
  renderBriefing(
    threadWith(spineValuesWith(field, storedValue)),
    EMPTY_INTEGRITY,
    null,
    null,
    HAS_PREVIOUS_SESSION,
    NO_SESSION_ENTRIES
  )

const sectionOf = (rendered: string, field: SpineBlockField): string[] => {
  const lines = rendered.split('\n')
  const labelIndex = lines.indexOf(field.label)
  assert.notEqual(
    labelIndex,
    -1,
    `expected the briefing to carry the label '${field.label}', without which the ${field.name} value renders nowhere and every assertion below would be vacuous, got ${JSON.stringify(lines)}`
  )
  const afterLabel = lines.slice(labelIndex + 1)
  assert.equal(
    afterLabel[0],
    BLANK_LINE,
    `expected the server to open the '${field.label}' section with a blank line before the ${field.name} value, got ${JSON.stringify(afterLabel[0])}`
  )
  const body = afterLabel.slice(1)
  const end = body.indexOf(BLANK_LINE)
  return end === -1 ? body : body.slice(0, end)
}

const BLOCK_QUOTE_MARKER_AT_LINE_START = /^> ?/

const withoutBlockQuoteMarker = (line: string): string => line.replace(BLOCK_QUOTE_MARKER_AT_LINE_START, '')

const headingLinesOf = (rendered: string): string[] =>
  rendered.split('\n').filter((line) => MARKDOWN_HEADING_LINE.test(withoutBlockQuoteMarker(line)))

const countOccurrences = (text: string, needle: string): number => text.split(needle).length - 1

for (const field of SPINE_BLOCK_FIELDS) {
  test(`briefing.spine-${field.slug}-renders-a-stored-line-break-as-two-real-lines`, () => {
    const opening = openingLineFor(field)
    const closing = closingLineFor(field)
    const stored = `${opening}${STORED_LINE_BREAK}${closing}`
    const rendered = renderStoredValue(field, stored)
    const section = sectionOf(rendered, field)

    assert.deepEqual(
      section,
      [...field.serverAuthoredLines, `> ${opening}`, `> ${closing}`],
      `expected the stored ${field.name} '${stored}' to render under '${field.label}' as the two separate lines '> ${opening}' and '> ${closing}', each carrying the server's own blockquote marker, got ${JSON.stringify(section)}`
    )
    assert.equal(
      countOccurrences(rendered, STORED_LINE_BREAK),
      NO_TOKEN_OCCURRENCES,
      `expected the decoded ${field.name} to leave no '${STORED_LINE_BREAK}' token in the briefing, and this fixture seeds that token in no other field, got ${JSON.stringify(rendered)}`
    )
  })

  test(`briefing.spine-${field.slug}-line-break-token-cannot-forge-a-heading`, () => {
    const opening = openingLineFor(field)
    const forged = forgedHeadingFor(field)
    const stored = `${opening}${STORED_LINE_BREAK}${forged}`
    const rendered = renderStoredValue(field, stored)
    const section = sectionOf(rendered, field)
    const headingLines = headingLinesOf(rendered)

    assert.deepEqual(
      section,
      [...field.serverAuthoredLines, `> ${opening}`, `> ${renderedForgedHeadingFor(field)}`],
      `expected the stored ${field.name} '${stored}' to render under '${field.label}' as '> ${opening}' followed by '> ${renderedForgedHeadingFor(field)}', the line break decoded, the heading marker behind it re-escaped, and each line carrying the server's own blockquote marker, got ${JSON.stringify(section)}`
    )
    assert.deepEqual(
      headingLines,
      [BRIEFING_HEADING],
      `expected the only Markdown heading line in the briefing to be the one the server authors, '${BRIEFING_HEADING}'; a stored ${field.name} of '${stored}' must not add '${forged}', got ${JSON.stringify(headingLines)}`
    )
  })
}

test('escape.escapeStoredBlock-cannot-be-forged-into-authoring-its-own-blockquote-marker', () => {
  assert.equal(
    escapeStoredBlock('> forged quote'),
    '> U+003E forged quote',
    "a stored value spelling its own leading '>' must render as the server's blockquote marker followed by the value's own '>' escaped, not as two indistinguishable blockquote markers"
  )
})
