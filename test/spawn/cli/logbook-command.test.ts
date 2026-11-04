import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RepoPaths } from '../../../src/thread/paths.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const COMMAND = join(LOGBOOK_ROOT, 'bin', 'logbook')
const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = '2023-12-31T09:00:00.000Z'
const SPAWN_LIMIT_MS = 120000
const SESSION_HOLDER = 'session-holder'
const PENDING_RISK = '- R1 Pending risk from the session.'
const REFUSAL_KEYS = ['accepted', 'example', 'field', 'message', 'ok', 'retryable']

type Modules = {
  store: typeof import('../../../src/thread/store.ts')
  reconcile: typeof import('../../../src/thread/reconcile.ts')
  paths: typeof import('../../../src/thread/paths.ts')
  holds: typeof import('../../../src/thread/holds.ts')
}

type Scratch = { root: string; repo: string; home: string; outside: string; env: Record<string, string> }

type Seeded = Scratch & { paths: RepoPaths; modules: Modules }

type CommandRun = { status: number | null; stdout: string; stderr: string; error: string | null }

type DocumentParts = { nextIds?: string; decisions?: readonly string[] }

const loadModules = async (): Promise<Modules> => ({
  store: await import('../../../src/thread/store.ts'),
  reconcile: await import('../../../src/thread/reconcile.ts'),
  paths: await import('../../../src/thread/paths.ts'),
  holds: await import('../../../src/thread/holds.ts')
})

const stateDocument = (parts: DocumentParts = {}): string => {
  const decisions = parts.decisions ?? []
  const lines = [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    `Next ids: ${parts.nextIds ?? 'c2 D1 R1 S1'}`,
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The login page loads.',
    '',
    '## Where things stand',
    '',
    'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    'Find the fault.',
    '',
    '## Decisions in force',
    '',
    ...(decisions.length === 0 ? [] : [...decisions, '']),
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live'
  ]
  return `${lines.join('\n')}\n`
}

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const initRepository = (repo: string): void => {
  mkdirSync(repo, { recursive: true })
  mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Command Tester'])
  mustGit(repo, ['config', 'user.email', 'command@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'command test repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '--quiet', '-m', 'initial commit'])
}

const withScratch = async (fn: (scratch: Scratch) => Promise<void> | void): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-command-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    const outside = join(root, 'outside')
    mkdirSync(home)
    mkdirSync(outside)
    initRepository(repo)
    await fn({ root, repo, home, outside, env: { PATH: process.env.PATH ?? '', HOME: home } })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const sessionRuntime = (scratch: Scratch) =>
  testRuntime({ env: { PATH: process.env.PATH, HOME: scratch.home }, sessionId: SESSION_HOLDER })

const withThread = async (
  parts: DocumentParts,
  fn: (seeded: Seeded) => Promise<void> | void
): Promise<void> => {
  const modules = await loadModules()
  await withScratch(async (scratch) => {
    const rt = sessionRuntime(scratch)
    const found = modules.paths.findRepository(rt, scratch.repo)
    assert.ok(found.ok, 'the scratch repository must be found')
    const seeded = modules.store.commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: stateDocument(parts), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, `the thread must be seeded: ${JSON.stringify(seeded)}`)
    await fn({ ...scratch, paths: found.value, modules })
  })
}

const runCommand = (args: readonly string[], cwd: string, env: Record<string, string>): CommandRun => {
  const result = spawnSync(COMMAND, [...args], { cwd, env, encoding: 'utf8', timeout: SPAWN_LIMIT_MS })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error === undefined ? null : result.error.message
  }
}

const describeRun = (run: CommandRun): string =>
  `exit ${String(run.status)}, error ${String(run.error)}, stdout ${JSON.stringify(run.stdout)}, stderr ${JSON.stringify(run.stderr)}`

const singleLine = (text: string): string => {
  const body = text.replace(/\n$/, '')
  assert.notEqual(body, '', 'the output must hold one line')
  assert.ok(!body.includes('\n'), `the output must be exactly one line: ${JSON.stringify(text)}`)
  return body
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS_REF]).trim()

const storedText = (repo: string): string => mustGit(repo, ['cat-file', 'blob', `${THREADS_REF}:fix-login.md`])

const messageLines = (repo: string, revision: string): string[] =>
  mustGit(repo, ['log', '-1', '--format=%B', revision]).replace(/\n+$/, '').split('\n')

const sectionBody = (text: string, heading: string): string => {
  const lines = text.split('\n')
  const start = lines.indexOf(`## ${heading}`)
  assert.ok(start >= 0, `the document must have the section ## ${heading}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
}

const sectionLines = (text: string, heading: string): string[] => sectionBody(text, heading).split('\n')

const assertWriterTrailer = (lines: readonly string[], writer: string): void => {
  assert.deepEqual(lines.slice(-2), ['', `Writer: ${writer}`], `the commit message must end with the writer: ${lines.join('\n')}`)
}

const assertRefusal = (run: CommandRun): Record<string, unknown> => {
  assert.equal(run.status, 1, describeRun(run))
  const refusal = JSON.parse(singleLine(run.stdout)) as Record<string, unknown>
  assert.equal(refusal.ok, false)
  assert.equal(typeof refusal.message, 'string')
  assert.ok(run.stderr.includes(refusal.message as string), `stderr must hold the refusal message: ${describeRun(run)}`)
  return refusal
}

const holdFile = (seeded: Seeded): string => {
  const file = seeded.modules.paths.holdPath(seeded.paths, 'fix-login')
  assert.ok(file.ok, 'the hold path must resolve')
  return file.value
}

const workingCopyFile = (seeded: Seeded): string => {
  const file = seeded.modules.paths.workingCopyPath(seeded.paths, 'fix-login')
  assert.ok(file.ok, 'the working copy path must resolve')
  return file.value
}

const withPendingRisk = (text: string): string => {
  const raised = text.replace('Next ids: c2 D1 R1 S1', 'Next ids: c2 D1 R2 S1')
  const edited = raised.replace('## Open risks\n\n', `## Open risks\n\n${PENDING_RISK}\n\n`)
  assert.notEqual(raised, text, 'the Next ids line must be raised')
  assert.notEqual(edited, raised, 'the pending risk must be added')
  return edited
}

const writeArgs = (tool: string, repo: string, writer: string, args: Record<string, unknown>): string[] => [
  tool,
  '--repo',
  repo,
  '--writer',
  writer,
  '--args',
  JSON.stringify(args)
]

const recordDecision = (seeded: Seeded, args: Record<string, unknown>): void => {
  const run = runCommand(writeArgs('record_decision', seeded.repo, 'run:demo', args), seeded.outside, seeded.env)
  assert.equal(run.status, 0, describeRun(run))
}

type LiveRun = { code: number | null; stdout: string; stdinOpen: boolean }

const runWithOpenInput = async (
  args: readonly string[],
  cwd: string,
  env: Record<string, string>
): Promise<LiveRun> => {
  const child = spawn(COMMAND, [...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  const chunks: Buffer[] = []
  child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  const closed = new Promise<LiveRun>((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code) => {
      resolve({ code, stdout: Buffer.concat(chunks).toString('utf8'), stdinOpen: !child.stdin.writableEnded })
    })
  })
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<'timeout'>((resolve) => {
    limitTimer = setTimeout(() => resolve('timeout'), SPAWN_LIMIT_MS)
  })
  try {
    const outcome = await Promise.race([closed, limit])
    if (outcome === 'timeout') {
      child.kill('SIGKILL')
      assert.fail(`bin/logbook ${args[0] ?? ''} did not exit within ${SPAWN_LIMIT_MS} ms while its input stayed open`)
    }
    return outcome
  } finally {
    clearTimeout(limitTimer)
    child.stdin.destroy()
  }
}

test('command.update-thread-commits-and-prints-the-structured-result', async () => {
  await withThread({}, (seeded) => {
    const run = runCommand(
      writeArgs('update_thread', seeded.repo, 'run:demo', {
        thread_id: 'fix-login',
        next_step: 'Ship the fix.',
        risks_add: [{ text: 'The fix may regress sign-up.' }]
      }),
      seeded.outside,
      seeded.env
    )
    assert.equal(run.status, 0, describeRun(run))
    assert.deepEqual(JSON.parse(singleLine(run.stdout)), {
      thread_id: 'fix-login',
      summary: 'next step set, added R1',
      added_risk_ids: ['R1']
    })
    const stored = storedText(seeded.repo)
    assert.equal(sectionBody(stored, 'Next step'), 'Ship the fix.')
    assert.ok(sectionLines(stored, 'Open risks').includes('- R1 The fix may regress sign-up.'), stored)
    assertWriterTrailer(messageLines(seeded.repo, THREADS_REF), 'run:demo')
  })
})

test('command.record-decision-commits-and-prints-the-structured-result', async () => {
  await withThread({}, (seeded) => {
    const run = runCommand(
      writeArgs('record_decision', seeded.repo, 'run:demo', {
        thread_id: 'fix-login',
        title: 'Pick a store: git',
        context: 'The thread needs a store.',
        options: ['git', 'a database'],
        outcome: 'git, because it is already there'
      }),
      seeded.outside,
      seeded.env
    )
    assert.equal(run.status, 0, describeRun(run))
    assert.deepEqual(JSON.parse(singleLine(run.stdout)), { thread_id: 'fix-login', decision_id: 'D1', removed: [] })
    const stored = storedText(seeded.repo)
    assert.ok(stored.split('\n').includes('- D1 Pick a store: git: git, because it is already there'), stored)
    const lines = messageLines(seeded.repo, THREADS_REF)
    assert.equal(lines[0], 'record_decision fix-login: D1 Pick a store: git')
    assert.ok(lines.includes('Outcome: git, because it is already there'), lines.join('\n'))
  })
})

test('command.park-thread-commits-and-prints-the-structured-result', async () => {
  await withThread({}, (seeded) => {
    seeded.modules.holds.takeHold(sessionRuntime(seeded), seeded.paths, 'fix-login', SESSION_HOLDER, null)
    const holdBefore = readFileSync(holdFile(seeded))
    const run = runCommand(
      writeArgs('park_thread', seeded.repo, 'run:demo', { thread_id: 'fix-login', next_step: 'Resume with the review.' }),
      seeded.outside,
      seeded.env
    )
    assert.equal(run.status, 0, describeRun(run))
    assert.deepEqual(JSON.parse(singleLine(run.stdout)), { parked_thread_ids: ['fix-login'] })
    const stored = storedText(seeded.repo)
    assert.ok(stored.split('\n').includes('Status: parked'), stored)
    assert.equal(sectionBody(stored, 'Next step'), 'Resume with the review.')
    assertWriterTrailer(messageLines(seeded.repo, THREADS_REF), 'run:demo')
    assert.deepEqual(readFileSync(holdFile(seeded)), holdBefore)
    assert.equal(seeded.modules.holds.readHold(seeded.paths, 'fix-login')?.holder, SESSION_HOLDER)
  })
})

test('command.repo-flag-wins-over-the-session-environment', async () => {
  await withThread({}, (seeded) => {
    const second = join(seeded.root, 'second')
    initRepository(second)
    const run = runCommand(
      writeArgs('update_thread', seeded.repo, 'run:demo', { thread_id: 'fix-login', next_step: 'Ship the fix.' }),
      seeded.outside,
      { ...seeded.env, CLAUDE_PROJECT_DIR: second, CLAUDE_CODE_SESSION_ID: 'inherited-session' }
    )
    assert.equal(run.status, 0, describeRun(run))
    assert.equal(sectionBody(storedText(seeded.repo), 'Next step'), 'Ship the fix.')
    assert.notEqual(rawGit(second, ['rev-parse', '--verify', '--quiet', THREADS_REF]).status, 0)
    const lines = messageLines(seeded.repo, THREADS_REF)
    assert.equal(lines[lines.length - 1], 'Writer: run:demo')
    assert.ok(!lines.includes('Writer: inherited-session'), lines.join('\n'))
  })
})

test('command.usage-errors-exit-2-and-change-nothing', async () => {
  await withThread({}, (seeded) => {
    const repo = seeded.repo
    const step = '{"thread_id":"fix-login","next_step":"x"}'
    const cases: ReadonlyArray<readonly [string, readonly string[]]> = [
      ['no command', []],
      ['unknown command', ['frobnicate', '--repo', repo]],
      ['unknown flag', ['update_thread', '--repo', repo, '--writer', 'run:demo', '--args', step, '--force']],
      ['repeated flag', ['update_thread', '--repo', repo, '--repo', repo, '--writer', 'run:demo', '--args', step]],
      ['flag without a value', ['update_thread', '--repo', repo, '--writer', 'run:demo', '--args']],
      ['positional argument', ['update_thread', 'extra', '--repo', repo, '--writer', 'run:demo', '--args', step]],
      ['missing --repo', ['update_thread', '--writer', 'run:demo', '--args', step]],
      ['missing --writer', ['update_thread', '--repo', repo, '--args', step]],
      ['missing --args', ['update_thread', '--repo', repo, '--writer', 'run:demo']],
      ['missing --thread', ['decisions', '--repo', repo]],
      ['flag the command does not take', ['decisions', '--repo', repo, '--thread', 'fix-login', '--writer', 'run:demo']],
      ['writer refused', ['update_thread', '--repo', repo, '--writer', 'run:Bad Slug', '--args', step]],
      ['args not JSON', ['update_thread', '--repo', repo, '--writer', 'run:demo', '--args', '{not json']],
      ['args not an object', ['update_thread', '--repo', repo, '--writer', 'run:demo', '--args', '[1,2]']],
      ['flag with an empty value', ['update_thread', '--repo', '', '--writer', 'run:demo', '--args', step]]
    ]
    assert.equal(cases.length, 15)
    const before = tipOf(repo)
    for (const [name, args] of cases) {
      const run = runCommand(args, seeded.outside, seeded.env)
      assert.equal(run.status, 2, `${name}: ${describeRun(run)}`)
      assert.equal(run.stdout, '', `${name}: ${describeRun(run)}`)
      const lines = run.stderr.replace(/\n$/, '').split('\n')
      assert.equal(lines.length, 1, `${name}: ${describeRun(run)}`)
      assert.ok((lines[0] ?? '').startsWith('logbook: '), `${name}: ${describeRun(run)}`)
    }
    assert.equal(tipOf(repo), before)
  })
})

test('command.schema-refusal-exits-1-with-the-refusal-json', async () => {
  await withThread({}, (seeded) => {
    const before = tipOf(seeded.repo)
    const run = runCommand(
      writeArgs('update_thread', seeded.repo, 'run:demo', { thread_id: 'fix-login' }),
      seeded.outside,
      seeded.env
    )
    const refusal = assertRefusal(run)
    assert.deepEqual(Object.keys(refusal).sort(), REFUSAL_KEYS)
    assert.equal(typeof refusal.field, 'string')
    assert.equal(typeof refusal.accepted, 'string')
    assert.equal(typeof refusal.example, 'string')
    assert.equal(typeof refusal.retryable, 'boolean')
    assert.equal(tipOf(seeded.repo), before)
  })
})

test('command.unknown-thread-exits-1-with-the-refusal-json', async () => {
  await withThread({}, (seeded) => {
    const before = tipOf(seeded.repo)
    const run = runCommand(
      writeArgs('record_decision', seeded.repo, 'run:demo', {
        thread_id: 'ghost',
        title: 't',
        context: 'c',
        options: ['a', 'b'],
        outcome: 'a'
      }),
      seeded.outside,
      seeded.env
    )
    const refusal = assertRefusal(run)
    assert.equal(refusal.field, 'thread_id')
    assert.equal(tipOf(seeded.repo), before)
  })
})

test('command.missing-repository-exits-1-with-the-refusal-json', async () => {
  await withScratch((scratch) => {
    const bare = join(scratch.root, 'not-a-repository')
    mkdirSync(bare)
    const run = runCommand(
      writeArgs('update_thread', bare, 'run:demo', { thread_id: 'fix-login', next_step: 'x' }),
      scratch.outside,
      scratch.env
    )
    const refusal = assertRefusal(run)
    assert.equal(typeof refusal.field, 'string')
    assert.notEqual(refusal.field, '')
    assert.equal(existsSync(join(bare, '.git')), false)
  })
})

test('command.well-formed-write-exits-0', async () => {
  await withThread({}, (seeded) => {
    const run = runCommand(
      writeArgs('update_thread', seeded.repo, '0123-session_id', { thread_id: 'fix-login', next_step: 'Ship the fix.' }),
      seeded.outside,
      seeded.env
    )
    assert.equal(run.status, 0, describeRun(run))
    const result = JSON.parse(singleLine(run.stdout)) as Record<string, unknown>
    assert.equal(result.thread_id, 'fix-login')
    assert.equal(run.stderr, '')
    assertWriterTrailer(messageLines(seeded.repo, THREADS_REF), '0123-session_id')
  })
})

test('command.finishes-with-an-open-input-pipe', async () => {
  await withThread({}, async (seeded) => {
    const write = await runWithOpenInput(
      writeArgs('update_thread', seeded.repo, 'run:demo', { thread_id: 'fix-login', next_step: 'Ship the fix.' }),
      seeded.outside,
      seeded.env
    )
    assert.equal(write.code, 0, JSON.stringify(write))
    assert.equal(write.stdinOpen, true)
    JSON.parse(singleLine(write.stdout))
    const read = await runWithOpenInput(
      ['decisions', '--repo', seeded.repo, '--thread', 'fix-login'],
      seeded.outside,
      seeded.env
    )
    assert.equal(read.code, 0, JSON.stringify(read))
    assert.equal(read.stdinOpen, true)
    assert.equal(singleLine(read.stdout), '[]')
  })
})

test('command.decisions-lists-the-decisions-in-force-from-their-commits', async () => {
  await withThread({}, (seeded) => {
    const common = { thread_id: 'fix-login', context: 'c', options: ['a', 'b'] }
    recordDecision(seeded, { ...common, title: 'Pick a store: git', outcome: 'git, because it is already there' })
    recordDecision(seeded, { ...common, title: 'Retry policy', outcome: 'retry until it lands' })
    recordDecision(seeded, { ...common, title: 'Retry forever', outcome: 'no cap', supersedes: ['D2'] })
    const run = runCommand(['decisions', '--repo', seeded.repo, '--thread', 'fix-login'], seeded.outside, seeded.env)
    assert.equal(run.status, 0, describeRun(run))
    assert.deepEqual(JSON.parse(singleLine(run.stdout)), [
      { id: 'D1', title: 'Pick a store: git', outcome: 'git, because it is already there' },
      { id: 'D3', title: 'Retry forever', outcome: 'no cap' }
    ])
  })
})

test('command.decisions-splits-a-hand-written-line-at-its-first-colon', async () => {
  await withThread(
    { nextIds: 'c2 D2 R1 S1', decisions: ['- D1 Use sh: it is everywhere: and small'] },
    (seeded) => {
      const run = runCommand(['decisions', '--repo', seeded.repo, '--thread', 'fix-login'], seeded.outside, seeded.env)
      assert.equal(run.status, 0, describeRun(run))
      assert.deepEqual(JSON.parse(singleLine(run.stdout)), [
        { id: 'D1', title: 'Use sh', outcome: 'it is everywhere: and small' }
      ])
    }
  )
})

test('command.decisions-prints-an-empty-array-for-a-thread-with-none', async () => {
  await withThread({}, (seeded) => {
    const run = runCommand(['decisions', '--repo', seeded.repo, '--thread', 'fix-login'], seeded.outside, seeded.env)
    assert.equal(run.status, 0, describeRun(run))
    assert.equal(singleLine(run.stdout), '[]')
  })
})

test('command.decisions-refuses-an-unknown-thread', async () => {
  await withThread({}, (seeded) => {
    const run = runCommand(['decisions', '--repo', seeded.repo, '--thread', 'ghost'], seeded.outside, seeded.env)
    const refusal = assertRefusal(run)
    assert.equal(refusal.field, 'thread_id')
  })
})

const DANGLING_ALIAS = '01ARZ3NDEKTSV4RRFFQ69G5FAV'

const storeDanglingAlias = (seeded: Seeded): void => {
  const aliasFile = join(seeded.root, 'aliases.json')
  writeFileSync(aliasFile, `${JSON.stringify({ [DANGLING_ALIAS]: 'ghost' })}\n`)
  const blob = mustGit(seeded.repo, ['hash-object', '-w', aliasFile]).trim()
  mustGit(seeded.repo, ['read-tree', THREADS_REF])
  mustGit(seeded.repo, ['update-index', '--add', '--cacheinfo', `100644,${blob},aliases.json`])
  const tree = mustGit(seeded.repo, ['write-tree']).trim()
  const commit = mustGit(seeded.repo, ['commit-tree', tree, '-p', THREADS_REF, '-m', 'alias a thread with no document']).trim()
  mustGit(seeded.repo, ['update-ref', THREADS_REF, commit])
  mustGit(seeded.repo, ['read-tree', 'HEAD'])
}

test('command.decisions-refuses-an-alias-whose-thread-has-no-document', async () => {
  await withThread({}, (seeded) => {
    storeDanglingAlias(seeded)
    const run = runCommand(['decisions', '--repo', seeded.repo, '--thread', DANGLING_ALIAS], seeded.outside, seeded.env)
    const refusal = assertRefusal(run)
    assert.deepEqual(Object.keys(refusal).sort(), REFUSAL_KEYS)
    assert.equal(refusal.field, 'thread_id')
    assert.equal(refusal.retryable, true)
    assert.equal(
      refusal.message,
      `the thread ghost has no document at the tip of ${THREADS_REF}, so its decisions could not be read`
    )
  })
})

test('command.run-and-session-write-one-thread-together', async () => {
  await withThread({}, (seeded) => {
    const session = sessionRuntime(seeded)
    seeded.modules.holds.takeHold(session, seeded.paths, 'fix-login', SESSION_HOLDER, null)
    const materialised = seeded.modules.reconcile.reconcileThread(session, seeded.paths, 'fix-login')
    assert.ok('kind' in materialised && materialised.kind === 'materialised', JSON.stringify(materialised))
    const copy = workingCopyFile(seeded)
    writeFileSync(copy, withPendingRisk(readFileSync(copy, 'utf8')))
    const copyBefore = readFileSync(copy)
    const holdBefore = readFileSync(holdFile(seeded))
    const run = runCommand(
      writeArgs('update_thread', seeded.repo, 'run:demo', { thread_id: 'fix-login', next_step: 'Ship the fix.' }),
      seeded.outside,
      seeded.env
    )
    assert.equal(run.status, 0, describeRun(run))
    assert.deepEqual(readFileSync(copy), copyBefore)
    assert.deepEqual(readFileSync(holdFile(seeded)), holdBefore)
    const settled = seeded.modules.reconcile.reconcileThread(session, seeded.paths, 'fix-login')
    assert.ok('kind' in settled && settled.kind === 'accepted', JSON.stringify(settled))
    const stored = storedText(seeded.repo)
    assert.equal(sectionBody(stored, 'Next step'), 'Ship the fix.')
    assert.ok(stored.split('\n').includes(PENDING_RISK), stored)
    const newest = messageLines(seeded.repo, THREADS_REF)
    const parent = messageLines(seeded.repo, `${THREADS_REF}^`)
    assert.equal(newest[newest.length - 1], `Writer: ${SESSION_HOLDER}`)
    assert.equal(parent[parent.length - 1], 'Writer: run:demo')
  })
})
