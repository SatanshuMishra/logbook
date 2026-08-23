import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { Refusal } from '../../src/schema/declare.ts'
import { spawnServer, type SpawnedServer } from '../support/spawn-client.ts'
import { spawnProbeServer, CONTROL_SPECS } from '../support/probe-server.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const REGISTER_MODULE_PATH = fileURLToPath(new URL('../../src/server/register.ts', import.meta.url))
const RUNTIME_MODULE_PATH = fileURLToPath(new URL('../../src/runtime/runtime.ts', import.meta.url))
const MCP_SERVER_MODULE_PATH = fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/server/mcp.js'))
const MCP_STDIO_MODULE_PATH = fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))
const ZOD_MODULE_PATH = fileURLToPath(import.meta.resolve('zod'))

const HANDLER_REFUSAL: Refusal = {
  ok: false,
  field: 'probe.value',
  accepted: 'a non-empty string of at most ten characters',
  example: 'ok',
  retryable: true,
  message: 'probe.value must be a non-empty string of at most ten characters'
}

const HANDLER_REFUSAL_TOOL_NAME = 'probe_handler_refusal'
const OUTPUT_SCHEMA_GUARD_TOOL_NAME = 'probe_output_schema_guard'

const buildEntrySource = (): string => `
import { z } from '${ZOD_MODULE_PATH}'
import { McpServer } from '${MCP_SERVER_MODULE_PATH}'
import { StdioServerTransport } from '${MCP_STDIO_MODULE_PATH}'
import { productionRuntime } from '${RUNTIME_MODULE_PATH}'
import { registerTool, NO_ARGUMENTS } from '${REGISTER_MODULE_PATH}'

const rt = productionRuntime()
const server = new McpServer(
  { name: 'logbook-errors-probe', version: '0.0.0' },
  { capabilities: { tools: { listChanged: true } } }
)

registerTool(server, rt, {
  name: '${HANDLER_REFUSAL_TOOL_NAME}',
  title: '${HANDLER_REFUSAL_TOOL_NAME}',
  description: 'Always refuses from within its own handler so the four-part refusal payload can be inspected end to end. This tool performs no side effects.',
  input: NO_ARGUMENTS,
  output: NO_ARGUMENTS,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async () => ({ ok: false, refusal: ${JSON.stringify(HANDLER_REFUSAL)} })
})

registerTool(server, rt, {
  name: '${OUTPUT_SCHEMA_GUARD_TOOL_NAME}',
  title: '${OUTPUT_SCHEMA_GUARD_TOOL_NAME}',
  description: 'Declares an output schema and always resolves without structured content, on purpose, to prove the guard is visible.',
  input: NO_ARGUMENTS,
  output: z.object({ echoed: z.string().describe('never populated; this probe never returns structured content') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async () => ({ ok: true, text: 'no structured content on purpose', structured: undefined })
})

const transport = new StdioServerTransport()
await server.connect(transport)
`

const spawnErrorsProbeServer = async (): Promise<{ spawned: SpawnedServer; cleanup: () => void }> => {
  const entryDir = mkdtempSync(join(tmpdir(), 'logbook-errors-probe-'))
  const entryPath = join(entryDir, 'entry.ts')
  writeFileSync(entryPath, buildEntrySource(), 'utf8')
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT, entry: entryPath })
  return { spawned, cleanup: () => rmSync(entryDir, { recursive: true, force: true }) }
}

const firstTextOf = (result: CallToolResult): string => {
  const [firstContent] = result.content
  assert.ok(firstContent !== undefined, 'expected the call result to carry at least one content block')
  assert.equal(firstContent.type, 'text')
  return (firstContent as { type: 'text'; text: string }).text
}

test('error.refusal-carries-four-parts', async () => {
  const { spawned, cleanup } = await spawnErrorsProbeServer()
  try {
    await spawned.client.listTools()
    const result = (await spawned.client.callTool({
      name: HANDLER_REFUSAL_TOOL_NAME,
      arguments: {}
    })) as CallToolResult
    assert.equal(result.isError, true)
    assert.equal(result.structuredContent, undefined)

    const text = firstTextOf(result)
    assert.match(text, new RegExp(`field: ${HANDLER_REFUSAL.field}`))
    assert.match(text, new RegExp(`accepted: ${HANDLER_REFUSAL.accepted}`))
    assert.match(text, new RegExp(`example: ${HANDLER_REFUSAL.example}`))
    assert.match(text, new RegExp(`retryable: ${HANDLER_REFUSAL.retryable}`))
  } finally {
    await spawned.close()
    cleanup()
  }
})

test('error.malformed-non-object-arguments-are-in-band', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.conformant])
  try {
    await spawned.client.listTools()
    const result = (await spawned.client.callTool({
      name: 'probe_conformant'
    })) as CallToolResult
    assert.equal(result.isError, true)
    const text = firstTextOf(result)
    assert.match(text, /Input validation error/)
    assert.match(text, /probe_conformant/)
  } finally {
    await spawned.close()
  }
})

test('error.type-mismatch-returns-our-four-part-refusal', async () => {
  const spawned = await spawnProbeServer([CONTROL_SPECS.conformant])
  try {
    await spawned.client.listTools()
    const result = (await spawned.client.callTool({
      name: 'probe_conformant',
      arguments: { value: 42 }
    })) as CallToolResult
    assert.equal(result.isError, true)
    const text = firstTextOf(result)
    const lines = text.split('\n')
    assert.equal(lines[0], 'field: value')
    assert.match(text, /^accepted: /m)
    assert.match(text, /^example: /m)
    assert.match(text, /^retryable: (true|false)/m)
  } finally {
    await spawned.close()
  }
})

test('error.output-schema-guard', async () => {
  const { spawned, cleanup } = await spawnErrorsProbeServer()
  try {
    const result = (await spawned.client.callTool({
      name: OUTPUT_SCHEMA_GUARD_TOOL_NAME,
      arguments: {}
    })) as CallToolResult
    assert.equal(result.isError, true)
    const text = firstTextOf(result)
    assert.match(
      text,
      new RegExp(
        `Output validation error: Tool ${OUTPUT_SCHEMA_GUARD_TOOL_NAME} has an output schema but no structured content was provided`
      )
    )
  } finally {
    await spawned.close()
    cleanup()
  }
})
