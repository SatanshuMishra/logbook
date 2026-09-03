import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { builtinModules, isBuiltin } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import { REBUILD_ROOT, forEachDescendant, lineOf, loadSourceProgram, relativeToRoot, sourceFileFor } from '../support/source-census.ts'

type ImportConstruct = 'import-declaration' | 'export-from' | 'dynamic-import' | 'require-call'

type ImportSite = {
  file: string
  line: number
  construct: ImportConstruct
  specifier: string | undefined
}

const stringLiteralTextOf = (expr: ts.Expression | undefined): string | undefined =>
  expr !== undefined && ts.isStringLiteralLike(expr) ? expr.text : undefined

const isDynamicImportCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword

const isRequireCall = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require'

const importSiteFor = (sourceFile: ts.SourceFile, relFile: string, node: ts.Node): ImportSite | undefined => {
  if (ts.isImportDeclaration(node)) {
    return {
      file: relFile,
      line: lineOf(sourceFile, node),
      construct: 'import-declaration',
      specifier: stringLiteralTextOf(node.moduleSpecifier)
    }
  }
  if (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined) {
    return {
      file: relFile,
      line: lineOf(sourceFile, node),
      construct: 'export-from',
      specifier: stringLiteralTextOf(node.moduleSpecifier)
    }
  }
  if (isDynamicImportCall(node)) {
    return {
      file: relFile,
      line: lineOf(sourceFile, node),
      construct: 'dynamic-import',
      specifier: stringLiteralTextOf(node.arguments[0])
    }
  }
  if (isRequireCall(node)) {
    return {
      file: relFile,
      line: lineOf(sourceFile, node),
      construct: 'require-call',
      specifier: stringLiteralTextOf(node.arguments[0])
    }
  }
  return undefined
}

const importSitesIn = (sourceFile: ts.SourceFile, relFile: string): ImportSite[] => {
  const sites: ImportSite[] = []
  forEachDescendant(sourceFile, (node) => {
    const site = importSiteFor(sourceFile, relFile, node)
    if (site !== undefined) sites.push(site)
  })
  return sites
}

const PACKAGE_JSON_PATH = path.join(REBUILD_ROOT, 'package.json')

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const readRuntimeDependencyNames = (): ReadonlySet<string> => {
  const raw = readFileSync(PACKAGE_JSON_PATH, 'utf8')
  const doc: unknown = JSON.parse(raw)
  assert.ok(isPlainObject(doc), `readRuntimeDependencyNames: ${PACKAGE_JSON_PATH} did not parse to a JSON mapping`)
  const dependencies = (doc as Record<string, unknown>).dependencies
  assert.ok(isPlainObject(dependencies), `readRuntimeDependencyNames: ${PACKAGE_JSON_PATH} has no dependencies mapping`)
  return new Set(Object.keys(dependencies))
}

const SHIPPED_TREE_ROOT_DIRS = ['src', 'bin', 'hooks'] as const
const SHIPPED_CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'])

const walkFilesRecursively = (absoluteDir: string): string[] =>
  readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(absoluteDir, entry.name)
    return entry.isDirectory() ? walkFilesRecursively(entryPath) : [entryPath]
  })

const shippedCodeFilesOnDisk = (): string[] =>
  SHIPPED_TREE_ROOT_DIRS.flatMap((dirName) =>
    walkFilesRecursively(path.join(REBUILD_ROOT, dirName)).filter((filePath) =>
      SHIPPED_CODE_EXTENSIONS.has(path.extname(filePath))
    )
  )

const BARE_BUILTIN_NAMES = new Set(builtinModules.filter((name) => !name.startsWith('node:')))

const isRelativeSpecifier = (specifier: string): boolean =>
  specifier === '.' || specifier === '..' || specifier.startsWith('./') || specifier.startsWith('../')

const packageNameFrom = (specifier: string): string => {
  const segments = specifier.split('/')
  if (specifier.startsWith('@')) return segments.slice(0, 2).join('/')
  return segments[0] ?? ''
}

const isWithinShippedTree = (relPath: string): boolean => {
  const normalised = relPath.split(path.sep).join('/')
  return SHIPPED_TREE_ROOT_DIRS.some((dirName) => normalised === dirName || normalised.startsWith(`${dirName}/`))
}

const resolveRelativeSpecifier = (importingFileRelPath: string, specifier: string): string =>
  path.normalize(path.join(path.dirname(importingFileRelPath), specifier))

const classifySpecifierText = (
  specifier: string,
  dependencyNames: ReadonlySet<string>,
  importingFileRelPath: string
): Classified<ImportSite>['verdict'] | 'unclassifiable' => {
  if (isRelativeSpecifier(specifier)) {
    const resolved = resolveRelativeSpecifier(importingFileRelPath, specifier)
    return isWithinShippedTree(resolved) ? 'allowed' : 'forbidden'
  }
  if (specifier.startsWith('#')) return 'unclassifiable'
  if (specifier.startsWith('node:')) {
    return isBuiltin(specifier) ? 'allowed' : 'unclassifiable'
  }
  if (specifier.startsWith('/')) return 'forbidden'
  if (specifier.includes(':')) return 'unclassifiable'
  if (specifier.startsWith('.')) return 'unclassifiable'
  const packageName = packageNameFrom(specifier)
  if (packageName.length === 0) return 'unclassifiable'
  if (BARE_BUILTIN_NAMES.has(packageName)) return 'forbidden'
  return dependencyNames.has(packageName) ? 'allowed' : 'forbidden'
}

const classifyImportSite =
  (dependencyNames: ReadonlySet<string>) =>
  (item: ImportSite): Classified<ImportSite>['verdict'] | 'unclassifiable' => {
    if (item.specifier === undefined) return 'unclassifiable'
    return classifySpecifierText(item.specifier, dependencyNames, item.file)
  }

const describeSite = (item: ImportSite): string =>
  `${item.file}:${item.line} (${item.construct}) specifier=${item.specifier === undefined ? '<unresolvable>' : JSON.stringify(item.specifier)}`

const describeViolations = (
  population: readonly ImportSite[],
  classify: (item: ImportSite) => Classified<ImportSite>['verdict'] | 'unclassifiable'
): string => {
  const violations = population.filter((item) => classify(item) !== 'allowed')
  return [
    `shipped-imports-census: ${violations.length} of ${population.length} import sites violate or cannot be classified`,
    ...violations.map(describeSite)
  ].join('\n')
}

const isHaltedOnUnclassifiable = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census halted on an unclassifiable item')

const isRejectedAsForbidden = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('census rejected a forbidden item')

test('contract.shipped-code-imports-only-declared-runtime-dependencies', () => {
  const { program, productionFiles } = loadSourceProgram()
  const dependencyNames = readRuntimeDependencyNames()
  const population = productionFiles.flatMap((fileName) =>
    importSitesIn(sourceFileFor(program, fileName), relativeToRoot(fileName))
  )

  assert.ok(
    population.length > 0,
    'contract.shipped-code-imports-only-declared-runtime-dependencies: zero import sites found across src/bin/hooks; a census over an empty population proves nothing'
  )

  const classify = classifyImportSite(dependencyNames)
  assert.doesNotThrow(() => census(population, classify), describeViolations(population, classify))
})

test('contract.shipped-code-imports-only-declared-runtime-dependencies.every-shipped-code-file-is-seen-by-the-program', () => {
  const { productionFiles } = loadSourceProgram()
  const programFileSet = new Set(productionFiles.map((fileName) => path.normalize(fileName)))
  const onDisk = shippedCodeFilesOnDisk()

  assert.ok(
    onDisk.length > 0,
    'contract.shipped-code-imports-only-declared-runtime-dependencies.every-shipped-code-file-is-seen-by-the-program: zero files found under src/bin/hooks; a census over an empty population proves nothing'
  )

  for (const filePath of onDisk) {
    assert.ok(
      programFileSet.has(path.normalize(filePath)),
      `contract.shipped-code-imports-only-declared-runtime-dependencies.every-shipped-code-file-is-seen-by-the-program: ${relativeToRoot(filePath)} is a shipped file on disk that the TypeScript program (built from tsconfig's .ts-only include) does not see; the import census would silently omit it`
    )
  }
})

test('contract.shipped-code-imports-only-declared-runtime-dependencies.control.a-devdependency-import-is-forbidden-and-named', () => {
  const synthetic: ImportSite[] = [{ file: 'src/example.ts', line: 7, construct: 'import-declaration', specifier: 'commonmark' }]
  const classify = classifyImportSite(new Set(['zod']))
  assert.throws(() => census(synthetic, classify), isRejectedAsForbidden)
})

test('contract.shipped-code-imports-only-declared-runtime-dependencies.control.an-unresolvable-specifier-halts-the-census', () => {
  const synthetic: ImportSite[] = [{ file: 'src/example.ts', line: 12, construct: 'dynamic-import', specifier: undefined }]
  const classify = classifyImportSite(new Set(['zod']))
  assert.throws(() => census(synthetic, classify), isHaltedOnUnclassifiable)
})

test('contract.shipped-code-imports-only-declared-runtime-dependencies.classifier-decides-every-stated-shape', () => {
  const dependencyNames = new Set(['zod', '@modelcontextprotocol/sdk'])
  const importingFile = 'src/store/records.ts'

  assert.equal(classifySpecifierText('./sibling.ts', dependencyNames, importingFile), 'allowed')
  assert.equal(classifySpecifierText('../parent.ts', dependencyNames, importingFile), 'allowed')
  assert.equal(
    classifySpecifierText('../../test/support/census.ts', dependencyNames, 'src/index.ts'),
    'forbidden'
  )
  assert.equal(classifySpecifierText('#internal/foo', dependencyNames, importingFile), 'unclassifiable')
  assert.equal(classifySpecifierText('node:fs', dependencyNames, importingFile), 'allowed')
  assert.equal(classifySpecifierText('node:test', dependencyNames, importingFile), 'allowed')
  assert.equal(classifySpecifierText('node:not-a-real-builtin', dependencyNames, importingFile), 'unclassifiable')
  assert.equal(classifySpecifierText('zod', dependencyNames, importingFile), 'allowed')
  assert.equal(
    classifySpecifierText('@modelcontextprotocol/sdk/server/mcp.js', dependencyNames, importingFile),
    'allowed'
  )
  assert.equal(classifySpecifierText('commonmark', dependencyNames, importingFile), 'forbidden')
  assert.equal(classifySpecifierText('fs', dependencyNames, importingFile), 'forbidden')
  assert.equal(classifySpecifierText('/etc/passwd', dependencyNames, importingFile), 'forbidden')
  assert.equal(classifySpecifierText('data:text/plain,hi', dependencyNames, importingFile), 'unclassifiable')
})

test('contract.shipped-code-imports-only-declared-runtime-dependencies.extractor-decomposes-every-handled-construct', () => {
  const { program } = loadSourceProgram()
  const fixturePath = path.join(REBUILD_ROOT, 'test', 'fixtures', 'import-specifier-constructs.ts')
  const sourceFile = sourceFileFor(program, fixturePath)
  const sites = importSitesIn(sourceFile, relativeToRoot(fixturePath))

  const hasSite = (construct: ImportConstruct, specifier: string): boolean =>
    sites.some((site) => site.construct === construct && site.specifier === specifier)

  assert.ok(hasSite('import-declaration', 'node:path'), 'expected a static `import ... from` to be decomposed')
  assert.ok(hasSite('import-declaration', 'node:fs'), 'expected an `import type ... from` to be decomposed')
  assert.ok(hasSite('export-from', 'node:os'), 'expected an `export ... from` to be decomposed')
  assert.ok(hasSite('dynamic-import', 'node:util'), 'expected a dynamic `import()` to be decomposed')
  assert.ok(hasSite('require-call', 'node:crypto'), 'expected a `require(...)` call to be decomposed')
})

test('contract.shipped-code-imports-only-declared-runtime-dependencies.extractor-halts-on-a-non-literal-specifier', () => {
  const { program } = loadSourceProgram()
  const fixturePath = path.join(REBUILD_ROOT, 'test', 'fixtures', 'import-specifier-unresolvable.ts')
  const sourceFile = sourceFileFor(program, fixturePath)
  const sites = importSitesIn(sourceFile, relativeToRoot(fixturePath))

  assert.equal(sites.length, 2, `expected exactly the dynamic-import and require-call sites, found ${sites.length}`)
  assert.ok(
    sites.every((site) => site.specifier === undefined),
    'expected every site built from a variable, not a string literal, to be unresolvable'
  )

  const classify = classifyImportSite(new Set(['zod']))
  assert.throws(() => census(sites, classify), isHaltedOnUnclassifiable)
})
