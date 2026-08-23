import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

export const REBUILD_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const TSCONFIG_PATH = fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
const TEST_ROOT_PREFIX = `test${path.sep}`

export type SourceProgram = {
  program: ts.Program
  checker: ts.TypeChecker
  productionFiles: string[]
  testFiles: string[]
}

const loadProgram = (): ts.Program => {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile)
  if (configFile.error !== undefined) {
    throw new Error(
      `loadSourceProgram: failed to read ${TSCONFIG_PATH}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
    )
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(TSCONFIG_PATH))
  if (parsed.errors.length > 0) {
    const rendered = parsed.errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')
    throw new Error(`loadSourceProgram: failed to parse ${TSCONFIG_PATH}: ${rendered}`)
  }
  if (parsed.fileNames.length === 0) {
    throw new Error(`loadSourceProgram: ${TSCONFIG_PATH} resolved zero source files`)
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}

export const relativeToRoot = (absolutePath: string): string => path.relative(REBUILD_ROOT, absolutePath)

export const isTestFile = (relativePath: string): boolean => relativePath.startsWith(TEST_ROOT_PREFIX)

export const loadSourceProgram = (): SourceProgram => {
  const program = loadProgram()
  const checker = program.getTypeChecker()
  const productionFiles: string[] = []
  const testFiles: string[] = []
  for (const fileName of program.getRootFileNames()) {
    const sourceFile = program.getSourceFile(fileName)
    if (sourceFile === undefined) {
      throw new Error(`loadSourceProgram: ${fileName} is a root file name but is not part of the compiled program`)
    }
    if (isTestFile(relativeToRoot(fileName))) {
      testFiles.push(fileName)
    } else {
      productionFiles.push(fileName)
    }
  }
  if (productionFiles.length === 0) {
    throw new Error('loadSourceProgram: the production partition is empty')
  }
  if (testFiles.length === 0) {
    throw new Error('loadSourceProgram: the test partition is empty')
  }
  return { program, checker, productionFiles, testFiles }
}

export const sourceFileFor = (program: ts.Program, fileName: string): ts.SourceFile => {
  const sourceFile = program.getSourceFile(fileName)
  if (sourceFile === undefined) {
    throw new Error(`sourceFileFor: ${fileName} is not part of the compiled program`)
  }
  return sourceFile
}

export const forEachDescendant = (node: ts.Node, visit: (node: ts.Node) => void): void => {
  visit(node)
  node.forEachChild((child) => forEachDescendant(child, visit))
}

export const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile)).line + 1

export const isAmbientGlobal = (checker: ts.TypeChecker, node: ts.Node, name: string): boolean => {
  if (!ts.isIdentifier(node) || node.text !== name) return false
  const symbol = checker.getSymbolAtLocation(node)
  if (symbol === undefined) return false
  const declarations = symbol.declarations
  if (declarations === undefined || declarations.length === 0) return false
  return declarations.every((declaration) => declaration.getSourceFile().fileName.endsWith('.d.ts'))
}

export const findNamedImportSymbols = (
  checker: ts.TypeChecker,
  sourceFile: ts.SourceFile,
  moduleSpecifiers: readonly string[],
  importedNames: readonly string[]
): Map<ts.Symbol, string> => {
  const matches = new Map<ts.Symbol, string>()
  const moduleSet = new Set(moduleSpecifiers)
  const nameSet = new Set(importedNames)
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isImportDeclaration(node)) return
    if (!ts.isStringLiteral(node.moduleSpecifier)) return
    if (!moduleSet.has(node.moduleSpecifier.text)) return
    const namedBindings = node.importClause?.namedBindings
    if (namedBindings === undefined || !ts.isNamedImports(namedBindings)) return
    for (const element of namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text
      if (!nameSet.has(importedName)) continue
      const symbol = checker.getSymbolAtLocation(element.name)
      if (symbol !== undefined) {
        matches.set(symbol, importedName)
      }
    }
  })
  return matches
}
