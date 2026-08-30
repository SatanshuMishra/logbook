import type { z } from 'zod'
import type { Refusal } from './declare.ts'
import { type JsonSchemaNode, resolveNode, synthesise } from './example.ts'
import { clipGraphemes, escapeStored } from '../render/escape.ts'
import * as caps from './caps.ts'

const isNode = (value: unknown): value is JsonSchemaNode =>
  typeof value === 'object' && value !== null

const nodeAtPath = (root: JsonSchemaNode, path: (string | number | symbol)[]): JsonSchemaNode => {
  let cursor: JsonSchemaNode = root
  for (const segment of path) {
    const resolved = resolveNode(root, cursor)
    if (typeof segment === 'number') {
      const items = resolved.items
      cursor = isNode(items) ? items : resolved
      continue
    }
    const properties = resolved.properties
    const key = String(segment)
    if (isNode(properties) && key in properties) {
      const next = (properties as Record<string, unknown>)[key]
      cursor = isNode(next) ? next : resolved
      continue
    }
    cursor = resolved
  }
  return cursor
}

const renderField = (path: (string | number | symbol)[]): string =>
  path.length === 0 ? '(root)' : path.map((segment) => String(segment)).join('.')

const renderUnrecognizedKeysField = (issue: z.core.$ZodIssue): string | null => {
  if (issue.code !== 'unrecognized_keys') return null
  const prefix = issue.path.map((segment) => String(segment)).join('.')
  const escapedKeys = issue.keys.map((key) => clipGraphemes(escapeStored(key), caps.UNRECOGNIZED_KEY_NAME_MAX))
  const shown = escapedKeys.slice(0, caps.UNRECOGNIZED_KEYS_SHOWN_MAX)
  const remainder = escapedKeys.length - shown.length
  const keys = remainder > 0 ? `${shown.join(',')} (+${remainder} more)` : shown.join(',')
  return prefix.length === 0 ? keys : `${prefix}.${keys}`
}

const ACCEPTED_KEYS = [
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'pattern',
  'enum',
  'minItems',
  'maxItems'
] as const

const renderAccepted = (node: JsonSchemaNode): string => {
  const parts: string[] = []
  if (typeof node.type === 'string') {
    parts.push(node.type)
  }
  for (const key of ACCEPTED_KEYS) {
    if (key in node) {
      const value = node[key]
      const rendered = Array.isArray(value) ? value.join(',') : String(value)
      parts.push(`${key}=${rendered}`)
    }
  }
  if (typeof node.description === 'string' && node.description.length > 0) {
    parts.push(node.description)
  }
  return parts.join(' ')
}

const renderExample = (root: JsonSchemaNode, node: JsonSchemaNode): string => {
  const raw = synthesise(root, node)
  return typeof raw === 'string' ? raw : JSON.stringify(raw)
}

const isNonRetryable = (issue: z.core.$ZodIssue): boolean => issue.code === 'custom'

const valueAtPath = (input: unknown, path: (string | number | symbol)[]): unknown => {
  let cursor: unknown = input
  for (const segment of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[String(segment)]
  }
  return cursor
}

const renderObserved = (input: unknown, issue: z.core.$ZodIssue): string | null => {
  const value = valueAtPath(input, issue.path)
  if (typeof value === 'string') return `${value.length} characters`
  if (Array.isArray(value)) return `${value.length} entries`
  return null
}

const renderRemedy = (issue: z.core.$ZodIssue): string => {
  if (issue.code === 'too_big' && issue.origin === 'array') {
    return `remove entries until at most ${String(issue.maximum)} remain and retry`
  }
  if (issue.code === 'too_big') {
    return `shorten the value to at most ${String(issue.maximum)} and retry`
  }
  if (issue.code === 'too_small') {
    return `lengthen the value to at least ${String(issue.minimum)} and retry`
  }
  return 'send a value matching what this field accepts and retry'
}

const renderMessage = (
  field: string,
  accepted: string,
  observed: string | null,
  example: string,
  remedy: string,
  retryable: boolean
): string => {
  const observedClause = observed === null ? '' : `observed ${observed}; `
  return `${field} was refused; it accepts ${accepted}; ${observedClause}a valid example is ${example}; remedy: ${remedy}; retryable=${retryable}.`
}

export const refuse = (
  jsonSchema: Record<string, unknown>,
  issues: z.core.$ZodIssue[],
  input?: unknown
): Refusal => {
  const issue = issues[0]
  if (issue === undefined) {
    throw new Error('refuse called with no issues to derive a refusal from')
  }
  const outerNode = nodeAtPath(jsonSchema, issue.path)
  const resolvedNode = resolveNode(jsonSchema, outerNode)
  const effectiveNode: JsonSchemaNode = { ...resolvedNode, ...outerNode }

  const field = renderUnrecognizedKeysField(issue) ?? renderField(issue.path)
  const accepted = renderAccepted(effectiveNode)
  const example = renderExample(jsonSchema, outerNode)
  const retryable = !isNonRetryable(issue)
  const observed = renderObserved(input, issue)
  const message = renderMessage(field, accepted, observed, example, renderRemedy(issue), retryable)

  return { ok: false, field, accepted, example, retryable, message }
}
