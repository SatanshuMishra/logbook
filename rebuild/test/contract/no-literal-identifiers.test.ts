import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

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

const isAssertCallee = (expr: ts.Expression): boolean => {
  if (ts.isIdentifier(expr)) return expr.text === 'assert'
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression)) return expr.expression.text === 'assert'
  return false
}

const isInsideAssertCall = (node: ts.Node): boolean => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isCallExpression(current)) return isAssertCallee(current.expression)
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

const collectLiteralCandidate = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  relFile: string,
  node: ts.StringLiteral
): LiteralCandidate => {
  const insideAssertCall = isInsideAssertCall(node)
  const base = { file: relFile, line: lineOf(sourceFile, node), text: node.text, insideAssertCall }
  const parent = node.parent

  if (!ts.isVariableDeclaration(parent) || parent.initializer !== node) {
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
  const hasOutsideReference = references.some((ref) => !isInsideAssertCall(ref))
  return { ...base, bindingShape: 'simple-identifier', hasOutsideReference }
}

const collectLiteralCandidates = (checker: ts.TypeChecker, sourceFile: ts.SourceFile, relFile: string): LiteralCandidate[] => {
  const found: LiteralCandidate[] = []
  forEachDescendant(sourceFile, (node) => {
    if (ts.isStringLiteral(node) && matchesIdentifierShape(node.text)) {
      found.push(collectLiteralCandidate(checker, sourceFile, relFile, node))
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
