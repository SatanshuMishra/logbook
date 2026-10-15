import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'

type Source = { name: string; lines: readonly string[] }

const TSCONFIG_PATH = fileURLToPath(new URL('../../tsconfig.json', import.meta.url))
const IO_PATH = fileURLToPath(new URL('../../hooks/lib/io.ts', import.meta.url))

const CONTROL: Source = {
  name: 'control',
  lines: [
    "void runHook('empty', () => ({}))",
    "void runHook('stop', () => ({ hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'x' } }))",
    "void runHook('post-tool-use', () => ({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'x' } }))",
    "void runHook('session-start', () => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x' } }))",
    "void runHook('session-start-message', () => ({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'x' }, systemMessage: 'y' }))",
    "void runHook('pre-tool-use', () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', permissionDecisionReason: 'r' } }))",
    "const suppressed = { hookSpecificOutput: { hookEventName: 'Stop' as const, additionalContext: 'x' }, suppressOutput: true }",
    "void runHook('suppressed', () => suppressed)",
    "const unseen: any = { decision: 'block' }",
    "void runHook('any', () => unseen)",
    "const indexed: { hookSpecificOutput: { hookEventName: 'Stop'; additionalContext: string }; [key: string]: unknown } = { hookSpecificOutput: { hookEventName: 'Stop', additionalContext: 'x' }, decision: 'block' }",
    "void runHook('index-signature', () => indexed)",
    "const blocking = { hookSpecificOutput: { hookEventName: 'Stop' as const, additionalContext: 'x' }, decision: 'block' }",
    "const declared: { hookSpecificOutput: { hookEventName: 'Stop'; additionalContext: string } } = blocking",
    "void runHook('declared', () => declared)"
  ]
}

const compilerOptions = (): ts.CompilerOptions => {
  const configFile = ts.readConfigFile(TSCONFIG_PATH, ts.sys.readFile)
  if (configFile.error !== undefined) {
    throw new Error(`failed to read ${TSCONFIG_PATH}: ${ts.flattenDiagnosticMessageText(configFile.error.messageText, '\n')}`)
  }
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, dirname(TSCONFIG_PATH))
  if (parsed.errors.length > 0) {
    const rendered = parsed.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    throw new Error(`failed to parse ${TSCONFIG_PATH}: ${rendered.join('\n')}`)
  }
  return parsed.options
}

const sourceText = (source: Source): string =>
  [`import { runHook } from ${JSON.stringify(IO_PATH)}`, '', ...source.lines, ''].join('\n')

const typeErrors = (sources: readonly Source[]): ReadonlyMap<string, readonly string[]> => {
  const folder = mkdtempSync(join(tmpdir(), 'logbook-hook-output-type-'))
  try {
    const files = sources.map((source) => ({ source, file: join(folder, `${source.name}.mts`) }))
    for (const { source, file } of files) writeFileSync(file, sourceText(source))
    const program = ts.createProgram({ rootNames: files.map(({ file }) => file), options: compilerOptions() })
    return new Map(
      files.map(({ source, file }) => {
        const sourceFile = program.getSourceFile(file)
        if (sourceFile === undefined) throw new Error(`${source.name} is not part of the program`)
        const messages = ts
          .getPreEmitDiagnostics(program, sourceFile)
          .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        return [source.name, messages]
      })
    )
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

const assertControlAndRefusals = (sources: readonly Source[]): void => {
  const errors = typeErrors([CONTROL, ...sources])
  assert.deepEqual(errors.get(CONTROL.name), [])
  for (const source of sources) {
    const found = errors.get(source.name) ?? []
    assert.ok(found.length > 0, `${source.name} type-checked without an error`)
  }
}

test('hook-output.type-refuses-a-decision', async () => {
  await import('../../src/hook/output.ts')
  assertControlAndRefusals([
    { name: 'decision-in-place', lines: ["void runHook('decision', () => ({ decision: 'block', reason: 'r' }))"] },
    {
      name: 'decision-in-a-variable',
      lines: [
        "const output = { hookSpecificOutput: { hookEventName: 'Stop' as const, additionalContext: 'x' }, decision: 'block' }",
        "void runHook('decision', () => output)"
      ]
    }
  ])
})

test('hook-output.type-refuses-continue', async () => {
  await import('../../src/hook/output.ts')
  assertControlAndRefusals([
    { name: 'continue-in-place', lines: ["void runHook('continue', () => ({ continue: false, stopReason: 'r' }))"] },
    {
      name: 'continue-in-a-variable',
      lines: [
        "const output = { hookSpecificOutput: { hookEventName: 'PostToolUse' as const, additionalContext: 'x' }, continue: false }",
        "void runHook('continue', () => output)"
      ]
    }
  ])
})

test('hook-output.type-refuses-a-permission-decision-other-than-allow', async () => {
  await import('../../src/hook/output.ts')
  assertControlAndRefusals([
    {
      name: 'deny-in-place',
      lines: [
        "void runHook('deny', () => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } }))"
      ]
    },
    {
      name: 'ask-in-a-variable',
      lines: [
        "const output = { hookSpecificOutput: { hookEventName: 'PreToolUse' as const, permissionDecision: 'ask' as const, permissionDecisionReason: 'r' } }",
        "void runHook('ask', () => output)"
      ]
    }
  ])
})

test('hook-output.type-refuses-an-event-its-hooks-do-not-answer', async () => {
  await import('../../src/hook/output.ts')
  assertControlAndRefusals([
    {
      name: 'permission-request',
      lines: [
        "void runHook('permission-request', () => ({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny' } } }))"
      ]
    }
  ])
})

test('hook-output.type-refuses-fields-without-a-hook-specific-output', async () => {
  await import('../../src/hook/output.ts')
  assertControlAndRefusals([
    { name: 'suppress-output', lines: ["void runHook('suppress-output', () => ({ suppressOutput: true }))"] },
    { name: 'system-message', lines: ["void runHook('system-message', () => ({ systemMessage: 'y' }))"] }
  ])
})

test('hook-output.type-refuses-an-open-record', async () => {
  await import('../../src/hook/output.ts')
  assertControlAndRefusals([
    {
      name: 'open-record',
      lines: [
        "const output: Record<string, unknown> = { decision: 'block' }",
        "void runHook('open-record', () => output)"
      ]
    }
  ])
})
