import { randomUUID } from 'node:crypto'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
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

const KNOWN_PATTERN_CHECKED_PATHS = new Set(['content.type', 'content.text'])

const EXAMPLE_EXEMPTION_LENGTH_FLOOR = 4

const escapeForRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isExemptibleExample = (example: string): boolean => example.length >= EXAMPLE_EXEMPTION_LENGTH_FLOOR

const scrubAnchoredExampleOccurrences = (value: string, declaredExample: string): string => {
  if (!isExemptibleExample(declaredExample)) return value
  const escaped = escapeForRegex(declaredExample)
  const anchoredPattern = new RegExp(`(example:\\s*|a valid example is\\s*)${escaped}(?=[;\\n]|$)`, 'g')
  return value.replace(anchoredPattern, '$1')
}

export const classifyEmittedPath = (
  s: EmittedString
): Classified<EmittedString>['verdict'] | 'unclassifiable' => {
  const normalized = normalizePath(s.path)

  if (!KNOWN_PATTERN_CHECKED_PATHS.has(normalized)) {
    return 'unclassifiable'
  }

  const scrubbed = scrubAnchoredExampleOccurrences(s.value, s.declaredExample)
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

const TSCONFIG_PATH = fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
const DECLARE_MODULE_PATH = fileURLToPath(new URL('../../src/schema/declare.ts', import.meta.url))

const loadProgram = (): ts.Program => {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile)
  if (configFile.error !== undefined) {
    throw new Error(
      `scanRefusalProducers: failed to read ${TSCONFIG_PATH}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
    )
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(TSCONFIG_PATH))
  if (parsed.errors.length > 0) {
    const rendered = parsed.errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')
    throw new Error(`scanRefusalProducers: failed to parse ${TSCONFIG_PATH}: ${rendered}`)
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}

const findRefusalType = (program: ts.Program, checker: ts.TypeChecker): ts.Type => {
  const declareFile = program.getSourceFile(DECLARE_MODULE_PATH)
  if (declareFile === undefined) {
    throw new Error(`scanRefusalProducers: ${DECLARE_MODULE_PATH} is not part of the compiled program`)
  }
  const moduleSymbol = checker.getSymbolAtLocation(declareFile)
  if (moduleSymbol === undefined) {
    throw new Error('scanRefusalProducers: schema/declare.ts has no resolvable module symbol')
  }
  const refusalSymbol = checker.getExportsOfModule(moduleSymbol).find((symbol) => symbol.getName() === 'Refusal')
  if (refusalSymbol === undefined) {
    throw new Error('scanRefusalProducers: schema/declare.ts no longer exports a "Refusal" type')
  }
  return checker.getDeclaredTypeOfSymbol(refusalSymbol)
}

const resolveAliasedSymbol = (checker: ts.TypeChecker, symbol: ts.Symbol): ts.Symbol =>
  (symbol.flags & ts.SymbolFlags.Alias) !== 0 ? checker.getAliasedSymbol(symbol) : symbol

const carriesRefusalProperty = (checker: ts.TypeChecker, refusalType: ts.Type, constituent: ts.Type): boolean => {
  const refusalProperty = constituent.getProperty('refusal')
  if (refusalProperty === undefined) return false
  const declarations = refusalProperty.declarations
  if (declarations === undefined || declarations.length === 0) return false
  const propertyType = checker.getTypeOfSymbolAtLocation(refusalProperty, declarations[0] as ts.Node)
  return checker.isTypeAssignableTo(propertyType, refusalType)
}

const producesRefusal = (checker: ts.TypeChecker, refusalType: ts.Type, returnType: ts.Type): boolean => {
  const awaited = checker.getAwaitedType(returnType) ?? returnType
  const constituents = awaited.isUnion() ? awaited.types : [awaited]
  return constituents.some(
    (constituent) =>
      checker.isTypeAssignableTo(constituent, refusalType) || carriesRefusalProperty(checker, refusalType, constituent)
  )
}

export const scanRefusalProducers = (): ProducerId[] => {
  const files = walkTsFiles(SRC_ROOT)
  const program = loadProgram()
  const checker = program.getTypeChecker()
  const refusalType = findRefusalType(program, checker)
  const producers: ProducerId[] = []

  for (const file of files) {
    const relativeFile = path.relative(SRC_ROOT, file)
    const sourceFile = program.getSourceFile(file)
    if (sourceFile === undefined) {
      throw new Error(`scanRefusalProducers: ${relativeFile} is not part of the compiled program`)
    }
    const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile)
    if (syntacticDiagnostics.length > 0) {
      const rendered = syntacticDiagnostics
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('\n')
      throw new Error(`scanRefusalProducers: ${relativeFile} failed to parse: ${rendered}`)
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) {
      throw new Error(`scanRefusalProducers: ${relativeFile} has no resolvable module symbol`)
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAliasedSymbol(checker, exported)
      if ((resolved.flags & ts.SymbolFlags.Value) === 0) continue
      const type = checker.getTypeOfSymbol(resolved)
      const callSignatures = type.getCallSignatures()
      if (callSignatures.length === 0) continue
      const matches = callSignatures.some((signature) =>
        producesRefusal(checker, refusalType, checker.getReturnTypeOfSignature(signature))
      )
      if (matches) {
        producers.push(`${relativeFile}#${exported.getName()}`)
      }
    }
  }
  return producers
}
