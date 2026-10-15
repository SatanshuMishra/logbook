import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ulid } from 'ulid'
import { checkStructure } from '../../src/doc/check.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, workingCopyPath, type RepoPaths } from '../../src/thread/paths.ts'
import { applyToolChange, reconcileThread } from '../../src/thread/reconcile.ts'
import { commitDocuments, readDocument } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const THREADS = 'refs/logbook/threads'

const timeAt = (minute: number): string => new Date(Date.UTC(2026, 9, 14, 10, minute)).toISOString()

const A_START = timeAt(20)
const B_START = timeAt(40)
const STEP_MS = 1000

const C1_OPEN = '- [ ] c1 The login page loads'
const C1_TICKED = '- [x] c1 The login page loads evidence: test login.loads passed'
const C2_OPEN = '- [ ] c2 Errors show under the form'
const R1 = '- R1 The staging database may be stale'
const R2 = '- R2 The cookie domain may differ between hosts'
const STAND = 'The form renders but submitting it fails.'
const NEXT_STEP = 'Fix the submit handler.'
const HANGING_SERVER = 'node -e "process.stdin.resume()"'
const MARKER_LINE = /^(<<<<<<<|=======|>>>>>>>)/
const RETRY_STAND = 'Keep the retry rule when the submit fails.'

type DocParts = {
  slug?: string
  title?: string
  updated: string
  nextIds?: string
  criteria?: string[]
  stand?: string
  nextStep?: string
  risks?: string[]
  note?: string[]
}

const threadDoc = (parts: DocParts): string => {
  const lines = [
    `# ${parts.slug ?? 'fix-login'}: ${parts.title ?? 'Fix the login page'}`,
    'Status: active',
    `Updated: ${parts.updated}`,
    `Next ids: ${parts.nextIds ?? 'c3 D2 R2 S1'}`,
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    ...(parts.criteria ?? [C1_OPEN, C2_OPEN]),
    '',
    '## Where things stand',
    '',
    parts.stand ?? STAND,
    '',
    '## Next step',
    '',
    parts.nextStep ?? NEXT_STEP,
    '',
    '## Decisions in force',
    '',
    '- D1 Keep the session cookie: the mobile app reads it',
    '',
    '## Open risks',
    '',
    ...(parts.risks ?? [R1]),
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md',
    ...(parts.note === undefined ? [] : ['', '## This update', '', ...parts.note])
  ]
  return `${lines.join('\n')}\n`
}

type Clone = { repo: string; paths: RepoPaths; rt: Runtime }

type World = { scratch: string; origin: string; a: Clone; b: Clone }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const clientFor = (scratch: string, repo: string, name: string, start: string): Clone => {
  mustGit(repo, ['config', 'user.name', `Sync Tester ${name}`])
  mustGit(repo, ['config', 'user.email', `${name}@logbook.test`])
  const home = join(scratch, `home-${name}`)
  mkdirSync(home)
  const rt = testRuntime({
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: home },
    sessionId: `session-${name}`,
    start,
    stepMs: STEP_MS
  })
  const found = findRepository(rt, repo)
  assert.ok(found.ok, 'the test repository must be found')
  return { repo, paths: found.value, rt }
}

const cloneOf = (scratch: string, origin: string, name: string, start: string): Clone => {
  mustGit(scratch, ['clone', '--quiet', origin, name])
  return clientFor(scratch, join(scratch, name), name, start)
}

const withWorld = async (fn: (world: World) => Promise<void>): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-thread-sync-'))
  try {
    const origin = join(scratch, 'origin.git')
    mustGit(scratch, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
    const a = cloneOf(scratch, origin, 'a', A_START)
    mustGit(a.repo, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
    writeFileSync(join(a.repo, 'README.md'), 'sync test repository\n')
    mustGit(a.repo, ['add', 'README.md'])
    mustGit(a.repo, ['commit', '--quiet', '-m', 'initial commit'])
    mustGit(a.repo, ['push', '--quiet', 'origin', 'main'])
    const b = cloneOf(scratch, origin, 'b', B_START)
    await fn({ scratch, origin, a, b })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS]).trim()

const allRefs = (repo: string): string => mustGit(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])

const storedText = (repo: string, slug: string): string => mustGit(repo, ['cat-file', 'blob', `${THREADS}:${slug}.md`])

const parentsOf = (repo: string, commit: string): string[] =>
  mustGit(repo, ['rev-list', '--parents', '-n', '1', commit]).trim().split(' ').slice(1)

const commitThread = (clone: Clone, slug: string, text: string, aliases?: Record<string, string>): string => {
  const stored = readDocument(clone.rt, clone.paths, slug)
  const committed = commitDocuments(clone.rt, clone.paths, {
    changes: [{ slug, text, expectedBlob: stored?.blob ?? null }],
    message: `update ${slug}: test change`,
    ...(aliases === undefined ? {} : { aliases })
  })
  assert.ok(committed.ok, JSON.stringify(committed))
  return committed.value.commit
}

const pushThreads = (clone: Clone): void => {
  mustGit(clone.repo, ['push', '--quiet', 'origin', `${THREADS}:${THREADS}`])
}

const pullThreads = (clone: Clone): void => {
  mustGit(clone.repo, ['fetch', '--quiet', 'origin', `+${THREADS}:${THREADS}`])
}

const copyPathOf = (clone: Clone, slug: string): string => {
  const file = workingCopyPath(clone.paths, slug)
  assert.ok(file.ok, 'the working copy path must be built')
  return file.value
}

const writeCopy = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const withoutUpdated = (text: string): string => text.replace(/^Updated: .*$/m, 'Updated:')

const markerLines = (text: string): number[] =>
  text.split('\n').flatMap((line, index) => (MARKER_LINE.test(line) ? [index + 1] : []))

const processesMatching = (token: string): string => spawnSync('pgrep', ['-fl', token], { encoding: 'utf8' }).stdout

const exitOf = (child: ChildProcess): Promise<number | null> =>
  new Promise((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode)
      return
    }
    child.once('exit', (code) => resolve(code))
    child.once('error', () => resolve(null))
  })

const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`

const writeScript = (folder: string, name: string, lines: string[]): string => {
  const script = join(folder, name)
  writeFileSync(script, `${lines.join('\n')}\n`)
  chmodSync(script, 0o755)
  return script
}

const recorderScript = (folder: string, log: string): string =>
  writeScript(folder, 'record-upload-pack.sh', ['#!/bin/sh', `echo started >> ${shellQuote(log)}`, 'exit 1'])

const serveOnceScript = (folder: string, marker: string): string =>
  writeScript(folder, 'serve-once-upload-pack.sh', [
    '#!/bin/sh',
    `if [ -e ${shellQuote(marker)} ]; then`,
    '  exit 1',
    'fi',
    `echo started > ${shellQuote(marker)}`,
    'git upload-pack "$@"'
  ])

const recordedStarts = (log: string): string => (existsSync(log) ? readFileSync(log, 'utf8') : '')

const missingLines = (repo: string): string[] =>
  mustGit(repo, ['rev-list', '--objects', '--missing=print', THREADS])
    .split('\n')
    .filter((line) => line.startsWith('?'))

type PartialWorld = World & { partial: Clone; first: string }

const withPartialClone = async (filter: string, fn: (world: PartialWorld) => Promise<void>): Promise<void> =>
  withWorld(async (world) => {
    const first = commitThread(world.a, 'fix-login', threadDoc({ updated: timeAt(0), stand: RETRY_STAND }))
    commitThread(world.a, 'fix-login', threadDoc({ updated: timeAt(5) }))
    pushThreads(world.a)
    mustGit(world.origin, ['config', 'uploadpack.allowFilter', 'true'])
    mustGit(world.scratch, ['clone', '--quiet', `--filter=${filter}`, `file://${world.origin}`, 'partial'])
    const partial = clientFor(world.scratch, join(world.scratch, 'partial'), 'partial', B_START)
    await fn({ ...world, partial, first })
  })

const clockRecorder = (rt: Runtime): { rt: Runtime; given: () => readonly string[] } => {
  let given: readonly string[] = []
  const now = (): string => {
    const value = rt.now()
    given = [...given, value]
    return value
  }
  return { rt: { ...rt, now }, given: () => given }
}

const nextStepChange = (text: string) => ({
  ok: true as const,
  text: text.replace(NEXT_STEP, 'Run the login tests.'),
  summary: 'next step set',
  details: [],
  noteLines: []
})

test('sync.leaves-the-users-checkout-alone', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a }) => {
    writeFileSync(join(a.repo, 'staged.txt'), 'a staged file\n')
    mustGit(a.repo, ['add', 'staged.txt'])
    writeFileSync(join(a.repo, 'README.md'), 'a modified tracked file\n')
    const snapshot = (): string[] => [
      mustGit(a.repo, ['rev-parse', 'HEAD']),
      mustGit(a.repo, ['for-each-ref', 'refs/heads']),
      mustGit(a.repo, ['diff', '--cached']),
      mustGit(a.repo, ['status', '--porcelain'])
    ]
    const before = snapshot()
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    writeCopy(
      copyPathOf(a, 'fix-login'),
      threadDoc({ updated: timeAt(0), criteria: [C1_TICKED, C2_OPEN], note: ['Ticked c1.'] })
    )
    const reconciled = reconcileThread(a.rt, a.paths, 'fix-login')
    assert.ok('kind' in reconciled && reconciled.kind === 'accepted', JSON.stringify(reconciled))
    if (reconciled.push !== null) await exitOf(reconciled.push)
    const changed = applyToolChange(a.rt, a.paths, 'fix-login', { tool: 'update_thread', change: nextStepChange })
    assert.ok(changed.ok, JSON.stringify(changed))
    if (changed.value.push !== null) await exitOf(changed.value.push)
    const synced = await syncThreads(a.rt, a.paths)
    assert.equal(synced.error, null)
    assert.deepEqual(snapshot(), before)
  })
})

test('sync.no-origin', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-thread-sync-'))
  try {
    const repo = join(scratch, 'repo')
    mkdirSync(repo)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    const solo = clientFor(scratch, repo, 'solo', A_START)
    commitThread(solo, 'fix-login', threadDoc({ updated: timeAt(0) }))
    const before = allRefs(repo)
    const result = await syncThreads(solo.rt, solo.paths)
    assert.deepEqual(result, { fetched: false, merged: false, conflicts: [], pushed: false, error: 'no-origin' })
    assert.equal(allRefs(repo), before)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('sync.fetch-failure-changes-nothing', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    const token = randomBytes(8).toString('hex')
    mustGit(a.repo, ['config', 'remote.origin.uploadpack', `${HANGING_SERVER} ${token}`])
    const before = allRefs(a.repo)
    const result = await syncThreads(a.rt, a.paths, { timeoutMs: 500 })
    assert.equal(result.fetched, false)
    assert.equal(result.merged, false)
    assert.equal(result.pushed, false)
    assert.deepEqual(result.conflicts, [])
    assert.match(result.error ?? '', /git fetch timed out after 500 ms/)
    assert.equal(allRefs(a.repo), before)
    assert.equal(processesMatching(token), '', 'no process running process.stdin.resume() may remain')
  })
})

test('sync.pushes-when-origin-has-no-threads', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, origin }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    assert.equal(rawGit(origin, ['rev-parse', '--verify', '--quiet', THREADS]).status, 1)
    const result = await syncThreads(a.rt, a.paths)
    assert.deepEqual(result, { fetched: true, merged: false, conflicts: [], pushed: true, error: null })
    assert.equal(tipOf(origin), tipOf(a.repo))
  })
})

test('sync.takes-origin-when-local-has-none', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b, origin }) => {
    const text = threadDoc({ updated: timeAt(0) })
    commitThread(a, 'fix-login', text)
    pushThreads(a)
    assert.equal(rawGit(b.repo, ['rev-parse', '--verify', '--quiet', THREADS]).status, 1)
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: [], pushed: false, error: null })
    assert.equal(tipOf(b.repo), tipOf(origin))
    assert.equal(readDocument(b.rt, b.paths, 'fix-login')?.text, text)
  })
})

test('sync.fast-forwards-a-clone-that-is-behind', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b }) => {
    const first = threadDoc({ updated: timeAt(0) })
    commitThread(a, 'fix-login', first)
    pushThreads(a)
    pullThreads(b)
    const copy = copyPathOf(b, 'fix-login')
    writeCopy(copy, first)
    const second = threadDoc({ updated: timeAt(5), stand: 'The submit handler is fixed on staging.' })
    commitThread(a, 'fix-login', second)
    pushThreads(a)
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: [], pushed: false, error: null })
    assert.equal(tipOf(b.repo), tipOf(a.repo))
    assert.equal(readFileSync(copy, 'utf8'), second)
  })
})

test('sync.pushes-a-clone-that-is-ahead', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, origin }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    pushThreads(a)
    const ahead = commitThread(a, 'fix-login', threadDoc({ updated: timeAt(5), nextStep: 'Run the login tests.' }))
    assert.notEqual(tipOf(origin), ahead)
    const result = await syncThreads(a.rt, a.paths)
    assert.deepEqual(result, { fetched: true, merged: false, conflicts: [], pushed: true, error: null })
    assert.equal(tipOf(origin), ahead)
    assert.equal(tipOf(a.repo), ahead)
  })
})

test('sync.merges-updates-to-different-threads', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b, origin }) => {
    const alpha = (parts: Omit<DocParts, 'slug' | 'title'>): string =>
      threadDoc({ ...parts, slug: 'alpha', title: 'Alpha work' })
    const beta = (parts: Omit<DocParts, 'slug' | 'title'>): string =>
      threadDoc({ ...parts, slug: 'beta', title: 'Beta work' })
    commitThread(a, 'alpha', alpha({ updated: timeAt(0) }))
    commitThread(a, 'beta', beta({ updated: timeAt(0) }))
    pushThreads(a)
    pullThreads(b)
    const alphaUpdate = alpha({ updated: timeAt(5), stand: 'Clone A moved alpha on.' })
    const aTip = commitThread(a, 'alpha', alphaUpdate)
    pushThreads(a)
    const betaUpdate = beta({ updated: timeAt(6), nextStep: 'Ship beta from clone B.' })
    const bTip = commitThread(b, 'beta', betaUpdate)
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: [], pushed: true, error: null })
    const merged = tipOf(b.repo)
    assert.deepEqual(parentsOf(b.repo, merged), [bTip, aTip])
    assert.equal(storedText(b.repo, 'alpha'), alphaUpdate)
    assert.equal(storedText(b.repo, 'beta'), betaUpdate)
    assert.equal(tipOf(origin), merged)
  })
})

test('sync.merges-one-thread-edited-in-separate-lines', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    pushThreads(a)
    pullThreads(b)
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(5), criteria: [C1_TICKED, C2_OPEN] }))
    pushThreads(a)
    commitThread(b, 'fix-login', threadDoc({ updated: timeAt(6), nextIds: 'c3 D2 R3 S1', risks: [R1, R2] }))
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: [], pushed: true, error: null })
    const text = storedText(b.repo, 'fix-login')
    assert.ok(text.split('\n').includes(C1_TICKED), text)
    assert.ok(text.split('\n').includes(R2), text)
    assert.deepEqual(checkStructure(text, 'fix-login'), [])
    const nextIds = /^Next ids: c\d+ D\d+ R(\d+) S\d+$/m.exec(text)
    assert.ok(nextIds !== null, text)
    assert.ok(Number(nextIds[1]) >= 3, `Next ids must be at least R3, got ${nextIds[0]}`)
  })
})

test('sync.keeps-conflict-markers-for-the-same-line', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    pushThreads(a)
    pullThreads(b)
    const fromA = 'Rewrite the submit handler as clone A planned.'
    const fromB = 'Rewrite the submit handler as clone B planned.'
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(5), nextStep: fromA }))
    pushThreads(a)
    commitThread(b, 'fix-login', threadDoc({ updated: timeAt(6), nextStep: fromB }))
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: ['fix-login'], pushed: true, error: null })
    const text = storedText(b.repo, 'fix-login')
    const lines = text.split('\n')
    const start = lines.indexOf('<<<<<<< local')
    assert.ok(start >= 0, text)
    assert.deepEqual(lines.slice(start, start + 5), ['<<<<<<< local', fromB, '=======', fromA, '>>>>>>> origin'])
    const markers = markerLines(text)
    assert.equal(markers.length, 3)
    assert.deepEqual(
      checkStructure(text, 'fix-login').map((violation) => violation.line),
      markers
    )
  })
})

test('sync.merges-unaccepted-working-copy-edits', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    pushThreads(a)
    pullThreads(b)
    const standFromB = 'Clone B traced the failure to the cookie domain.'
    const stepFromA = 'Run the login tests on staging.'
    const copy = copyPathOf(b, 'fix-login')
    writeCopy(copy, threadDoc({ updated: timeAt(0), stand: standFromB }))
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(5), nextStep: stepFromA }))
    pushThreads(a)
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: [], pushed: false, error: null })
    assert.equal(
      withoutUpdated(readFileSync(copy, 'utf8')),
      withoutUpdated(threadDoc({ updated: timeAt(5), stand: standFromB, nextStep: stepFromA }))
    )
  })
})

test('sync.leaves-an-absent-working-copy-absent', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    pushThreads(a)
    pullThreads(b)
    const copy = copyPathOf(b, 'fix-login')
    assert.equal(existsSync(copy), false)
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(5), nextStep: 'Run the login tests.' }))
    pushThreads(a)
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: [], pushed: false, error: null })
    assert.equal(tipOf(b.repo), tipOf(a.repo))
    assert.equal(existsSync(copy), false)
  })
})

test('sync.merges-clones-with-no-common-history', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b, origin }) => {
    const textA = threadDoc({ updated: timeAt(1) })
    const textB = threadDoc({ updated: timeAt(2) })
    const aTip = commitThread(a, 'fix-login', textA)
    pushThreads(a)
    const bTip = commitThread(b, 'fix-login', textB)
    assert.deepEqual(parentsOf(a.repo, aTip), [])
    assert.deepEqual(parentsOf(b.repo, bTip), [])
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: [], pushed: true, error: null })
    const merged = tipOf(b.repo)
    assert.deepEqual(parentsOf(b.repo, merged), [bTip, aTip])
    const text = storedText(b.repo, 'fix-login')
    assert.deepEqual(markerLines(text), [])
    assert.equal(withoutUpdated(text), withoutUpdated(textB))
    assert.equal(tipOf(origin), merged)
  })
})

test('sync.no-common-history-conflicts-only-where-texts-differ', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b }) => {
    const oldIdA = ulid()
    const oldIdB = ulid()
    const stepA = 'Fix the submit handler as clone A wrote it.'
    const stepB = 'Fix the submit handler as clone B wrote it.'
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(1), nextStep: stepA }), { [oldIdA]: 'fix-login' })
    pushThreads(a)
    const textB = threadDoc({ updated: timeAt(2), nextStep: stepB })
    commitThread(b, 'fix-login', textB, { [oldIdB]: 'fix-login' })
    const result = await syncThreads(b.rt, b.paths)
    assert.deepEqual(result, { fetched: true, merged: true, conflicts: ['fix-login'], pushed: true, error: null })
    const text = storedText(b.repo, 'fix-login')
    const lines = text.split('\n')
    const start = lines.indexOf('<<<<<<< local')
    assert.ok(start >= 0, text)
    assert.deepEqual(lines.slice(start, start + 5), ['<<<<<<< local', stepB, '=======', stepA, '>>>>>>> origin'])
    assert.equal(markerLines(text).length, 3)
    const resolved = [...lines.slice(0, start), stepB, ...lines.slice(start + 5)].join('\n')
    assert.equal(withoutUpdated(resolved), withoutUpdated(textB))
    const aliases: unknown = JSON.parse(mustGit(b.repo, ['cat-file', 'blob', `${THREADS}:aliases.json`]))
    assert.deepEqual(aliases, { [oldIdA]: 'fix-login', [oldIdB]: 'fix-login' })
  })
})

test('sync.reports-a-rejected-push', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, origin }) => {
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    pushThreads(a)
    const originBefore = tipOf(origin)
    const hook = join(origin, 'hooks', 'update')
    writeFileSync(hook, '#!/bin/sh\nif [ "$1" = "refs/logbook/threads" ]; then\n  exit 1\nfi\nexit 0\n')
    chmodSync(hook, 0o755)
    const ahead = commitThread(a, 'fix-login', threadDoc({ updated: timeAt(5), nextStep: 'Run the login tests.' }))
    const result = await syncThreads(a.rt, a.paths)
    assert.equal(result.fetched, true)
    assert.equal(result.merged, false)
    assert.equal(result.pushed, false)
    assert.deepEqual(result.conflicts, [])
    assert.match(result.error ?? '', /rejected/)
    assert.equal(tipOf(a.repo), ahead)
    assert.equal(tipOf(origin), originBefore)
  })
})

test('sync.pushes-when-origin-has-no-threads-in-a-translated-locale', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, origin }) => {
    const tip = commitThread(a, 'fix-login', threadDoc({ updated: timeAt(0) }))
    assert.equal(rawGit(origin, ['rev-parse', '--verify', '--quiet', THREADS]).status, 1)
    const german = testRuntime({
      cwd: a.repo,
      env: { ...a.rt.env, LANG: 'de_DE.UTF-8', LC_ALL: 'de_DE.UTF-8', LANGUAGE: 'de' },
      sessionId: a.rt.sessionId,
      start: A_START,
      stepMs: STEP_MS
    })
    const result = await syncThreads(german, a.paths)
    assert.equal(result.fetched, true)
    assert.equal(result.pushed, true)
    assert.equal(result.error, null)
    assert.equal(tipOf(origin), tip)
  })
})

test('sync.merges-an-unaccepted-status-edit', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withWorld(async ({ a, b }) => {
    const stored = threadDoc({ updated: timeAt(30) })
    commitThread(a, 'fix-login', stored)
    pushThreads(a)
    pullThreads(b)
    const copy = copyPathOf(b, 'fix-login')
    writeCopy(copy, stored.replace('Status: active', 'Status: parked'))
    const stepFromA = 'Run the login tests on staging.'
    commitThread(a, 'fix-login', threadDoc({ updated: timeAt(60), nextStep: stepFromA }))
    pushThreads(a)
    const clock = clockRecorder(b.rt)
    const result = await syncThreads(clock.rt, b.paths)
    assert.deepEqual(result.conflicts, [])
    assert.equal(result.error, null)
    const text = readFileSync(copy, 'utf8')
    const lines = text.split('\n')
    assert.ok(lines.includes('Status: parked'), text)
    assert.ok(lines.includes(stepFromA), text)
    assert.deepEqual(markerLines(text), [])
    const updated = /^Updated: (.*)$/m.exec(text)
    assert.ok(updated !== null, text)
    assert.ok(clock.given().includes(updated[1] ?? ''), `Updated ${updated[1]} is not a time B's runtime gave the sync`)
    assert.ok(lines.includes('Next ids: c3 D2 R2 S1'), text)
  })
})

test('sync.fetches-the-objects-a-partial-clone-lacks', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  const { searchHistory } = await import('../../src/thread/roster.ts')
  await withPartialClone('blob:none', async ({ scratch, partial, first }) => {
    const result = await syncThreads(partial.rt, partial.paths)
    assert.equal(result.error, null)
    assert.deepEqual(missingLines(partial.repo), [])
    const log = join(scratch, 'upload-pack-starts.log')
    mustGit(partial.repo, ['config', 'remote.origin.uploadpack', shellQuote(recorderScript(scratch, log))])
    const found = searchHistory(partial.rt, partial.paths, 'retry rule')
    assert.ok(found.ok, JSON.stringify(found))
    const inFirst = found.value.find((match) => match.commit === first)
    assert.ok(inFirst !== undefined, JSON.stringify(found.value))
    assert.equal(inFirst.file, 'fix-login.md')
    assert.deepEqual(inFirst.lines, [RETRY_STAND])
    assert.equal(recordedStarts(log), '')
  })
})

test('sync.fetches-the-trees-a-tree-filtered-clone-lacks', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  const { searchHistory } = await import('../../src/thread/roster.ts')
  await withPartialClone('tree:0', async ({ scratch, partial, first }) => {
    const result = await syncThreads(partial.rt, partial.paths)
    assert.equal(result.error, null)
    assert.deepEqual(missingLines(partial.repo), [])
    const log = join(scratch, 'upload-pack-starts.log')
    mustGit(partial.repo, ['config', 'remote.origin.uploadpack', shellQuote(recorderScript(scratch, log))])
    const found = searchHistory(partial.rt, partial.paths, 'retry rule')
    assert.ok(found.ok, JSON.stringify(found))
    const inFirst = found.value.find((match) => match.commit === first)
    assert.ok(inFirst !== undefined, JSON.stringify(found.value))
    assert.equal(inFirst.file, 'fix-login.md')
    assert.deepEqual(inFirst.lines, [RETRY_STAND])
    assert.equal(recordedStarts(log), '')
  })
})

test('sync.reports-a-failed-fetch-of-missing-objects', async () => {
  const { syncThreads } = await import('../../src/thread/sync.ts')
  await withPartialClone('blob:none', async ({ scratch, partial }) => {
    const marker = join(scratch, 'upload-pack-served')
    mustGit(partial.repo, ['config', 'remote.origin.uploadpack', shellQuote(serveOnceScript(scratch, marker))])
    const result = await syncThreads(partial.rt, partial.paths)
    assert.equal(result.fetched, true)
    assert.equal(result.merged, false)
    assert.equal(result.pushed, false)
    assert.ok(
      (result.error ?? '').startsWith('fetch missing objects from origin failed:'),
      `unexpected error: ${result.error}`
    )
    assert.equal(rawGit(partial.repo, ['rev-parse', '--verify', '--quiet', THREADS]).status, 1)
  })
})
