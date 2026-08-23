import { randomUUID } from 'node:crypto'
import type { Classified } from './census.ts'
import type { Refusal } from '../../src/schema/declare.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'

export type EmittedString = { path: string; value: string }

export const SENTINEL_TOKEN = `logbook-census-sentinel-${randomUUID()}`
export const SENTINEL_POSIX = `/private/tmp/${SENTINEL_TOKEN}/leak`
export const SENTINEL_WIN32 = `C:\\Users\\${SENTINEL_TOKEN}\\leak`

const LEGITIMATE_EXAMPLES = [
  '/Users/example/project',
  '/Users/example/.claude/plugin-data'
] as const

const POSIX_ABSOLUTE_PATTERN = /(^|[\s:'"(])\/[^\s'"]+\/[^\s'"]*/
const WIN32_ABSOLUTE_PATTERN = /(^|[\s:'"(])[A-Za-z]:\\[^\s'"]+/

export const refusalTemplate = (): Refusal => {
  const result = ThreadRecord.parse({})
  if (result.ok) {
    throw new Error('refusalTemplate: a guaranteed-invalid ThreadRecord input unexpectedly parsed')
  }
  return result
}

export const taintRefusal = (template: Refusal, sentinel: string): Refusal => {
  const keys = Object.keys(template)
  if (keys.length === 0) {
    throw new Error('taintRefusal: template has no enumerable keys to taint')
  }
  const tainted: Record<string, unknown> = {}
  for (const key of keys) {
    const value = (template as Record<string, unknown>)[key]
    if (typeof value === 'boolean') {
      tainted[key] = value
      continue
    }
    if (typeof value === 'string') {
      tainted[key] = `${value} ${sentinel}`
      continue
    }
    throw new Error(`taintRefusal: field "${key}" is neither string nor boolean`)
  }
  return tainted as Refusal
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const walkEmitted = (value: unknown, path: string, acc: EmittedString[]): void => {
  if (typeof value === 'string') {
    acc.push({ path, value })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkEmitted(entry, `${path}[${index}]`, acc))
    return
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const nextPath = path.length === 0 ? key : `${path}.${key}`
      walkEmitted(value[key], nextPath, acc)
    }
  }
}

export const emittedStrings = (value: unknown): EmittedString[] => {
  const acc: EmittedString[] = []
  walkEmitted(value, '', acc)
  return acc
}

export const classifyEmittedPath = (
  s: EmittedString
): Classified<EmittedString>['verdict'] | 'unclassifiable' => {
  let scrubbed = s.value
  for (const example of LEGITIMATE_EXAMPLES) {
    scrubbed = scrubbed.split(example).join('')
  }
  const looksLikePath = POSIX_ABSOLUTE_PATTERN.test(scrubbed) || WIN32_ABSOLUTE_PATTERN.test(scrubbed)
  return looksLikePath ? 'forbidden' : 'allowed'
}
