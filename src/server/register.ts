import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Runtime } from '../runtime/runtime.ts'
import { declare, type Refusal } from '../schema/declare.ts'
import { toolOk, toolRefusal } from './errors.ts'
import { NO_ARGUMENTS } from './no-arguments.ts'
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

  const wrappedHandler = async (rawArgs: unknown, extra: ToolContext): Promise<CallToolResult> => {
    try {
      const parsed = declared.parse(rawArgs)
      if (!parsed.ok) {
        return toolRefusal(parsed)
      }
      const reply = await spec.handler(rt, extra, parsed.value)
      if (reply.ok) {
        return toolOk(reply.text, reply.structured)
      }
      return toolRefusal(reply.refusal)
    } catch (error) {
      return reportCrash(rt, spec.name, error)
    }
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
