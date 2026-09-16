import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SPEC_REL_PATH = join('docs', 'specs', '2026-08-28-continuity-goal-model.md')
const README_REL_PATH = 'README.md'
const SPEC_PATH = join(PROJECT_ROOT, SPEC_REL_PATH)
const README_PATH = join(PROJECT_ROOT, README_REL_PATH)

const PROMISE_SECTION_HEADING = '### 4.1 Logbook goals — public, and published in the README'
const SECTION_BOUNDARY_PREFIX = '### '
const SINGLE_SESSION_LIMIT_PHRASE = 'single-session-per-project'

export type PromiseRow = { line: number; text: string }
export type PromiseMention = { line: number; token: string; suffix: string }

const SEPARATOR_ROW_PATTERN = /^\|(?:\s*:?-+:?\s*\|)+$/
const HEADER_ROW_PATTERN = /^\|\s*ID\s*\|\s*Promise\s*\|$/
const PROMISE_ROW_PATTERN = /^\|\s*\*\*(LG\d+)\*\*\s*\|\s*\S.*\|$/
const PROMISE_TOKEN_PATTERN = /(?<![A-Za-z0-9])LG([A-Za-z0-9]*)/g
const PROMISE_ID_PATTERN = /^\d+$/

export const promiseTableRows = (spec: string): PromiseRow[] => {
  const lines = spec.split('\n')
  const start = lines.indexOf(PROMISE_SECTION_HEADING)
  if (start === -1) {
    throw new Error(
      `readme.promises: ${SPEC_REL_PATH} carries no line exactly equal to "${PROMISE_SECTION_HEADING}"; the published-promise population cannot be derived`
    )
  }
  const rows: PromiseRow[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const text = lines[index] as string
    if (text.startsWith(SECTION_BOUNDARY_PREFIX)) break
    if (text.startsWith('|')) rows.push({ line: index + 1, text })
  }
  return rows
}

export const promiseIdOf = (row: PromiseRow): string | null => {
  const match = PROMISE_ROW_PATTERN.exec(row.text)
  return match === null ? null : (match[1] as string)
}

export const declaredPromiseIds = (rows: readonly PromiseRow[]): string[] =>
  rows.map(promiseIdOf).filter((id): id is string => id !== null)

export const mentionsPromise = (document: string, id: string): boolean =>
  new RegExp(`(?<![A-Za-z0-9])${id}(?![0-9])`).test(document)

export const classifyPromiseRow = (
  row: PromiseRow,
  readme: string
): Classified<PromiseRow>['verdict'] | 'unclassifiable' => {
  if (SEPARATOR_ROW_PATTERN.test(row.text)) return 'allowed'
  if (HEADER_ROW_PATTERN.test(row.text)) return 'allowed'
  const id = promiseIdOf(row)
  if (id === null) return 'unclassifiable'
  return mentionsPromise(readme, id) ? 'allowed' : 'forbidden'
}

export const promiseMentions = (readme: string): PromiseMention[] => {
  const found: PromiseMention[] = []
  readme.split('\n').forEach((text, index) => {
    for (const match of text.matchAll(PROMISE_TOKEN_PATTERN)) {
      found.push({ line: index + 1, token: match[0] as string, suffix: match[1] as string })
    }
  })
  return found
}

export const classifyPromiseMention = (
  mention: PromiseMention,
  declared: ReadonlySet<string>
): Classified<PromiseMention>['verdict'] | 'unclassifiable' => {
  if (!PROMISE_ID_PATTERN.test(mention.suffix)) return 'unclassifiable'
  return declared.has(mention.token) ? 'allowed' : 'forbidden'
}

const readSpec = (): string => readFileSync(SPEC_PATH, 'utf8')
const readReadme = (): string => readFileSync(README_PATH, 'utf8')

const isHaltedOnUnclassifiable = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census halted on an unclassifiable item')

const isRejectedAsForbidden = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census rejected a forbidden item')

test('contract.readme-publishes-every-published-promise', () => {
  const rows = promiseTableRows(readSpec())
  assert.ok(
    rows.length > 0,
    `readme.promises: ${SPEC_REL_PATH} section 4.1 holds no table row; a census over an empty population proves nothing`
  )

  const ids = declaredPromiseIds(rows)
  assert.ok(
    ids.length > 0,
    `readme.promises: ${SPEC_REL_PATH} section 4.1 declares no promise identifier; a census over an empty population proves nothing`
  )
  assert.equal(
    new Set(ids).size,
    ids.length,
    `readme.promises: ${SPEC_REL_PATH} section 4.1 declares a duplicate identifier, which would shrink the population silently: ${ids.join(', ')}`
  )

  const readme = readReadme()
  assert.ok(readme.length > 0, `readme.promises: ${README_REL_PATH} is empty`)

  assert.doesNotThrow(() => census(rows, (row) => classifyPromiseRow(row, readme)))
})

test('contract.readme-publishes-every-published-promise.control.a-promise-absent-from-the-readme-is-forbidden-and-named', () => {
  const synthetic: PromiseRow[] = [{ line: 1, text: '| **LG99** | **A promise nobody published** |' }]
  assert.equal(classifyPromiseRow(synthetic[0] as PromiseRow, '# a readme naming no promise\n'), 'forbidden')
  assert.throws(
    () => census(synthetic, (row) => classifyPromiseRow(row, '# a readme naming no promise\n')),
    (error: unknown) => isRejectedAsForbidden(error) && (error as Error).message.includes('LG99')
  )
})

test('contract.readme-publishes-every-published-promise.control.an-unparsable-promise-row-halts-the-census', () => {
  const synthetic: PromiseRow[] = [{ line: 1, text: '| LG4 | a row that lost its bold identifier |' }]
  assert.equal(classifyPromiseRow(synthetic[0] as PromiseRow, '**LG4**'), 'unclassifiable')
  assert.throws(() => census(synthetic, (row) => classifyPromiseRow(row, '**LG4**')), isHaltedOnUnclassifiable)
})

test('contract.readme-publishes-every-published-promise.control.a-longer-identifier-does-not-satisfy-a-shorter-one', () => {
  assert.equal(mentionsPromise('**LG17** and **LG10**', 'LG1'), false)
  assert.equal(mentionsPromise('**LG1** and **LG17**', 'LG1'), true)
  assert.equal(mentionsPromise('XLG1X', 'LG1'), false)
})

test('contract.readme-publishes-every-published-promise.control.a-header-row-and-a-separator-row-are-allowed', () => {
  const synthetic: PromiseRow[] = [
    { line: 1, text: '| ID | Promise |' },
    { line: 2, text: '|---|---|' }
  ]
  assert.deepEqual(
    synthetic.map((row) => classifyPromiseRow(row, '')),
    ['allowed', 'allowed']
  )
})

test('contract.readme-names-no-promise-the-spec-does-not-declare', () => {
  const declared = new Set(declaredPromiseIds(promiseTableRows(readSpec())))
  assert.ok(
    declared.size > 0,
    `readme.promises: ${SPEC_REL_PATH} declared no promise identifier, so this census would never consult the specification`
  )

  const mentions = promiseMentions(readReadme())
  assert.ok(
    mentions.length > 0,
    `readme.promises: ${README_REL_PATH} names no promise identifier at all; a census over an empty population proves nothing`
  )

  assert.doesNotThrow(() => census(mentions, (mention) => classifyPromiseMention(mention, declared)))
})

test('contract.readme-names-no-promise-the-spec-does-not-declare.control.an-undeclared-identifier-is-forbidden-and-a-malformed-one-halts', () => {
  const declared = new Set(['LG1'])
  const undeclared = promiseMentions('this readme promises **LG42** to everyone\n')
  assert.equal(undeclared.length, 1)
  assert.equal(classifyPromiseMention(undeclared[0] as PromiseMention, declared), 'forbidden')
  assert.throws(
    () => census(undeclared, (mention) => classifyPromiseMention(mention, declared)),
    (error: unknown) => isRejectedAsForbidden(error) && (error as Error).message.includes('LG42')
  )

  const malformed = promiseMentions('this readme promises **LGx** to everyone\n')
  assert.equal(malformed.length, 1)
  assert.equal(classifyPromiseMention(malformed[0] as PromiseMention, declared), 'unclassifiable')
  assert.throws(
    () => census(malformed, (mention) => classifyPromiseMention(mention, declared)),
    isHaltedOnUnclassifiable
  )
})

test('contract.readme-states-the-single-session-limit', () => {
  assert.ok(
    readReadme().includes(SINGLE_SESSION_LIMIT_PHRASE),
    `readme.promises: ${README_REL_PATH} does not carry the phrase "${SINGLE_SESSION_LIMIT_PHRASE}"; the single-session limit must be stated as a limit rather than discovered`
  )
})
