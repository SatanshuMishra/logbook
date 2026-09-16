import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as ts from 'typescript'
import { census, type Classified } from '../support/census.ts'
import { loadSourceProgram, relativeToRoot, lineOf, sourceFileFor } from '../support/source-census.ts'
import { loadLimitsRegister, parseLimitsRegisterRows, type LimitRow } from '../support/limits-register.ts'
import * as caps from '../../src/schema/caps.ts'

const SWEEP_PREDICATE =
  'population: for each fileName in loadSourceProgram().productionFiles, for each top-level statement of that ' +
  'SourceFile that is a ts.VariableStatement whose declarationList.flags carries ts.NodeFlags.Const, for each ' +
  'declaration in that list, the site is in the population iff ' +
  '(checker.getTypeAtLocation(declaration.name).flags & ts.TypeFlags.NumberLike) !== 0; a declaration.name that ' +
  'is not a ts.Identifier halts naming the file and line; let and var declarations are excluded from the ' +
  'population, and files under scripts/ sit outside the tsconfig program and so are excluded too'

const PRODUCTION_ROOT_SEGMENTS: readonly string[] = ['bin', 'hooks', 'src']

type Site = { file: string; line: number; name: string; declaration: ts.VariableDeclaration }
type ResolvedSite = Site & { value: number }

const sweepConstantSites = (program: ts.Program, checker: ts.TypeChecker, productionFiles: readonly string[]): Site[] => {
  const sites: Site[] = []
  for (const fileName of productionFiles) {
    const sourceFile = sourceFileFor(program, fileName)
    for (const statement of sourceFile.statements) {
      if (!ts.isVariableStatement(statement)) continue
      if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error(
            `limits-register-census: ${relativeToRoot(fileName)}:${lineOf(sourceFile, declaration)} declares a top-level const with a non-identifier binding name, which ${SWEEP_PREDICATE} cannot name`
          )
        }
        const type = checker.getTypeAtLocation(declaration.name)
        if ((type.flags & ts.TypeFlags.NumberLike) === 0) continue
        sites.push({
          file: relativeToRoot(fileName),
          line: lineOf(sourceFile, declaration.name),
          name: declaration.name.text,
          declaration
        })
      }
    }
  }
  return sites
}

const NUMBER_GLOBALS: Readonly<Record<string, number>> = {
  POSITIVE_INFINITY: Number.POSITIVE_INFINITY,
  NEGATIVE_INFINITY: Number.NEGATIVE_INFINITY,
  MAX_SAFE_INTEGER: Number.MAX_SAFE_INTEGER,
  MIN_SAFE_INTEGER: Number.MIN_SAFE_INTEGER
}

const SUPPORTED_BINARY_OPERATORS: Readonly<Record<number, (left: number, right: number) => number>> = {
  [ts.SyntaxKind.PlusToken]: (left, right) => left + right,
  [ts.SyntaxKind.MinusToken]: (left, right) => left - right,
  [ts.SyntaxKind.AsteriskToken]: (left, right) => left * right,
  [ts.SyntaxKind.SlashToken]: (left, right) => left / right,
  [ts.SyntaxKind.PercentToken]: (left, right) => left % right
}

type FoldResult = { ok: true; value: number } | { ok: false; kind: ts.SyntaxKind; cause?: unknown }

const isMathMaxOrMin = (expr: ts.Expression): 'max' | 'min' | null => {
  if (!ts.isPropertyAccessExpression(expr)) return null
  if (!ts.isIdentifier(expr.expression) || expr.expression.text !== 'Math') return null
  if (expr.name.text === 'max') return 'max'
  if (expr.name.text === 'min') return 'min'
  return null
}

const resolveIdentifierDeclaration = (expr: ts.Identifier, checker: ts.TypeChecker): ts.VariableDeclaration | null => {
  let symbol = checker.getSymbolAtLocation(expr)
  if (symbol === undefined) return null
  if ((symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    symbol = checker.getAliasedSymbol(symbol)
  }
  const declarations = symbol.declarations
  if (declarations === undefined || declarations.length === 0) return null
  const declaration = declarations.find((candidate): candidate is ts.VariableDeclaration => ts.isVariableDeclaration(candidate))
  return declaration ?? null
}

const isExportedDeclaration = (declaration: ts.VariableDeclaration): boolean => {
  const statement = declaration.parent.parent
  if (!ts.canHaveModifiers(statement)) return false
  const modifiers = ts.getModifiers(statement)
  if (modifiers === undefined) return false
  return modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
}

const foldExpression = async (expr: ts.Expression, checker: ts.TypeChecker): Promise<FoldResult> => {
  if (ts.isParenthesizedExpression(expr)) return foldExpression(expr.expression, checker)
  if (ts.isNumericLiteral(expr)) return { ok: true, value: Number(expr.text) }
  if (ts.isPrefixUnaryExpression(expr) && (expr.operator === ts.SyntaxKind.PlusToken || expr.operator === ts.SyntaxKind.MinusToken)) {
    const operand = await foldExpression(expr.operand, checker)
    if (!operand.ok) return operand
    return { ok: true, value: expr.operator === ts.SyntaxKind.MinusToken ? -operand.value : operand.value }
  }
  if (ts.isBinaryExpression(expr)) {
    const apply = SUPPORTED_BINARY_OPERATORS[expr.operatorToken.kind]
    if (apply !== undefined) {
      const left = await foldExpression(expr.left, checker)
      if (!left.ok) return left
      const right = await foldExpression(expr.right, checker)
      if (!right.ok) return right
      return { ok: true, value: apply(left.value, right.value) }
    }
  }
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === 'Number') {
    const globalValue = NUMBER_GLOBALS[expr.name.text]
    if (globalValue !== undefined) return { ok: true, value: globalValue }
    return { ok: false, kind: expr.kind }
  }
  if (ts.isCallExpression(expr)) {
    const fnName = isMathMaxOrMin(expr.expression)
    if (fnName !== null) {
      const values: number[] = []
      for (const arg of expr.arguments) {
        const folded = await foldExpression(arg, checker)
        if (!folded.ok) return folded
        values.push(folded.value)
      }
      return { ok: true, value: fnName === 'max' ? Math.max(...values) : Math.min(...values) }
    }
    return { ok: false, kind: expr.kind }
  }
  if (ts.isIdentifier(expr)) {
    const resolved = resolveIdentifierDeclaration(expr, checker)
    if (resolved === null) return { ok: false, kind: expr.kind }
    try {
      const value = await resolveDeclarationValue(resolved, checker)
      return { ok: true, value }
    } catch (cause) {
      return { ok: false, kind: expr.kind, cause }
    }
  }
  return { ok: false, kind: expr.kind }
}

const dynamicImportValue = async (declaration: ts.VariableDeclaration, name: string): Promise<number | undefined> => {
  if (!isExportedDeclaration(declaration)) return undefined
  const sourceFile = declaration.getSourceFile()
  const moduleUrl = pathToFileURL(sourceFile.fileName).href
  let mod: Record<string, unknown>
  try {
    mod = (await import(moduleUrl)) as Record<string, unknown>
  } catch (cause) {
    throw new Error(
      `limits-register-census: ${relativeToRoot(sourceFile.fileName)} threw while being dynamically imported to resolve constant "${name}": ${String(cause)}`,
      { cause }
    )
  }
  const value = mod[name]
  return typeof value === 'number' ? value : undefined
}

const resolveDeclarationValue = async (declaration: ts.VariableDeclaration, checker: ts.TypeChecker): Promise<number> => {
  const nameNode = declaration.name
  if (!ts.isIdentifier(nameNode)) {
    throw new Error('limits-register-census: resolveDeclarationValue reached a non-identifier binding name')
  }
  const type = checker.getTypeAtLocation(nameNode)
  if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return (type as ts.NumberLiteralType).value
  }
  const initializer = declaration.initializer
  let failing: FoldResult | null = null
  if (initializer !== undefined) {
    const folded = await foldExpression(initializer, checker)
    if (folded.ok) return folded.value
    failing = folded
  }
  const imported = await dynamicImportValue(declaration, nameNode.text)
  if (imported !== undefined) return imported
  const sourceFile = declaration.getSourceFile()
  const kindName = failing !== null ? ts.SyntaxKind[failing.kind] : 'MissingInitializer'
  const causeSuffix = failing !== null && failing.cause !== undefined ? `; caused by: ${String(failing.cause)}` : ''
  throw new Error(
    `limits-register-census: ${relativeToRoot(sourceFile.fileName)}:${lineOf(sourceFile, nameNode)} constant "${nameNode.text}" defeated the value fold at syntax kind ${kindName}${causeSuffix}`,
    failing !== null && failing.cause !== undefined ? { cause: failing.cause } : undefined
  )
}

const pathPartOf = (site: string): string => site.slice(0, site.lastIndexOf(':'))
const linePartOf = (site: string): number => Number(site.slice(site.lastIndexOf(':') + 1))
const pathNameKey = (filePath: string, name: string): string => `${filePath}::${name}`
const toPosixPath = (nativePath: string): string => nativePath.split(path.sep).join('/')

const numericValueOf = (value: LimitRow['value']): number =>
  value === 'Infinity' ? Number.POSITIVE_INFINITY : value === '-Infinity' ? Number.NEGATIVE_INFINITY : value

const formatValue = (value: number): string =>
  Number.isNaN(value) ? 'NaN' : Number.isFinite(value) ? String(value) : value > 0 ? 'Infinity' : '-Infinity'

const classifySiteAgainstRegister = (
  site: ResolvedSite,
  registerByPathName: ReadonlyMap<string, LimitRow>
): Classified<ResolvedSite>['verdict'] | 'unclassifiable' => {
  const row = registerByPathName.get(pathNameKey(toPosixPath(site.file), site.name))
  if (row === undefined) return 'unclassifiable'
  if (linePartOf(row.site) !== site.line) return 'forbidden'
  if (numericValueOf(row.value) !== site.value) return 'forbidden'
  return 'allowed'
}

const describeSiteFailure = (registerByPathName: ReadonlyMap<string, LimitRow>) => (site: ResolvedSite): string => {
  const row = registerByPathName.get(pathNameKey(toPosixPath(site.file), site.name))
  if (row === undefined) {
    return `limits-register-census: ${site.file}:${site.line} declares const ${site.name} = ${formatValue(site.value)}, which ${SWEEP_PREDICATE} put in the population, but no row in docs/registers/size-limits.json names it; add one with basis "unrecorded" and reason null if nothing is known`
  }
  const registeredLine = linePartOf(row.site)
  if (registeredLine !== site.line) {
    return `limits-register-census: docs/registers/size-limits.json row for ${site.name} at ${site.file} names line ${registeredLine}, but the live declaration is at line ${site.line}; update the row's "site" to "${site.file}:${site.line}"`
  }
  const registeredValue = numericValueOf(row.value)
  if (registeredValue !== site.value) {
    return `limits-register-census: docs/registers/size-limits.json row ${row.site} (${site.name}) records value ${formatValue(registeredValue)}, but the live constant is ${formatValue(site.value)}`
  }
  return `limits-register-census: ${row.site} (${site.name}) unexpectedly failed classification`
}

const classifyRegisterRowAgainstLiveSites = (
  row: LimitRow,
  liveKeys: ReadonlySet<string>
): Classified<LimitRow>['verdict'] | 'unclassifiable' =>
  liveKeys.has(pathNameKey(pathPartOf(row.site), row.name)) ? 'allowed' : 'forbidden'

const describeOrphanRowFailure = (row: LimitRow): string =>
  `limits-register-census: docs/registers/size-limits.json row ${row.site} (${row.name}) names no live top-level const among the swept sites (${SWEEP_PREDICATE}); the constant "${row.name}" this row describes no longer exists at "${pathPartOf(row.site)}", or it was renamed or moved; remove or update the row`

const firstFailure = <T,>(
  items: readonly T[],
  classify: (item: T) => Classified<T>['verdict'] | 'unclassifiable',
  describe: (item: T) => string
): string => {
  for (const item of items) {
    if (classify(item) !== 'allowed') return describe(item)
  }
  return 'no item failed this census'
}

test('contract.limits-register-census.population-is-non-empty', () => {
  const { program, checker, productionFiles } = loadSourceProgram()
  const sites = sweepConstantSites(program, checker, productionFiles)
  assert.ok(sites.length > 0, `limits-register-census: ${SWEEP_PREDICATE}; produced 0 sites; a census over an empty population proves nothing`)
})

test('contract.limits-register-census.production-root-segments-are-exactly-bin-hooks-src', () => {
  const { productionFiles } = loadSourceProgram()
  const segments = new Set(productionFiles.map((fileName) => relativeToRoot(fileName).split(path.sep)[0]))
  assert.deepEqual(
    [...segments].sort(),
    [...PRODUCTION_ROOT_SEGMENTS].sort(),
    `limits-register-census: production root segments were ${JSON.stringify([...segments].sort())}, expected exactly ${JSON.stringify(PRODUCTION_ROOT_SEGMENTS)}; scripts/ sits outside the tsconfig program and must stay outside the swept population`
  )
})

test('contract.limits-register-census.every-caps-export-is-swept', () => {
  const { program, checker, productionFiles } = loadSourceProgram()
  const sites = sweepConstantSites(program, checker, productionFiles)
  const sweptCapsNames = new Set(sites.filter((site) => toPosixPath(site.file) === 'src/schema/caps.ts').map((site) => site.name))
  for (const capName of Object.keys(caps)) {
    assert.ok(
      sweptCapsNames.has(capName),
      `limits-register-census: src/schema/caps.ts exports "${capName}" but the sweep predicate did not find it among top-level const sites`
    )
  }
})

test('contract.limits-register-census.control.format-value-of-nan-names-nan-not-infinity', () => {
  assert.equal(formatValue(Number.NaN), 'NaN')
})

test('contract.limits-register-census.control.a-site-with-no-register-row-is-unclassifiable', () => {
  const registerByPathName = new Map<string, LimitRow>()
  const site = { file: 'src/example.ts', line: 1, name: 'UNREGISTERED_MAX', value: 10 } as ResolvedSite
  assert.equal(classifySiteAgainstRegister(site, registerByPathName), 'unclassifiable')
})

test('contract.limits-register-census.control.a-matching-row-is-allowed', () => {
  const row: LimitRow = {
    name: 'SOME_MAX',
    site: 'src/example.ts:1',
    value: 10,
    basis: 'unrecorded',
    reason: null,
    mirrors: null,
    mirror_relation: null
  }
  const registerByPathName = new Map([[pathNameKey('src/example.ts', 'SOME_MAX'), row]])
  const site = { file: 'src/example.ts', line: 1, name: 'SOME_MAX', value: 10 } as ResolvedSite
  assert.equal(classifySiteAgainstRegister(site, registerByPathName), 'allowed')
})

test('contract.limits-register-census.control.a-value-mismatch-is-forbidden', () => {
  const row: LimitRow = {
    name: 'SOME_MAX',
    site: 'src/example.ts:1',
    value: 10,
    basis: 'unrecorded',
    reason: null,
    mirrors: null,
    mirror_relation: null
  }
  const registerByPathName = new Map([[pathNameKey('src/example.ts', 'SOME_MAX'), row]])
  const site = { file: 'src/example.ts', line: 1, name: 'SOME_MAX', value: 11 } as ResolvedSite
  assert.equal(classifySiteAgainstRegister(site, registerByPathName), 'forbidden')
  const synthetic = [site]
  assert.throws(() => census(synthetic, (item) => classifySiteAgainstRegister(item, registerByPathName)))
})

test('contract.limits-register-census.control.a-line-mismatch-is-forbidden-and-names-the-live-line', () => {
  const row: LimitRow = {
    name: 'SOME_MAX',
    site: 'src/example.ts:1',
    value: 10,
    basis: 'unrecorded',
    reason: null,
    mirrors: null,
    mirror_relation: null
  }
  const registerByPathName = new Map([[pathNameKey('src/example.ts', 'SOME_MAX'), row]])
  const site = { file: 'src/example.ts', line: 2, name: 'SOME_MAX', value: 10 } as ResolvedSite
  assert.equal(classifySiteAgainstRegister(site, registerByPathName), 'forbidden')
  const message = describeSiteFailure(registerByPathName)(site)
  assert.match(message, /live declaration is at line 2/)
  const synthetic = [site]
  assert.throws(() => census(synthetic, (item) => classifySiteAgainstRegister(item, registerByPathName)))
})

test('contract.limits-register-census.every-swept-constant-matches-its-register-row', async () => {
  const { program, checker, productionFiles } = loadSourceProgram()
  const sites = sweepConstantSites(program, checker, productionFiles)
  assert.ok(sites.length > 0, `limits-register-census: ${SWEEP_PREDICATE}; produced 0 sites`)

  const register = loadLimitsRegister()
  const registerByPathName = new Map(register.map((row) => [pathNameKey(pathPartOf(row.site), row.name), row]))
  const registerBySite = new Map(register.map((row) => [row.site, row]))

  const resolvedSites: ResolvedSite[] = []
  for (const site of sites) {
    const value = await resolveDeclarationValue(site.declaration, checker)
    resolvedSites.push({ ...site, value })
  }

  assert.doesNotThrow(
    () => census(resolvedSites, (site) => classifySiteAgainstRegister(site, registerByPathName)),
    firstFailure(resolvedSites, (site) => classifySiteAgainstRegister(site, registerByPathName), describeSiteFailure(registerByPathName))
  )

  const valueByPathName = new Map(resolvedSites.map((site) => [pathNameKey(toPosixPath(site.file), site.name), site.value]))

  for (const row of register) {
    if (row.mirrors === null || row.mirror_relation === null) continue
    const mirrorRow = registerBySite.get(row.mirrors)
    assert.ok(mirrorRow !== undefined, `limits-register-census: ${row.site} (${row.name}) mirrors "${row.mirrors}", which names no row in the register`)
    if (mirrorRow === undefined) continue

    const ownValue = valueByPathName.get(pathNameKey(pathPartOf(row.site), row.name))
    const mirrorValue = valueByPathName.get(pathNameKey(pathPartOf(mirrorRow.site), mirrorRow.name))
    assert.ok(ownValue !== undefined, `limits-register-census: ${row.site} (${row.name}) was not found among the swept live sites`)
    assert.ok(mirrorValue !== undefined, `limits-register-census: ${mirrorRow.site} (${mirrorRow.name}) was not found among the swept live sites`)
    if (ownValue === undefined || mirrorValue === undefined) continue

    const relationHolds =
      row.mirror_relation === 'equal'
        ? ownValue === mirrorValue
        : row.mirror_relation === 'at-most'
          ? ownValue <= mirrorValue
          : ownValue >= mirrorValue

    assert.ok(
      relationHolds,
      `limits-register-census: ${row.site} (${row.name}) = ${formatValue(ownValue)} claims "${row.mirror_relation}" against ${row.mirrors} (${mirrorRow.name}) = ${formatValue(mirrorValue)}, but the live values disagree`
    )
  }
})

test('contract.limits-register-census.control.an-orphan-register-row-is-forbidden', () => {
  const liveKeys = new Set(['src/example.ts::SOME_MAX'])
  const orphan: LimitRow = {
    name: 'GHOST_MAX',
    site: 'src/example.ts:99',
    value: 10,
    basis: 'unrecorded',
    reason: null,
    mirrors: null,
    mirror_relation: null
  }
  assert.equal(classifyRegisterRowAgainstLiveSites(orphan, liveKeys), 'forbidden')
  assert.throws(() => census([orphan], (row) => classifyRegisterRowAgainstLiveSites(row, liveKeys)))
})

test('contract.limits-register-census.control.a-row-naming-a-live-site-is-allowed', () => {
  const liveKeys = new Set(['src/example.ts::SOME_MAX'])
  const row: LimitRow = {
    name: 'SOME_MAX',
    site: 'src/example.ts:1',
    value: 10,
    basis: 'unrecorded',
    reason: null,
    mirrors: null,
    mirror_relation: null
  }
  assert.equal(classifyRegisterRowAgainstLiveSites(row, liveKeys), 'allowed')
  assert.doesNotThrow(() => census([row], (r) => classifyRegisterRowAgainstLiveSites(r, liveKeys)))
})

test('contract.limits-register-census.every-register-row-resolves-to-a-live-site', () => {
  const { program, checker, productionFiles } = loadSourceProgram()
  const sites = sweepConstantSites(program, checker, productionFiles)
  const liveKeys = new Set(sites.map((site) => pathNameKey(toPosixPath(site.file), site.name)))
  const register = loadLimitsRegister()
  const classify = (row: LimitRow) => classifyRegisterRowAgainstLiveSites(row, liveKeys)
  assert.doesNotThrow(() => census(register, classify), firstFailure(register, classify, describeOrphanRowFailure))
})

test('contract.limits-register-census.the-loader-itself-halts-on-a-basis-reason-inconsistency', () => {
  const badRow = {
    name: 'BAD_MAX',
    site: 'src/example.ts:1',
    value: 10,
    basis: 'chosen',
    reason: null,
    mirrors: null,
    mirror_relation: null
  }
  assert.throws(() => parseLimitsRegisterRows([badRow], 'synthetic'))
})
