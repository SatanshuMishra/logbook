import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import * as ts from 'typescript'
import { SRC_ROOT, loadProgram, resolveAliasedSymbol, walkTsFiles } from './refusal-census.ts'
import type { ProducerId } from './refusal-census.ts'

export type ObjectDescentFamily = 'tool-handler' | 'record-methods'

export type ObjectDescentCandidate = { producer: ProducerId; family: ObjectDescentFamily }

const TOOL_SHAPE_FIELDS = ['name', 'title', 'description', 'input', 'output', 'annotations', 'handler'] as const
const TOOL_CALLABLE_FIELDS = ['handler'] as const

const RECORD_SHAPE_FIELDS = ['name', 'schema', 'jsonSchema', 'parse', 'refuse'] as const
const RECORD_CALLABLE_FIELDS = ['parse', 'refuse'] as const

const propertyTypeOf = (checker: ts.TypeChecker, type: ts.Type, field: string): ts.Type | undefined => {
  const property = type.getProperty(field)
  if (property === undefined) return undefined
  const declarations = property.declarations
  if (declarations === undefined || declarations.length === 0) return undefined
  return checker.getTypeOfSymbolAtLocation(property, declarations[0] as ts.Node)
}

const hasAllNamedFields = (type: ts.Type, fields: readonly string[]): boolean =>
  fields.every((field) => type.getProperty(field) !== undefined)

const hasAllCallableFields = (checker: ts.TypeChecker, type: ts.Type, fields: readonly string[]): boolean =>
  fields.every((field) => {
    const propertyType = propertyTypeOf(checker, type, field)
    return propertyType !== undefined && propertyType.getCallSignatures().length > 0
  })

const matchesToolHandlerShape = (checker: ts.TypeChecker, type: ts.Type): boolean =>
  hasAllNamedFields(type, TOOL_SHAPE_FIELDS) && hasAllCallableFields(checker, type, TOOL_CALLABLE_FIELDS)

const matchesRecordMethodsShape = (checker: ts.TypeChecker, type: ts.Type): boolean =>
  hasAllNamedFields(type, RECORD_SHAPE_FIELDS) && hasAllCallableFields(checker, type, RECORD_CALLABLE_FIELDS)

export const deriveObjectDescentCandidates = (): ObjectDescentCandidate[] => {
  const files = walkTsFiles(SRC_ROOT)
  const program = loadProgram()
  const checker = program.getTypeChecker()
  const candidates: ObjectDescentCandidate[] = []

  for (const file of files) {
    const relativeFile = path.relative(SRC_ROOT, file)
    const sourceFile = program.getSourceFile(file)
    if (sourceFile === undefined) {
      throw new Error(`deriveObjectDescentCandidates: ${relativeFile} is not part of the compiled program`)
    }
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) {
      throw new Error(`deriveObjectDescentCandidates: ${relativeFile} has no resolvable module symbol`)
    }
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const resolved = resolveAliasedSymbol(checker, exported)
      if ((resolved.flags & ts.SymbolFlags.Value) === 0) continue
      const type = checker.getTypeOfSymbol(resolved)
      if (type.getCallSignatures().length > 0) continue

      const isToolHandlerShape = matchesToolHandlerShape(checker, type)
      const isRecordMethodsShape = matchesRecordMethodsShape(checker, type)
      if (isToolHandlerShape && isRecordMethodsShape) {
        throw new Error(
          `deriveObjectDescentCandidates: "${exported.getName()}" in ${relativeFile} matches both known object-descent shapes`
        )
      }

      if (isToolHandlerShape) {
        candidates.push({ producer: `${relativeFile}#${exported.getName()}.handler`, family: 'tool-handler' })
        continue
      }
      if (isRecordMethodsShape) {
        candidates.push({ producer: `${relativeFile}#${exported.getName()}.parse`, family: 'record-methods' })
        candidates.push({ producer: `${relativeFile}#${exported.getName()}.refuse`, family: 'record-methods' })
      }
    }
  }

  return candidates
}

const TOOLS_DIR_RELATIVE = path.join('server', 'tools')
const SCHEMA_DIR_RELATIVE = 'schema'
const TOOLS_INDEX_FILE = 'index.ts'
const DECLARE_MODULE_FILE = 'declare.ts'
const DECLARE_ASSIGNMENT_PATTERN = /=\s*declare</

const listTsFilesRelativeTo = (relativeDir: string): string[] =>
  readdirSync(path.join(SRC_ROOT, relativeDir), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts'))
    .map((entry) => path.join(relativeDir, entry.name))

const requireNonEmptyDerivation = (derivationName: string, relativeDir: string, files: string[]): string[] => {
  if (files.length === 0) {
    throw new Error(`${derivationName}: derived no expected files under ${relativeDir}`)
  }
  return files
}

export const deriveExpectedToolHandlerFiles = (): string[] =>
  requireNonEmptyDerivation(
    'deriveExpectedToolHandlerFiles',
    TOOLS_DIR_RELATIVE,
    listTsFilesRelativeTo(TOOLS_DIR_RELATIVE).filter((relativeFile) => path.basename(relativeFile) !== TOOLS_INDEX_FILE)
  )

export const deriveExpectedRecordMethodsFiles = (): string[] =>
  requireNonEmptyDerivation(
    'deriveExpectedRecordMethodsFiles',
    SCHEMA_DIR_RELATIVE,
    listTsFilesRelativeTo(SCHEMA_DIR_RELATIVE)
      .filter((relativeFile) => path.basename(relativeFile) !== DECLARE_MODULE_FILE)
      .filter((relativeFile) => DECLARE_ASSIGNMENT_PATTERN.test(readFileSync(path.join(SRC_ROOT, relativeFile), 'utf8')))
  )

export const producerSourceFile = (producer: ProducerId): string => {
  const separatorIndex = producer.indexOf('#')
  if (separatorIndex === -1) {
    throw new Error(`producerSourceFile: "${producer}" has no "#" separator`)
  }
  return producer.slice(0, separatorIndex)
}
