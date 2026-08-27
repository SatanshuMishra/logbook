import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderBriefing, BRIEFING_MAX_CHARS, RESUME_PAYLOAD_MAX_BYTES } from '../../src/render/briefing.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'
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

const FILLS = [
  { name: 'ascii', char: ASCII_FILL },
  { name: 'cjk', char: MULTI_BYTE_FILL }
] as const

const ANCHORINGS = [
  { name: 'unanchored', anchored: false },
  { name: 'anchored-to-current-criterion', anchored: true }
] as const

const CRITERIA_COUNTS = [0, 1, 5, 10, 20, caps.CRITERIA_MAX_ELEMENTS, 120, caps.CRITERIA_RETENTION_MAX_ELEMENTS]
const KEY_DECISION_COUNTS = [0, 5, 10, caps.KEY_DECISIONS_MAX_ELEMENTS]

const GRAPHEME_DENSITY_PROBE_LENGTH = 4

const PAYLOAD_NOTE =
  'previous_session in the resume payload is null, which is the smallest shape that field takes'

const serialisedRecordBytes = (shape: SweepShape): number =>
  Buffer.byteLength(JSON.stringify(buildSweepFixture(rt, shape).thread), 'utf8')

const resumePayloadBytes = (threadId: string, briefing: string): number =>
  Buffer.byteLength(
    JSON.stringify({
      content: [{ type: 'text', text: briefing }],
      structuredContent: { thread_id: threadId, briefing, previous_session: null }
    }),
    'utf8'
  )

type Measured = { chars: number; bytes: number }

const measure = (shape: SweepShape): Measured => {
  const { thread, predecessor, integrity } = buildSweepFixture(rt, shape)
  const briefing = renderBriefing(thread, integrity, null, predecessor)
  return { chars: briefing.length, bytes: resumePayloadBytes(thread.id, briefing) }
}

const isAdmissible = (shape: SweepShape): boolean => ThreadRecord.parse(buildSweepFixture(rt, shape).thread).ok

const largestSatisfying = (upperBound: number, holds: (candidate: number) => boolean): number => {
  let low = -1
  let high = upperBound
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (holds(middle)) low = middle
    else high = middle - 1
  }
  return low
}

const OUTCOME_CLASSES = [
  'schema-inadmissible',
  'admissible-within-both-caps',
  'admissible-breaching-a-cap'
] as const

type Outcome = (typeof OUTCOME_CLASSES)[number] | 'frontier-not-located'

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
}

const classifiedOutcomes: ReadonlySet<string> = new Set(OUTCOME_CLASSES)

const verdictOf = (record: SweptRecord): 'allowed' | 'forbidden' | 'unclassifiable' =>
  classifiedOutcomes.has(record.outcome) ? 'allowed' : 'unclassifiable'

const describe = (record: SweptRecord): string =>
  `${record.fill}/${record.anchoring} criteria=${record.criteriaCount} criterionText=${record.criterionTextLength} keyDecisions=${record.keyDecisionCount} risks=${record.bulkCount} outOfScope=${record.bulkCount} rendered ${record.chars} characters (cap ${BRIEFING_MAX_CHARS}) and ${record.bytes} resume-payload bytes (cap ${RESUME_PAYLOAD_MAX_BYTES})`

type FrontierScan = { lengths: number[]; frontierLocated: boolean }

const criterionTextLengthsFor = (partial: Omit<SweepShape, 'criterionTextLength'>, recordCeiling: number): FrontierScan => {
  const at = (criterionTextLength: number): SweepShape => ({ ...partial, criterionTextLength })

  const cache = new Map<number, number>()
  const charsAt = (length: number): number => {
    const cached = cache.get(length)
    if (cached !== undefined) return cached
    const fresh = measure(at(length)).chars
    cache.set(length, fresh)
    return fresh
  }

  const spread = (frontier: number): number[] => {
    const beyond = Math.min(recordCeiling, frontier + 1)
    const lengths = [
      0,
      1,
      Math.max(0, frontier - 1),
      frontier,
      beyond,
      Math.floor((beyond + recordCeiling) / 2),
      recordCeiling
    ]
    return [...new Set(lengths.filter((length) => length <= recordCeiling))].sort((left, right) => left - right)
  }

  if (recordCeiling < 2) {
    return { lengths: Array.from({ length: recordCeiling + 1 }, (_, index) => index), frontierLocated: true }
  }

  const base = charsAt(0)
  const slope = charsAt(1) - base
  if (slope <= 0) return { lengths: spread(0), frontierLocated: true }

  const onUnclippedLine = (length: number): boolean => charsAt(length) === base + slope * length
  if (onUnclippedLine(recordCeiling)) return { lengths: spread(recordCeiling), frontierLocated: true }

  const isFrontier = (candidate: number): boolean =>
    candidate < recordCeiling && onUnclippedLine(candidate) && !onUnclippedLine(candidate + 1)

  const predicted = Math.min(recordCeiling, Math.max(0, Math.floor((BRIEFING_MAX_CHARS - base) / slope)))
  const frontier = isFrontier(predicted) ? predicted : largestSatisfying(recordCeiling, onUnclippedLine)
  if (!isFrontier(frontier)) return { lengths: [], frontierLocated: false }

  return { lengths: spread(frontier), frontierLocated: true }
}

const sweep = (): SweptRecord[] => {
  const swept: SweptRecord[] = []

  for (const fill of FILLS) {
    for (const anchoring of ANCHORINGS) {
      for (const criteriaCount of CRITERIA_COUNTS) {
        for (const keyDecisionCount of KEY_DECISION_COUNTS) {
          const shapeAt = (criterionTextLength: number, bulkCount: number): SweepShape => ({
            fill: fill.char,
            anchored: anchoring.anchored,
            criteriaCount,
            keyDecisionCount,
            criterionTextLength,
            bulkCount
          })

          const record = (
            criterionTextLength: number,
            bulkCount: number,
            outcome: Outcome,
            measured: Measured | null
          ): SweptRecord => ({
            fill: fill.name,
            anchoring: anchoring.name,
            criteriaCount,
            keyDecisionCount,
            criterionTextLength,
            bulkCount,
            outcome,
            chars: measured === null ? null : measured.chars,
            bytes: measured === null ? null : measured.bytes
          })

          const withinRecordCap = (shape: SweepShape): boolean =>
            serialisedRecordBytes(shape) <= caps.THREAD_RECORD_SERIALISED_MAX_BYTES

          const bulkCount = largestSatisfying(caps.OPEN_RISKS_MAX_ELEMENTS, (candidate) =>
            withinRecordCap(shapeAt(0, candidate))
          )

          if (bulkCount < 0) {
            swept.push(record(0, 0, 'schema-inadmissible', null))
            continue
          }

          const recordCeiling = largestSatisfying(caps.CRITERION_TEXT_MAX, (candidate) =>
            withinRecordCap(shapeAt(candidate, bulkCount))
          )

          const { lengths, frontierLocated } = criterionTextLengthsFor(
            {
              fill: fill.char,
              anchored: anchoring.anchored,
              criteriaCount,
              keyDecisionCount,
              bulkCount
            },
            recordCeiling
          )

          if (!frontierLocated) {
            swept.push(record(-1, bulkCount, 'frontier-not-located', null))
            continue
          }

          for (const criterionTextLength of lengths) {
            const shape = shapeAt(criterionTextLength, bulkCount)
            if (!isAdmissible(shape)) {
              swept.push(record(criterionTextLength, bulkCount, 'schema-inadmissible', null))
              continue
            }
            const measured = measure(shape)
            const withinBoth = measured.chars <= BRIEFING_MAX_CHARS && measured.bytes <= RESUME_PAYLOAD_MAX_BYTES
            swept.push(
              record(
                criterionTextLength,
                bulkCount,
                withinBoth ? 'admissible-within-both-caps' : 'admissible-breaching-a-cap',
                measured
              )
            )
          }
        }
      }
    }
  }

  return swept
}

test('briefing.frontier-sweep-finds-no-record-breaching-the-character-or-byte-cap', (t) => {
  assert.equal(Buffer.byteLength(ASCII_FILL, 'utf8'), 1, 'the ASCII fill must be one byte per character')
  assert.equal(Buffer.byteLength(MULTI_BYTE_FILL, 'utf8'), 3, 'the multi-byte fill must be three bytes per character')
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

  const admissible = swept.filter((record) => record.outcome !== 'schema-inadmissible')
  const breaching = swept.filter((record) => record.outcome === 'admissible-breaching-a-cap')
  const sweptTextLengths = swept.map((record) => record.criterionTextLength)

  t.diagnostic(`frontier sweep classified ${swept.length} records in ${elapsedMs.toFixed(0)}ms`)
  t.diagnostic(`dimension fill: ${FILLS.map((entry) => entry.name).join(', ')}`)
  t.diagnostic(`dimension anchoring: ${ANCHORINGS.map((entry) => entry.name).join(', ')}`)
  t.diagnostic(
    `dimension criteria count: ${CRITERIA_COUNTS.join(', ')} within bounds 0 and ${caps.CRITERIA_RETENTION_MAX_ELEMENTS}`
  )
  t.diagnostic(
    `dimension key-decision count: ${KEY_DECISION_COUNTS.join(', ')} within bounds 0 and ${caps.KEY_DECISIONS_MAX_ELEMENTS}`
  )
  t.diagnostic(
    `dimension criterion text length: per configuration zero, one, the unclipped-render frontier and both its neighbours, the midpoint beyond it, and the longest text the record byte cap admits; observed span ${Math.min(...sweptTextLengths)} to ${Math.max(...sweptTextLengths)} within bounds 0 and ${caps.CRITERION_TEXT_MAX}`
  )
  for (const outcome of OUTCOME_CLASSES) {
    t.diagnostic(`class ${outcome}: ${swept.filter((record) => record.outcome === outcome).length}`)
  }
  for (const held of [...SWEEP_FIXTURE_HELD_FIXED, PAYLOAD_NOTE]) t.diagnostic(`held fixed: ${held}`)
  for (const excluded of SWEEP_FIXTURE_NOT_SWEPT) t.diagnostic(`not swept: ${excluded}`)

  assert.equal(
    Math.max(...sweptTextLengths),
    caps.CRITERION_TEXT_MAX,
    'the criterion text dimension must reach the schema text cap somewhere in the grid, or the sweep never tested the longest admissible criterion text'
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

  assert.equal(
    breaching.length,
    0,
    [
      `${breaching.length} of ${swept.length} swept records exceeded the ${BRIEFING_MAX_CHARS} character cap or the ${RESUME_PAYLOAD_MAX_BYTES} resume-payload byte cap`,
      ...worstPerFill.map((record) => `worst ${record.fill}: ${describe(record)}`),
      ...worstFirst.slice(0, 5).map((record) => `breaching: ${describe(record)}`)
    ].join('\n')
  )
})
