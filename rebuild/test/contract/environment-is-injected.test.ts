import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import {
  findNamedImportSymbols,
  forEachDescendant,
  isAmbientGlobal,
  lineOf,
  loadSourceProgram,
  relativeToRoot,
  sourceFileFor
} from '../support/source-census.ts'

type Capability = 'now' | 'ulid' | 'env' | 'cwd'

type EnvironmentCandidate = {
  file: string
  line: number
  capability: Capability
  verdict: 'allowed' | 'forbidden'
}

const KNOWN_CAPABILITIES: ReadonlySet<Capability> = new Set(['now', 'ulid', 'env', 'cwd'])

const findRuntimeType = (checker: ts.TypeChecker, program: ts.Program, productionFiles: string[]): ts.Type => {
  const matches: { file: string; type: ts.Type }[] = []
  for (const file of productionFiles) {
    const sourceFile = sourceFileFor(program, file)
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) continue
    const runtimeExport = checker
      .getExportsOfModule(moduleSymbol)
      .find((symbol) => symbol.getName() === 'Runtime' && (symbol.flags & ts.SymbolFlags.Type) !== 0)
    if (runtimeExport !== undefined) {
      matches.push({ file: relativeToRoot(file), type: checker.getDeclaredTypeOfSymbol(runtimeExport) })
    }
  }
  if (matches.length === 0) {
    throw new Error('environment-is-injected: no production module exports a type named Runtime')
  }
  if (matches.length > 1) {
    throw new Error(
      `environment-is-injected: multiple production modules export a type named Runtime: ${matches.map((m) => m.file).join(', ')}`
    )
  }
  const only = matches[0]
  if (only === undefined) {
    throw new Error('environment-is-injected: unreachable single-match lookup found nothing')
  }
  return only.type
}

const exportsRuntimeFactory = (checker: ts.TypeChecker, runtimeType: ts.Type, moduleSymbol: ts.Symbol): boolean =>
  checker.getExportsOfModule(moduleSymbol).some((exported) => {
    if ((exported.flags & ts.SymbolFlags.Value) === 0) return false
    const type = checker.getTypeOfSymbol(exported)
    return type
      .getCallSignatures()
      .some((signature) => checker.isTypeAssignableTo(checker.getReturnTypeOfSignature(signature), runtimeType))
  })

const findPermittedFiles = (
  checker: ts.TypeChecker,
  program: ts.Program,
  productionFiles: string[],
  runtimeType: ts.Type
): Set<string> => {
  const permitted = new Set<string>()
  for (const file of productionFiles) {
    const sourceFile = sourceFileFor(program, file)
    const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
    if (moduleSymbol === undefined) continue
    if (exportsRuntimeFactory(checker, runtimeType, moduleSymbol)) {
      permitted.add(relativeToRoot(file))
    }
  }
  return permitted
}

const collectEnvironmentCandidates = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  relFile: string,
  permittedFiles: Set<string>
): EnvironmentCandidate[] => {
  const found: EnvironmentCandidate[] = []
  const ulidImports = findNamedImportSymbols(checker, sourceFile, ['ulid'], ['ulid'])
  const verdictFor = (): 'allowed' | 'forbidden' => (permittedFiles.has(relFile) ? 'allowed' : 'forbidden')

  forEachDescendant(sourceFile, (node) => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      const baseIsProcess = isAmbientGlobal(checker, node.expression, 'process')
      const baseIsDate = isAmbientGlobal(checker, node.expression, 'Date')
      const baseIsPerformance = isAmbientGlobal(checker, node.expression, 'performance')
      const propName = node.name.text

      if (baseIsProcess && propName === 'env') {
        found.push({ file: relFile, line: lineOf(sourceFile, node), capability: 'env', verdict: verdictFor() })
      } else if (baseIsProcess && propName === 'cwd') {
        found.push({ file: relFile, line: lineOf(sourceFile, node), capability: 'cwd', verdict: verdictFor() })
      } else if (baseIsProcess && propName === 'hrtime') {
        found.push({ file: relFile, line: lineOf(sourceFile, node), capability: 'now', verdict: verdictFor() })
      } else if (baseIsDate && propName === 'now') {
        found.push({ file: relFile, line: lineOf(sourceFile, node), capability: 'now', verdict: verdictFor() })
      } else if (baseIsPerformance && propName === 'now') {
        found.push({ file: relFile, line: lineOf(sourceFile, node), capability: 'now', verdict: verdictFor() })
      }
      return
    }

    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && isAmbientGlobal(checker, node.expression, 'Date')) {
      const hasZeroArgs = node.arguments === undefined || node.arguments.length === 0
      if (hasZeroArgs) {
        found.push({ file: relFile, line: lineOf(sourceFile, node), capability: 'now', verdict: verdictFor() })
      }
      return
    }

    if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent)) {
      const symbol = checker.getSymbolAtLocation(node)
      if (symbol !== undefined && ulidImports.has(symbol)) {
        found.push({ file: relFile, line: lineOf(sourceFile, node), capability: 'ulid', verdict: verdictFor() })
      }
    }
  })

  return found
}

const classifyCandidate = (candidate: EnvironmentCandidate): Classified<EnvironmentCandidate>['verdict'] | 'unclassifiable' =>
  KNOWN_CAPABILITIES.has(candidate.capability) ? candidate.verdict : 'unclassifiable'

test('contract.environment-is-injected', () => {
  const { checker, program, productionFiles } = loadSourceProgram()
  const runtimeType = findRuntimeType(checker, program, productionFiles)
  const permittedFiles = findPermittedFiles(checker, program, productionFiles, runtimeType)
  assert.ok(permittedFiles.size > 0, 'expected at least one production module to export a Runtime factory')

  const population = productionFiles.flatMap((file) =>
    collectEnvironmentCandidates(checker, sourceFileFor(program, file), relativeToRoot(file), permittedFiles)
  )
  assert.ok(population.length > 0, 'expected at least one ambient-environment reference in the production partition')
  assert.equal(
    population.length,
    4,
    `expected exactly four ambient-environment references, found ${population.length}: ${JSON.stringify(population)}`
  )

  assert.doesNotThrow(() => census(population, classifyCandidate))

  const synthetic: EnvironmentCandidate[] = [{ file: 'src/store/git.ts', line: 1, capability: 'env', verdict: 'forbidden' }]
  assert.throws(() => census(synthetic, classifyCandidate))
})

test('contract.environment-is-injected.halts-on-an-unrecognised-capability', () => {
  const bogus = {
    file: 'src/runtime/runtime.ts',
    line: 1,
    capability: 'entropy' as unknown as Capability,
    verdict: 'allowed' as const
  }
  assert.throws(() => census([bogus], classifyCandidate))
})
