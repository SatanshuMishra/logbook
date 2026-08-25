import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import {
  REBUILD_ROOT,
  findDefaultImportSymbols,
  findNamedImportSymbols,
  forEachDescendant,
  lineOf,
  loadSourceProgram,
  relativeToRoot,
  sourceFileFor
} from '../support/source-census.ts'

const ASSERT_MODULE_SPECIFIERS = ['node:assert', 'assert', 'node:assert/strict', 'assert/strict']
const ASSERT_FUNCTION_NAMES = [
  'ok',
  'equal',
  'notEqual',
  'strictEqual',
  'notStrictEqual',
  'deepEqual',
  'notDeepEqual',
  'deepStrictEqual',
  'notDeepStrictEqual',
  'match',
  'doesNotMatch',
  'throws',
  'doesNotThrow',
  'ifError',
  'rejects',
  'doesNotReject',
  'fail'
]

type AssertSymbols = { defaults: Set<ts.Symbol>; named: Set<ts.Symbol> }

type BindingShape = 'none' | 'simple-identifier' | 'unresolvable'

type LiteralCandidate = {
  file: string
  line: number
  text: string
  insideAssertCall: boolean
  bindingShape: BindingShape
  hasOutsideReference: boolean | null
}

const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/i
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

const matchesIdentifierShape = (text: string): boolean => ULID_PATTERN.test(text) || TIMESTAMP_PATTERN.test(text)

const findAssertSymbols = (checker: ts.TypeChecker, sourceFile: ts.SourceFile): AssertSymbols => ({
  defaults: findDefaultImportSymbols(checker, sourceFile, ASSERT_MODULE_SPECIFIERS),
  named: new Set(findNamedImportSymbols(checker, sourceFile, ASSERT_MODULE_SPECIFIERS, ASSERT_FUNCTION_NAMES).keys())
})

const isAssertCallee = (checker: ts.TypeChecker, assertSymbols: AssertSymbols, expr: ts.Expression): boolean => {
  if (ts.isIdentifier(expr)) {
    const symbol = checker.getSymbolAtLocation(expr)
    return symbol !== undefined && assertSymbols.named.has(symbol)
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) {
    const symbol = checker.getSymbolAtLocation(expr.expression)
    return symbol !== undefined && assertSymbols.defaults.has(symbol)
  }
  return false
}

const isInsideAssertCall = (checker: ts.TypeChecker, assertSymbols: AssertSymbols, node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isCallExpression(current) && isAssertCallee(checker, assertSymbols, current.expression)) return true
    current = current.parent
  }
  return false
}

const findReferences = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  symbol: ts.Symbol,
  declarationName: ts.Node
): ts.Identifier[] => {
  const refs: ts.Identifier[] = []
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isIdentifier(node) || node === declarationName) return
    if (checker.getSymbolAtLocation(node) === symbol) refs.push(node)
  })
  return refs
}

const unwrapArrayLiteralWrappers = (node: ts.Node): ts.Node => {
  let current = node
  while (current.parent !== undefined && ts.isArrayLiteralExpression(current.parent)) {
    current = current.parent
  }
  return current
}

const collectLiteralCandidate = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  relFile: string,
  assertSymbols: AssertSymbols,
  node: ts.StringLiteral
): LiteralCandidate => {
  const insideAssertCall = isInsideAssertCall(checker, assertSymbols, node)
  const base = { file: relFile, line: lineOf(sourceFile, node), text: node.text, insideAssertCall }
  const bindingRoot = unwrapArrayLiteralWrappers(node)
  const parent = bindingRoot.parent

  if (parent === undefined || !ts.isVariableDeclaration(parent) || parent.initializer !== bindingRoot) {
    return { ...base, bindingShape: 'none', hasOutsideReference: null }
  }
  if (!ts.isIdentifier(parent.name)) {
    return { ...base, bindingShape: 'unresolvable', hasOutsideReference: null }
  }
  const symbol = checker.getSymbolAtLocation(parent.name)
  if (symbol === undefined) {
    return { ...base, bindingShape: 'unresolvable', hasOutsideReference: null }
  }
  const references = findReferences(checker, sourceFile, symbol, parent.name)
  if (references.length === 0) {
    return { ...base, bindingShape: 'unresolvable', hasOutsideReference: null }
  }
  const hasOutsideReference = references.some((ref) => !isInsideAssertCall(checker, assertSymbols, ref))
  return { ...base, bindingShape: 'simple-identifier', hasOutsideReference }
}

const collectLiteralCandidates = (checker: ts.TypeChecker, sourceFile: ts.SourceFile, relFile: string): LiteralCandidate[] => {
  const found: LiteralCandidate[] = []
  const assertSymbols = findAssertSymbols(checker, sourceFile)
  forEachDescendant(sourceFile, (node) => {
    if (ts.isStringLiteral(node) && matchesIdentifierShape(node.text)) {
      found.push(collectLiteralCandidate(checker, sourceFile, relFile, assertSymbols, node))
    }
  })
  return found
}

const classifyLiteral = (candidate: LiteralCandidate): Classified<LiteralCandidate>['verdict'] | 'unclassifiable' => {
  if (candidate.insideAssertCall) return 'forbidden'
  if (candidate.bindingShape === 'unresolvable') return 'unclassifiable'
  if (candidate.bindingShape === 'none') return 'allowed'
  if (candidate.hasOutsideReference === null) return 'unclassifiable'
  return candidate.hasOutsideReference ? 'allowed' : 'forbidden'
}

test('contract.no-literal-identifiers', () => {
  const { checker, program, testFiles } = loadSourceProgram()
  const population = testFiles.flatMap((file) =>
    collectLiteralCandidates(checker, sourceFileFor(program, file), relativeToRoot(file))
  )
  assert.ok(population.length > 0, 'expected at least one ULID- or timestamp-shaped literal in the test partition')

  assert.doesNotThrow(() => census(population, classifyLiteral))

  const synthetic: LiteralCandidate[] = [
    {
      file: 'unit/field-merge.test.ts',
      line: 1,
      text: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      insideAssertCall: true,
      bindingShape: 'none',
      hasOutsideReference: null
    }
  ]
  assert.throws(() => census(synthetic, classifyLiteral))
})

test('contract.no-literal-identifiers.halts-on-a-binding-only-referenced-inside-assertions', () => {
  const synthetic: LiteralCandidate[] = [
    {
      file: 'unit/field-merge.test.ts',
      line: 1,
      text: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      insideAssertCall: false,
      bindingShape: 'simple-identifier',
      hasOutsideReference: false
    }
  ]
  assert.throws(() => census(synthetic, classifyLiteral))
})

test('contract.no-literal-identifiers.halts-on-an-unresolvable-binding-shape', () => {
  const synthetic: LiteralCandidate[] = [
    {
      file: 'unit/field-merge.test.ts',
      line: 1,
      text: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      insideAssertCall: false,
      bindingShape: 'unresolvable',
      hasOutsideReference: null
    }
  ]
  assert.throws(() => census(synthetic, classifyLiteral))
})

test('contract.no-literal-identifiers.collector-catches-a-named-assert-import-and-an-array-bound-literal', () => {
  const { checker, program } = loadSourceProgram()
  const fixturePath = path.join(REBUILD_ROOT, 'test', 'fixtures', 'no-literal-identifiers-violation.ts')
  const sourceFile = sourceFileFor(program, fixturePath)
  const relFile = relativeToRoot(fixturePath)
  const candidates = collectLiteralCandidates(checker, sourceFile, relFile)
  assert.ok(candidates.length >= 2, `expected the collector to find both literal shapes, found ${candidates.length}`)
  assert.throws(() => census(candidates, classifyLiteral))
})
