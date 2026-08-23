import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import * as ts from 'typescript'
import { census, type Classified } from '../support/census.ts'
import { spawnServer } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const TEST_ROOT = fileURLToPath(new URL('../../test', import.meta.url))
const TSCONFIG_PATH = fileURLToPath(new URL('../../tsconfig.json', import.meta.url))

const SPAWN_CONTRACT_SUFFIX = '.spawn.contract'
const REJECTS_INVALID_SUFFIX = '.rejects-invalid'

const walkTestFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walkTestFiles(full)
    if (!entry.isFile()) return []
    return entry.name.endsWith('.test.ts') ? [full] : []
  })

const loadTestProgram = (): ts.Program => {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile)
  if (configFile.error !== undefined) {
    throw new Error(
      `collectPresentTestNames: failed to read ${TSCONFIG_PATH}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`
    )
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(TSCONFIG_PATH))
  if (parsed.errors.length > 0) {
    const rendered = parsed.errors
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
      .join('\n')
    throw new Error(`collectPresentTestNames: failed to parse ${TSCONFIG_PATH}: ${rendered}`)
  }
  return ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options })
}

const testNamesIn = (sourceFile: ts.SourceFile): string[] => {
  const names: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'test') {
      const firstArg = node.arguments[0]
      if (firstArg !== undefined && ts.isStringLiteralLike(firstArg)) {
        names.push(firstArg.text)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return names
}

export const collectPresentTestNames = (): Set<string> => {
  const files = walkTestFiles(TEST_ROOT)
  const program = loadTestProgram()
  const names = new Set<string>()

  for (const file of files) {
    const relativeFile = path.relative(TEST_ROOT, file)
    const sourceFile = program.getSourceFile(file)
    if (sourceFile === undefined) {
      throw new Error(`collectPresentTestNames: ${relativeFile} is not part of the compiled program`)
    }
    const syntacticDiagnostics = program.getSyntacticDiagnostics(sourceFile)
    if (syntacticDiagnostics.length > 0) {
      const rendered = syntacticDiagnostics
        .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        .join('\n')
      throw new Error(`collectPresentTestNames: ${relativeFile} failed to parse: ${rendered}`)
    }
    for (const name of testNamesIn(sourceFile)) {
      names.add(name)
    }
  }

  return names
}

export const classifyToolMandatoryTests = (
  toolName: string,
  presentTestNames: ReadonlySet<string>
): Classified<string>['verdict'] | 'unclassifiable' => {
  if (typeof toolName !== 'string' || toolName.trim().length === 0) return 'unclassifiable'
  const hasSpawnContract = presentTestNames.has(`${toolName}${SPAWN_CONTRACT_SUFFIX}`)
  const hasRejectsInvalid = presentTestNames.has(`${toolName}${REJECTS_INVALID_SUFFIX}`)
  return hasSpawnContract && hasRejectsInvalid ? 'allowed' : 'forbidden'
}

test('contract.every-tool-has-mandatory-tests', async () => {
  const spawned = await spawnServer({ projectRoot: PROJECT_ROOT })
  let liveToolNames: string[]
  try {
    const listed = await spawned.client.listTools()
    liveToolNames = listed.tools.map((tool) => tool.name)
  } finally {
    await spawned.close()
  }

  assert.ok(
    liveToolNames.length > 0,
    'contract.every-tool-has-mandatory-tests: the live server published no tools; a census over an empty list proves nothing'
  )

  const presentTestNames = collectPresentTestNames()
  const classify = (toolName: string): Classified<string>['verdict'] | 'unclassifiable' =>
    classifyToolMandatoryTests(toolName, presentTestNames)

  assert.doesNotThrow(() => census(liveToolNames, classify))
})

test('contract.every-tool-has-mandatory-tests.control.missing-test-is-forbidden', () => {
  const presentTestNames = new Set([
    `probe_tool${SPAWN_CONTRACT_SUFFIX}`
  ])
  assert.equal(classifyToolMandatoryTests('probe_tool', presentTestNames), 'forbidden')

  const bothPresent = new Set([`probe_tool${SPAWN_CONTRACT_SUFFIX}`, `probe_tool${REJECTS_INVALID_SUFFIX}`])
  assert.equal(classifyToolMandatoryTests('probe_tool', bothPresent), 'allowed')

  assert.equal(classifyToolMandatoryTests('', bothPresent), 'unclassifiable')
})
