import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { RepoPaths } from '../../src/thread/paths.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const PUSH_HELPER = join(LOGBOOK_ROOT, 'bin', 'logbook-push.ts')
const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = '2023-12-31T09:00:00.000Z'
const SPAWN_LIMIT_MS = 120000
const NETWORK_SOURCES = ['src/store/git.ts', 'src/thread/sync.ts', 'src/thread/reconcile.ts', 'bin/logbook-push.ts']
const TIMER_WORDS = ['setTimeout', 'timeoutMs', 'TIMEOUT_MS']

type Scratch = { root: string; repo: string; home: string; bin: string; probeOut: string }

const stateDocument = (): string => {
  const lines = [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
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
  mustGit(repo, ['config', 'user.name', 'Network Tester'])
  mustGit(repo, ['config', 'user.email', 'network@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'network test repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '--quiet', '-m', 'initial commit'])
}

const seedThreads = async (repo: string, home: string): Promise<RepoPaths> => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments } = await import('../../src/thread/store.ts')
  const rt = testRuntime({ env: { PATH: process.env.PATH, HOME: home }, sessionId: 'network-session' })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the scratch repository must be found')
  const seeded = commitDocuments(rt, found.value, {
    changes: [{ slug: 'fix-login', text: stateDocument(), expectedBlob: null }],
    message: 'open_thread fix-login: opened'
  })
  assert.ok(seeded.ok, `the thread must be seeded: ${JSON.stringify(seeded)}`)
  return found.value
}

const withScratch = async (fn: (scratch: Scratch) => Promise<void>): Promise<void> => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-git-non-interactive-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    const bin = join(root, 'bin')
    mkdirSync(home)
    mkdirSync(bin)
    initRepository(repo)
    await fn({ root, repo, home, bin, probeOut: join(root, 'probe-out.txt') })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const writeExecutable = (file: string, lines: readonly string[]): void => {
  writeFileSync(file, `${lines.join('\n')}\n`)
  chmodSync(file, 0o755)
}

const PROBE_LINES = [
  '"$(git config --get http.lowSpeedLimit)"',
  '"$(git config --get http.lowSpeedTime)"',
  '"$GIT_TERMINAL_PROMPT"',
  '"$GIT_PAGER"',
  '"$GCM_INTERACTIVE"',
  '"askpass=$GIT_ASKPASS"'
]

const writeProbeHelper = (bin: string, extra: readonly string[]): void => {
  writeExecutable(join(bin, 'git-remote-probe'), [
    '#!/bin/sh',
    `printf '%s\\n' ${[...PROBE_LINES, ...extra].join(' ')} > "$PROBE_OUT"`,
    'exit 1'
  ])
}

const probeRuntime = (scratch: Scratch, extraEnv: Record<string, string>): Runtime =>
  testRuntime({
    env: {
      PATH: `${scratch.bin}:${process.env.PATH ?? ''}`,
      HOME: scratch.home,
      PROBE_OUT: scratch.probeOut,
      ...extraEnv
    },
    sessionId: 'network-session'
  })

const probeLines = (scratch: Scratch): string[] => readFileSync(scratch.probeOut, 'utf8').replace(/\n$/, '').split('\n')

test('git.fetch-hands-dead-peer-settings-to-the-transport', async () => {
  await withScratch(async (scratch) => {
    const paths = await seedThreads(scratch.repo, scratch.home)
    mustGit(scratch.repo, ['remote', 'add', 'origin', 'probe::origin'])
    writeProbeHelper(scratch.bin, [])
    const { syncThreads } = await import('../../src/thread/sync.ts')
    const result = await syncThreads(probeRuntime(scratch, { GIT_ASKPASS: '/usr/bin/false' }), paths)
    assert.equal(result.fetched, false, JSON.stringify(result))
    assert.equal(typeof result.error, 'string')
    assert.notEqual(result.error, '')
    assert.deepEqual(probeLines(scratch), ['1', '60', '0', 'cat', 'never', 'askpass='])
  })
})

test('git.ssh-fetch-gets-batch-mode-and-server-alive', async () => {
  await withScratch(async (scratch) => {
    const paths = await seedThreads(scratch.repo, scratch.home)
    mustGit(scratch.repo, ['remote', 'add', 'origin', 'ssh://example.invalid/x.git'])
    writeExecutable(join(scratch.bin, 'ssh'), ['#!/bin/sh', 'printf \'%s\\n\' "$*" >> "$PROBE_OUT"', 'exit 255'])
    const { syncThreads } = await import('../../src/thread/sync.ts')
    const result = await syncThreads(probeRuntime(scratch, {}), paths)
    assert.equal(result.fetched, false, JSON.stringify(result))
    const text = readFileSync(scratch.probeOut, 'utf8')
    assert.ok(text.includes('-o BatchMode=yes'), text)
    assert.ok(text.includes('-o ServerAliveInterval=15'), text)
    assert.ok(text.includes('-o ServerAliveCountMax=4'), text)
  })
})

test('git.caller-config-entries-are-kept', async () => {
  await withScratch(async (scratch) => {
    const paths = await seedThreads(scratch.repo, scratch.home)
    mustGit(scratch.repo, ['remote', 'add', 'origin', 'probe::origin'])
    writeProbeHelper(scratch.bin, ['"$(git config --get probe.marker)"'])
    const { syncThreads } = await import('../../src/thread/sync.ts')
    const result = await syncThreads(
      probeRuntime(scratch, {
        GIT_ASKPASS: '/usr/bin/false',
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'probe.marker',
        GIT_CONFIG_VALUE_0: 'kept'
      }),
      paths
    )
    assert.equal(result.fetched, false, JSON.stringify(result))
    assert.deepEqual(probeLines(scratch), ['1', '60', '0', 'cat', 'never', 'askpass=', 'kept'])
  })
})

test('git.push-helper-pushes-with-only-the-repository-argument', async () => {
  await withScratch(async (scratch) => {
    await seedThreads(scratch.repo, scratch.home)
    const origin = join(scratch.root, 'origin.git')
    mustGit(scratch.root, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
    mustGit(scratch.repo, ['remote', 'add', 'origin', origin])
    const run = spawnSync(process.execPath, [PUSH_HELPER, scratch.repo], {
      cwd: scratch.root,
      env: { PATH: process.env.PATH ?? '', HOME: scratch.home },
      encoding: 'utf8',
      timeout: SPAWN_LIMIT_MS
    })
    assert.equal(run.status, 0, `exit ${String(run.status)}, error ${String(run.error?.message)}, stderr ${run.stderr}`)
    assert.equal(
      mustGit(origin, ['rev-parse', THREADS_REF]).trim(),
      mustGit(scratch.repo, ['rev-parse', THREADS_REF]).trim()
    )
  })
})

test('git.network-code-holds-no-wall-clock-timer', () => {
  for (const source of NETWORK_SOURCES) {
    const text = readFileSync(join(LOGBOOK_ROOT, source), 'utf8')
    for (const word of TIMER_WORDS) assert.ok(!text.includes(word), `${source} must not contain ${word}`)
  }
})
