import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { census, type Classified } from '../support/census.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'
import * as caps from '../../src/schema/caps.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CRITERIA_DOMAIN_PATTERN = /criteri/i
const CRITERION_STATEMENT_LEAF = 'text'
const ARRAY_ELEMENT_SUFFIX = '[]'
const AMEND_CRITERIA_TOOL_NAME = 'amend_criteria'
const THREAD_ID_PROPERTY = 'thread_id'

type SchemaProperty = { path: string; topLevelName: string; node: unknown }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const flattenProperties = (properties: unknown, prefix: string, topLevelName: string): SchemaProperty[] => {
  if (!isPlainObject(properties)) return []
  return Object.entries(properties).flatMap(([key, node]) => {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`
    const ownTopLevelName = prefix.length === 0 ? key : topLevelName
    return [{ path, topLevelName: ownTopLevelName, node }, ...flattenSchemaNode(node, path, ownTopLevelName)]
  })
}

const flattenSchemaNode = (node: unknown, path: string, topLevelName: string): SchemaProperty[] => {
  if (!isPlainObject(node)) return []
  const collected: SchemaProperty[] = []
  if (node.properties !== undefined) {
    collected.push(...flattenProperties(node.properties, path, topLevelName))
  }
  if (node.items !== undefined) {
    const itemsPath = `${path}[]`
    collected.push({ path: itemsPath, topLevelName, node: node.items })
    collected.push(...flattenSchemaNode(node.items, itemsPath, topLevelName))
  }
  return collected
}

const hasThreadIdProperty = (inputSchema: Record<string, unknown>): boolean => {
  const properties = inputSchema.properties
  return isPlainObject(properties) && THREAD_ID_PROPERTY in properties
}

const isCriterionStatementProperty = (path: string): boolean =>
  path.endsWith(ARRAY_ELEMENT_SUFFIX) || path.slice(path.lastIndexOf('.') + 1) === CRITERION_STATEMENT_LEAF

export const classifyCriteriaTextProperty = (
  entry: SchemaProperty,
  toolHasThreadId: boolean
): Classified<SchemaProperty>['verdict'] | 'unclassifiable' => {
  const { node } = entry
  if (!isPlainObject(node)) return 'unclassifiable'
  if ('oneOf' in node || 'anyOf' in node || 'allOf' in node) return 'unclassifiable'

  const type = node.type
  if (type === undefined) return 'unclassifiable'
  if (type !== 'string') return 'allowed'

  if (!CRITERIA_DOMAIN_PATTERN.test(entry.topLevelName)) return 'allowed'
  if ('pattern' in node || 'enum' in node || 'const' in node) return 'allowed'
  if (!isCriterionStatementProperty(entry.path)) return 'allowed'

  return toolHasThreadId ? 'forbidden' : 'allowed'
}

const censusItemsFor = (tool: PublishedTool): SchemaProperty[] =>
  flattenProperties(tool.inputSchema.properties, '', '')

test('criteria.no-other-tool-writes-criteria', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  let published: PublishedTool[]
  try {
    await spawned.client.listTools()
    published = await listPublishedTools(spawned)
  } finally {
    await spawned.close()
  }

  const auditedTools = published.filter((tool) => tool.name !== AMEND_CRITERIA_TOOL_NAME)
  assert.ok(
    auditedTools.length > 0,
    'criteria.no-other-tool-writes-criteria: no non-amend_criteria tools were published; a census over an empty list proves nothing'
  )

  for (const tool of auditedTools) {
    const toolHasThreadId = hasThreadIdProperty(tool.inputSchema)
    const items = censusItemsFor(tool)
    assert.doesNotThrow(
      () => census(items, (entry) => classifyCriteriaTextProperty(entry, toolHasThreadId)),
      `criteria.no-other-tool-writes-criteria: tool "${tool.name}" exposes a property that writes completion-criteria text`
    )
  }
})

test('criteria.no-other-tool-writes-criteria.control.free-text-on-an-existing-thread-is-forbidden', () => {
  const dangerousProperty: SchemaProperty = {
    path: 'criteria_rewrite[].text',
    topLevelName: 'criteria_rewrite',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'the new text for an existing criterion' }
  }
  assert.equal(classifyCriteriaTextProperty(dangerousProperty, true), 'forbidden')
})

test('criteria.no-other-tool-writes-criteria.control.creation-only-tool-is-allowed', () => {
  const creationProperty: SchemaProperty = {
    path: 'completion_criteria[]',
    topLevelName: 'completion_criteria',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'one completion criterion as plain text' }
  }
  assert.equal(classifyCriteriaTextProperty(creationProperty, false), 'allowed')
})

test('criteria.no-other-tool-writes-criteria.control.id-reference-is-not-text', () => {
  const idReferenceProperty: SchemaProperty = {
    path: 'criteria_done[]',
    topLevelName: 'criteria_done',
    node: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$', description: 'the id of a completion criterion' }
  }
  assert.equal(classifyCriteriaTextProperty(idReferenceProperty, true), 'allowed')
})

test('criteria.no-other-tool-writes-criteria.control.a-recorded-observation-is-not-criterion-text', () => {
  const resultProperty: SchemaProperty = {
    path: 'criteria_done[].result',
    topLevelName: 'criteria_done',
    node: {
      type: 'string',
      maxLength: caps.CRITERION_RESULT_MAX,
      description: 'what the check returned, or when it could not be run, specifically why it could not'
    }
  }
  assert.equal(classifyCriteriaTextProperty(resultProperty, true), 'allowed')
})

test('criteria.no-other-tool-writes-criteria.control.a-bare-criteria-array-element-on-a-thread-tool-is-forbidden', () => {
  const bareElementProperty: SchemaProperty = {
    path: 'criteria_replace[]',
    topLevelName: 'criteria_replace',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'replacement text for a criterion' }
  }
  assert.equal(classifyCriteriaTextProperty(bareElementProperty, true), 'forbidden')
})

test('criteria.no-other-tool-writes-criteria.control.unrelated-scope-text-is-allowed', () => {
  const scopeProperty: SchemaProperty = {
    path: 'risks_add[].scope',
    topLevelName: 'risks_add',
    node: {
      type: 'string',
      minLength: 1,
      maxLength: caps.RISK_SCOPE_MAX,
      description: 'the criterion or area of the thread this risk concerns'
    }
  }
  assert.equal(classifyCriteriaTextProperty(scopeProperty, true), 'allowed')
})

test('criteria.no-other-tool-writes-criteria.control.unresolvable-shape-halts', () => {
  const unionProperty: SchemaProperty = {
    path: 'criteria_weird',
    topLevelName: 'criteria_weird',
    node: { oneOf: [{ type: 'string' }, { type: 'null' }] }
  }
  assert.equal(classifyCriteriaTextProperty(unionProperty, true), 'unclassifiable')

  const typelessProperty: SchemaProperty = {
    path: 'criteria_weird_two',
    topLevelName: 'criteria_weird_two',
    node: { description: 'no type keyword at all' }
  }
  assert.equal(classifyCriteriaTextProperty(typelessProperty, true), 'unclassifiable')
})
