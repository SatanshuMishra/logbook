import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { rawGit } from '../support/git-fixture.ts'
import type { HookProcessResult } from '../support/run-hook.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; workingDir: string; workingCopy: string }

const ALLOW = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'allow',
    permissionDecisionReason: 'logbook working copy'
  }
}

const PRE_TOOL_USE_ENTRY = fileURLToPath(new URL('../../hooks/pre-tool-use.ts', import.meta.url))

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const writeFile = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-permission-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-permission-home-'))
  try {
    initRepo(repo)
    const workingDir = join(home, '.logbook', 'demo-0123456789ab')
    mkdirSync(workingDir, { recursive: true })
    await fn({ repo, home, workingDir, workingCopy: join(workingDir, 'fix-login.md') })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const withFolder = async (prefix: string, fn: (folder: string) => Promise<void>): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), `${prefix}-`))
  try {
    await fn(folder)
  } finally {
    rmSync(folder, { recursive: true, force: true })
  }
}

const preEvent = (fixture: Fixture, tool: string, toolInput: Record<string, unknown>): Record<string, unknown> => ({
  session_id: 's1',
  transcript_path: join(fixture.home, 'transcripts', 's1.jsonl'),
  cwd: fixture.repo,
  prompt_id: 'p1',
  hook_event_name: 'PreToolUse',
  tool_name: tool,
  tool_input: toolInput,
  tool_use_id: 'toolu_01'
})

const readEvent = (fixture: Fixture, file: string): Record<string, unknown> => preEvent(fixture, 'Read', { file_path: file })

const editEvent = (fixture: Fixture, file: string): Record<string, unknown> =>
  preEvent(fixture, 'Edit', { file_path: file, old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false })

const answerOf = async (
  fixture: Fixture,
  event: Record<string, unknown>,
  env: Record<string, string> = { HOME: fixture.home }
): Promise<unknown> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook: 'pre-tool-use', event, env })
  assert.equal(run.code, 0, run.stderr)
  return JSON.parse(run.stdout)
}

const readAll = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = await stream.toArray()
  return Buffer.concat(chunks).toString('utf8')
}

const runWithoutHome = async (event: Record<string, unknown>): Promise<HookProcessResult> => {
  const child = spawn(process.execPath, [PRE_TOOL_USE_ENTRY], { env: { PATH: process.env.PATH ?? '' } })
  const closed = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => resolve(code))
  })
  child.stdin.end(JSON.stringify(event))
  const [stdout, stderr, code] = await Promise.all([readAll(child.stdout), readAll(child.stderr), closed])
  return { code, stdout, stderr }
}

test('permission.allows-reading-and-editing-a-working-copy', async () => {
  await withFixture(async (fixture) => {
    writeFile(fixture.workingCopy, '# fix-login: Fix the login page\n')
    assert.deepEqual(await answerOf(fixture, readEvent(fixture, fixture.workingCopy)), ALLOW)
    assert.deepEqual(await answerOf(fixture, editEvent(fixture, fixture.workingCopy)), ALLOW)
  })
})

test('permission.allows-a-working-copy-through-a-symlinked-folder', async () => {
  await withFixture(async (fixture) => {
    writeFile(fixture.workingCopy, '# fix-login: Fix the login page\n')
    await withFolder('logbook-permission-link', async (folder) => {
      const link = join(folder, 'linked-working-folder')
      symlinkSync(fixture.workingDir, link)
      assert.deepEqual(await answerOf(fixture, readEvent(fixture, join(link, 'fix-login.md'))), ALLOW)
    })
  })
})

test('permission.allows-a-working-copy-not-yet-written', async () => {
  await withFixture(async (fixture) => {
    assert.deepEqual(await answerOf(fixture, readEvent(fixture, join(fixture.workingDir, 'new-thread.md'))), ALLOW)
  })
})

test('permission.gives-nothing-for-other-paths', async () => {
  await withFixture(async (fixture) => {
    writeFile(fixture.workingCopy, '# fix-login: Fix the login page\n')
    const notes = join(fixture.home, '.logbook', 'notes.txt')
    const sshConfig = join(fixture.home, '.ssh', 'config')
    const nested = join(fixture.workingDir, 'sub', 'x.md')
    const upperCase = join(fixture.workingDir, 'Bad.md')
    const badKey = join(fixture.home, '.logbook', 'Demo', 'fix-login.md')
    for (const file of [notes, sshConfig, nested, upperCase, badKey]) writeFile(file, 'not a working copy\n')
    const others = [
      notes,
      `${fixture.workingDir}/../../.ssh/config`,
      nested,
      upperCase,
      badKey,
      join(fixture.repo, 'README.md')
    ]
    for (const file of others) {
      assert.deepEqual(await answerOf(fixture, readEvent(fixture, file)), {}, `Read of ${file}`)
    }
    assert.deepEqual(await answerOf(fixture, readEvent(fixture, fixture.workingCopy)), ALLOW)
  })
})

test('permission.gives-nothing-through-a-symlink-leading-outside', async () => {
  await withFixture(async (fixture) => {
    await withFolder('logbook-permission-outside', async (folder) => {
      const target = join(folder, 'outside.md')
      writeFile(target, '# fix-login: Fix the login page\n')
      symlinkSync(target, fixture.workingCopy)
      assert.deepEqual(await answerOf(fixture, editEvent(fixture, fixture.workingCopy)), {})
      const other = join(fixture.workingDir, 'other-thread.md')
      writeFile(other, '# other-thread: Another thread\n')
      assert.deepEqual(await answerOf(fixture, editEvent(fixture, other)), ALLOW)
    })
  })
})

test('permission.gives-nothing-for-write-and-other-tools', async () => {
  await withFixture(async (fixture) => {
    writeFile(fixture.workingCopy, '# fix-login: Fix the login page\n')
    const write = preEvent(fixture, 'Write', { file_path: fixture.workingCopy, content: '# fix-login: Fix it\n' })
    const notebook = preEvent(fixture, 'NotebookEdit', { notebook_path: fixture.workingCopy, new_source: 'x' })
    const noPath = preEvent(fixture, 'Read', { limit: 10 })
    for (const event of [write, notebook, noPath]) {
      assert.deepEqual(await answerOf(fixture, event), {}, `${String(event.tool_name)} event`)
    }
    assert.deepEqual(await answerOf(fixture, readEvent(fixture, fixture.workingCopy)), ALLOW)
  })
})

test('permission.gives-nothing-without-home', async () => {
  await withFixture(async (fixture) => {
    writeFile(fixture.workingCopy, '# fix-login: Fix the login page\n')
    const event = readEvent(fixture, fixture.workingCopy)
    const unset = await runWithoutHome(event)
    assert.equal(unset.code, 0, unset.stderr)
    assert.deepEqual(JSON.parse(unset.stdout), {})
    assert.deepEqual(await answerOf(fixture, event, { HOME: '' }), {})
    const { permissionDecision } = await import('../../src/hook/permission.ts')
    const call = { tool_name: 'Read', tool_input: { file_path: fixture.workingCopy } }
    assert.deepEqual(permissionDecision(testRuntime({ cwd: fixture.repo, env: {} }), call), {})
    assert.deepEqual(permissionDecision(testRuntime({ cwd: fixture.repo, env: { HOME: '' } }), call), {})
    assert.deepEqual(permissionDecision(testRuntime({ cwd: fixture.repo, env: { HOME: fixture.home } }), call), ALLOW)
  })
})

test('permission.answers-a-subagent-the-same', async () => {
  await withFixture(async (fixture) => {
    writeFile(fixture.workingCopy, '# fix-login: Fix the login page\n')
    const event = { ...editEvent(fixture, fixture.workingCopy), agent_id: 'a1', agent_type: 'general-purpose' }
    assert.deepEqual(await answerOf(fixture, event), ALLOW)
  })
})
