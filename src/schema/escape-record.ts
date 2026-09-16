import type { Declared } from './declare.ts'
import { resolveNode, type JsonSchemaNode } from './example.ts'
import { escapeStored } from '../render/escape.ts'

const ESCAPED_CLASSES: ReadonlySet<string> = new Set(['content', 'pointer'])

const isNode = (value: unknown): value is JsonSchemaNode => typeof value === 'object' && value !== null && !Array.isArray(value)

const escapeByClass = (root: JsonSchemaNode, node: JsonSchemaNode, value: unknown, inherited: string | null): unknown => {
  const fieldClass = typeof node.class === 'string' ? node.class : inherited
  if (typeof value === 'string') {
    return fieldClass !== null && ESCAPED_CLASSES.has(fieldClass) ? escapeStored(value) : value
  }
  const shaped = resolveNode(root, node)
  if (Array.isArray(value)) {
    const items = shaped.items
    return isNode(items) ? value.map((entry) => escapeByClass(root, items, entry, fieldClass)) : value
  }
  if (isNode(value)) {
    const properties = isNode(shaped.properties) ? shaped.properties : {}
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => {
        const property = properties[key]
        return [key, isNode(property) ? escapeByClass(root, property, entry, fieldClass) : entry]
      })
    )
  }
  return value
}

export const escapeStoredRecord = <T>(declared: Declared<T>, record: T): T =>
  escapeByClass(declared.jsonSchema, declared.jsonSchema, record, null) as T
