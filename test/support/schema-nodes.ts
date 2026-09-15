export type SchemaNode = { path: string; value: unknown }

export const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const NON_SCALAR_KEYS = ['anyOf', 'oneOf', 'allOf', '$defs', '$ref', 'properties', 'items', 'additionalProperties'] as const

const isBareNullNode = (value: unknown): boolean =>
  isPlainObject(value) && value.type === 'null' && Object.keys(value).length === 1

export const nullableScalarMemberOf = (node: Record<string, unknown>): Record<string, unknown> | undefined => {
  const members = node.anyOf
  if (!Array.isArray(members) || members.length !== 2) return undefined
  if ('type' in node || 'oneOf' in node || 'allOf' in node) return undefined
  const nonNull = members.filter((member) => !isBareNullNode(member))
  const [member] = nonNull
  if (nonNull.length !== 1 || !isPlainObject(member)) return undefined
  return NON_SCALAR_KEYS.some((key) => key in member) ? undefined : member
}

export const flattenSchemaNodes = (value: unknown, path: string): SchemaNode[] => {
  if (!isPlainObject(value)) return []

  const collected: SchemaNode[] = []

  const properties = value.properties
  if (properties !== undefined) {
    if (!isPlainObject(properties)) {
      collected.push({ path: `${path}.properties`, value: properties })
    } else {
      for (const [key, child] of Object.entries(properties)) {
        const childPath = `${path}.${key}`
        collected.push({ path: childPath, value: child })
        collected.push(...flattenSchemaNodes(child, childPath))
      }
    }
  }

  const items = value.items
  if (items !== undefined) {
    const itemsPath = `${path}[]`
    collected.push({ path: itemsPath, value: items })
    collected.push(...flattenSchemaNodes(items, itemsPath))
  }

  return collected
}
