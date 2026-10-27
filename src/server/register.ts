import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import { guarded, recordEvent, recordInRun, startRun, writeThreadSummary } from '../metrics/record.ts'
import { secondsBetween } from '../metrics/summary.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { declare, type Refusal } from '../schema/declare.ts'
import { actingSession, heldBy } from '../thread/holds.ts'
import { findRepository, startDirectory, type RepoPaths } from '../thread/paths.ts'
import { readDocument, resolveThreadId } from '../thread/store.ts'
import { toolOk, toolRefusal } from './errors.ts'
import { NO_ARGUMENTS } from './no-arguments.ts'
import type { LedgerToolName } from './tool-names.ts'
import { TOOL_SPECS } from './tools/index.ts'

export { NO_ARGUMENTS } from './no-arguments.ts'

export type ToolContext = RequestHandlerExtra<ServerRequest, ServerNotification>

export type ToolReply<O> = { ok: true; text: string; structured: O } | { ok: false; refusal: Refusal }

export type ToolSpec<I, O> = {
  name: string
  title: string
  description: string
  input: z.ZodObject<z.ZodRawShape>
  output: z.ZodObject<z.ZodRawShape>
  annotations: {
    readOnlyHint: boolean
    destructiveHint: boolean
    idempotentHint: boolean
    openWorldHint: false
  }
  handler: (rt: Runtime, ctx: ToolContext, input: I) => Promise<ToolReply<O>>
}

export const ALL_TOOLS: ToolSpec<never, never>[] = [...TOOL_SPECS]

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const propertiesOf = (jsonSchema: Record<string, unknown>): Record<string, unknown> | undefined =>
  isJsonObject(jsonSchema.properties) ? jsonSchema.properties : undefined

const forgePublishedInput = (jsonSchema: Record<string, unknown>): z.ZodTypeAny => {
  const properties = propertiesOf(jsonSchema) ?? {}
  const shape: z.ZodRawShape = Object.fromEntries(
    Object.entries(properties).map(([key, node]) => [
      key,
      z.unknown().optional().meta(isJsonObject(node) ? node : {})
    ])
  )
  const rootMeta: Record<string, unknown> = { ...jsonSchema }
  delete rootMeta.type
  delete rootMeta.properties
  delete rootMeta.$schema
  return z.object(shape).passthrough().meta(rootMeta)
}

const takesArguments = (jsonSchema: Record<string, unknown>): boolean => {
  const properties = propertiesOf(jsonSchema)
  return properties !== undefined && Object.keys(properties).length > 0
}

const assertPublishableSchema = (name: string, jsonSchema: Record<string, unknown>): void => {
  if (propertiesOf(jsonSchema) === undefined) {
    throw new Error(
      `registerTool: "${name}" declares an input schema whose root is not a plain object; the published schema cannot truthfully represent it`
    )
  }
  if (takesArguments(jsonSchema) && jsonSchema.additionalProperties !== false) {
    throw new Error(
      `registerTool: "${name}" declares an input schema with arguments that is not a z.strictObject; unknown keys would be silently accepted instead of refused`
    )
  }
}

const shapeKeysOf = (schema: z.ZodObject<z.ZodRawShape>): readonly string[] | null => {
  const rawShape = (schema as unknown as { shape?: unknown }).shape
  if (rawShape === null || typeof rawShape !== 'object') return null
  return Object.keys(rawShape as Record<string, unknown>)
}

const reportCrash = (rt: Runtime, toolName: string, error: unknown): CallToolResult => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  rt.log({ level: 'error', source: 'server.register', tool: toolName, message })
  return {
    isError: true,
    content: [{ type: 'text', text: `logbook: "${toolName}" failed unexpectedly and the failure was logged.` }]
  }
}

type Outcome = 'ok' | 'refused' | 'crashed'

type Answer = { result: CallToolResult; outcome: Outcome; refusalField: string | null }

type Holding = { paths: RepoPaths; held: string | null }

type Concern = { paths: RepoPaths; slug: string | null }

const TOOL_CALL_EVENT = 'tool.call'
const STARTS_A_RUN: LedgerToolName = 'open_thread'
const WRITES_A_SUMMARY: ReadonlySet<string> = new Set<LedgerToolName>(['park_thread', 'close_thread'])

const refusedAnswer = (refusal: Refusal): Answer => ({
  result: toolRefusal(refusal),
  outcome: 'refused',
  refusalField: refusal.field
})

const stringArgument = (rawArgs: unknown, key: string): string | null => {
  if (!isJsonObject(rawArgs)) return null
  const value = rawArgs[key]
  return typeof value === 'string' ? value : null
}

const namedThread = (rt: Runtime, paths: RepoPaths, rawArgs: unknown): string | null => {
  const threadId = stringArgument(rawArgs, 'thread_id')
  const resolved = threadId === null ? null : resolveThreadId(rt, paths, threadId)
  if (resolved !== null && resolved.ok) return resolved.value
  const slug = stringArgument(rawArgs, 'slug')
  return slug !== null && readDocument(rt, paths, slug) !== null ? slug : null
}

const holdingAtStart = (rt: Runtime): Holding | null =>
  guarded(rt, null, () => {
    const found = findRepository(rt, startDirectory(rt, rt.cwd ?? ''))
    if (!found.ok) return null
    const paths = found.value
    return { paths, held: heldBy(paths, actingSession(paths, rt.sessionId)) }
  })

const concernOf = (rt: Runtime, holding: Holding | null, rawArgs: unknown): Concern | null =>
  holding === null
    ? null
    : guarded(rt, null, () => ({ paths: holding.paths, slug: namedThread(rt, holding.paths, rawArgs) ?? holding.held }))

const recordCall = (
  rt: Runtime,
  toolName: string,
  rawArgs: unknown,
  concern: Concern | null,
  answer: Answer,
  seconds: number
): void => {
  if (concern === null) return
  const fields = {
    tool: toolName,
    outcome: answer.outcome,
    refusal_field: answer.refusalField,
    call_seconds: seconds
  }
  const opened = toolName === STARTS_A_RUN && answer.outcome === 'ok' ? stringArgument(rawArgs, 'slug') : null
  if (opened !== null) {
    const run = startRun(rt, opened)
    if (run !== null) recordInRun(rt, concern.paths, run, TOOL_CALL_EVENT, fields)
    return
  }
  if (concern.slug !== null) recordEvent(rt, concern.paths, concern.slug, TOOL_CALL_EVENT, fields)
}

const summarise = (rt: Runtime, toolName: string, concern: Concern | null, answer: Answer): void => {
  if (concern === null || concern.slug === null || answer.outcome !== 'ok' || !WRITES_A_SUMMARY.has(toolName)) return
  writeThreadSummary(rt, concern.paths, concern.slug)
}

export const registerTool = <I, O>(server: McpServer, rt: Runtime, spec: ToolSpec<I, O>): void => {
  const enforcedKeys = shapeKeysOf(spec.input)
  if (enforcedKeys !== null && enforcedKeys.length === 0 && spec.input !== NO_ARGUMENTS) {
    throw new Error(
      `registerTool: "${spec.name}" declares an input schema with no properties; use NO_ARGUMENTS to declare a genuinely zero-argument tool`
    )
  }

  const declared = declare<I>(spec.name, spec.input as unknown as z.ZodType<I>)
  assertPublishableSchema(spec.name, declared.jsonSchema)
  const publishedInput = forgePublishedInput(declared.jsonSchema)

  const answer = async (rawArgs: unknown, extra: ToolContext): Promise<Answer> => {
    try {
      const parsed = declared.parse(rawArgs)
      if (!parsed.ok) {
        return refusedAnswer(parsed)
      }
      const reply = await spec.handler(rt, extra, parsed.value)
      if (reply.ok) {
        return { result: toolOk(reply.text, reply.structured), outcome: 'ok', refusalField: null }
      }
      return refusedAnswer(reply.refusal)
    } catch (error) {
      return { result: reportCrash(rt, spec.name, error), outcome: 'crashed', refusalField: null }
    }
  }

  const wrappedHandler = async (rawArgs: unknown, extra: ToolContext): Promise<CallToolResult> => {
    const startedAt = rt.now()
    const holding = holdingAtStart(rt)
    const answered = await answer(rawArgs, extra)
    const finishedAt = rt.now()
    const concern = concernOf(rt, holding, rawArgs)
    recordCall(rt, spec.name, rawArgs, concern, answered, secondsBetween(startedAt, finishedAt))
    summarise(rt, spec.name, concern, answered)
    return answered.result
  }

  server.registerTool(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: publishedInput,
      outputSchema: spec.output,
      annotations: spec.annotations
    },
    wrappedHandler
  )
}
