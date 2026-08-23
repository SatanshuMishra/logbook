import type { z } from 'zod'
import type { Refusal } from './declare.ts'
import { type JsonSchemaNode, resolveNode, synthesise } from './example.ts'

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
  const keys = issue.keys.join(',')
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

const renderMessage = (field: string, accepted: string, example: string, retryable: boolean): string =>
  `${field} was refused; it accepts ${accepted}; a valid example is ${example}; retryable=${retryable}.`

export const refuse = (jsonSchema: Record<string, unknown>, issues: z.core.$ZodIssue[]): Refusal => {
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
  const message = renderMessage(field, accepted, example, retryable)

  return { ok: false, field, accepted, example, retryable, message }
}
