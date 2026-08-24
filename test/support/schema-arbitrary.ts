import { resolveNode, synthesise, type JsonSchemaNode } from '../../src/schema/example.ts'

export type { JsonSchemaNode } from '../../src/schema/example.ts'

export type ConstraintClass = 'required' | 'maxLength' | 'pattern' | 'minItems' | 'wrongType' | 'unknownKey'

export type Mutation = {
  class: ConstraintClass
  field: string
  input: Record<string, unknown>
}

export type MissingClass = { class: ConstraintClass; reason: string }

export type GeneratedCases = {
  valid: Record<string, unknown>
  mutations: Mutation[]
  missing: MissingClass[]
}

export const ALL_CONSTRAINT_CLASSES: readonly ConstraintClass[] = [
  'required',
  'maxLength',
  'pattern',
  'minItems',
  'wrongType',
  'unknownKey'
]

const isNode = (value: unknown): value is JsonSchemaNode =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const propertiesOf = (toolName: string, node: JsonSchemaNode): Record<string, JsonSchemaNode> => {
  const raw = node.properties
  if (!isNode(raw)) {
    throw new Error(`schema-arbitrary: ${toolName} published an object schema with no "properties" map`)
  }
  const out: Record<string, JsonSchemaNode> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!isNode(value)) {
      throw new Error(`schema-arbitrary: ${toolName}.${key} published a non-object schema node`)
    }
    out[key] = value
  }
  return out
}

const requiredOf = (node: JsonSchemaNode): string[] =>
  Array.isArray(node.required) ? node.required.filter((entry): entry is string => typeof entry === 'string') : []

const WRONG_TYPE_PROBES: Record<string, unknown> = {
  string: 12345,
  integer: 'not-a-number',
  number: 'not-a-number',
  boolean: 'not-a-boolean',
  array: 'not-an-array',
  object: 'not-an-object'
}

const wrongTypeValue = (toolName: string, field: string, node: JsonSchemaNode): unknown => {
  const type = node.type
  if (typeof type !== 'string') {
    throw new Error(`schema-arbitrary: ${toolName}.${field} published no "type" keyword; cannot derive a wrong-type probe`)
  }
  if (!(type in WRONG_TYPE_PROBES)) {
    throw new Error(`schema-arbitrary: ${toolName}.${field} published an unhandled type "${type}"`)
  }
  return WRONG_TYPE_PROBES[type]
}

const VIOLATION_PROBE_CHARS = ['!', '~', '#', '*', '@']

const violatePattern = (toolName: string, field: string, node: JsonSchemaNode, validValue: string): string => {
  const pattern = node.pattern
  if (typeof pattern !== 'string') {
    throw new Error(`schema-arbitrary: ${toolName}.${field} has no published pattern to violate`)
  }
  const regex = new RegExp(pattern)
  const length = Math.max(validValue.length, 1)
  for (const probe of VIOLATION_PROBE_CHARS) {
    const candidate = probe.repeat(length)
    if (!regex.test(candidate)) return candidate
  }
  throw new Error(`schema-arbitrary: ${toolName}.${field} - no probe character violates published pattern ${pattern}`)
}

const exceedMaxLength = (toolName: string, field: string, node: JsonSchemaNode): string => {
  const maxLength = node.maxLength
  if (typeof maxLength !== 'number') {
    throw new Error(`schema-arbitrary: ${toolName}.${field} has no published maxLength to exceed`)
  }
  return 'x'.repeat(maxLength + 1)
}

const shortArrayFor = (root: JsonSchemaNode, toolName: string, field: string, node: JsonSchemaNode): unknown[] => {
  const minItems = node.minItems
  if (typeof minItems !== 'number') {
    throw new Error(`schema-arbitrary: ${toolName}.${field} has no published minItems to undershoot`)
  }
  const items = node.items
  if (!isNode(items)) {
    throw new Error(`schema-arbitrary: ${toolName}.${field} declares minItems without a published items schema`)
  }
  const itemsNode = resolveNode(root, items)
  const length = Math.max(minItems - 1, 0)
  return Array.from({ length }, () => synthesise(root, itemsNode))
}

export const synthesiseValue = (root: JsonSchemaNode, node: JsonSchemaNode): unknown => synthesise(root, node)

export const buildValidInstance = (
  toolName: string,
  schema: JsonSchemaNode,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> => {
  if (schema.type !== 'object') {
    throw new Error(`schema-arbitrary: ${toolName} published a non-object root schema, which this generator does not support`)
  }
  const base = synthesise(schema, schema)
  if (!isNode(base)) {
    throw new Error(`schema-arbitrary: ${toolName} synthesised a non-object instance from an object schema`)
  }
  return { ...base, ...overrides }
}

const pushMutation = (
  mutations: Mutation[],
  seen: Set<ConstraintClass>,
  constraintClass: ConstraintClass,
  field: string,
  input: Record<string, unknown>
): void => {
  seen.add(constraintClass)
  mutations.push({ class: constraintClass, field, input })
}

const generateNestedMutations = (
  toolName: string,
  schema: JsonSchemaNode,
  key: string,
  arrayNode: JsonSchemaNode,
  validBase: Record<string, unknown>,
  mutations: Mutation[],
  seen: Set<ConstraintClass>
): void => {
  const items = arrayNode.items
  if (!isNode(items)) return
  const itemsNode = resolveNode(schema, items)

  if (itemsNode.type === 'object') {
    const itemProperties = propertiesOf(`${toolName}.${key}[]`, itemsNode)
    const goodItem = synthesise(schema, itemsNode)
    if (!isNode(goodItem)) {
      throw new Error(`schema-arbitrary: ${toolName}.${key} items synthesised a non-object instance`)
    }
    for (const [subKey, subRawNode] of Object.entries(itemProperties)) {
      const subNode = resolveNode(schema, subRawNode)
      const subGoodValue = synthesise(schema, subNode)
      const nestedField = `${key}.0.${subKey}`
      const withNestedField = (corrupted: unknown): Record<string, unknown> => ({
        ...validBase,
        [key]: [{ ...goodItem, [subKey]: corrupted }]
      })
      if (typeof subNode.maxLength === 'number' && typeof subGoodValue === 'string') {
        pushMutation(mutations, seen, 'maxLength', nestedField, withNestedField(exceedMaxLength(toolName, nestedField, subNode)))
      }
      if (typeof subNode.pattern === 'string' && typeof subGoodValue === 'string') {
        pushMutation(mutations, seen, 'pattern', nestedField, withNestedField(violatePattern(toolName, nestedField, subNode, subGoodValue)))
      }
      pushMutation(mutations, seen, 'wrongType', nestedField, withNestedField(wrongTypeValue(toolName, nestedField, subNode)))
    }
    return
  }

  const subGoodValue = synthesise(schema, itemsNode)
  const itemField = `${key}.0`
  const withItemField = (corrupted: unknown): Record<string, unknown> => ({ ...validBase, [key]: [corrupted] })
  if (typeof itemsNode.maxLength === 'number' && typeof subGoodValue === 'string') {
    pushMutation(mutations, seen, 'maxLength', itemField, withItemField(exceedMaxLength(toolName, itemField, itemsNode)))
  }
  if (typeof itemsNode.pattern === 'string' && typeof subGoodValue === 'string') {
    pushMutation(mutations, seen, 'pattern', itemField, withItemField(violatePattern(toolName, itemField, itemsNode, subGoodValue)))
  }
}

export const generateSchemaCases = (
  toolName: string,
  schema: JsonSchemaNode,
  overrides: Record<string, unknown> = {}
): GeneratedCases => {
  if (schema.type !== 'object') {
    throw new Error(`schema-arbitrary: ${toolName} published a non-object root schema, which this generator does not support`)
  }
  const properties = propertiesOf(toolName, schema)
  const required = requiredOf(schema)
  const validBase = buildValidInstance(toolName, schema, overrides)

  const mutations: Mutation[] = []
  const seen = new Set<ConstraintClass>()

  if (schema.additionalProperties === false) {
    const unknownKey = '__logbook_unexpected_field__'
    pushMutation(mutations, seen, 'unknownKey', unknownKey, { ...validBase, [unknownKey]: true })
  }

  for (const key of required) {
    const dropped = { ...validBase }
    delete dropped[key]
    pushMutation(mutations, seen, 'required', key, dropped)
  }

  for (const [key, rawNode] of Object.entries(properties)) {
    const node = resolveNode(schema, rawNode)
    const goodValue = key in overrides ? overrides[key] : synthesise(schema, node)
    const withField = (corrupted: unknown): Record<string, unknown> => ({ ...validBase, [key]: corrupted })

    if (typeof node.maxLength === 'number' && typeof goodValue === 'string') {
      pushMutation(mutations, seen, 'maxLength', key, withField(exceedMaxLength(toolName, key, node)))
    }
    if (typeof node.pattern === 'string' && typeof goodValue === 'string') {
      pushMutation(mutations, seen, 'pattern', key, withField(violatePattern(toolName, key, node, goodValue)))
    }
    if (node.type === 'array' && typeof node.minItems === 'number') {
      pushMutation(mutations, seen, 'minItems', key, withField(shortArrayFor(schema, toolName, key, node)))
    }
    pushMutation(mutations, seen, 'wrongType', key, withField(wrongTypeValue(toolName, key, node)))

    if (node.type === 'array') {
      generateNestedMutations(toolName, schema, key, node, validBase, mutations, seen)
    }
  }

  const missing: MissingClass[] = ALL_CONSTRAINT_CLASSES.filter((c) => !seen.has(c)).map((c) => ({
    class: c,
    reason: `${toolName}'s published input schema carries no constraint of class "${c}"`
  }))

  return { valid: validBase, mutations, missing }
}
