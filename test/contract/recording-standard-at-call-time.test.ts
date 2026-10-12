import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { listPublishedTools, type PublishedTool } from '../support/published.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const publishedTool = (tools: PublishedTool[], name: string): PublishedTool => {
  const found = tools.find((tool) => tool.name === name)
  if (found === undefined) {
    throw new Error(`expected a published tool named "${name}", found: ${tools.map((t) => t.name).join(', ')}`)
  }
  return found
}

const propertyDescription = (tool: PublishedTool, property: string): string => {
  const properties = tool.inputSchema.properties as Record<string, { description?: string }> | undefined
  const description = properties?.[property]?.description
  if (description === undefined) {
    throw new Error(`expected ${tool.name} to publish a described property "${property}"`)
  }
  return description
}

const withPublishedTools = async (run: (tools: PublishedTool[]) => void): Promise<void> => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    run(await listPublishedTools(spawned))
  } finally {
    await spawned.close()
  }
}

const NEXT_STEP_PHRASES = [
  'an action someone could begin without re-deriving anything',
  'naming the file and the place in it',
  'an action, not a goal or a phase name'
] as const

test('contract.recording-standard.next-step-fields-state-the-next-action-standard', async () => {
  await withPublishedTools((tools) => {
    for (const name of ['open_thread', 'update_thread', 'park_thread']) {
      const description = propertyDescription(publishedTool(tools, name), 'next_step')
      for (const phrase of NEXT_STEP_PHRASES) {
        assert.ok(description.includes(phrase), `${name} next_step must contain "${phrase}"`)
      }
    }
  })
})

test('contract.recording-standard.criteria-writers-state-the-definition-of-done-test', async () => {
  await withPublishedTools((tools) => {
    for (const name of ['update_thread', 'amend_criteria']) {
      assert.ok(
        publishedTool(tools, name).description.includes('Keep the definition of done true to what is now known.'),
        `${name} must state the definition-of-done test`
      )
    }
  })
})

test('contract.recording-standard.session-log-states-the-subagent-test', async () => {
  await withPublishedTools((tools) => {
    assert.ok(
      publishedTool(tools, 'log_session_event').description.includes(
        'Record here anything a subagent returned that it could not record itself.'
      )
    )
  })
})
