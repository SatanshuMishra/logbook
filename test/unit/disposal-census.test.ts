import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { census, type Classified } from '../support/census.ts'

type Verdict = Classified<unknown>['verdict'] | 'unclassifiable'
type RegisterName = 'FILED' | 'NEW'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PLAN_DIR = path.join(ROOT, 'docs', 'plans', '2026-08-28-continuity-goal-model')
const REGISTER_PATH = path.join(ROOT, 'docs', 'registers', 'continuity-goal-model-disposal.json')

const REGISTERS: readonly RegisterName[] = ['FILED', 'NEW']

const DOCUMENTS: Record<RegisterName, string> = {
  FILED: path.join(PLAN_DIR, 'FILED.md'),
  NEW: path.join(PLAN_DIR, 'NEW-CRITERIA.md')
}

const LEGAL_CLASSES: Record<RegisterName, readonly string[]> = {
  FILED: ['shipped-here', 'bound', 'closed'],
  NEW: ['shipped-here', 'own-thread']
}

const EVIDENCE_REQUIREMENT: Record<string, string> = {
  'shipped-here': 'a non-empty "evidence" string',
  'own-thread': 'a 26-character Crockford base32 ULID in "thread_id", and the same shape in "decision_id" when it is present',
  bound: 'a "ruling" matching OR<number> and a "unit" matching U<number> with an optional -<LETTER> suffix',
  closed: 'a non-empty "reason" string'
}

const PENDING = 'pending'
const HEADING_PATTERN = /^## (\S+) — (.+)$/
const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
const RULING_PATTERN = /^OR\d+$/
const UNIT_PATTERN = /^U\d+(-[A-Z])?$/

type Heading = { register: RegisterName; ordinal: number; id: string; title: string; line: number }

const readHeadings = (register: RegisterName): Heading[] => {
  const file = DOCUMENTS[register]
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch (cause) {
    throw new Error(`disposal-census: could not read the ${register} document at ${file}: ${String(cause)}`)
  }
  const headings: Heading[] = []
  const lines = text.split('\n')
  for (const [index, line] of lines.entries()) {
    const matched = HEADING_PATTERN.exec(line)
    if (matched === null) continue
    const id = matched[1]
    const title = matched[2]
    if (id === undefined || title === undefined) {
      throw new Error(`disposal-census: ${file}:${index + 1} matched a heading but yielded no identifier or title: ${line}`)
    }
    headings.push({ register, ordinal: headings.length + 1, id, title, line: index + 1 })
  }
  return headings
}

const allHeadings = (): Record<RegisterName, Heading[]> => ({
  FILED: readHeadings('FILED'),
  NEW: readHeadings('NEW')
})

type RegisterEntry = {
  register: RegisterName
  index: number
  ordinal: number
  id: string
  disposalClass: string
  raw: Record<string, unknown>
}

type DisposalRegister = { complete: boolean; entries: Record<RegisterName, RegisterEntry[]> }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parseEntry = (register: RegisterName, index: number, raw: unknown): RegisterEntry => {
  const where = `${REGISTER_PATH}: ${register}[${index}]`
  if (!isPlainObject(raw)) {
    throw new Error(`disposal-census: ${where} is not an object; every register entry must be an object`)
  }
  const { ordinal, id, class: disposalClass } = raw
  if (typeof ordinal !== 'number' || !Number.isFinite(ordinal)) {
    throw new Error(`disposal-census: ${where} has no finite numeric "ordinal"; found ${JSON.stringify(ordinal)}`)
  }
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`disposal-census: ${where} has no non-empty string "id"; found ${JSON.stringify(id)}`)
  }
  if (typeof disposalClass !== 'string' || disposalClass.length === 0) {
    throw new Error(`disposal-census: ${where} has no non-empty string "class"; found ${JSON.stringify(disposalClass)}`)
  }
  return { register, index, ordinal, id, disposalClass, raw }
}

const parseRegisterArray = (register: RegisterName, raw: Record<string, unknown>): RegisterEntry[] => {
  const list = raw[register]
  if (!Array.isArray(list)) {
    throw new Error(`disposal-census: ${REGISTER_PATH} has no "${register}" array; found ${JSON.stringify(list)}`)
  }
  return list.map((entry, index) => parseEntry(register, index, entry))
}

const loadRegister = (): DisposalRegister => {
  let text: string
  try {
    text = readFileSync(REGISTER_PATH, 'utf8')
  } catch (cause) {
    throw new Error(`disposal-census: could not read the disposal register at ${REGISTER_PATH}: ${String(cause)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`disposal-census: ${REGISTER_PATH} is not valid JSON: ${String(cause)}`)
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`disposal-census: ${REGISTER_PATH} must hold a JSON object at its root`)
  }
  const complete = parsed.disposal_complete
  if (typeof complete !== 'boolean') {
    throw new Error(
      `disposal-census: ${REGISTER_PATH} has no boolean "disposal_complete"; found ${JSON.stringify(complete)}`
    )
  }
  return {
    complete,
    entries: { FILED: parseRegisterArray('FILED', parsed), NEW: parseRegisterArray('NEW', parsed) }
  }
}

const firstFailure = <T>(items: T[], classify: (item: T) => Verdict, describe: (item: T) => string): string => {
  for (const item of items) {
    if (classify(item) !== 'allowed') return describe(item)
  }
  return 'no item failed this census'
}

const halts = <T>(items: T[], classify: (item: T) => Verdict, describe: (item: T) => string): void => {
  assert.doesNotThrow(() => census(items, classify), firstFailure(items, classify, describe))
}

const guardNonEmpty = (headings: Record<RegisterName, Heading[]>, entries: Record<RegisterName, RegisterEntry[]>): void => {
  for (const register of REGISTERS) {
    assert.ok(
      headings[register].length > 0,
      `disposal-census: ${DOCUMENTS[register]} yielded no "## <id> — <title>" headings; a census over an empty population proves nothing`
    )
    assert.ok(
      entries[register].length > 0,
      `disposal-census: ${REGISTER_PATH} carries no ${register} entries; a census over an empty population proves nothing`
    )
  }
}

type Pairing = {
  register: RegisterName
  ordinal: number
  heading: Heading | null
  entry: RegisterEntry | null
}

const pairByOrdinal = (
  headings: Record<RegisterName, Heading[]>,
  entries: Record<RegisterName, RegisterEntry[]>
): Pairing[] =>
  REGISTERS.flatMap((register) => {
    const byOrdinal = new Map<number, Heading>(headings[register].map((heading) => [heading.ordinal, heading]))
    const entriesByOrdinal = new Map<number, RegisterEntry>(entries[register].map((entry) => [entry.ordinal, entry]))
    const ordinals = [...new Set([...byOrdinal.keys(), ...entriesByOrdinal.keys()])].sort((a, b) => a - b)
    return ordinals.map((ordinal) => ({
      register,
      ordinal,
      heading: byOrdinal.get(ordinal) ?? null,
      entry: entriesByOrdinal.get(ordinal) ?? null
    }))
  })

const classifyPairing = (pairing: Pairing): Verdict =>
  pairing.heading === null || pairing.entry === null ? 'unclassifiable' : 'allowed'

const describePairing = (pairing: Pairing): string => {
  const { register, ordinal, heading, entry } = pairing
  if (heading === null) {
    return `disposal-census: ${register} ordinal ${ordinal} — the disposal register carries an entry for "${entry?.id ?? 'an unnamed item'}", but ${DOCUMENTS[register]} has no heading at that ordinal`
  }
  if (entry === null) {
    return `disposal-census: ${register} ordinal ${ordinal} — "${heading.id}" titled "${heading.title}" (${DOCUMENTS[register]}:${heading.line}) has no entry in the disposal register, so its disposal is unrecorded`
  }
  return `disposal-census: ${register} ordinal ${ordinal} is paired`
}

const classifyIdentity = (pairing: Pairing): Verdict => {
  const { heading, entry } = pairing
  if (heading === null || entry === null) return 'allowed'
  return entry.id === heading.id ? 'allowed' : 'unclassifiable'
}

const describeIdentity = (pairing: Pairing): string => {
  const { register, ordinal, heading, entry } = pairing
  if (heading === null || entry === null) return `disposal-census: ${register} ordinal ${ordinal} has no pair to compare`
  return `disposal-census: ${register} ordinal ${ordinal} — the disposal register names "${entry.id}", but the heading at that ordinal is "${heading.id}" titled "${heading.title}" (${DOCUMENTS[register]}:${heading.line}); an item was inserted, removed or renamed and the register no longer lines up`
}

const classifyClass = (entry: RegisterEntry): Verdict => {
  if (entry.disposalClass === PENDING) return 'allowed'
  return LEGAL_CLASSES[entry.register].includes(entry.disposalClass) ? 'allowed' : 'unclassifiable'
}

const registerWhereClassIsLegal = (disposalClass: string, exclude: RegisterName): RegisterName | null => {
  for (const candidate of REGISTERS) {
    if (candidate === exclude) continue
    if (LEGAL_CLASSES[candidate].includes(disposalClass)) return candidate
  }
  return null
}

const describeClass = (entry: RegisterEntry): string => {
  const { register, ordinal, id, disposalClass } = entry
  const legal = LEGAL_CLASSES[register].map((name) => `"${name}"`).join(', ')
  const elsewhere = registerWhereClassIsLegal(disposalClass, register)
  const aside =
    elsewhere === null
      ? ''
      : `; "${disposalClass}" is a ${elsewhere}-only disposal class and carries no meaning in ${register}`
  return `disposal-census: ${register} ordinal ${ordinal} ("${id}") has class "${disposalClass}", which ${register} does not accept; ${register} accepts ${legal}, or the sentinel "${PENDING}" while the disposal is undecided${aside}`
}

const isNonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.trim().length > 0

const matches = (pattern: RegExp, value: unknown): boolean => typeof value === 'string' && pattern.test(value)

const hasRequiredEvidence = (entry: RegisterEntry): boolean => {
  const { raw } = entry
  switch (entry.disposalClass) {
    case 'shipped-here':
      return isNonEmptyString(raw.evidence)
    case 'own-thread':
      return matches(ULID_PATTERN, raw.thread_id) && (raw.decision_id === undefined || matches(ULID_PATTERN, raw.decision_id))
    case 'bound':
      return matches(RULING_PATTERN, raw.ruling) && matches(UNIT_PATTERN, raw.unit)
    case 'closed':
      return isNonEmptyString(raw.reason)
    default:
      return false
  }
}

const classifyEvidence = (entry: RegisterEntry): Verdict => (hasRequiredEvidence(entry) ? 'allowed' : 'unclassifiable')

const describeEvidence = (entry: RegisterEntry): string => {
  const { register, ordinal, id, disposalClass, raw } = entry
  const requirement = EVIDENCE_REQUIREMENT[disposalClass] ?? 'evidence this census does not know how to check'
  const carried = Object.keys(raw)
    .filter((key) => key !== 'ordinal' && key !== 'id' && key !== 'class')
    .map((key) => `${key}=${JSON.stringify(raw[key])}`)
    .join(', ')
  const found = carried.length === 0 ? 'no evidence field at all' : carried
  return `disposal-census: ${register} ordinal ${ordinal} ("${id}") is disposed as "${disposalClass}", which requires ${requirement}; it carries ${found}`
}

const isDisposed = (entry: RegisterEntry): boolean =>
  entry.disposalClass !== PENDING && LEGAL_CLASSES[entry.register].includes(entry.disposalClass)

type OrdinalItem = { register: RegisterName; ordinal: number; id: string; occurrences: number; total: number }

const ordinalItems = (entries: Record<RegisterName, RegisterEntry[]>): OrdinalItem[] =>
  REGISTERS.flatMap((register) => {
    const list = entries[register]
    const occurrences = new Map<number, number>()
    for (const entry of list) occurrences.set(entry.ordinal, (occurrences.get(entry.ordinal) ?? 0) + 1)
    return list.map((entry) => ({
      register,
      ordinal: entry.ordinal,
      id: entry.id,
      occurrences: occurrences.get(entry.ordinal) ?? 0,
      total: list.length
    }))
  })

const classifyOrdinal = (item: OrdinalItem): Verdict => {
  if (!Number.isInteger(item.ordinal)) return 'unclassifiable'
  if (item.ordinal < 1 || item.ordinal > item.total) return 'unclassifiable'
  return item.occurrences === 1 ? 'allowed' : 'unclassifiable'
}

const describeOrdinal = (item: OrdinalItem): string => {
  const { register, ordinal, id, occurrences, total } = item
  if (!Number.isInteger(ordinal)) {
    return `disposal-census: ${register} entry "${id}" has ordinal ${ordinal}, which is not a whole number`
  }
  if (ordinal < 1 || ordinal > total) {
    return `disposal-census: ${register} entry "${id}" has ordinal ${ordinal}, outside 1..${total}, so the ordinals cannot run contiguously from 1`
  }
  return `disposal-census: ${register} ordinal ${ordinal} appears ${occurrences} times (entry "${id}"); each ordinal must appear exactly once, because ordinal is what keys an item when two items share an identifier`
}

const declarationMatchesData = (complete: boolean, pendingCount: number): boolean => complete === (pendingCount === 0)

test('disposal-census.every-heading-in-both-registers-has-exactly-one-disposal-entry-and-back', () => {
  const headings = allHeadings()
  const { entries } = loadRegister()
  guardNonEmpty(headings, entries)
  halts(pairByOrdinal(headings, entries), classifyPairing, describePairing)
})

test('disposal-census.every-heading-in-both-registers-has-exactly-one-disposal-entry-and-back.control.a-heading-without-an-entry-and-an-entry-without-a-heading-both-halt', () => {
  const heading: Heading = { register: 'FILED', ordinal: 7, id: 'F6a', title: 'a filed item', line: 132 }
  const entry: RegisterEntry = {
    register: 'FILED',
    index: 6,
    ordinal: 7,
    id: 'F6a',
    disposalClass: PENDING,
    raw: { ordinal: 7, id: 'F6a', class: PENDING }
  }
  assert.equal(classifyPairing({ register: 'FILED', ordinal: 7, heading, entry }), 'allowed')
  assert.equal(classifyPairing({ register: 'FILED', ordinal: 7, heading, entry: null }), 'unclassifiable')
  assert.equal(classifyPairing({ register: 'FILED', ordinal: 7, heading: null, entry }), 'unclassifiable')
  assert.match(describePairing({ register: 'FILED', ordinal: 7, heading, entry: null }), /ordinal 7 — "F6a" titled "a filed item"/)
})

test('disposal-census.each-entry-names-the-identifier-of-the-heading-at-its-ordinal', () => {
  const headings = allHeadings()
  const { entries } = loadRegister()
  guardNonEmpty(headings, entries)
  halts(pairByOrdinal(headings, entries), classifyIdentity, describeIdentity)
})

test('disposal-census.each-entry-names-the-identifier-of-the-heading-at-its-ordinal.control.an-identifier-that-drifts-from-its-ordinal-halts', () => {
  const heading: Heading = { register: 'FILED', ordinal: 12, id: 'F6a', title: 'a third private copy', line: 132 }
  const entryFor = (id: string): RegisterEntry => ({
    register: 'FILED',
    index: 11,
    ordinal: 12,
    id,
    disposalClass: PENDING,
    raw: { ordinal: 12, id, class: PENDING }
  })
  assert.equal(classifyIdentity({ register: 'FILED', ordinal: 12, heading, entry: entryFor('F6a') }), 'allowed')
  assert.equal(classifyIdentity({ register: 'FILED', ordinal: 12, heading, entry: entryFor('F6b') }), 'unclassifiable')
  assert.match(
    describeIdentity({ register: 'FILED', ordinal: 12, heading, entry: entryFor('F6b') }),
    /names "F6b", but the heading at that ordinal is "F6a"/
  )
})

test('disposal-census.every-class-is-legal-for-the-register-it-appears-in-or-is-the-pending-sentinel', () => {
  const headings = allHeadings()
  const { entries } = loadRegister()
  guardNonEmpty(headings, entries)
  halts([...entries.FILED, ...entries.NEW], classifyClass, describeClass)
})

test('disposal-census.every-class-is-legal-for-the-register-it-appears-in-or-is-the-pending-sentinel.control.a-filed-only-class-on-a-new-entry-halts-and-is-named', () => {
  const newEntry = (disposalClass: string): RegisterEntry => ({
    register: 'NEW',
    index: 0,
    ordinal: 1,
    id: 'N1',
    disposalClass,
    raw: { ordinal: 1, id: 'N1', class: disposalClass }
  })
  const filedEntry = (disposalClass: string): RegisterEntry => ({
    register: 'FILED',
    index: 0,
    ordinal: 1,
    id: 'F3a',
    disposalClass,
    raw: { ordinal: 1, id: 'F3a', class: disposalClass }
  })
  assert.equal(classifyClass(newEntry(PENDING)), 'allowed')
  assert.equal(classifyClass(newEntry('own-thread')), 'allowed')
  assert.equal(classifyClass(newEntry('bound')), 'unclassifiable')
  assert.equal(classifyClass(newEntry('closed')), 'unclassifiable')
  assert.equal(classifyClass(filedEntry('bound')), 'allowed')
  assert.equal(classifyClass(filedEntry('own-thread')), 'unclassifiable')
  assert.equal(classifyClass(filedEntry('absorbed-into-a-unit')), 'unclassifiable')
  assert.match(describeClass(newEntry('bound')), /"bound" is a FILED-only disposal class and carries no meaning in NEW/)
  assert.doesNotMatch(describeClass(filedEntry('absorbed-into-a-unit')), /only disposal class/)
})

test('disposal-census.every-disposed-entry-carries-the-evidence-its-class-requires', () => {
  const headings = allHeadings()
  const { entries } = loadRegister()
  guardNonEmpty(headings, entries)
  halts([...entries.FILED, ...entries.NEW].filter(isDisposed), classifyEvidence, describeEvidence)
})

test('disposal-census.every-disposed-entry-carries-the-evidence-its-class-requires.control.each-class-refuses-the-wrong-evidence', () => {
  const entryOf = (register: RegisterName, disposalClass: string, evidence: Record<string, unknown>): RegisterEntry => {
    const id = register === 'FILED' ? 'F3a' : 'N1'
    return { register, index: 0, ordinal: 1, id, disposalClass, raw: { ordinal: 1, id, class: disposalClass, ...evidence } }
  }
  const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
  const threadOnly = entryOf('NEW', 'own-thread', { thread_id: ulid })
  const threadAndDecision = entryOf('NEW', 'own-thread', { thread_id: ulid, decision_id: ulid })
  const threadWithSlugDecision = entryOf('NEW', 'own-thread', { thread_id: ulid, decision_id: 'not-a-ulid' })
  const threadWithSlug = entryOf('NEW', 'own-thread', { thread_id: 'a-slug-not-a-ulid' })
  const threadWithNonCrockfordLetter = entryOf('NEW', 'own-thread', { thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAU' })
  const boundWithoutUnit = entryOf('FILED', 'bound', { ruling: 'OR18' })
  const closedWithoutReason = entryOf('FILED', 'closed', {})

  assert.equal(classifyEvidence(entryOf('FILED', 'shipped-here', { evidence: 'landed in the census test' })), 'allowed')
  assert.equal(classifyEvidence(entryOf('FILED', 'shipped-here', { evidence: '  ' })), 'unclassifiable')
  assert.equal(classifyEvidence(entryOf('FILED', 'shipped-here', {})), 'unclassifiable')

  assert.equal(classifyEvidence(threadOnly), 'allowed')
  assert.equal(classifyEvidence(threadAndDecision), 'allowed')
  assert.equal(classifyEvidence(threadWithSlugDecision), 'unclassifiable')
  assert.equal(classifyEvidence(threadWithSlug), 'unclassifiable')
  assert.equal(classifyEvidence(threadWithNonCrockfordLetter), 'unclassifiable')

  assert.equal(classifyEvidence(entryOf('FILED', 'bound', { ruling: 'OR18', unit: 'U9' })), 'allowed')
  assert.equal(classifyEvidence(entryOf('FILED', 'bound', { ruling: 'OR18', unit: 'U9-E' })), 'allowed')
  assert.equal(classifyEvidence(boundWithoutUnit), 'unclassifiable')
  assert.equal(classifyEvidence(entryOf('FILED', 'bound', { unit: 'U9' })), 'unclassifiable')
  assert.equal(classifyEvidence(entryOf('FILED', 'bound', { ruling: '18', unit: 'U9' })), 'unclassifiable')
  assert.equal(classifyEvidence(entryOf('FILED', 'bound', { ruling: 'OR18', unit: 'unit nine' })), 'unclassifiable')

  assert.equal(classifyEvidence(entryOf('FILED', 'closed', { reason: 'superseded by the rewrite' })), 'allowed')
  assert.equal(classifyEvidence(closedWithoutReason), 'unclassifiable')

  assert.match(describeEvidence(boundWithoutUnit), /requires a "ruling" matching OR<number>/)
  assert.match(describeEvidence(closedWithoutReason), /carries no evidence field at all/)
})

test('disposal-census.ordinals-are-unique-within-a-register-and-run-contiguously-from-one', () => {
  const headings = allHeadings()
  const { entries } = loadRegister()
  guardNonEmpty(headings, entries)
  halts(ordinalItems(entries), classifyOrdinal, describeOrdinal)
})

test('disposal-census.ordinals-are-unique-within-a-register-and-run-contiguously-from-one.control.a-repeated-a-zero-and-an-overrun-ordinal-all-halt', () => {
  const item = (ordinal: number, occurrences: number, total: number): OrdinalItem => ({
    register: 'FILED',
    ordinal,
    id: 'F6a',
    occurrences,
    total
  })
  assert.equal(classifyOrdinal(item(1, 1, 3)), 'allowed')
  assert.equal(classifyOrdinal(item(1, 2, 3)), 'unclassifiable')
  assert.equal(classifyOrdinal(item(0, 1, 3)), 'unclassifiable')
  assert.equal(classifyOrdinal(item(4, 1, 3)), 'unclassifiable')
  assert.equal(classifyOrdinal(item(1.5, 1, 3)), 'unclassifiable')
  assert.match(describeOrdinal(item(1, 2, 3)), /ordinal 1 appears 2 times/)
  assert.match(describeOrdinal(item(4, 1, 3)), /outside 1\.\.3/)
})

test('disposal-census.the-disposal-complete-flag-is-true-exactly-when-nothing-is-pending', () => {
  const headings = allHeadings()
  const { complete, entries } = loadRegister()
  guardNonEmpty(headings, entries)
  const all = [...entries.FILED, ...entries.NEW]
  const pending = all.filter((entry) => entry.disposalClass === PENDING)
  const first = pending[0]
  const detail =
    first === undefined
      ? `disposal-census: every one of the ${all.length} register entries is disposed, so "disposal_complete" must be true, but ${REGISTER_PATH} declares false`
      : `disposal-census: ${pending.length} of ${all.length} register entries are still pending, the first being ${first.register} ordinal ${first.ordinal} ("${first.id}"), so "disposal_complete" must be false, but ${REGISTER_PATH} declares true`
  assert.equal(declarationMatchesData(complete, pending.length), true, detail)
})

test('disposal-census.the-disposal-complete-flag-is-true-exactly-when-nothing-is-pending.control.the-flag-cannot-be-flipped-to-silence-a-pending-item', () => {
  assert.equal(declarationMatchesData(false, 7), true)
  assert.equal(declarationMatchesData(true, 0), true)
  assert.equal(declarationMatchesData(true, 1), false)
  assert.equal(declarationMatchesData(false, 0), false)
})
