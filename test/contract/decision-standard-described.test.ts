import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { BUDGET_BYTES, classifyDescription, listPublishedTools, type PublishedTool } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const PROPERTY_PHRASES: Readonly<Record<string, string>> = {
  context: 'what forced this choice',
  options: 'at least two',
  option_reasons: 'why it was or was not chosen',
  outcome: 'which option was chosen and why'
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const soleTool = (tools: readonly PublishedTool[], name: string): PublishedTool => {
  const found = tools.find((tool) => tool.name === name)
  if (found === undefined) {
    throw new Error(`expected a published tool named "${name}", found: ${tools.map((t) => t.name).join(', ')}`)
  }
  return found
}

const propertyDescription = (tool: PublishedTool, property: string): string => {
  const properties = tool.inputSchema.properties
  assert.ok(isRecord(properties), `${tool.name} published no input properties`)
  const node = properties[property]
  assert.ok(isRecord(node), `${tool.name} published no input property "${property}"`)
  assert.equal(typeof node.description, 'string', `${tool.name}.${property} published no description`)
  return node.description as string
}

test('contract.decision-standard.record-decision-states-the-standard', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const tool = soleTool(await listPublishedTools(spawned), 'record_decision')

    assert.ok(
      tool.description.includes('Whoever chose between the options records the choice.'),
      `the record_decision description must state who records the choice, got:\n${tool.description}`
    )
    assert.ok(Buffer.byteLength(tool.description, 'utf8') < BUDGET_BYTES, 'the record_decision description must stay inside its budget')
    assert.equal(classifyDescription(tool.description), 'allowed', 'the record_decision description must meet the description budget')

    for (const [property, phrase] of Object.entries(PROPERTY_PHRASES)) {
      const description = propertyDescription(tool, property)
      assert.ok(description.includes(phrase), `record_decision.${property} must contain "${phrase}", got: ${description}`)
    }
  } finally {
    await spawned.close()
  }
})
