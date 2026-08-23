import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { census } from '../support/census.ts'
import {
  BUDGET_BYTES,
  classifyDescription,
  listPublishedTools,
  type PublishedTool
} from '../support/published.ts'
import { CONTROL_SPECS, spawnProbeServer } from '../support/probe-server.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))

const soleTool = (tools: PublishedTool[], name: string): PublishedTool => {
  const found = tools.find((tool) => tool.name === name)
  if (found === undefined) {
    throw new Error(`expected a published tool named "${name}", found: ${tools.map((t) => t.name).join(', ')}`)
  }
  return found
}

test('contract.instructions-within-budget', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  try {
    const instructions = spawned.instructions()
    assert.notEqual(instructions, undefined)
    assert.ok(Buffer.byteLength(instructions as string, 'utf8') < BUDGET_BYTES)

    const items = ALL_TOOLS.map((tool) => tool.description)
    assert.doesNotThrow(() => census(items, classifyDescription))
  } finally {
    await spawned.close()
  }
})

test('contract.instructions-within-budget.control.oversize-description-is-forbidden', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.oversizeDescription])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_oversize_description')
    const verdict = classifyDescription(tool.description)
    assert.equal(verdict, 'forbidden', 'probe_oversize_description must classify forbidden')
  } finally {
    await spawned.close()
  }
})

test('contract.instructions-within-budget.control.long-lead-sentence-is-forbidden', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.longLeadSentence])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_long_lead_sentence')
    const verdict = classifyDescription(tool.description)
    assert.equal(verdict, 'forbidden', 'probe_long_lead_sentence must classify forbidden')
  } finally {
    await spawned.close()
  }
})

test('contract.instructions-within-budget.control.no-sentence-terminator-is-unclassifiable', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.noSentenceTerminator])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_no_sentence_terminator')
    const verdict = classifyDescription(tool.description)
    assert.equal(verdict, 'unclassifiable', 'probe_no_sentence_terminator must classify unclassifiable')
  } finally {
    await spawned.close()
  }
})

test('contract.instructions-within-budget.control.conformant-description-is-allowed', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.conformant])
  try {
    const published = await listPublishedTools(spawned)
    const tool = soleTool(published, 'probe_conformant')
    const verdict = classifyDescription(tool.description)
    assert.equal(verdict, 'allowed', 'probe_conformant must classify allowed')
  } finally {
    await spawned.close()
  }
})
