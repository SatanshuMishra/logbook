import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments, readDocument } from '../../src/thread/store.ts'
import { pushThreads, syncThreads } from '../../src/thread/sync.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const THREADS = 'refs/logbook/threads'
const START = '2026-10-14T10:20:00.000Z'
const SLEEP_SECONDS = 30
const SYNC_LIMIT_MS = 500
const PUSH_LIMIT_MS = 10000
const STOPPED_WELL_BEFORE_MS = 10000
const HELPER_GONE_WITHIN_MS = 5000
const POLL_MS = 50

type Clone = { repo: string; paths: RepoPaths; rt: Runtime }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const threadDoc = (slug: string, stand: string): string =>
  [
    `# ${slug}: Work on ${slug}`,
    'Status: active',
    `Updated: ${START}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The login page loads',
    '',
    '## Where things stand',
    '',
    stand,
    '',
    '## Next step',
    '',
    'Fix the submit handler.',
    '',
    '## Decisions in force',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md',
    ''
  ].join('\n')

const clientFor = (scratch: string, repo: string, name: string): Clone => {
  mustGit(repo, ['config', 'user.name', `Bounded Tester ${name}`])
  mustGit(repo, ['config', 'user.email', `${name}@logbook.test`])
  const home = join(scratch, `home-${name}`)
  mkdirSync(home)
  const rt = testRuntime({
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: home, PLUGIN_METRICS_DIR: join(scratch, `metrics-${name}`) },
    sessionId: `session-${name}`,
    start: START
  })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the test repository must be found')
  return { repo, paths: found.value, rt }
}

const commitThread = (clone: Clone, slug: string, text: string): void => {
  const stored = readDocument(clone.rt, clone.paths, slug)
  const committed = commitDocuments(clone.rt, clone.paths, {
    changes: [{ slug, text, expectedBlob: stored?.blob ?? null }],
    message: `update ${slug}: test change`
  })
  assert.ok(committed.ok, JSON.stringify(committed))
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS]).trim()

const storedText = (repo: string, slug: string): string => mustGit(repo, ['cat-file', 'blob', `${THREADS}:${slug}.md`])

const withScratch = async (fn: (scratch: string) => Promise<void>): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-bounded-sync-'))
  try {
    await fn(scratch)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const soloWithThread = (scratch: string): Clone => {
  const repo = join(scratch, 'repo')
  mkdirSync(repo)
  mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
  const solo = clientFor(scratch, repo, 'solo')
  commitThread(solo, 'fix-login', threadDoc('fix-login', 'The form renders but submitting it fails.'))
  return solo
}

const withBareOrigin = (scratch: string): string => {
  const origin = join(scratch, 'origin.git')
  mustGit(scratch, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
  return origin
}

const cloneOf = (scratch: string, origin: string, name: string): Clone => {
  mustGit(scratch, ['clone', '--quiet', origin, name])
  return clientFor(scratch, join(scratch, name), name)
}

const processRunning = (commandLine: string): boolean =>
  spawnSync('pgrep', ['-f', `${commandLine.replaceAll('.', '\\.')}$`], { encoding: 'utf8' }).status === 0

const settlesWithin = async (limitMs: number, gone: () => boolean): Promise<boolean> => {
  const deadline = performance.now() + limitMs
  while (performance.now() < deadline) {
    if (gone()) return true
    await new Promise((resolve) => setTimeout(resolve, POLL_MS))
  }
  return gone()
}

test('bounded-sync.sync-past-its-limit-is-stopped', async () => {
  await withScratch(async (scratch) => {
    const solo = soloWithThread(scratch)
    const sleepCommand = `sleep ${SLEEP_SECONDS}.${String(randomInt(10000, 99999))}`
    mustGit(solo.repo, ['remote', 'add', 'origin', `ext::${sleepCommand}`])
    mustGit(solo.repo, ['config', 'protocol.ext.allow', 'always'])
    const before = tipOf(solo.repo)
    const started = performance.now()
    const result = await syncThreads(solo.rt, solo.paths, { limitMs: SYNC_LIMIT_MS })
    const elapsed = performance.now() - started
    assert.ok(elapsed < STOPPED_WELL_BEFORE_MS, `the sync took ${elapsed} ms`)
    assert.equal(result.error, `sync with origin stopped after ${SYNC_LIMIT_MS} ms`)
    assert.equal(result.pushed, false)
    assert.equal(tipOf(solo.repo), before)
    assert.ok(
      await settlesWithin(HELPER_GONE_WITHIN_MS, () => !processRunning(sleepCommand)),
      'the transport helper git started must be stopped with it'
    )
  })
})

test('bounded-sync.push-threads-reports-pushed', async () => {
  await withScratch(async (scratch) => {
    const origin = withBareOrigin(scratch)
    const solo = soloWithThread(scratch)
    mustGit(solo.repo, ['remote', 'add', 'origin', origin])
    assert.equal(rawGit(origin, ['rev-parse', '--verify', '--quiet', THREADS]).status, 1)
    const outcome = await pushThreads(solo.rt, solo.paths, { limitMs: PUSH_LIMIT_MS })
    assert.deepEqual(outcome, { pushed: true, error: null })
    assert.equal(tipOf(origin), tipOf(solo.repo))
  })
})

test('bounded-sync.push-threads-reports-the-failure', async () => {
  await withScratch(async (scratch) => {
    const empty = join(scratch, 'not-a-repository')
    mkdirSync(empty)
    const solo = soloWithThread(scratch)
    mustGit(solo.repo, ['remote', 'add', 'origin', empty])
    const before = tipOf(solo.repo)
    const outcome = await pushThreads(solo.rt, solo.paths, { limitMs: PUSH_LIMIT_MS })
    assert.equal(outcome.pushed, false)
    assert.match(outcome.error ?? '', /^fetch from origin failed: .*does not appear to be a git repository/)
    assert.equal(tipOf(solo.repo), before)
  })
})

test('bounded-sync.push-threads-merges-a-moved-origin', async () => {
  await withScratch(async (scratch) => {
    const origin = withBareOrigin(scratch)
    const other = cloneOf(scratch, origin, 'other')
    const otherText = threadDoc('other-work', 'The other computer started this.')
    commitThread(other, 'other-work', otherText)
    mustGit(other.repo, ['push', '--quiet', 'origin', `${THREADS}:${THREADS}`])
    const local = cloneOf(scratch, origin, 'local')
    const localText = threadDoc('fix-login', 'This computer parked the login fix.')
    commitThread(local, 'fix-login', localText)
    const outcome = await pushThreads(local.rt, local.paths, { limitMs: PUSH_LIMIT_MS })
    assert.deepEqual(outcome, { pushed: true, error: null })
    assert.equal(storedText(origin, 'other-work'), otherText)
    assert.equal(storedText(origin, 'fix-login'), localText)
    assert.equal(tipOf(origin), tipOf(local.repo))
  })
})

test('bounded-sync.push-threads-without-origin', async () => {
  await withScratch(async (scratch) => {
    const solo = soloWithThread(scratch)
    const before = tipOf(solo.repo)
    const outcome = await pushThreads(solo.rt, solo.paths, { limitMs: PUSH_LIMIT_MS })
    assert.deepEqual(outcome, { pushed: null, error: null })
    assert.equal(tipOf(solo.repo), before)
  })
})
