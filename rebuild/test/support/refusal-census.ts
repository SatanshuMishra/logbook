import { randomUUID } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Classified } from './census.ts'
import type { Refusal } from '../../src/schema/declare.ts'
import { ThreadRecord } from '../../src/schema/thread.ts'

export type EmittedString = { path: string; value: string; declaredExample: string }

export const SENTINEL_TOKEN = `logbook-census-sentinel-${randomUUID()}`
export const SENTINEL_POSIX = `/private/tmp/${SENTINEL_TOKEN}/leak`
export const SENTINEL_WIN32 = `C:\\Users\\${SENTINEL_TOKEN}\\leak`

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

const walkEmitted = (value: unknown, path: string, declaredExample: string, acc: EmittedString[]): void => {
  if (typeof value === 'string') {
    acc.push({ path, value, declaredExample })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkEmitted(entry, `${path}[${index}]`, declaredExample, acc))
    return
  }
  if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      const nextPath = path.length === 0 ? key : `${path}.${key}`
      walkEmitted(value[key], nextPath, declaredExample, acc)
    }
  }
}

export const emittedStrings = (value: unknown, declaredExample: string): EmittedString[] => {
  const acc: EmittedString[] = []
  walkEmitted(value, '', declaredExample, acc)
  return acc
}

const normalizePath = (rawPath: string): string => rawPath.replace(/\[\d+\]/g, '')

const KNOWN_PATTERN_CHECKED_PATHS = new Set([
  'content.type',
  'content.text',
  'structuredContent.field',
  'structuredContent.accepted',
  'structuredContent.message',
  'structuredContent.ok',
  'structuredContent.retryable'
])

const KNOWN_EXAMPLE_PATH = 'structuredContent.example'

export const classifyEmittedPath = (
  s: EmittedString
): Classified<EmittedString>['verdict'] | 'unclassifiable' => {
  const normalized = normalizePath(s.path)

  if (normalized === KNOWN_EXAMPLE_PATH) {
    return s.value === s.declaredExample ? 'allowed' : 'unclassifiable'
  }

  if (!KNOWN_PATTERN_CHECKED_PATHS.has(normalized)) {
    return 'unclassifiable'
  }

  const scrubbed = s.declaredExample.length > 0 ? s.value.split(s.declaredExample).join('') : s.value
  const looksLikePath = POSIX_ABSOLUTE_PATTERN.test(scrubbed) || WIN32_ABSOLUTE_PATTERN.test(scrubbed)
  return looksLikePath ? 'forbidden' : 'allowed'
}

export type ProducerId = string

const SRC_ROOT = fileURLToPath(new URL('../../src', import.meta.url))

const walkTsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkTsFiles(full)
    if (!entry.isFile()) return []
    if (!entry.name.endsWith('.ts')) return []
    if (entry.name.endsWith('.test.ts')) return []
    return [full]
  })

const PRODUCER_SIGNATURE_PATTERN =
  /export const (\w+)\s*=\s*(?:<[^>]*>\s*)?\(([\s\S]*?)\)\s*:\s*([\s\S]*?)\s*=>\s*\{/g

export const scanRefusalProducers = (): ProducerId[] => {
  const files = walkTsFiles(SRC_ROOT)
  const producers: ProducerId[] = []
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    const relativeFile = path.relative(SRC_ROOT, file)
    for (const match of source.matchAll(PRODUCER_SIGNATURE_PATTERN)) {
      const name = match[1]
      const returnType = match[3]
      if (name === undefined || returnType === undefined) continue
      if (/\bRefusal\b|\bCasFailure\b/.test(returnType)) {
        producers.push(`${relativeFile}#${name}`)
      }
    }
  }
  return producers
}
