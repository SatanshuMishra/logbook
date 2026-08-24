import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { NO_ARGUMENTS, type ToolReply, type ToolSpec } from '../../src/server/register.ts'
import { BUDGET_BYTES } from './published.ts'
import { spawnServer, type SpawnedServer } from './spawn-client.ts'

export type ProbeSpec = {
  name: string
  description: string
  input: unknown
  output: unknown
  handler: (input: unknown) => Promise<ToolReply<unknown>>
}

const okReply = (text: string, structured: Record<string, unknown>): ToolReply<unknown> => ({
  ok: true,
  text,
  structured
})

const CONFORMANT_INPUT = z.strictObject({
  value: z
    .string()
    .max(50)
    .describe('a short probe value; capped at fifty characters in prose because the cap is not published as a schema keyword')
})
const CONFORMANT_OUTPUT = z.object({ echoed: z.string().describe('the value that was received') })

const conformant: ProbeSpec = {
  name: 'probe_conformant',
  description:
    'Echoes a short probe value back to the caller. It exists only to prove that a conformant tool with one property publishes an allowed input schema. The value is capped at fifty characters, enforced in the handler rather than on the wire. This tool performs no side effects and is safe to call repeatedly.',
  input: CONFORMANT_INPUT,
  output: CONFORMANT_OUTPUT,
  handler: async (input) => {
    const value = (input as { value: string }).value
    return okReply(`echoed ${value}`, { echoed: value })
  }
}

const UNREACHABLE_OUTPUT = z.object({ ok: z.boolean().describe('always true; this probe is never actually called') })
const unreachableHandler = async (): Promise<ToolReply<unknown>> => okReply('unreachable', { ok: true })

const NULLABLE_ROOT_INPUT = z
  .object({ a: z.string().describe('a probe field only reachable when the root is not null') })
  .nullable()

const nullableRoot: ProbeSpec = {
  name: 'probe_nullable_root',
  description:
    'Registers a nullable-wrapped object as its input schema on purpose. It exists only to prove that a non-object root gets published as an empty object while the server keeps enforcing the original shape. Calling this tool is not meaningful; it exists purely for the published-schema census. It never enters the production tool registry.',
  input: NULLABLE_ROOT_INPUT,
  output: UNREACHABLE_OUTPUT,
  handler: unreachableHandler
}

const UNION_ROOT_INPUT = z.union([
  z.object({ a: z.string().describe('the first branch of the probe union') }),
  z.object({ b: z.number().describe('the second branch of the probe union') })
])

const unionRoot: ProbeSpec = {
  name: 'probe_union_root',
  description:
    'Registers a top-level union as its input schema on purpose. It exists only to prove that a union root also gets published as an empty object while the server keeps enforcing the original union. Calling this tool is not meaningful; it exists purely for the published-schema census. It never enters the production tool registry.',
  input: UNION_ROOT_INPUT,
  output: UNREACHABLE_OUTPUT,
  handler: unreachableHandler
}

const noArguments: ProbeSpec = {
  name: 'probe_no_arguments',
  description:
    'Takes no arguments at all and exists only to prove that a genuinely zero-argument tool still publishes an allowed input schema. It uses the shared marker for a deliberate empty schema rather than an ad-hoc empty object, which is what makes the zero-argument declaration impossible to supply by accident. Calling it always succeeds and returns a fixed acknowledgement.',
  input: NO_ARGUMENTS,
  output: z.object({ acknowledged: z.boolean().describe('always true') }),
  handler: async () => okReply('acknowledged', { acknowledged: true })
}

const OVERSIZE_FILLER =
  'This probe description exists solely to exceed the two kilobyte publication budget so the census can prove the budget check actually reddens on a real violation. '

const buildOversizeDescription = (): string => {
  let text = ''
  while (Buffer.byteLength(text, 'utf8') < BUDGET_BYTES) {
    text += OVERSIZE_FILLER
  }
  return text
}

const oversizeDescription: ProbeSpec = {
  name: 'probe_oversize_description',
  description: buildOversizeDescription(),
  input: NO_ARGUMENTS,
  output: UNREACHABLE_OUTPUT,
  handler: unreachableHandler
}

const longLeadSentence: ProbeSpec = {
  name: 'probe_long_lead_sentence',
  description:
    'This probe tool exists specifically to prove that a lead sentence exceeding two hundred bytes is classified as forbidden by the description census because the model would never see the remainder of a sentence this long once the client truncates the tail of an oversize tool description. It has no other effect. It is read-only.',
  input: NO_ARGUMENTS,
  output: UNREACHABLE_OUTPUT,
  handler: unreachableHandler
}

const noSentenceTerminator: ProbeSpec = {
  name: 'probe_no_sentence_terminator',
  description:
    'This probe tool description deliberately omits every sentence-ending mark such as a period, an exclamation point, or a question mark so the classifier cannot locate a lead sentence boundary and must halt as unclassifiable rather than guess',
  input: NO_ARGUMENTS,
  output: UNREACHABLE_OUTPUT,
  handler: unreachableHandler
}

export const CONTROL_SPECS: {
  conformant: ProbeSpec
  nullableRoot: ProbeSpec
  unionRoot: ProbeSpec
  noArguments: ProbeSpec
  oversizeDescription: ProbeSpec
  longLeadSentence: ProbeSpec
  noSentenceTerminator: ProbeSpec
} = {
  conformant,
  nullableRoot,
  unionRoot,
  noArguments,
  oversizeDescription,
  longLeadSentence,
  noSentenceTerminator
}

export const adaptProbeSpec = (spec: ProbeSpec): ToolSpec<unknown, unknown> => ({
  name: spec.name,
  title: spec.name,
  description: spec.description,
  input: spec.input as z.ZodObject<z.ZodRawShape>,
  output: spec.output as z.ZodObject<z.ZodRawShape>,
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (_rt, _ctx, input) => spec.handler(input)
})

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const REGISTER_MODULE_PATH = fileURLToPath(new URL('../../src/server/register.ts', import.meta.url))
const RUNTIME_MODULE_PATH = fileURLToPath(new URL('../../src/runtime/runtime.ts', import.meta.url))
const PROBE_MODULE_PATH = fileURLToPath(new URL(import.meta.url))
const MCP_SERVER_MODULE_PATH = fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/server/mcp.js'))
const MCP_STDIO_MODULE_PATH = fileURLToPath(import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js'))

const nameOfSpec = (spec: ProbeSpec): keyof typeof CONTROL_SPECS => {
  const entry = (Object.entries(CONTROL_SPECS) as [keyof typeof CONTROL_SPECS, ProbeSpec][]).find(
    ([, value]) => value === spec
  )
  if (entry === undefined) {
    throw new Error(`spawnProbeServer: spec "${spec.name}" is not a member of CONTROL_SPECS`)
  }
  return entry[0]
}

const buildEntrySource = (keys: readonly string[]): string => `
import { McpServer } from ${JSON.stringify(MCP_SERVER_MODULE_PATH)}
import { StdioServerTransport } from ${JSON.stringify(MCP_STDIO_MODULE_PATH)}
import { productionRuntime } from ${JSON.stringify(RUNTIME_MODULE_PATH)}
import { registerTool } from ${JSON.stringify(REGISTER_MODULE_PATH)}
import { CONTROL_SPECS, adaptProbeSpec } from ${JSON.stringify(PROBE_MODULE_PATH)}

const requestedKeys = ${JSON.stringify(keys)}
const rt = productionRuntime()
const server = new McpServer(
  { name: 'logbook-probe', version: '0.0.0' },
  { capabilities: { tools: { listChanged: true } } }
)

for (const key of requestedKeys) {
  const spec = CONTROL_SPECS[key]
  if (spec === undefined) {
    throw new Error('probe entry: unknown control spec "' + key + '"')
  }
  registerTool(server, rt, adaptProbeSpec(spec))
}

const transport = new StdioServerTransport()
await server.connect(transport)
`

export const spawnProbeServer = async (specs: readonly ProbeSpec[]): Promise<SpawnedServer> => {
  const keys = specs.map(nameOfSpec)
  const entryDir = mkdtempSync(join(tmpdir(), 'logbook-probe-entry-'))
  const entryPath = join(entryDir, 'entry.ts')
  writeFileSync(entryPath, buildEntrySource(keys), 'utf8')

  try {
    const spawned = await spawnServer({ projectRoot: PROJECT_ROOT, entry: entryPath })
    return {
      client: spawned.client,
      stderr: spawned.stderr,
      instructions: spawned.instructions,
      close: async () => {
        await spawned.close()
        rmSync(entryDir, { recursive: true, force: true })
      }
    }
  } catch (error) {
    rmSync(entryDir, { recursive: true, force: true })
    throw error
  }
}
