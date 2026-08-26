import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { TOOL_SPECS } from '../../src/server/tools/index.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const RULE_REL_PATH = join('docs', 'rules', 'continuity-ledger.md')
const RULE_PATH = join(PROJECT_ROOT, RULE_REL_PATH)

type DocumentSpan = { file: string; line: number; text: string }

const CODE_SPAN_PATTERN = /`([^`]+)`/g

const extractSpans = (relPath: string, content: string): DocumentSpan[] => {
  const spans: DocumentSpan[] = []
  content.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(CODE_SPAN_PATTERN)) {
      spans.push({ file: relPath, line: index + 1, text: match[1] as string })
    }
  })
  return spans
}

const IDENTIFIER_CHARACTERS_PATTERN = /^[a-z0-9_.]+$/
const SNAKE_CASE_PATTERN = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/

const headOf = (text: string): string => {
  const dot = text.indexOf('.')
  return dot === -1 ? text : text.slice(0, dot)
}

const isToolShaped = (text: string): boolean =>
  IDENTIFIER_CHARACTERS_PATTERN.test(text) && headOf(text).includes('_')

const classifyDocumentSpan = (
  span: DocumentSpan,
  toolNames: ReadonlySet<string>
): Classified<DocumentSpan>['verdict'] | 'unclassifiable' => {
  if (!IDENTIFIER_CHARACTERS_PATTERN.test(span.text)) return 'allowed'
  const head = headOf(span.text)
  if (!head.includes('_')) return 'allowed'
  if (!SNAKE_CASE_PATTERN.test(head)) return 'unclassifiable'
  return toolNames.has(head) ? 'allowed' : 'forbidden'
}

const registeredToolNames = (): Set<string> => new Set(TOOL_SPECS.map((spec) => spec.name))

const isHaltedOnUnclassifiable = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census halted on an unclassifiable item')

const isRejectedAsForbidden = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census rejected a forbidden item')

const syntheticSpan = (text: string): DocumentSpan => ({ file: 'synthetic', line: 1, text })

test('contract.continuity-rule-names-no-tool-absent-from-the-registry', () => {
  const toolNames = registeredToolNames()
  assert.ok(
    toolNames.size > 0,
    'contract.continuity-rule: TOOL_SPECS published no tool names; a census against an empty population proves nothing'
  )

  const spans = extractSpans(RULE_REL_PATH, readFileSync(RULE_PATH, 'utf8'))
  assert.ok(
    spans.length > 0,
    `contract.continuity-rule: ${RULE_REL_PATH} holds no backtick code span; a census over an empty population proves nothing`
  )

  const toolShaped = spans.filter((span) => isToolShaped(span.text))
  assert.ok(
    toolShaped.length > 0,
    `contract.continuity-rule: ${RULE_REL_PATH} names no underscored identifier at all, so this census would pass without ever consulting the registry`
  )
  assert.ok(
    toolShaped.some((span) => toolNames.has(headOf(span.text))),
    `contract.continuity-rule: no span in ${RULE_REL_PATH} resolves to a registered tool, so the registry lookup is never exercised`
  )

  assert.doesNotThrow(() => census(spans, (span) => classifyDocumentSpan(span, toolNames)))
})

test('contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unregistered-tool-name-is-forbidden-and-named', () => {
  const toolNames = registeredToolNames()
  const synthetic = [syntheticSpan('transition_thread')]
  assert.equal(classifyDocumentSpan(synthetic[0] as DocumentSpan, toolNames), 'forbidden')
  assert.throws(
    () => census(synthetic, (span) => classifyDocumentSpan(span, toolNames)),
    (error: unknown) => isRejectedAsForbidden(error) && (error as Error).message.includes('transition_thread')
  )
})

test('contract.continuity-rule-names-no-tool-absent-from-the-registry.control.an-unrecognised-underscored-identifier-halts-the-census', () => {
  const toolNames = registeredToolNames()
  const synthetic = [syntheticSpan('mcp__ledger__open_thread')]
  assert.equal(classifyDocumentSpan(synthetic[0] as DocumentSpan, toolNames), 'unclassifiable')
  assert.throws(() => census(synthetic, (span) => classifyDocumentSpan(span, toolNames)), isHaltedOnUnclassifiable)
})

test('contract.continuity-rule-names-no-tool-absent-from-the-registry.control.registered-qualified-and-non-identifier-spans-are-allowed', () => {
  const toolNames = registeredToolNames()
  const synthetic = [
    syntheticSpan('open_thread'),
    syntheticSpan('park_thread.outcome'),
    syntheticSpan('refs/logbook/ledger'),
    syntheticSpan('spine.next_step')
  ]
  assert.deepEqual(
    synthetic.map((span) => classifyDocumentSpan(span, toolNames)),
    ['allowed', 'allowed', 'allowed', 'allowed']
  )
  assert.doesNotThrow(() => census(synthetic, (span) => classifyDocumentSpan(span, toolNames)))
})
