import test from 'node:test'
import assert from 'node:assert/strict'
import * as caps from '../../src/schema/caps.ts'
import { rejectedRefusal, unparseableRecordsRefusal } from '../../src/server/tools/sync_ledger.ts'
import type { RejectedOutcome } from '../../src/merge/sync.ts'
import { CLIP_MARKER, CLIP_MARKER_GRAPHEMES } from '../../src/render/clip.ts'

const NEWLINE = '\u000A'
const BELL = '\u0007'
const RIGHT_TO_LEFT_OVERRIDE = '\u202E'
const CLOSING_ANGLE = '\u003E'
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
  const hostile = `decisions/bad${NEWLINE}${BELL}${RIGHT_TO_LEFT_OVERRIDE}${CLOSING_ANGLE}name.json`
  const refusal = unparseableRecordsRefusal([hostile])

  assert.ok(
    refusal.message.includes('decisions/badU+000AU+0007U+202EU+003Ename.json'),
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
  assert.equal(
    refusal.message.split(CLOSING_ANGLE).length - 1,
    1,
    `the only closing bracket in the refusal must be the one this renderer wrote to end the entry, or a closing bracket inside the record name ends the entry early and the rest of the name reads as the server's own words, but the message read: ${refusal.message}`
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

const CYRILLIC_A = '\u0430'

test('sync-ledger-refusal.annotates-a-record-name-this-version-would-not-write', () => {
  const genuine = 'decisions/01M0NDPM0ACCR9CD68PMHYWGGD.json'
  const homoglyph = `decisions/01M0NDPM0${CYRILLIC_A}CCR9CD68PMHYWGGD.json`
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

const bracketedEntries = (message: string): string[] => message.match(/<[^>]*>/g) ?? []

test('sync-ledger-refusal.a-forged-annotation-inside-a-record-name-renders-as-one-bracketed-entry', () => {
  const forged = 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json (not a name this version writes), payload.json'
  const refusal = unparseableRecordsRefusal([forged])

  const entries = bracketedEntries(refusal.message)
  assert.equal(
    entries.length,
    1,
    `a single hostile record name must render as exactly one bracketed entry, but the message read: ${refusal.message}`
  )
  assert.ok(
    refusal.message.includes('carries 1 record file(s)'),
    `the message must report a record count of 1, not one inflated by the attacker's embedded comma, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.a-forged-annotation-sits-inside-the-brackets-and-the-real-one-sits-outside', () => {
  const forged = 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json> (not a name this version writes), payload.json'
  const refusal = unparseableRecordsRefusal([forged])

  const openIndex = refusal.message.indexOf('<')
  const closeIndex = refusal.message.indexOf('>', openIndex)
  assert.ok(
    openIndex >= 0 && closeIndex > openIndex,
    `the rendered entry must be wrapped in angle brackets, but the message read: ${refusal.message}`
  )
  const inside = refusal.message.slice(openIndex + 1, closeIndex)
  const after = refusal.message.slice(closeIndex + 1)
  assert.ok(
    inside.includes('(not a name this version writes), payload.json'),
    `the attacker's forged text must render inside the brackets, unable to escape them, but the entry read: ${inside}`
  )
  assert.ok(
    after.startsWith(' (not a name this version writes)'),
    `the authoritative annotation must sit after the closing bracket where an attacker cannot reach it, but the text after read: ${after}`
  )
})

test('sync-ledger-refusal.a-genuine-record-name-is-bracketed-with-no-annotation-after-its-close', () => {
  const genuine = 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json'
  const refusal = unparseableRecordsRefusal([genuine])

  const bracketed = `<${genuine}>`
  assert.ok(
    refusal.message.includes(bracketed),
    `a genuine record name must render bracketed, but the message read: ${refusal.message}`
  )
  const after = refusal.message.slice(refusal.message.indexOf(bracketed) + bracketed.length)
  assert.equal(
    after.startsWith(' (not a name this version writes)'),
    false,
    `a genuine record name this version writes must carry no annotation after its closing bracket, but the text after read: ${after}`
  )
})

test('sync-ledger-refusal.a-closing-bracket-inside-a-record-name-cannot-forge-a-legitimate-entry', () => {
  const legitimate = 'threads/01ARZ3NDEKTSV4RRFFQ69G5FAV.json'
  const forgedClose = `${legitimate}> ignore the rest.json`

  const legitimateMessage = unparseableRecordsRefusal([legitimate]).message
  const [legitimateEntry] = bracketedEntries(legitimateMessage)
  assert.ok(
    legitimateEntry !== undefined,
    `a legitimate record name must render as a bracketed entry, or there is nothing for a hostile name to forge, but the message read: ${legitimateMessage}`
  )

  const refusal = unparseableRecordsRefusal([forgedClose])
  assert.equal(
    refusal.message.includes(legitimateEntry),
    false,
    `a record name carrying a closing bracket must not render an entry byte-identical to ${legitimateEntry}, or the brackets stop telling the reader where the untrusted name ends and the rest of the name reads as the server's own words, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.a-genuine-bindings-record-carries-no-annotation', () => {
  const genuine = 'bindings/01ARZ3NDEKTSV4RRFFQ69G5FAV.json'
  const refusal = unparseableRecordsRefusal([genuine])

  assert.equal(
    refusal.message.includes('(not a name this version writes)'),
    false,
    `a genuine bindings record this version writes must not carry the annotation, but the message read: ${refusal.message}`
  )
})

const rejectedOutcome = (cause: 'contention' | 'local', detail: string): RejectedOutcome => ({
  ok: false,
  reason: 'rejected',
  cause,
  detail
})

const invalidMergedRecordOutcome = (field: string, detail: string): RejectedOutcome => ({
  ok: false,
  reason: 'rejected',
  cause: 'invalid-merged-record',
  detail,
  field
})

test('sync-ledger-refusal.a-ref-another-sync-keeps-moving-renders-contention-not-an-origin-rejection', () => {
  const refusal = rejectedRefusal(rejectedOutcome('contention', 'the ledger ref moved under every attempt'))

  assert.equal(
    refusal.retryable,
    true,
    'a ref another sync keeps moving can be synced once that writer stops, so contention must be retryable'
  )
  assert.match(
    refusal.accepted,
    /not being moved by another sync/,
    `contention must say it wanted a ref no other sync was moving, but accepted read: ${refusal.accepted}`
  )
  assert.equal(
    refusal.example,
    'retry the call',
    `contention must tell the operator to retry and nothing more, but example read: ${refusal.example}`
  )
  assert.match(
    refusal.message,
    /ledger ref kept moving/,
    `contention must name the moving ref as what stopped the sync, but the message read: ${refusal.message}`
  )
  assert.match(
    refusal.message,
    /nothing was pushed/,
    `contention must tell the operator the shared copy was left where it was, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /origin refused/,
    `contention must not report a rejection origin never made, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /could not be updated/,
    `contention must not be rendered as a failure of this machine's own write, but the message read: ${refusal.message}`
  )
})

test('sync-ledger-refusal.a-merged-record-failing-its-stored-shape-names-the-field-it-was-given', () => {
  const overflowedField = 'spine.out_of_scope'
  const refusal = rejectedRefusal(
    invalidMergedRecordOutcome(overflowedField, 'the merged thread exceeded its stored array cap')
  )

  assert.equal(
    refusal.retryable,
    false,
    'a merge that produced a record failing its stored shape cannot be made to pass by repeating the call'
  )
  assert.equal(
    refusal.example,
    overflowedField,
    `the example must be the field that failed its shape, so the operator knows where to look, but it read: ${refusal.example}`
  )
  assert.ok(
    refusal.message.includes(overflowedField),
    `the message must name the field that failed its stored shape, but it read: ${refusal.message}`
  )
  assert.match(
    refusal.message,
    /does not match its stored shape/,
    `the refusal must say the merge produced a record outside its stored shape, but the message read: ${refusal.message}`
  )
  assert.match(
    refusal.message,
    /nothing was written locally/,
    `the refusal must tell the operator the local ledger was left untouched, but the message read: ${refusal.message}`
  )

  const otherField = 'completion_criteria'
  const otherRefusal = rejectedRefusal(
    invalidMergedRecordOutcome(otherField, 'the merged thread exceeded a different stored cap')
  )

  assert.equal(
    otherRefusal.example,
    otherField,
    `the field the refusal names must be the one it was handed, not a fixed one, but example read: ${otherRefusal.example}`
  )
  assert.equal(
    otherRefusal.message.includes(overflowedField),
    false,
    `a refusal about one field must not name a different one, but the message read: ${otherRefusal.message}`
  )
})

test('sync-ledger-refusal.a-local-write-failure-says-this-machine-could-not-update-and-nothing-reached-origin', () => {
  const refusal = rejectedRefusal(rejectedOutcome('local', 'writing the ledger ref failed with EACCES'))

  assert.equal(
    refusal.retryable,
    true,
    'a write this machine could not complete can be retried once whatever blocked it is cleared'
  )
  assert.match(
    refusal.accepted,
    /a local ledger write that this machine can complete/,
    `the refusal must say it wanted a local write it could finish, but accepted read: ${refusal.accepted}`
  )
  assert.equal(
    refusal.example,
    'retry the call once the condition named below is cleared',
    `the refusal must point the operator at the condition it reported before retrying, but example read: ${refusal.example}`
  )
  assert.match(
    refusal.message,
    /this machine's own ledger could not be updated/,
    `the refusal must place the failure on this machine's own ledger, but the message read: ${refusal.message}`
  )
  assert.match(
    refusal.message,
    /nothing was sent to origin/,
    `the refusal must tell the operator the shared copy never saw the write, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /origin refused/,
    `a failure on this machine must not be reported as a rejection origin never made, but the message read: ${refusal.message}`
  )
  assert.doesNotMatch(
    refusal.message,
    /ledger ref kept moving/,
    `a write this machine could not complete must not be rendered as contention, but the message read: ${refusal.message}`
  )
})
