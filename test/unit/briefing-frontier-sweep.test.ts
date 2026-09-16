import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  renderBriefingWithPasses,
  BRIEFING_MAX_CHARS,
  RESUME_PAYLOAD_MAX_BYTES,
  NOT_RECORDED,
  RELATED_TITLE_FLOOR,
  RELATED_SLUG_FLOOR,
  RISK_TEXT_FLOOR,
  RISK_REF_FLOOR,
  KEY_DECISION_TITLE_FLOOR,
  OUT_OF_SCOPE_TEXT_FLOOR,
  CRITERION_TEXT_FLOOR,
  CRITERION_CHECK_FLOOR,
  CRITERION_RESULT_FLOOR,
  type DecisionIntegrity
} from '../../src/render/briefing.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import * as caps from '../../src/schema/caps.ts'
import { testRuntime } from '../support/runtime.ts'
import { census } from '../support/census.ts'
import {
  buildSweepFixture,
  SWEEP_FIXTURE_HELD_FIXED,
  SWEEP_FIXTURE_NOT_SWEPT,
  type SweepShape
} from '../support/briefing-sweep-fixture.ts'

const rt = testRuntime()

const ASCII_FILL = 'x'
const MULTI_BYTE_FILL = '漢'
const DELIMITER_FILL = '.'

const FILLS = [
  { name: 'ascii', char: ASCII_FILL },
  { name: 'cjk', char: MULTI_BYTE_FILL },
  { name: 'delimiter', char: DELIMITER_FILL }
] as const

const ANCHORINGS = [
  { name: 'unanchored', anchored: false },
  { name: 'anchored-to-current-criterion', anchored: true }
] as const

const SWEEP_RECORD_BYTES_CEILING = 65536
const SWEEP_CRITERION_TEXT_MAX = 500

type PinnedOutcome = 'within' | 'breaching' | 'inadmissible'

type PinnedShape = {
  name: string
  criteriaCount: number
  keyDecisionCount: number
  criterionTextLength: number
  bulkCount: number
  expected: Readonly<Record<string, PinnedOutcome>>
}

const PINNED_SHAPES: readonly PinnedShape[] = [
  {
    name: 'empty',
    criteriaCount: 0,
    keyDecisionCount: 0,
    criterionTextLength: 0,
    bulkCount: 0,
    expected: { ascii: 'within', cjk: 'within', delimiter: 'within' }
  },
  {
    name: 'empty-at-max-criterion-text',
    criteriaCount: 0,
    keyDecisionCount: 0,
    criterionTextLength: SWEEP_CRITERION_TEXT_MAX,
    bulkCount: 0,
    expected: { ascii: 'within', cjk: 'within', delimiter: 'within' }
  },
  {
    name: 'one-criterion-one-risk',
    criteriaCount: 1,
    keyDecisionCount: 0,
    criterionTextLength: 0,
    bulkCount: 1,
    expected: { ascii: 'within', cjk: 'within', delimiter: 'within' }
  },
  {
    name: 'five-criteria',
    criteriaCount: 5,
    keyDecisionCount: 0,
    criterionTextLength: 0,
    bulkCount: 1,
    expected: { ascii: 'within', cjk: 'within', delimiter: 'within' }
  },
  {
    name: 'five-criteria-short-text',
    criteriaCount: 5,
    keyDecisionCount: 0,
    criterionTextLength: 2,
    bulkCount: 1,
    expected: { ascii: 'within', cjk: 'within', delimiter: 'within' }
  },
  {
    name: 'five-criteria-at-max-criterion-text',
    criteriaCount: 5,
    keyDecisionCount: 0,
    criterionTextLength: SWEEP_CRITERION_TEXT_MAX,
    bulkCount: 1,
    expected: { ascii: 'within', cjk: 'breaching', delimiter: 'within' }
  },
  {
    name: 'criteria-saturated',
    criteriaCount: caps.CRITERIA_MAX_ELEMENTS,
    keyDecisionCount: 0,
    criterionTextLength: 1,
    bulkCount: 0,
    expected: { ascii: 'within', cjk: 'breaching', delimiter: 'within' }
  },
  {
    name: 'criteria-saturated-with-bulk',
    criteriaCount: caps.CRITERIA_MAX_ELEMENTS,
    keyDecisionCount: 0,
    criterionTextLength: 1,
    bulkCount: 5,
    expected: { ascii: 'breaching', cjk: 'breaching', delimiter: 'breaching' }
  },
  {
    name: 'criteria-at-retention-cap',
    criteriaCount: caps.CRITERIA_RETENTION_MAX_ELEMENTS,
    keyDecisionCount: 0,
    criterionTextLength: 1,
    bulkCount: 0,
    expected: { ascii: 'breaching', cjk: 'breaching', delimiter: 'breaching' }
  },
  {
    name: 'key-decisions-at-cap',
    criteriaCount: caps.CRITERIA_MAX_ELEMENTS,
    keyDecisionCount: caps.KEY_DECISIONS_MAX_ELEMENTS,
    criterionTextLength: 1,
    bulkCount: 1,
    expected: { ascii: 'inadmissible', cjk: 'inadmissible', delimiter: 'inadmissible' }
  }
]

const CRITERIA_COUNTS = [...new Set(PINNED_SHAPES.map((shape) => shape.criteriaCount))].sort((a, b) => a - b)
const KEY_DECISION_COUNTS = [...new Set(PINNED_SHAPES.map((shape) => shape.keyDecisionCount))].sort((a, b) => a - b)

const GRAPHEME_DENSITY_PROBE_LENGTH = 4

const FLOOR_FIELD_GRAPHEME_SEGMENTER = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemeCount = (text: string): number => Array.from(FLOOR_FIELD_GRAPHEME_SEGMENTER.segment(text)).length

const PAYLOAD_NOTE =
  'previous_session in the resume payload is null, which is the smallest shape that field takes'

const serialisedRecordBytes = (shape: SweepShape): number =>
  Buffer.byteLength(JSON.stringify(buildSweepFixture(rt, shape).thread), 'utf8')

const resumePayloadBytes = (threadId: string, briefing: string): number =>
  Buffer.byteLength(
    JSON.stringify({
      content: [{ type: 'text', text: '' }],
      structuredContent: { thread_id: threadId, briefing, previous_session: null }
    }),
    'utf8'
  )

type Measured = {
  chars: number
  bytes: number
  withinBudget: boolean
  itemsHeld: number
  itemsRendered: number
  criterionRows: number
  checkRows: number
  populatedCheckRows: number
  populatedResultRows: number
  riskRefRows: number
  floorHonoured: boolean
  floorViolatingField: string | null
  floorViolatingLength: number | null
  floorViolatingFloor: number | null
  floorViolatingExpectedMinimum: number | null
}

const SECTION_HEADINGS = [
  '**Open risks:**',
  '**Key decisions:**',
  '**Out of scope:**',
  '**Completion criteria:**',
  '**Settled items (on goals already met or struck):**'
] as const

const sectionLineCount = (lines: readonly string[], heading: string): number => {
  const headingIndex = lines.indexOf(heading)
  if (headingIndex === -1) return 0
  let count = 0
  for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line === undefined || line.length === 0) break
    count += 1
  }
  return count
}

const sectionMatchingLineCount = (lines: readonly string[], heading: string, pattern: RegExp): number => {
  const headingIndex = lines.indexOf(heading)
  if (headingIndex === -1) return 0
  let count = 0
  for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line === undefined || line.length === 0) break
    if (pattern.test(line)) count += 1
  }
  return count
}

const CRITERION_ROW_PATTERN = /^- c\d+ \[(?:open|done|struck)\] \[(?:confirmed|proposed|unsettled)\]:/
const CHECK_ROW_PATTERN = /^ {2}- check: /
const RESULT_ROW_PATTERN = /^ {2}- result: /
const RISK_REF_ROW_PATTERN = /^ {2}- ref: /
const RISK_ROW_PATTERN = /^- [0-9A-HJKMNP-TV-Z]{26} /
const NOT_RECORDED_CHECK_ROW = `  - check: ${NOT_RECORDED}`
const NOT_RECORDED_RESULT_PREFIX = `  - result: ${NOT_RECORDED} (`

const RISK_TEXT_CAPTURE = /^- [0-9A-HJKMNP-TV-Z]{26} (.*)$/
const RISK_REF_CAPTURE = /^ {2}- ref: (.*)$/
const OUT_OF_SCOPE_CAPTURE = /^- (.*)$/
const KEY_DECISION_CAPTURE = /^- (.*) \(decision [0-9A-HJKMNP-TV-Z]{26}\)$/
const CRITERION_TEXT_CAPTURE =
  /^- c\d+ \[(?:open|done|struck)\] \[(?:confirmed|proposed|unsettled)\]: (.*) \(id [0-9A-HJKMNP-TV-Z]{26}\)$/
const CRITERION_CHECK_CAPTURE = /^ {2}- check: (.*)$/
const CRITERION_RESULT_CAPTURE = /^ {2}- result: (.*) \((?:verified|unverified-reasoned|not recorded)\)$/
const RELATED_CAPTURE = /^- succeeds: (.*) \((.*)\)$/

type FloorField = { field: string; floor: number; expectedMinimum: number; length: number }

const sectionLines = (lines: readonly string[], heading: string): string[] => {
  const headingIndex = lines.indexOf(heading)
  if (headingIndex === -1) return []
  const collected: string[] = []
  for (let cursor = headingIndex + 1; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    if (line === undefined || line.length === 0) break
    collected.push(line)
  }
  return collected
}

const capturedLengths = (lines: readonly string[], pattern: RegExp, group: number = 1): number[] =>
  lines
    .map((line) => pattern.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => (match[group] ?? '').length)

const floorFieldsOf = (lines: readonly string[], thread: Thread, predecessor: Thread | null): FloorField[] => {
  const outOfScopeLines = sectionLines(lines, SECTION_HEADINGS[2])
  const checkLines = lines.filter((line) => CRITERION_CHECK_CAPTURE.test(line) && line !== NOT_RECORDED_CHECK_ROW)
  const resultLines = lines.filter(
    (line) => CRITERION_RESULT_CAPTURE.test(line) && !line.startsWith(NOT_RECORDED_RESULT_PREFIX)
  )
  const relatedMatches = lines
    .map((line) => RELATED_CAPTURE.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)

  const liveRisks = thread.spine.open_risks.filter((entry) => !entry.retired)
  const doneCriterion = thread.completion_criteria.find(
    (entry) => entry.done && typeof entry.result === 'string'
  )

  const withExpected = (field: string, floor: number, actualRawText: string | null | undefined, lengths: number[]): FloorField[] => {
    if (actualRawText === undefined || actualRawText === null || actualRawText.length === 0) return []
    assert.ok(
      lengths.length > 0,
      `the ${field} floor sweep expected at least one rendered line for a populated source field but captured none; the render grammar for this field has drifted out from under its capture pattern, or this census is passing silently over what it can no longer classify`
    )
    const expectedMinimum = Math.min(graphemeCount(escapeStored(actualRawText)), floor)
    return lengths.map((length) => ({ field, floor, expectedMinimum, length }))
  }

  return [
    ...withExpected('risk text', RISK_TEXT_FLOOR, liveRisks[0]?.text, capturedLengths(lines, RISK_TEXT_CAPTURE)),
    ...withExpected('risk ref', RISK_REF_FLOOR, liveRisks[0]?.refs[0], capturedLengths(lines, RISK_REF_CAPTURE)),
    ...withExpected(
      'out of scope text',
      OUT_OF_SCOPE_TEXT_FLOOR,
      thread.spine.out_of_scope[0]?.text,
      capturedLengths(outOfScopeLines, OUT_OF_SCOPE_CAPTURE)
    ),
    ...withExpected(
      'key decision title',
      KEY_DECISION_TITLE_FLOOR,
      thread.spine.key_decisions[0]?.title,
      capturedLengths(lines, KEY_DECISION_CAPTURE)
    ),
    ...withExpected(
      'criterion text',
      CRITERION_TEXT_FLOOR,
      thread.completion_criteria[0]?.text,
      capturedLengths(lines, CRITERION_TEXT_CAPTURE)
    ),
    ...withExpected(
      'criterion check',
      CRITERION_CHECK_FLOOR,
      thread.completion_criteria[0]?.check,
      capturedLengths(checkLines, CRITERION_CHECK_CAPTURE)
    ),
    ...withExpected(
      'criterion result',
      CRITERION_RESULT_FLOOR,
      doneCriterion?.result,
      capturedLengths(resultLines, CRITERION_RESULT_CAPTURE)
    ),
    ...withExpected(
      'related title',
      RELATED_TITLE_FLOOR,
      predecessor?.title,
      relatedMatches.map((match) => (match[1] ?? '').length)
    ),
    ...withExpected(
      'related slug',
      RELATED_SLUG_FLOOR,
      predecessor?.slug,
      relatedMatches.map((match) => (match[2] ?? '').length)
    )
  ]
}

const measureThread = (thread: Thread, integrity: DecisionIntegrity, predecessor: Thread | null): Measured => {
  const render = renderBriefingWithPasses(thread, integrity, null, predecessor)
  const lines = render.briefing.split('\n')

  const criterionRows = lines.filter((line) => CRITERION_ROW_PATTERN.test(line)).length
  const checkRows = lines.filter((line) => CHECK_ROW_PATTERN.test(line)).length
  const populatedCheckRows = lines.filter(
    (line) => CHECK_ROW_PATTERN.test(line) && line !== NOT_RECORDED_CHECK_ROW
  ).length
  const populatedResultRows = lines.filter(
    (line) => RESULT_ROW_PATTERN.test(line) && !line.startsWith(NOT_RECORDED_RESULT_PREFIX)
  ).length
  const riskRefRows = lines.filter((line) => RISK_REF_ROW_PATTERN.test(line)).length
  const riskRows = sectionMatchingLineCount(lines, SECTION_HEADINGS[0], RISK_ROW_PATTERN)
  const danglingRows = lines.filter((line) => line.startsWith('- dangling: ')).length
  const quarantinedRows = lines.filter((line) => line.startsWith('- quarantined: ')).length

  const violatingFloor = floorFieldsOf(lines, thread, predecessor).find((entry) => entry.length < entry.expectedMinimum) ?? null

  const itemsRendered =
    criterionRows +
    riskRows +
    sectionLineCount(lines, SECTION_HEADINGS[1]) +
    sectionLineCount(lines, SECTION_HEADINGS[2]) +
    sectionLineCount(lines, SECTION_HEADINGS[4]) +
    danglingRows +
    quarantinedRows

  const itemsHeld =
    thread.completion_criteria.length +
    thread.spine.open_risks.length +
    thread.spine.key_decisions.length +
    thread.spine.out_of_scope.length +
    integrity.dangling.length +
    integrity.quarantined.length

  return {
    chars: render.briefing.length,
    bytes: resumePayloadBytes(thread.id, render.briefing),
    withinBudget: render.withinBudget,
    itemsHeld,
    itemsRendered,
    criterionRows,
    checkRows,
    populatedCheckRows,
    populatedResultRows,
    riskRefRows,
    floorHonoured: violatingFloor === null,
    floorViolatingField: violatingFloor === null ? null : violatingFloor.field,
    floorViolatingLength: violatingFloor === null ? null : violatingFloor.length,
    floorViolatingFloor: violatingFloor === null ? null : violatingFloor.floor,
    floorViolatingExpectedMinimum: violatingFloor === null ? null : violatingFloor.expectedMinimum
  }
}

const measure = (shape: SweepShape): Measured => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, shape)
  return measureThread(thread, integrity, predecessor)
}

const isAdmissible = (shape: SweepShape): boolean => ThreadRecord.parse(buildSweepFixture(rt, shape).thread).ok

const OUTCOME_CLASSES = [
  'schema-inadmissible',
  'admissible-within-both-caps',
  'admissible-breaching-a-cap'
] as const

type Outcome = (typeof OUTCOME_CLASSES)[number]

type SweptRecord = {
  fill: string
  anchoring: string
  criteriaCount: number
  keyDecisionCount: number
  criterionTextLength: number
  bulkCount: number
  outcome: Outcome
  chars: number | null
  bytes: number | null
  withinBudget: boolean | null
  itemsHeld: number | null
  itemsRendered: number | null
  criterionRows: number | null
  checkRows: number | null
  populatedCheckRows: number | null
  populatedResultRows: number | null
  riskRefRows: number | null
  floorHonoured: boolean | null
  floorViolatingField: string | null
  floorViolatingLength: number | null
  floorViolatingFloor: number | null
  floorViolatingExpectedMinimum: number | null
}

const classifiedOutcomes: ReadonlySet<string> = new Set(OUTCOME_CLASSES)

const verdictOf = (record: SweptRecord): 'allowed' | 'forbidden' | 'unclassifiable' =>
  classifiedOutcomes.has(record.outcome) ? 'allowed' : 'unclassifiable'

const describe = (record: SweptRecord): string =>
  `${record.fill}/${record.anchoring} criteria=${record.criteriaCount} criterionText=${record.criterionTextLength} keyDecisions=${record.keyDecisionCount} risks=${record.bulkCount} outOfScope=${record.bulkCount} rendered ${record.chars} characters (cap ${BRIEFING_MAX_CHARS}) and ${record.bytes} resume-payload bytes (cap ${RESUME_PAYLOAD_MAX_BYTES})`

const outcomeOf = (shape: SweepShape, expected: PinnedOutcome): Outcome => {
  if (expected === 'inadmissible') return 'schema-inadmissible'
  const measured = measure(shape)
  return measured.chars <= BRIEFING_MAX_CHARS && measured.bytes <= RESUME_PAYLOAD_MAX_BYTES
    ? 'admissible-within-both-caps'
    : 'admissible-breaching-a-cap'
}

const expectedOutcomeClass = (expected: PinnedOutcome): Outcome =>
  expected === 'inadmissible'
    ? 'schema-inadmissible'
    : expected === 'within'
      ? 'admissible-within-both-caps'
      : 'admissible-breaching-a-cap'

const admissibleHere = (shape: SweepShape): boolean =>
  isAdmissible(shape) && serialisedRecordBytes(shape) <= SWEEP_RECORD_BYTES_CEILING

const sweep = (): SweptRecord[] => {
  const swept: SweptRecord[] = []

  for (const fill of FILLS) {
    for (const anchoring of ANCHORINGS) {
      for (const pinned of PINNED_SHAPES) {
        const shape: SweepShape = {
          fill: fill.char,
          anchored: anchoring.anchored,
          criteriaCount: pinned.criteriaCount,
          keyDecisionCount: pinned.keyDecisionCount,
          criterionTextLength: pinned.criterionTextLength,
          bulkCount: pinned.bulkCount
        }

        const expected = pinned.expected[fill.name]
        assert.ok(
          expected !== undefined,
          `the pinned shape ${pinned.name} declares no expected outcome for the ${fill.name} fill; every pinned row states what it is supposed to produce so that a cap change fails loudly rather than testing a boundary that has moved`
        )

        const admissible = admissibleHere(shape)
        assert.equal(
          admissible,
          expected !== 'inadmissible',
          `the pinned shape ${pinned.name} on the ${fill.name} fill declares ${expected} but the record is ${admissible ? 'admissible' : 'inadmissible'}; a cap has moved and this row no longer sits where it was pinned`
        )

        const base = {
          fill: fill.name,
          anchoring: anchoring.name,
          criteriaCount: pinned.criteriaCount,
          keyDecisionCount: pinned.keyDecisionCount,
          criterionTextLength: pinned.criterionTextLength,
          bulkCount: pinned.bulkCount
        }

        if (!admissible) {
          swept.push({
            ...base,
            outcome: 'schema-inadmissible',
            chars: null,
            bytes: null,
            withinBudget: null,
            itemsHeld: null,
            itemsRendered: null,
            criterionRows: null,
            checkRows: null,
            populatedCheckRows: null,
            populatedResultRows: null,
            riskRefRows: null,
            floorHonoured: null,
            floorViolatingField: null,
            floorViolatingLength: null,
            floorViolatingFloor: null,
            floorViolatingExpectedMinimum: null
          })
          continue
        }

        const measured = measure(shape)
        const outcome = outcomeOf(shape, expected as PinnedOutcome)
        assert.equal(
          outcome,
          expectedOutcomeClass(expected as PinnedOutcome),
          `the pinned shape ${pinned.name} on the ${fill.name} fill declares ${expected} but rendered ${measured.chars} characters (cap ${BRIEFING_MAX_CHARS}) and ${measured.bytes} payload bytes (cap ${RESUME_PAYLOAD_MAX_BYTES}); a cap has moved and this row no longer sits on the side of the budget it was pinned to`
        )

        swept.push({
          ...base,
          outcome,
          chars: measured.chars,
          bytes: measured.bytes,
          withinBudget: measured.withinBudget,
          itemsHeld: measured.itemsHeld,
          itemsRendered: measured.itemsRendered,
          criterionRows: measured.criterionRows,
          checkRows: measured.checkRows,
          populatedCheckRows: measured.populatedCheckRows,
          populatedResultRows: measured.populatedResultRows,
          riskRefRows: measured.riskRefRows,
          floorHonoured: measured.floorHonoured,
          floorViolatingField: measured.floorViolatingField,
          floorViolatingLength: measured.floorViolatingLength,
          floorViolatingFloor: measured.floorViolatingFloor,
          floorViolatingExpectedMinimum: measured.floorViolatingExpectedMinimum
        })
      }
    }
  }

  return swept
}


const oneRiskWithSeveralReferencesThread = (): Thread => ({
  id: rt.ulid(),
  slug: 'control-risk-refs',
  title: 'control record for the risk-reference item count',
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: 'control',
    next_step: 'control',
    landed: '',
    last_session: 'control',
    open_risks: [
      {
        id: rt.ulid(),
        scope: 'control',
        text: 'one risk backed by several external references',
        refs: ['first reference', 'second reference', 'third reference'],
        retired: false
      }
    ],
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

test('briefing.frontier-sweep-one-risk-with-several-references-counts-as-one-item', () => {
  const thread = oneRiskWithSeveralReferencesThread()
  const integrity: DecisionIntegrity = { resolved: 0, dangling: [], quarantined: [] }
  const measured = measureThread(thread, integrity, null)
  assert.equal(
    measured.itemsRendered,
    measured.itemsHeld,
    `a risk with several references must count as one item, not one per rendered line; rendered ${measured.itemsRendered} of ${measured.itemsHeld} held`
  )
})

test('briefing.frontier-sweep-finds-no-record-that-loses-an-item-or-hides-a-budget-breach', (t) => {
  assert.equal(Buffer.byteLength(ASCII_FILL, 'utf8'), 1, 'the ASCII fill must be one byte per character')
  assert.equal(Buffer.byteLength(MULTI_BYTE_FILL, 'utf8'), 3, 'the multi-byte fill must be three bytes per character')
  assert.equal(Buffer.byteLength(DELIMITER_FILL, 'utf8'), 1, 'the delimiter fill must be one byte per character')
  assert.equal(
    MULTI_BYTE_FILL.length,
    1,
    'the multi-byte fill must be one UTF-16 unit, so that a character count means the same thing under both fills'
  )
  const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
  for (const fill of FILLS) {
    assert.equal(
      escapeStored(fill.char),
      fill.char,
      `the ${fill.name} fill must pass through the stored-text escape unchanged, which is the exclusion this sweep declares for the escape-expanding fill class`
    )
    const probe = fill.char.repeat(GRAPHEME_DENSITY_PROBE_LENGTH)
    assert.equal(
      Array.from(graphemeSegmenter.segment(probe)).length,
      probe.length,
      `a run of the ${fill.name} fill must carry one grapheme per UTF-16 unit, which is the exclusion this sweep declares for grapheme density`
    )
  }
  assert.deepEqual(
    [Math.min(...CRITERIA_COUNTS), Math.max(...CRITERIA_COUNTS)],
    [0, caps.CRITERIA_RETENTION_MAX_ELEMENTS],
    'the criteria-count dimension must span an empty thread up to the schema retention cap'
  )
  assert.ok(
    CRITERIA_COUNTS.includes(caps.CRITERIA_MAX_ELEMENTS),
    'the criteria-count dimension must include the number of criteria the briefing shows, where the rendered list saturates'
  )
  assert.deepEqual(
    [Math.min(...KEY_DECISION_COUNTS), Math.max(...KEY_DECISION_COUNTS)],
    [0, caps.KEY_DECISIONS_MAX_ELEMENTS],
    'the key-decision dimension must span none up to the schema element cap'
  )

  const startedAt = process.hrtime.bigint()
  const swept = sweep()
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6

  census(swept, verdictOf)

  for (const outcomeClass of OUTCOME_CLASSES) {
    const populated = swept.some((record) => record.outcome === outcomeClass)
    assert.ok(
      populated,
      `the outcome class ${outcomeClass} holds no swept record; the grid never produced a record of that kind`
    )
  }

  const admissible = swept.filter((record) => record.outcome !== 'schema-inadmissible')
  const breaching = swept.filter((record) => record.outcome === 'admissible-breaching-a-cap')
  const sweptTextLengths = swept.map((record) => record.criterionTextLength)
  const sweptBulkCounts = swept.map((record) => record.bulkCount)

  t.diagnostic(`pinned sweep classified ${swept.length} records in ${elapsedMs.toFixed(0)}ms across ${PINNED_SHAPES.length} pinned shapes`)
  for (const pinned of PINNED_SHAPES) {
    t.diagnostic(`pinned shape ${pinned.name}: criteria=${pinned.criteriaCount} keyDecisions=${pinned.keyDecisionCount} criterionText=${pinned.criterionTextLength} bulk=${pinned.bulkCount} expected ${FILLS.map((entry) => `${entry.name}=${pinned.expected[entry.name]}`).join(' ')}`)
  }
  t.diagnostic(`dimension fill: ${FILLS.map((entry) => entry.name).join(', ')}`)
  t.diagnostic(`dimension anchoring: ${ANCHORINGS.map((entry) => entry.name).join(', ')}`)
  t.diagnostic(
    `dimension criteria count: ${CRITERIA_COUNTS.join(', ')} within bounds 0 and ${caps.CRITERIA_RETENTION_MAX_ELEMENTS}`
  )
  t.diagnostic(
    `dimension key-decision count: ${KEY_DECISION_COUNTS.join(', ')} within bounds 0 and ${caps.KEY_DECISIONS_MAX_ELEMENTS}`
  )
  t.diagnostic(
    `dimension criterion text length: pinned per shape rather than searched for; observed span ${Math.min(...sweptTextLengths)} to ${Math.max(...sweptTextLengths)} within bounds 0 and ${SWEEP_CRITERION_TEXT_MAX}`
  )
  t.diagnostic(
    `dimension bulk count (open risks and out-of-scope elements, held equal): pinned per shape; observed span ${Math.min(...sweptBulkCounts)} to ${Math.max(...sweptBulkCounts)} within bounds 0 and ${caps.RISKS_PER_CALL_MAX_ELEMENTS}`
  )
  for (const outcome of OUTCOME_CLASSES) {
    t.diagnostic(`class ${outcome}: ${swept.filter((record) => record.outcome === outcome).length}`)
  }
  for (const held of [...SWEEP_FIXTURE_HELD_FIXED, PAYLOAD_NOTE]) t.diagnostic(`held fixed: ${held}`)
  for (const excluded of SWEEP_FIXTURE_NOT_SWEPT) t.diagnostic(`not swept: ${excluded}`)

  assert.equal(
    Math.max(...sweptTextLengths),
    SWEEP_CRITERION_TEXT_MAX,
    'the criterion text dimension must reach SWEEP_CRITERION_TEXT_MAX, the former criterion text cap the sweep keeps as its upper bound, somewhere in the grid, or the sweep never tested its longest criterion text'
  )
  for (const fill of FILLS) {
    assert.ok(
      admissible.some((record) => record.fill === fill.name),
      `the ${fill.name} half of the sweep must contain at least one schema-admissible record, or that fill was never exercised`
    )
  }

  const worstFirst = [...breaching].sort((left, right) => (right.bytes ?? 0) - (left.bytes ?? 0))
  const worstPerFill = FILLS.map((fill) => worstFirst.find((record) => record.fill === fill.name)).filter(
    (record): record is SweptRecord => record !== undefined
  )
  for (const record of worstPerFill) t.diagnostic(`worst ${record.fill}: ${describe(record)}`)

  const losingAnItem = admissible.filter((record) => record.itemsRendered !== record.itemsHeld)
  assert.equal(
    losingAnItem.length,
    0,
    [
      `${losingAnItem.length} of ${admissible.length} swept records rendered fewer items than they hold; no display rule may remove an item`,
      ...losingAnItem.slice(0, 5).map((record) => `losing: ${record.itemsRendered} of ${record.itemsHeld} — ${describe(record)}`)
    ].join('\n')
  )

  const missingACheckLine = admissible.filter((record) => record.criterionRows !== record.checkRows)
  assert.equal(
    missingACheckLine.length,
    0,
    [
      `${missingACheckLine.length} of ${admissible.length} swept records rendered a criterion without its check line`,
      ...missingACheckLine.slice(0, 5).map((record) => `missing: ${record.checkRows} checks for ${record.criterionRows} criteria — ${describe(record)}`)
    ].join('\n')
  )

  const violatingAFloor = admissible.filter((record) => record.floorHonoured === false)
  assert.equal(
    violatingAFloor.length,
    0,
    [
      `${violatingAFloor.length} of ${admissible.length} swept records rendered a field shorter than its guaranteed floor`,
      ...violatingAFloor
        .slice(0, 5)
        .map(
          (record) =>
            `floor violated: ${record.floorViolatingField} rendered ${record.floorViolatingLength} chars, floor ${record.floorViolatingFloor}, expected minimum for this record ${record.floorViolatingExpectedMinimum} — ${describe(record)}`
        )
    ].join('\n')
  )

  const claimingToFit = breaching.filter((record) => record.withinBudget === true)
  assert.equal(
    claimingToFit.length,
    0,
    [
      `${claimingToFit.length} of ${breaching.length} breaching records reported themselves as within budget; a render that does not fit must say so`,
      ...claimingToFit.slice(0, 5).map((record) => `claiming: ${describe(record)}`)
    ].join('\n')
  )

  const silentlyBreaching = admissible.filter(
    (record) => record.withinBudget === true && (record.chars ?? 0) > BRIEFING_MAX_CHARS
  )
  assert.equal(
    silentlyBreaching.length,
    0,
    'no record may report itself within budget while rendering past the character cap'
  )

  const exercisesOnBothSidesOfTheBudget = (
    label: string,
    hasBranch: (record: SweptRecord) => boolean
  ): void => {
    const withinBudgetHit = admissible.some(
      (record) => record.outcome === 'admissible-within-both-caps' && hasBranch(record)
    )
    const breachingHit = admissible.some(
      (record) => record.outcome === 'admissible-breaching-a-cap' && hasBranch(record)
    )
    assert.ok(
      withinBudgetHit,
      `no swept record within both caps ever rendered ${label}; the branch was never exercised on a record that fits`
    )
    assert.ok(
      breachingHit,
      `no swept record breaching a cap ever rendered ${label}; the branch was never exercised on a record that overflows`
    )
  }

  exercisesOnBothSidesOfTheBudget('a populated check line', (record) => (record.populatedCheckRows ?? 0) > 0)
  exercisesOnBothSidesOfTheBudget('a populated result line', (record) => (record.populatedResultRows ?? 0) > 0)
  exercisesOnBothSidesOfTheBudget('a risk reference', (record) => (record.riskRefRows ?? 0) > 0)
})
