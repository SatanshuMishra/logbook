import { test } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { readFixture, readFixtureManifest } from './hook-process.ts'

const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/hook-events', import.meta.url))
const HOOK_TYPES_PATH = fileURLToPath(new URL('../fixtures/hook-types.d.ts', import.meta.url))
const TSCONFIG_PATH = fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
const VIRTUAL_FILE_PATH = path.join(FIXTURES_DIR, '__generated-typecheck__.ts')

const loadCompilerOptions = (): ts.CompilerOptions => {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile)
  if (configFile.error !== undefined) {
    throw new Error(`loadCompilerOptions: failed to read ${TSCONFIG_PATH}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`)
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, path.dirname(TSCONFIG_PATH))
  if (parsed.errors.length > 0) {
    const rendered = parsed.errors.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n')
    throw new Error(`loadCompilerOptions: failed to parse ${TSCONFIG_PATH}: ${rendered}`)
  }
  return parsed.options
}

const buildGeneratedSource = (assignments: readonly { typeName: string; fileName: string; json: string }[]): string => {
  const relativeTypesImport = './' + path.relative(FIXTURES_DIR, HOOK_TYPES_PATH).replace(/\\/g, '/')
  const importLine = `import type * as HookTypes from '${relativeTypesImport}'`
  const bodyLines = assignments.map(
    (a, index) => `const fixture_${index}: HookTypes.${a.typeName} = ${a.json}`
  )
  return [importLine, ...bodyLines, ''].join('\n')
}

const createVirtualHost = (generatedSource: string, options: ts.CompilerOptions): ts.CompilerHost => {
  const realHost = ts.createCompilerHost(options, true)
  return {
    ...realHost,
    fileExists: (fileName) => (fileName === VIRTUAL_FILE_PATH ? true : realHost.fileExists(fileName)),
    readFile: (fileName) => (fileName === VIRTUAL_FILE_PATH ? generatedSource : realHost.readFile(fileName)),
    getSourceFile: (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
      if (fileName === VIRTUAL_FILE_PATH) {
        return ts.createSourceFile(fileName, generatedSource, ts.ScriptTarget.ES2022, true)
      }
      return realHost.getSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile)
    }
  }
}

const typecheckGeneratedFile = (generatedSource: string): readonly ts.Diagnostic[] => {
  const options = loadCompilerOptions()
  const host = createVirtualHost(generatedSource, options)
  const program = ts.createProgram({ rootNames: [VIRTUAL_FILE_PATH], options, host })
  return ts.getPreEmitDiagnostics(program)
}

test('hook.fixtures.typecheck', () => {
  const manifest = readFixtureManifest()
  assert.ok(manifest.fixtures.length > 0, 'expected the fixture manifest to list at least one fixture')

  const assignments = manifest.fixtures.map((entry) => ({
    typeName: entry.type,
    fileName: entry.file,
    json: JSON.stringify(readFixture(entry.file), null, 2)
  }))

  const generatedSource = buildGeneratedSource(assignments)
  const diagnostics = typecheckGeneratedFile(generatedSource)

  if (diagnostics.length > 0) {
    const rendered = diagnostics
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'))
      .join('\n')
    assert.fail(`expected every fixture to type-check against its pinned hook type, got:\n${rendered}`)
  }
})

test('hook.fixtures.typecheck.control.a-mistyped-fixture-fails-the-build', () => {
  const generatedSource = buildGeneratedSource([
    { typeName: 'SessionStartEvent', fileName: 'probe', json: JSON.stringify({ session_id: 'x', source: 'not-a-real-source', cwd: '/x', hook_event_name: 'SessionStart', transcript_path: '/x' }) }
  ])
  const diagnostics = typecheckGeneratedFile(generatedSource)
  assert.ok(diagnostics.length > 0, 'expected a fixture with an invalid enum value to fail type-checking')
})
