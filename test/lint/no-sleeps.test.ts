import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import {
  REBUILD_ROOT,
  findNamedImportSymbols,
  forEachDescendant,
  isAmbientGlobal,
  lineOf,
  loadSourceProgram,
  relativeToRoot,
  sourceFileFor
} from '../support/source-census.ts'

type DelayCandidate =
  | { kind: 'call'; file: string; line: number; verdict: 'allowed' | 'forbidden' }
  | { kind: 'text'; file: string; line: number; token: string }

const DELAY_TOKENS = [
  ['set', 'Timeout('].join(''),
  ['set', 'Interval('].join(''),
  ['Atomics', '.wait('].join('')
]

const CHILD_PROCESS_MODULE_SPECIFIERS = ['node:child_process', 'child_process']
const CHILD_PROCESS_FUNCTIONS = ['spawn', 'spawnSync', 'exec', 'execSync']
const SLEEP_COMMAND_TOKEN = 'sleep'

const COMPARISON_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.LessThanEqualsToken
])

const delayKind = (checker: ts.TypeChecker, call: ts.CallExpression): string | undefined => {
  const callee = call.expression
  if (ts.isIdentifier(callee)) {
    if (isAmbientGlobal(checker, callee, 'setTimeout')) return 'setTimeout'
    if (isAmbientGlobal(checker, callee, 'setInterval')) return 'setInterval'
    return undefined
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)) {
    const propName = callee.name.text
    if (propName === 'wait' && isAmbientGlobal(checker, callee.expression, 'Atomics')) return 'Atomics.wait'
    if (callee.expression.text === 'globalThis' && propName === 'setTimeout') return 'setTimeout'
    if (callee.expression.text === 'globalThis' && propName === 'setInterval') return 'setInterval'
  }
  return undefined
}

const findEnclosingPromiseBinding = (checker: ts.TypeChecker, node: ts.Node): ts.Symbol | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isNewExpression(current) && ts.isIdentifier(current.expression) && isAmbientGlobal(checker, current.expression, 'Promise')) {
      const declaration = current.parent
      if (ts.isVariableDeclaration(declaration) && ts.isIdentifier(declaration.name)) {
        return checker.getSymbolAtLocation(declaration.name)
      }
      return undefined
    }
    current = current.parent
  }
  return undefined
}

const isInPromiseRaceArray = (checker: ts.TypeChecker, sourceFile: ts.SourceFile, bindingSymbol: ts.Symbol): boolean => {
  let matched = false
  forEachDescendant(sourceFile, (node) => {
    if (matched) return
    if (!ts.isCallExpression(node)) return
    if (!ts.isPropertyAccessExpression(node.expression)) return
    if (node.expression.name.text !== 'race') return
    if (!ts.isIdentifier(node.expression.expression)) return
    if (!isAmbientGlobal(checker, node.expression.expression, 'Promise')) return
    const arrayArg = node.arguments[0]
    if (arrayArg === undefined || !ts.isArrayLiteralExpression(arrayArg)) return
    matched = arrayArg.elements.some(
      (element) => ts.isIdentifier(element) && checker.getSymbolAtLocation(element) === bindingSymbol
    )
  })
  return matched
}

type LoopStatement = ts.WhileStatement | ts.DoStatement | ts.ForStatement

const findEnclosingLoop = (node: ts.Node): LoopStatement | undefined => {
  let current: ts.Node | undefined = node.parent
  while (current !== undefined) {
    if (ts.isWhileStatement(current) || ts.isDoStatement(current) || ts.isForStatement(current)) return current
    current = current.parent
  }
  return undefined
}

const loopCondition = (loop: LoopStatement): ts.Expression | undefined =>
  ts.isForStatement(loop) ? loop.condition : loop.expression

const conditionReObservesState = (loop: LoopStatement): boolean => {
  const condition = loopCondition(loop)
  if (condition === undefined) return false
  let observes = false
  forEachDescendant(condition, (node) => {
    if (ts.isCallExpression(node) || ts.isPropertyAccessExpression(node)) observes = true
  })
  return observes
}

const containsThrow = (node: ts.Node): boolean => {
  let matched = false
  forEachDescendant(node, (child) => {
    if (ts.isThrowStatement(child)) matched = true
  })
  return matched
}

const isComparisonExpression = (expr: ts.Expression): boolean =>
  ts.isBinaryExpression(expr) && COMPARISON_OPERATORS.has(expr.operatorToken.kind)

const containsComparisonThrow = (block: ts.Block): boolean => {
  let matched = false
  forEachDescendant(block, (node) => {
    if (matched) return
    if (ts.isIfStatement(node) && isComparisonExpression(node.expression) && containsThrow(node.thenStatement)) {
      matched = true
    }
  })
  return matched
}

const matchesPromiseRaceShape = (checker: ts.TypeChecker, sourceFile: ts.SourceFile, node: ts.Node): boolean => {
  const bindingSymbol = findEnclosingPromiseBinding(checker, node)
  if (bindingSymbol === undefined) return false
  return isInPromiseRaceArray(checker, sourceFile, bindingSymbol)
}

const matchesDeadlineLoopShape = (node: ts.Node): boolean => {
  const loop = findEnclosingLoop(node)
  if (loop === undefined) return false
  if (!ts.isBlock(loop.statement)) return false
  if (loop.statement.statements.length <= 1) return false
  if (!conditionReObservesState(loop)) return false
  return containsComparisonThrow(loop.statement)
}

const literalTextChunks = (node: ts.Node): string[] => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
  }
  return []
}

const containsSleepCommandText = (node: ts.Node): boolean => {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text === SLEEP_COMMAND_TOKEN || node.text.endsWith(`/${SLEEP_COMMAND_TOKEN}`)
  }
  return false
}

const collectDelayCandidates = (checker: ts.TypeChecker, sourceFile: ts.SourceFile, relFile: string): DelayCandidate[] => {
  const found: DelayCandidate[] = []
  const spawnImports = findNamedImportSymbols(checker, sourceFile, CHILD_PROCESS_MODULE_SPECIFIERS, CHILD_PROCESS_FUNCTIONS)

  forEachDescendant(sourceFile, (node) => {
    if (ts.isCallExpression(node)) {
      const kind = delayKind(checker, node)
      if (kind !== undefined) {
        const allowed = matchesPromiseRaceShape(checker, sourceFile, node) || matchesDeadlineLoopShape(node)
        found.push({ kind: 'call', file: relFile, line: lineOf(sourceFile, node), verdict: allowed ? 'allowed' : 'forbidden' })
        return
      }
      if (ts.isIdentifier(node.expression)) {
        const symbol = checker.getSymbolAtLocation(node.expression)
        if (symbol !== undefined && spawnImports.has(symbol) && node.arguments.some((arg) => containsSleepCommandText(arg))) {
          found.push({ kind: 'call', file: relFile, line: lineOf(sourceFile, node), verdict: 'forbidden' })
        }
      }
      return
    }
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      for (const chunk of literalTextChunks(node)) {
        for (const token of DELAY_TOKENS) {
          if (chunk.includes(token)) {
            found.push({ kind: 'text', file: relFile, line: lineOf(sourceFile, node), token })
          }
        }
      }
    }
  })
  return found
}

const classifyDelay = (candidate: DelayCandidate): Classified<DelayCandidate>['verdict'] | 'unclassifiable' =>
  candidate.kind === 'text' ? 'unclassifiable' : candidate.verdict

test('contract.no-sleeps', () => {
  const { checker, program, testFiles } = loadSourceProgram()
  const population = testFiles.flatMap((file) =>
    collectDelayCandidates(checker, sourceFileFor(program, file), relativeToRoot(file))
  )
  assert.ok(population.length > 0, 'expected at least one setTimeout/setInterval/Atomics.wait call in the test partition')

  assert.doesNotThrow(() => census(population, classifyDelay))

  const synthetic: DelayCandidate[] = [{ kind: 'call', file: 'spawn/stdout.test.ts', line: 1, verdict: 'forbidden' }]
  assert.throws(() => census(synthetic, classifyDelay))
})

test('contract.no-sleeps.halts-on-a-delay-token-embedded-in-a-string-literal', () => {
  const synthetic: DelayCandidate[] = [
    { kind: 'text', file: 'store/write-path.test.ts', line: 1, token: ['set', 'Timeout('].join('') }
  ]
  assert.throws(() => census(synthetic, classifyDelay))
})

test('contract.no-sleeps.collector-catches-aliased-imports-globalThis-and-a-spawned-sleep-binary', () => {
  const { checker, program } = loadSourceProgram()
  const fixturePath = path.join(REBUILD_ROOT, 'test', 'fixtures', 'no-sleeps-violation.ts')
  const sourceFile = sourceFileFor(program, fixturePath)
  const relFile = relativeToRoot(fixturePath)
  const candidates = collectDelayCandidates(checker, sourceFile, relFile)
  assert.ok(candidates.length >= 3, `expected the collector to find all three delay shapes, found ${candidates.length}`)
  assert.throws(() => census(candidates, classifyDelay))
})
