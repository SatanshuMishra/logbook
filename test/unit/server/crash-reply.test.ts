import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { registerTool, runTool, type ToolSpec } from '../../../src/server/register.ts'
import { testRuntime } from '../../support/runtime.ts'

type ProbeInput = { thread_id: string }
type ProbeOutput = { thread_id: string }

const CAUSE = 'the disk the thread is stored on is full'
const STACK_FRAME = '\n    at '
const PROBE_ARGUMENTS: ProbeInput = { thread_id: 'fix-login' }

const crashingTool: ToolSpec<ProbeInput, ProbeOutput> = {
  name: 'crash_probe',
  title: 'Crash probe',
  description: 'Fails on every call with the same cause.',
  input: z.strictObject({ thread_id: z.string().describe('any thread slug') }).describe('the probe input'),
  output: z.object({ thread_id: z.string().describe('the slug that was sent') }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async () => {
    throw new Error(CAUSE)
  }
}

const textOf = (content: unknown): string => {
  assert.ok(Array.isArray(content), 'the reply must carry content blocks')
  const first: unknown = content[0]
  assert.ok(typeof first === 'object' && first !== null && 'text' in first, 'the first content block must be text')
  return String(first.text)
}

test('register.crashed-call-tells-the-session-the-cause-the-command-prints', async () => {
  const outsideAnyRepository = mkdtempSync(join(tmpdir(), 'logbook-crash-reply-'))
  const rt = testRuntime({ cwd: outsideAnyRepository })
  const server = new McpServer({ name: 'logbook-crash-reply', version: '0.0.0' })
  const client = new Client({ name: 'logbook-crash-reply-client', version: '0.0.0' })
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  try {
    registerTool(server, rt, crashingTool)
    await server.connect(serverSide)
    await client.connect(clientSide)

    const reply = await client.callTool({ name: crashingTool.name, arguments: PROBE_ARGUMENTS })
    const commandOutcome = await runTool(rt, crashingTool, PROBE_ARGUMENTS)

    assert.deepEqual(commandOutcome, { kind: 'crashed', message: CAUSE })
    assert.equal(reply.isError, true)
    const text = textOf(reply.content)
    assert.ok(text.includes(crashingTool.name), text)
    assert.ok(text.includes(CAUSE), text)
    assert.equal(text.includes(STACK_FRAME), false, text)
  } finally {
    await client.close()
    await server.close()
    rmSync(outsideAnyRepository, { recursive: true, force: true })
  }
})
