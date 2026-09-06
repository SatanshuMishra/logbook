import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { census, type Classified } from '../support/census.ts'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'
import * as caps from '../../src/schema/caps.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const AMEND_CRITERIA_TOOL_NAME = 'amend_criteria'
const THREAD_ID_PROPERTY = 'thread_id'

type SchemaProperty = { toolName: string; path: string; node: unknown }

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const flattenProperties = (properties: unknown, prefix: string, toolName: string): SchemaProperty[] => {
  if (!isPlainObject(properties)) return []
  return Object.entries(properties).flatMap(([key, node]) => {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`
    return [{ toolName, path, node }, ...flattenSchemaNode(node, path, toolName)]
  })
}

const flattenSchemaNode = (node: unknown, path: string, toolName: string): SchemaProperty[] => {
  if (!isPlainObject(node)) return []
  const collected: SchemaProperty[] = []
  if (node.properties !== undefined) {
    collected.push(...flattenProperties(node.properties, path, toolName))
  }
  if (node.items !== undefined) {
    const itemsPath = `${path}[]`
    collected.push({ toolName, path: itemsPath, node: node.items })
    collected.push(...flattenSchemaNode(node.items, itemsPath, toolName))
  }
  return collected
}

const hasThreadIdProperty = (inputSchema: Record<string, unknown>): boolean => {
  const properties = inputSchema.properties
  return isPlainObject(properties) && THREAD_ID_PROPERTY in properties
}

const leafKey = (toolName: string, path: string): string => `${toolName}::${path}`

type LeafDisposition = 'allowed' | 'sensitive'

const FREE_TEXT_LEAF_DISPOSITIONS: Readonly<Record<string, LeafDisposition>> = {
  'open_thread::title': 'allowed',
  'open_thread::completion_criteria[].text': 'sensitive',
  'open_thread::completion_criteria[].check': 'allowed',
  'open_thread::artifacts[].label': 'allowed',
  'open_thread::artifacts[].pointer': 'allowed',
  'close_thread::detail': 'allowed',
  'log_session_event::actor': 'allowed',
  'log_session_event::body': 'allowed',
  'park_thread::outcome': 'allowed',
  'park_thread::next_step': 'allowed',
  'park_thread::landed': 'allowed',
  'record_decision::title': 'allowed',
  'record_decision::context': 'allowed',
  'record_decision::options[]': 'allowed',
  'record_decision::outcome': 'allowed',
  'record_decision::scope': 'allowed',
  'update_thread::criteria_done[].result': 'allowed',
  'update_thread::active_goal': 'allowed',
  'update_thread::next_step': 'allowed',
  'update_thread::last_session': 'allowed',
  'update_thread::blocked_by': 'allowed',
  'update_thread::risks_add[].text': 'allowed',
  'update_thread::risks_add[].scope': 'allowed',
  'update_thread::risks_add[].refs[]': 'allowed',
  'update_thread::key_decisions_add[].title': 'allowed',
  'update_thread::key_decisions_add[].scope': 'allowed',
  'update_thread::out_of_scope_add[]': 'allowed',
  'update_thread::artifacts_add[].label': 'allowed',
  'update_thread::artifacts_add[].pointer': 'allowed',
  'resolve_conflict::resolutions[].field': 'allowed',
  'list_threads::cursor': 'allowed'
}

export const classifyCriteriaTextProperty = (
  entry: SchemaProperty,
  toolHasThreadId: boolean,
  dispositions: Readonly<Record<string, LeafDisposition>> = FREE_TEXT_LEAF_DISPOSITIONS
): Classified<SchemaProperty>['verdict'] | 'unclassifiable' => {
  const { node } = entry
  if (!isPlainObject(node)) return 'unclassifiable'
  if ('oneOf' in node || 'anyOf' in node || 'allOf' in node) return 'unclassifiable'

  const type = node.type
  if (type === undefined) return 'unclassifiable'
  if (type !== 'string') return 'allowed'
  if ('pattern' in node || 'enum' in node || 'const' in node) return 'allowed'

  const disposition = dispositions[leafKey(entry.toolName, entry.path)]
  if (disposition === undefined) return 'unclassifiable'
  if (disposition === 'allowed') return 'allowed'

  return toolHasThreadId ? 'forbidden' : 'allowed'
}

const censusItemsFor = (tool: PublishedTool): SchemaProperty[] =>
  flattenProperties(tool.inputSchema.properties, '', tool.name)

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
      `criteria.no-other-tool-writes-criteria: tool "${tool.name}" exposes a free-text leaf this census cannot yet place. Decide the disposition, do not guess it: a leaf that carries a criterion's own statement belongs to the one tool sanctioned to write criterion text and must be classified "sensitive", forbidden on every other thread-bearing tool; a leaf that records an observation about a criterion, rather than restating it, is "allowed". Classifying rewritten or replacement criterion text as "allowed" reopens the defect this census exists to close.`
    )
  }
})

const CRITERIA_REWRITE_TEXT_DISPOSITION: Readonly<Record<string, LeafDisposition>> = {
  'criteria_rewrite::criteria_rewrite[].text': 'sensitive'
}

const CRITERIA_REPLACE_ELEMENT_DISPOSITION: Readonly<Record<string, LeafDisposition>> = {
  'criteria_replace::criteria_replace[]': 'sensitive'
}

test('criteria.no-other-tool-writes-criteria.control.free-text-on-an-existing-thread-is-forbidden', () => {
  const dangerousProperty: SchemaProperty = {
    toolName: 'criteria_rewrite',
    path: 'criteria_rewrite[].text',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'the new text for an existing criterion' }
  }
  assert.equal(classifyCriteriaTextProperty(dangerousProperty, true, CRITERIA_REWRITE_TEXT_DISPOSITION), 'forbidden')
})

test('criteria.no-other-tool-writes-criteria.control.creation-only-tool-is-allowed', () => {
  const creationProperty: SchemaProperty = {
    toolName: 'open_thread',
    path: 'completion_criteria[].text',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'one completion criterion as plain text' }
  }
  assert.equal(classifyCriteriaTextProperty(creationProperty, false), 'allowed')
})

test('criteria.no-other-tool-writes-criteria.control.id-reference-is-not-text', () => {
  const idReferenceProperty: SchemaProperty = {
    toolName: 'update_thread',
    path: 'criteria_done[]',
    node: { type: 'string', pattern: '^[0-9A-HJKMNP-TV-Z]{26}$', description: 'the id of a completion criterion' }
  }
  assert.equal(classifyCriteriaTextProperty(idReferenceProperty, true), 'allowed')
})

test('criteria.no-other-tool-writes-criteria.control.a-recorded-observation-is-not-criterion-text', () => {
  const resultProperty: SchemaProperty = {
    toolName: 'update_thread',
    path: 'criteria_done[].result',
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
    toolName: 'criteria_replace',
    path: 'criteria_replace[]',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'replacement text for a criterion' }
  }
  assert.equal(
    classifyCriteriaTextProperty(bareElementProperty, true, CRITERIA_REPLACE_ELEMENT_DISPOSITION),
    'forbidden'
  )
})

test('criteria.no-other-tool-writes-criteria.control.unrelated-scope-text-is-allowed', () => {
  const scopeProperty: SchemaProperty = {
    toolName: 'update_thread',
    path: 'risks_add[].scope',
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
    toolName: 'criteria_weird',
    path: 'criteria_weird',
    node: { oneOf: [{ type: 'string' }, { type: 'null' }] }
  }
  assert.equal(classifyCriteriaTextProperty(unionProperty, true), 'unclassifiable')

  const typelessProperty: SchemaProperty = {
    toolName: 'criteria_weird_two',
    path: 'criteria_weird_two',
    node: { description: 'no type keyword at all' }
  }
  assert.equal(classifyCriteriaTextProperty(typelessProperty, true), 'unclassifiable')
})

test('criteria.no-other-tool-writes-criteria.control.previously-vulnerable-property-names-are-never-silently-allowed', () => {
  const wording: SchemaProperty = {
    toolName: 'criteria_rewrite',
    path: 'criteria_rewrite[].wording',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'the new wording for an existing criterion' }
  }
  const statement: SchemaProperty = {
    toolName: 'criteria_rewrite',
    path: 'criteria_rewrite[].statement',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'the new statement for an existing criterion' }
  }
  const differentlyNamedTool: SchemaProperty = {
    toolName: 'goals_rewrite',
    path: 'goals_rewrite[].text',
    node: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
      description: 'the new text for an existing criterion, reached through a tool whose name carries no criteria substring'
    }
  }

  for (const candidate of [wording, statement, differentlyNamedTool]) {
    assert.notEqual(classifyCriteriaTextProperty(candidate, true), 'allowed')
  }
})

test('criteria.no-other-tool-writes-criteria.control.an-unmapped-leaf-halts-with-a-message-distinct-from-a-forbidden-one', () => {
  const unmappedLeaf: SchemaProperty = {
    toolName: 'criteria_rewrite',
    path: 'criteria_rewrite[].wording',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'the new wording for an existing criterion' }
  }
  const forbiddenLeaf: SchemaProperty = {
    toolName: 'criteria_rewrite',
    path: 'criteria_rewrite[].text',
    node: { type: 'string', minLength: 1, maxLength: 500, description: 'the new text for an existing criterion' }
  }

  let unmappedMessage = ''
  assert.throws(
    () => census([unmappedLeaf], (entry) => classifyCriteriaTextProperty(entry, true)),
    (error) => {
      unmappedMessage = (error as Error).message
      return true
    }
  )

  let forbiddenMessage = ''
  assert.throws(
    () => census([forbiddenLeaf], (entry) => classifyCriteriaTextProperty(entry, true, CRITERIA_REWRITE_TEXT_DISPOSITION)),
    (error) => {
      forbiddenMessage = (error as Error).message
      return true
    }
  )

  assert.match(unmappedMessage, /census halted on an unclassifiable item/)
  assert.match(forbiddenMessage, /census rejected a forbidden item/)
  assert.doesNotMatch(unmappedMessage, /rejected a forbidden item/)
  assert.doesNotMatch(forbiddenMessage, /halted on an unclassifiable item/)
})
