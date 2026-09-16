import { isDeepStrictEqual } from 'node:util'

const ROOT_PATH = '(root)'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isIdKeyedList = (value: unknown): value is { id: string }[] =>
  Array.isArray(value) && value.every((item) => isPlainObject(item) && typeof item.id === 'string')

const childPath = (prefix: string, key: string): string => (prefix === '' ? key : `${prefix}.${key}`)

const sortedUnion = (left: Iterable<string>, right: Iterable<string>): string[] => [...new Set([...left, ...right])].sort()

const differencesAt = (prefix: string, before: unknown, after: unknown): string[] => {
  if (isDeepStrictEqual(before, after)) return []
  if (isPlainObject(before) && isPlainObject(after)) {
    return sortedUnion(Object.keys(before), Object.keys(after)).flatMap((key) =>
      differencesAt(childPath(prefix, key), before[key], after[key])
    )
  }
  if (prefix !== '' && isIdKeyedList(before) && isIdKeyedList(after)) {
    const beforeById = new Map(before.map((item) => [item.id, item] as const))
    const afterById = new Map(after.map((item) => [item.id, item] as const))
    return sortedUnion(beforeById.keys(), afterById.keys()).flatMap((id) =>
      differencesAt(`${prefix}[${id}]`, beforeById.get(id), afterById.get(id))
    )
  }
  return [prefix === '' ? ROOT_PATH : prefix]
}

export const differingJsonPaths = (before: unknown, after: unknown): string[] => differencesAt('', before, after)
