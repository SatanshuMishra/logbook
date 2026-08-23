import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { findNamedImportSymbols, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

type DirCandidate = { file: string; line: number; kind: string; verdict: 'allowed' | 'forbidden' | 'unclassifiable' }

const NODE_FS_MODULE_SPECIFIERS = ['node:fs', 'fs']
const NODE_FS_DIR_FUNCTIONS = ['mkdtemp', 'mkdtempSync', 'mkdir', 'mkdirSync', 'cp', 'cpSync']
const CHILD_PROCESS_MODULE_SPECIFIERS = ['node:child_process', 'child_process']
const CHILD_PROCESS_FUNCTIONS = ['spawn', 'spawnSync', 'exec', 'execSync']

const CLOCK_IDENTIFIER_NAMES: ReadonlySet<string> = new Set(['Date', 'performance'])
const CLOCK_PROPERTY_NAMES: ReadonlySet<string> = new Set(['now', 'toISOString', 'hrtime'])

const referencesClock = (node: ts.Node): boolean => {
  let found = false
  forEachDescendant(node, (candidate) => {
    if (found) return
    if (ts.isIdentifier(candidate) && CLOCK_IDENTIFIER_NAMES.has(candidate.text)) found = true
    else if (ts.isPropertyAccessExpression(candidate) && CLOCK_PROPERTY_NAMES.has(candidate.name.text)) found = true
  })
  return found
}

const containsMkdirText = (node: ts.Node): boolean => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text.includes(['mk', 'dir'].join(''))
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.some((element) => containsMkdirText(element))
  }
  return false
}

const classifyDirCall = (relFile: string, sourceFile: ts.SourceFile, node: ts.CallExpression, importedName: string): DirCandidate => {
  const line = lineOf(sourceFile, node)
  if (importedName === 'mkdtemp' || importedName === 'mkdtempSync') {
    return { file: relFile, line, kind: importedName, verdict: 'allowed' }
  }
  if (importedName === 'cp' || importedName === 'cpSync') {
    return { file: relFile, line, kind: importedName, verdict: 'unclassifiable' }
  }
  const pathArg = node.arguments[0]
  const clockReferenced = pathArg !== undefined && referencesClock(pathArg)
  return { file: relFile, line, kind: importedName, verdict: clockReferenced ? 'forbidden' : 'allowed' }
}

const collectDirCandidates = (checker: ts.TypeChecker, sourceFile: ts.SourceFile, relFile: string): DirCandidate[] => {
  const found: DirCandidate[] = []
  const fsImports = findNamedImportSymbols(checker, sourceFile, NODE_FS_MODULE_SPECIFIERS, NODE_FS_DIR_FUNCTIONS)
  const childProcessImports = findNamedImportSymbols(
    checker,
    sourceFile,
    CHILD_PROCESS_MODULE_SPECIFIERS,
    CHILD_PROCESS_FUNCTIONS
  )

  forEachDescendant(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || !ts.isIdentifier(node.expression)) return
    const symbol = checker.getSymbolAtLocation(node.expression)
    if (symbol === undefined) return

    const fsFunctionName = fsImports.get(symbol)
    if (fsFunctionName !== undefined) {
      found.push(classifyDirCall(relFile, sourceFile, node, fsFunctionName))
      return
    }

    if (childProcessImports.has(symbol) && node.arguments.some((arg) => containsMkdirText(arg))) {
      found.push({ file: relFile, line: lineOf(sourceFile, node), kind: 'spawned-mkdir', verdict: 'unclassifiable' })
    }
  })

  return found
}

const classifyCandidate = (candidate: DirCandidate): Classified<DirCandidate>['verdict'] | 'unclassifiable' => candidate.verdict

const KNOWN_LIMIT_MESSAGE =
  'this census does not decide where a mkdir root came from; it needs cross-function taint tracking the checker cannot do'

test('contract.temp-dirs-are-atomic', () => {
  const { checker, program, testFiles } = loadSourceProgram()
  const population = testFiles.flatMap((file) =>
    collectDirCandidates(checker, sourceFileFor(program, file), relativeToRoot(file))
  )
  assert.ok(population.length > 0, 'expected at least one mkdir/mkdtemp call in the test partition')

  assert.doesNotThrow(() => census(population, classifyCandidate), KNOWN_LIMIT_MESSAGE)

  const synthetic: DirCandidate[] = [{ file: 'support/clone-fixture.ts', line: 1, kind: 'mkdirSync', verdict: 'forbidden' }]
  assert.throws(() => census(synthetic, classifyCandidate))
})

test('contract.temp-dirs-are-atomic.halts-on-a-copy-or-spawned-mkdir', () => {
  const synthetic: DirCandidate[] = [
    { file: 'support/clone-fixture.ts', line: 1, kind: 'cpSync', verdict: 'unclassifiable' }
  ]
  assert.throws(() => census(synthetic, classifyCandidate))
})
