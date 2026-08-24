import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import * as ts from 'typescript'
import { census } from '../support/census.ts'
import type { Classified } from '../support/census.ts'
import {
  REBUILD_ROOT,
  forEachDescendant,
  isFixtureFile,
  loadSourceProgram,
  relativeToRoot,
  sourceFileFor
} from '../support/source-census.ts'

const PROMPTS_RELATIVE_FILE = path.join('src', 'server', 'prompts.ts')
const ALLOWED_IMPORTER = path.join('src', 'server', 'main.ts')
const TOOLS_DIR_RELATIVE = path.join('src', 'server', 'tools')

type PromptImporterCandidate = { importer: string }

const resolvesToPromptsModule = (importingFile: string, moduleSpecifier: string): boolean => {
  if (!moduleSpecifier.startsWith('.')) return false
  const resolved = path.normalize(path.join(path.dirname(importingFile), moduleSpecifier))
  const promptsAbsolute = path.join(REBUILD_ROOT, PROMPTS_RELATIVE_FILE)
  return resolved === promptsAbsolute
}

const collectPromptImporters = (): PromptImporterCandidate[] => {
  const { program, productionFiles } = loadSourceProgram()
  const promptsAbsolute = path.join(REBUILD_ROOT, PROMPTS_RELATIVE_FILE)
  const found: PromptImporterCandidate[] = []

  for (const fileName of productionFiles) {
    if (path.normalize(fileName) === promptsAbsolute) continue
    const sourceFile = sourceFileFor(program, fileName)
    forEachDescendant(sourceFile, (node) => {
      if (!ts.isImportDeclaration(node)) return
      if (!ts.isStringLiteral(node.moduleSpecifier)) return
      if (!resolvesToPromptsModule(fileName, node.moduleSpecifier.text)) return
      found.push({ importer: relativeToRoot(fileName) })
    })
  }

  return found
}

const classifyPromptImporter = (
  candidate: PromptImporterCandidate
): Classified<PromptImporterCandidate>['verdict'] | 'unclassifiable' =>
  candidate.importer === ALLOWED_IMPORTER ? 'allowed' : 'forbidden'

test('prompt.nothing-depends-on-them', () => {
  const importers = collectPromptImporters()
  assert.ok(importers.length > 0, 'expected at least one production module to import prompts.ts')
  assert.ok(
    importers.some((c) => c.importer === ALLOWED_IMPORTER),
    'expected main.ts to be the module that registers the prompts'
  )
  assert.doesNotThrow(() => census(importers, classifyPromptImporter))

  const synthetic: PromptImporterCandidate[] = [{ importer: path.join('src', 'server', 'tools', 'resume_thread.ts') }]
  assert.throws(() => census(synthetic, classifyPromptImporter))
})

const collectRegisteredPromptNames = (): string[] => {
  const { program } = loadSourceProgram()
  const promptsAbsolute = path.join(REBUILD_ROOT, PROMPTS_RELATIVE_FILE)
  const sourceFile = sourceFileFor(program, promptsAbsolute)
  const names: string[] = []
  forEachDescendant(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return
    if (!ts.isPropertyAccessExpression(node.expression)) return
    if (node.expression.name.text !== 'registerPrompt') return
    const [firstArg] = node.arguments
    if (firstArg !== undefined && ts.isStringLiteral(firstArg)) names.push(firstArg.text)
  })
  return names
}

type ToolHandlerLiteral = { file: string; text: string }

const collectToolHandlerStringLiterals = (): ToolHandlerLiteral[] => {
  const { program, productionFiles } = loadSourceProgram()
  const toolsDirAbsolute = path.join(REBUILD_ROOT, TOOLS_DIR_RELATIVE)
  const found: ToolHandlerLiteral[] = []

  for (const fileName of productionFiles) {
    const relative = relativeToRoot(fileName)
    if (isFixtureFile(relative)) continue
    if (!fileName.startsWith(toolsDirAbsolute + path.sep)) continue
    if (path.basename(fileName) === 'index.ts') continue
    const sourceFile = sourceFileFor(program, fileName)
    forEachDescendant(sourceFile, (node) => {
      if (!ts.isStringLiteral(node)) return
      found.push({ file: relative, text: node.text })
    })
  }

  return found
}

test('prompt.no-tool-handler-references-a-prompt-by-name', () => {
  const promptNames = new Set(collectRegisteredPromptNames())
  assert.ok(promptNames.size > 0, 'expected prompts.ts to register at least one prompt')

  const literals = collectToolHandlerStringLiterals()
  assert.ok(literals.length > 0, 'expected at least one string literal across the tool handler files')

  const classifyToolHandlerLiteral = (
    literal: ToolHandlerLiteral
  ): Classified<ToolHandlerLiteral>['verdict'] | 'unclassifiable' =>
    promptNames.has(literal.text) ? 'forbidden' : 'allowed'

  assert.doesNotThrow(() => census(literals, classifyToolHandlerLiteral))

  const [firstPromptName] = [...promptNames]
  assert.ok(firstPromptName !== undefined)
  const synthetic: ToolHandlerLiteral[] = [{ file: path.join('src', 'server', 'tools', 'resume_thread.ts'), text: firstPromptName }]
  assert.throws(() => census(synthetic, classifyToolHandlerLiteral))
})
