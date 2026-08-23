import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js'
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js'
import type { Runtime } from '../runtime/runtime.ts'
import { declare, type Refusal } from '../schema/declare.ts'
import { toolOk, toolRefusal } from './errors.ts'

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

export const ALL_TOOLS: ToolSpec<never, never>[] = []

export const NO_ARGUMENTS: z.ZodObject<Record<string, never>> = z.object({})

type ZodDefLike = {
  type: string
  shape?: Record<string, z.ZodTypeAny>
  innerType?: z.ZodTypeAny
  element?: z.ZodTypeAny
  values?: unknown[]
  entries?: Record<string, string | number>
  options?: z.ZodTypeAny[]
  discriminator?: string
}

const zodDef = (schema: z.ZodTypeAny): ZodDefLike =>
  (schema as unknown as { _zod: { def: ZodDefLike } })._zod.def

const isPrimitiveLiteral = (value: unknown): value is string | number | boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'

const isPrimitiveLiteralArray = (values: unknown[]): values is (string | number | boolean)[] =>
  values.every(isPrimitiveLiteral)

const isZodObject = (schema: z.ZodTypeAny): schema is z.ZodObject<z.ZodRawShape> => zodDef(schema).type === 'object'

const isStringArray = (values: unknown[]): values is string[] =>
  values.every((value) => typeof value === 'string')

const withDescription = <T extends z.ZodTypeAny>(schema: T, description: string | undefined): T =>
  description === undefined ? schema : (schema.describe(description) as T)

const derivePublishedNode = (schema: z.ZodTypeAny): z.ZodTypeAny => {
  const def = zodDef(schema)
  switch (def.type) {
    case 'string':
      return withDescription(z.string(), schema.description)
    case 'number':
      return withDescription(z.number(), schema.description)
    case 'boolean':
      return withDescription(z.boolean(), schema.description)
    case 'literal': {
      const values = def.values ?? []
      if (values.length === 0 || !isPrimitiveLiteralArray(values)) {
        throw new Error('register: literal schema carries no derivable primitive value')
      }
      return withDescription(z.literal(values), schema.description)
    }
    case 'enum': {
      const values = Object.values(def.entries ?? {})
      if (values.length === 0 || !isStringArray(values)) {
        throw new Error('register: enum schema carries no derivable string values')
      }
      return withDescription(z.enum(values as [string, ...string[]]), schema.description)
    }
    case 'optional': {
      if (def.innerType === undefined) {
        throw new Error('register: optional schema carries no inner type')
      }
      return withDescription(derivePublishedNode(def.innerType).optional(), schema.description)
    }
    case 'nullable': {
      if (def.innerType === undefined) {
        throw new Error('register: nullable schema carries no inner type')
      }
      return withDescription(derivePublishedNode(def.innerType).nullable(), schema.description)
    }
    case 'array': {
      if (def.element === undefined) {
        throw new Error('register: array schema carries no element type')
      }
      return withDescription(z.array(derivePublishedNode(def.element)), schema.description)
    }
    case 'union': {
      const options = def.options
      if (options === undefined || options.length < 2) {
        throw new Error('register: union schema carries fewer than two derivable options')
      }
      const derivedOptions = options.map(derivePublishedNode)
      if (def.discriminator !== undefined) {
        if (!derivedOptions.every(isZodObject)) {
          throw new Error('register: discriminated union schema carries a non-object option')
        }
        const discriminableOptions = derivedOptions as [
          z.ZodObject<z.ZodRawShape>,
          z.ZodObject<z.ZodRawShape>,
          ...z.ZodObject<z.ZodRawShape>[]
        ]
        return withDescription(z.discriminatedUnion(def.discriminator, discriminableOptions), schema.description)
      }
      const unionOptions = derivedOptions as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]
      return withDescription(z.union(unionOptions), schema.description)
    }
    case 'object': {
      if (def.shape === undefined) {
        throw new Error('register: object schema carries no shape')
      }
      const publishedShape: z.ZodRawShape = Object.fromEntries(
        Object.entries(def.shape).map(([key, value]) => [key, derivePublishedNode(value)])
      )
      return withDescription(z.object(publishedShape).passthrough(), schema.description)
    }
    default:
      throw new Error(`register: input schema node type "${def.type}" has no published-schema derivation`)
  }
}

const derivePublishedInputSchema = (schema: z.ZodObject<z.ZodRawShape>): z.ZodTypeAny => derivePublishedNode(schema)

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
  const publishedInput = derivePublishedInputSchema(spec.input)

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
