import test from 'node:test'
import assert from 'node:assert/strict'
import * as caps from '../../src/schema/caps.ts'
import { unparseableRecordsRefusal } from '../../src/server/tools/sync_ledger.ts'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES } from '../../src/render/clip.ts'

const NEWLINE = '\u000A'
const BELL = '\u0007'
const RIGHT_TO_LEFT_OVERRIDE = '\u202E'
const ESCAPED_BELL = 'U+0007'

test('sync-ledger-refusal.names-the-record-the-operator-has-to-fix', () => {
  const record = 'decisions/a-record-this-version-cannot-read.json'
  const refusal = unparseableRecordsRefusal([record])

  assert.equal(refusal.ok, false)
  assert.equal(refusal.field, 'sync')
  assert.equal(refusal.retryable, false)
  assert.ok(
    refusal.message.includes(record),
    `the operator must be told which record file could not be read, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.escapes-a-hostile-record-name', () => {
  const hostile = `decisions/bad${NEWLINE}${BELL}${RIGHT_TO_LEFT_OVERRIDE}name.json`
  const refusal = unparseableRecordsRefusal([hostile])

  assert.ok(
    refusal.message.includes('decisions/badU+000AU+0007U+202Ename.json'),
    `a remote-controlled record name must be escaped before the operator reads it, but the message read: ${refusal.message}`
  )
  assert.equal(
    refusal.message.includes(NEWLINE),
    false,
    'a newline inside a record name must not reach the rendered refusal'
  )
  assert.equal(
    refusal.message.includes(BELL),
    false,
    'a control character inside a record name must not reach the rendered refusal'
  )
  assert.equal(
    refusal.message.includes(RIGHT_TO_LEFT_OVERRIDE),
    false,
    'a bidi override inside a record name must not reach the rendered refusal'
  )
})

test('sync-ledger-refusal.clips-an-over-long-record-name', () => {
  const overLong = 'y'.repeat(caps.UNPARSEABLE_RECORD_NAME_MAX + 40)
  const refusal = unparseableRecordsRefusal([overLong])
  const budget = caps.UNPARSEABLE_RECORD_NAME_MAX - CLIP_MARKER_GRAPHEMES

  assert.ok(
    refusal.message.includes('y'.repeat(budget)),
    `the refusal must still show the record name up to its shortened budget, but the message read: ${refusal.message}`
  )
  assert.equal(
    refusal.message.includes('y'.repeat(budget + 1)),
    false,
    `a record name longer than its cap must be clipped, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.marks-a-shortened-record-name-with-the-clip-marker', () => {
  const overLong = 'y'.repeat(caps.UNPARSEABLE_RECORD_NAME_MAX + 40)
  const refusal = unparseableRecordsRefusal([overLong])
  const budget = caps.UNPARSEABLE_RECORD_NAME_MAX - CLIP_MARKER_GRAPHEMES
  const expected = `${'y'.repeat(budget)}${CLIP_MARKER}`

  assert.ok(
    refusal.message.includes(expected),
    `a shortened record name must show its budget of content followed by the clip marker and nothing more, but the message read: ${refusal.message}`
  )
  assert.equal(
    refusal.message.includes(`${'y'.repeat(budget + 1)}${CLIP_MARKER}`),
    false,
    `a shortened record name must not carry one more character of content than its budget, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.clips-a-record-name-after-escaping-has-expanded-it', () => {
  const controlHeavy = BELL.repeat(caps.UNPARSEABLE_RECORD_NAME_MAX)
  const refusal = unparseableRecordsRefusal([controlHeavy])
  const escapedCount = refusal.message.split(ESCAPED_BELL).length - 1
  const renderedLength = escapedCount * ESCAPED_BELL.length

  assert.ok(
    escapedCount > 0,
    `the refusal must still show the escaped record name, but the message read: ${refusal.message}`
  )
  assert.ok(
    renderedLength <= caps.UNPARSEABLE_RECORD_NAME_MAX,
    `escaping one control character into ${ESCAPED_BELL.length} characters must happen before the clip, or the cap stops bounding the rendered name: the name rendered ${renderedLength} characters against a cap of ${caps.UNPARSEABLE_RECORD_NAME_MAX}`
  )
})

test('sync-ledger-refusal.counts-the-records-it-did-not-show', () => {
  const extra = 3
  const records = Array.from(
    { length: caps.UNPARSEABLE_RECORDS_SHOWN_MAX + extra },
    (_, index) => `decisions/unreadable-${index}.json`
  )
  const refusal = unparseableRecordsRefusal(records)

  for (const record of records.slice(0, caps.UNPARSEABLE_RECORDS_SHOWN_MAX)) {
    assert.ok(
      refusal.message.includes(record),
      `the refusal must name ${record}, but the message read: ${refusal.message}`
    )
  }
  for (const record of records.slice(caps.UNPARSEABLE_RECORDS_SHOWN_MAX)) {
    assert.equal(
      refusal.message.includes(record),
      false,
      `the refusal must show at most ${caps.UNPARSEABLE_RECORDS_SHOWN_MAX} record names, but the message read: ${refusal.message}`
    )
  }
  assert.ok(
    refusal.message.includes(`(+${extra} more)`),
    `the refusal must say honestly how many record names it withheld, but the message read: ${refusal.message}`
  )
  assert.ok(
    refusal.message.includes(String(records.length)),
    `the refusal must say how many record files could not be read, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.annotates-a-record-name-this-version-would-not-write', () => {
  const genuine = 'decisions/01M0NDPM0ACCR9CD68PMHYWGGD.json'
  const homoglyph = `decisions/01M0NDPM0аCCR9CD68PMHYWGGD.json`
  const annotation = ' (not a name this version writes)'

  const genuineRefusal = unparseableRecordsRefusal([genuine])
  assert.equal(
    genuineRefusal.message.includes(annotation),
    false,
    `a genuine record name this version writes must not carry the annotation, but the message read: ${genuineRefusal.message}`
  )

  const homoglyphRefusal = unparseableRecordsRefusal([homoglyph])
  assert.ok(
    homoglyphRefusal.message.includes(annotation),
    `a record name outside the shape this version writes must carry the annotation, but the message read: ${homoglyphRefusal.message}`
  )
})
