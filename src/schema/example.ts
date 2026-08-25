import { ULID_PATTERN, SLUG_PATTERN, ISO_PATTERN } from './ids.ts'

export type JsonSchemaNode = Record<string, unknown>

const isNode = (value: unknown): value is JsonSchemaNode =>
  typeof value === 'object' && value !== null

export const resolveRef = (root: JsonSchemaNode, node: JsonSchemaNode): JsonSchemaNode => {
  const ref = node.$ref
  if (typeof ref !== 'string') {
    return node
  }
  const segments = ref.replace(/^#\//, '').split('/')
  let cursor: unknown = root
  for (const segment of segments) {
    if (!isNode(cursor)) {
      return node
    }
    cursor = cursor[segment]
  }
  return isNode(cursor) ? cursor : node
}

export const resolveNode = (root: JsonSchemaNode, node: JsonSchemaNode): JsonSchemaNode => {
  const withRef = resolveRef(root, node)
  const hasStructure = 'type' in withRef || 'properties' in withRef || 'items' in withRef
  if (!hasStructure && Array.isArray(withRef.anyOf)) {
    const members = (withRef.anyOf as unknown[]).filter(isNode)
    const nonNull = members.find((member) => resolveRef(root, member).type !== 'null')
    const chosen = nonNull ?? members[0]
    return chosen === undefined ? withRef : resolveNode(root, chosen)
  }
  return withRef
}

const synthesiseString = (node: JsonSchemaNode): string => {
  const pattern = typeof node.pattern === 'string' ? node.pattern : undefined
  if (pattern === ULID_PATTERN.source) {
    return '0'.repeat(26)
  }
  if (pattern === SLUG_PATTERN.source) {
    return 'a'
  }
  if (pattern === ISO_PATTERN.source) {
    return '2024-01-01T00:00:00.000Z'
  }
  const minLength = typeof node.minLength === 'number' ? node.minLength : 0
  const maxLength = typeof node.maxLength === 'number' ? node.maxLength : undefined
  const desired = Math.max(minLength, 1)
  const length = maxLength !== undefined ? Math.min(desired, Math.max(maxLength, minLength)) : desired
  return 'x'.repeat(length)
}

const synthesiseNumber = (node: JsonSchemaNode): number => {
  const minimum = typeof node.minimum === 'number' ? node.minimum : 0
  return minimum
}

const synthesiseEnum = (node: JsonSchemaNode): unknown => {
  const values = node.enum
  if (Array.isArray(values) && values.length > 0) {
    return values[0]
  }
  return null
}

const synthesiseObject = (root: JsonSchemaNode, node: JsonSchemaNode): Record<string, unknown> => {
  const properties = isNode(node.properties) ? (node.properties as Record<string, unknown>) : {}
  const required = Array.isArray(node.required) ? (node.required as unknown[]) : []
  const result: Record<string, unknown> = {}
  for (const key of required) {
    if (typeof key !== 'string') {
      continue
    }
    const propNode = properties[key]
    if (isNode(propNode)) {
      result[key] = synthesise(root, propNode)
    }
  }
  return result
}

const synthesiseArray = (root: JsonSchemaNode, node: JsonSchemaNode): unknown[] => {
  const minItems = typeof node.minItems === 'number' ? node.minItems : 0
  const items = node.items
  if (!isNode(items)) {
    return []
  }
  const result: unknown[] = []
  for (let i = 0; i < minItems; i += 1) {
    result.push(synthesise(root, items))
  }
  return result
}

export const synthesise = (root: JsonSchemaNode, node: JsonSchemaNode): unknown => {
  const resolved = resolveNode(root, node)
  if (Array.isArray(resolved.enum)) {
    return synthesiseEnum(resolved)
  }
  const type = resolved.type
  if (type === 'string') {
    return synthesiseString(resolved)
  }
  if (type === 'integer' || type === 'number') {
    return synthesiseNumber(resolved)
  }
  if (type === 'boolean') {
    return true
  }
  if (type === 'array') {
    return synthesiseArray(root, resolved)
  }
  if (type === 'object') {
    return synthesiseObject(root, resolved)
  }
  if (type === 'null') {
    return null
  }
  return null
}
