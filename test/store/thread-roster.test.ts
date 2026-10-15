import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from 'ulid'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type FixtureCommit = { ref: string; at: number; message: string; files: Record<string, string | null> }

type RosterContext = { repo: string; rt: Runtime; paths: RepoPaths }

type DocumentInput = { slug: string; status: string; nextStep: string; decisions?: string[]; risks?: string[] }

const THREADS = 'refs/logbook/threads'
const ARCHIVE = 'refs/logbook/archive/ledger'
const CONTINUE = 'To continue a thread, call resume_thread with its slug.'

const GIT_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const baseTime = (): number => Math.floor(Date.now() / 1000) - 100_000

const updatedAt = (): string => new Date(Date.UTC(2026, 9, 14, 9, 30)).toISOString()

const dataBlock = (text: string): string => `data ${Buffer.byteLength(text, 'utf8')}\n${text}\n`

const fileCommand = ([name, text]: [string, string | null]): string =>
  text === null ? `D ${name}\n` : `M 100644 inline ${name}\n${dataBlock(text)}`

const commitBlock = (commit: FixtureCommit): string =>
  [
    `commit ${commit.ref}\n`,
    `committer Roster Tester <tester@logbook.test> ${commit.at} +0000\n`,
    dataBlock(commit.message),
    ...Object.entries(commit.files).map(fileCommand),
    '\n'
  ].join('')

const importCommits = (repo: string, commits: readonly FixtureCommit[]): void => {
  const result = spawnSync('git', ['-C', repo, 'fast-import', '--quiet'], {
    env: GIT_ENV,
    encoding: 'utf8',
    input: commits.map(commitBlock).join('')
  })
  assert.equal(result.status, 0, `git fast-import failed: ${result.stderr}`)
}

const commitsOf = (repo: string, ref: string): string[] => {
  const result = rawGit(repo, ['rev-list', ref])
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim().split('\n')
}

const documentText = (input: DocumentInput): string =>
  [
    `# ${input.slug}: Work on ${input.slug}`,
    `Status: ${input.status}`,
    `Updated: ${updatedAt()}`,
    'Next ids: c1 D1 R1 S1',
    '',
    '## Goal',
    '',
    `Finish the work on ${input.slug}.`,
    '',
    '## Done when',
    '',
    '## Where things stand',
    '',
    'Not started.',
    '',
    '## Next step',
    '',
    ...(input.nextStep === '' ? [] : [input.nextStep, '']),
    '## Decisions in force',
    '',
    ...(input.decisions ?? []),
    ...((input.decisions ?? []).length > 0 ? [''] : []),
    '## Open risks',
    '',
    ...(input.risks ?? []),
    ...((input.risks ?? []).length > 0 ? [''] : []),
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    ''
  ].join('\n')

const threadCommit = (at: number, input: DocumentInput, message?: string): FixtureCommit => ({
  ref: THREADS,
  at,
  message: message ?? `open ${input.slug}`,
  files: { [`${input.slug}.md`]: documentText(input) }
})

const withRoster = <T>(fn: (context: RosterContext) => T): T =>
  withRepo((repo) => {
    const home = mkdtempSync(join(tmpdir(), 'logbook-thread-roster-home-'))
    try {
      const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home } })
      const found = findRepository(rt, repo)
      assert.ok(found.ok, found.ok ? '' : found.message)
      return fn({ repo, rt, paths: found.value })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

const closedThreadsFixture = (repo: string): void => {
  const start = baseTime()
  importCommits(repo, [
    threadCommit(start, { slug: 'fix-login', status: 'active', nextStep: 'Write the login fix. Then run the suite.' }),
    threadCommit(start + 60, { slug: 'old-docs', status: 'done', nextStep: '' }),
    threadCommit(start + 120, {
      slug: 'spike-cache',
      status: 'abandoned: replaced by fix-login',
      nextStep: 'Nothing more to do here.'
    })
  ])
}

test('roster.lists-open-threads-newest-first', async () => {
  const { listRoster } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const start = baseTime()
    importCommits(repo, [
      threadCommit(start, { slug: 'alpha', status: 'active', nextStep: 'Write the login fix. Then run the suite.' }),
      threadCommit(start + 60, { slug: 'beta', status: 'blocked: x', nextStep: 'Wait for x to land.' }),
      threadCommit(start + 120, { slug: 'gamma', status: 'parked', nextStep: 'Pick the cache work back up!' })
    ])
    const roster = listRoster(rt, paths, { includeClosed: false })
    assert.deepEqual(roster.text.split('\n'), [
      'gamma - parked - Next: Pick the cache work back up!',
      'beta - blocked: x - Next: Wait for x to land.',
      'alpha - active - Next: Write the login fix.'
    ])
    assert.equal(roster.closedCount, 0)
    assert.deepEqual(roster.threads, [
      {
        slug: 'gamma',
        title: 'Work on gamma',
        status: 'parked',
        nextStep: 'Pick the cache work back up!',
        path: join(paths.workingDir, 'gamma.md'),
        line: 'gamma - parked - Next: Pick the cache work back up!'
      },
      {
        slug: 'beta',
        title: 'Work on beta',
        status: 'blocked: x',
        nextStep: 'Wait for x to land.',
        path: join(paths.workingDir, 'beta.md'),
        line: 'beta - blocked: x - Next: Wait for x to land.'
      },
      {
        slug: 'alpha',
        title: 'Work on alpha',
        status: 'active',
        nextStep: 'Write the login fix.',
        path: join(paths.workingDir, 'alpha.md'),
        line: 'alpha - active - Next: Write the login fix.'
      }
    ])
  })
})

test('roster.counts-closed-threads', async () => {
  const { listRoster } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    closedThreadsFixture(repo)
    const roster = listRoster(rt, paths, { includeClosed: false })
    assert.deepEqual(roster.text.split('\n'), [
      'fix-login - active - Next: Write the login fix.',
      '2 closed threads: call list_threads with include_closed true.'
    ])
    assert.deepEqual(
      roster.threads.map((thread) => thread.slug),
      ['fix-login']
    )
    assert.equal(roster.closedCount, 2)
  })
})

test('roster.includes-closed-threads-on-request', async () => {
  const { listRoster } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    closedThreadsFixture(repo)
    const roster = listRoster(rt, paths, { includeClosed: true })
    assert.deepEqual(roster.text.split('\n'), [
      'fix-login - active - Next: Write the login fix.',
      'spike-cache - abandoned: replaced by fix-login - Next: Nothing more to do here.',
      'old-docs - done - Next: none'
    ])
    assert.deepEqual(
      roster.threads.map((thread) => thread.status),
      ['active', 'abandoned: replaced by fix-login', 'done']
    )
    assert.equal(roster.closedCount, 2)
  })
})

test('roster.lists-a-document-without-a-readable-status', async () => {
  const { listRoster } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const start = baseTime()
    const conflicted = documentText({ slug: 'gamma', status: 'done', nextStep: 'Merge the two versions. Then push.' })
      .replace('Status: done\n', '<<<<<<< local\nStatus: done\n=======\nStatus: parked\n>>>>>>> remote\n')
    importCommits(repo, [
      threadCommit(start, { slug: 'alpha', status: 'active', nextStep: 'Write the login fix. Then run the suite.' }),
      { ref: THREADS, at: start + 60, message: 'merge gamma', files: { 'gamma.md': conflicted } }
    ])
    const roster = listRoster(rt, paths, { includeClosed: false })
    assert.deepEqual(roster.text.split('\n'), [
      'gamma - unreadable - Next: Merge the two versions.',
      'alpha - active - Next: Write the login fix.'
    ])
    assert.equal(roster.closedCount, 0)
    assert.equal(roster.threads[0]?.status, 'unreadable')
  })
})

test('roster.empty', async () => {
  const { listRoster, sessionStartRoster } = await import('../../src/thread/roster.ts')
  withRoster(({ rt, paths }) => {
    assert.deepEqual(listRoster(rt, paths, { includeClosed: false }), { threads: [], closedCount: 0, text: '' })
    assert.deepEqual(listRoster(rt, paths, { includeClosed: true }), { threads: [], closedCount: 0, text: '' })
    assert.equal(sessionStartRoster(rt, paths), null)
  })
})

test('roster.session-start-text-stays-under-the-ceiling', async () => {
  const { sessionStartRoster } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const start = baseTime()
    const numbers = Array.from({ length: 200 }, (_, index) => String(index + 1).padStart(3, '0'))
    const nextStepFor = (number: string): string =>
      `Review thread ${number} and write down what the next session must know about it today.`
    numbers.forEach((number) => assert.equal(nextStepFor(number).length, 80))
    const closedCommits = ['done', 'abandoned', 'done'].map((status, index) =>
      threadCommit(start + index * 60, { slug: `closed-${index + 1}`, status, nextStep: '' })
    )
    const openCommits = numbers.map((number, index) =>
      threadCommit(start + (index + 3) * 60, { slug: `thread-${number}`, status: 'active', nextStep: nextStepFor(number) })
    )
    importCommits(repo, [...closedCommits, ...openCommits])
    const text = sessionStartRoster(rt, paths)
    assert.ok(text !== null)
    assert.ok(text.length <= 9500, `the roster text is ${text.length} characters`)
    const lines = text.split('\n')
    assert.equal(lines.at(-1), CONTINUE)
    assert.equal(lines.at(-2), '3 closed threads: call list_threads with include_closed true.')
    const more = /^\((\d+) more threads: call list_threads\)$/.exec(lines.at(-3) ?? '')
    assert.ok(more !== null, `the line before the closed-threads line is ${JSON.stringify(lines.at(-3))}`)
    const kept = lines.length - 3
    assert.ok(kept > 0)
    assert.equal(Number(more[1]), 200 - kept)
    const newestLines = [...numbers]
      .reverse()
      .map((number) => `thread-${number} - active - Next: ${nextStepFor(number)}`)
    assert.deepEqual(lines.slice(0, kept), newestLines.slice(0, kept))
    const oneMore = [
      ...newestLines.slice(0, kept + 1),
      `(${200 - kept - 1} more threads: call list_threads)`,
      '3 closed threads: call list_threads with include_closed true.',
      CONTINUE
    ].join('\n')
    assert.ok(oneMore.length > 9500, `one more thread line would still fit in ${oneMore.length} characters`)
  })
})

const searchFixture = (repo: string): string[] => {
  const start = baseTime()
  importCommits(repo, [
    threadCommit(start, {
      slug: 'fix-login',
      status: 'active',
      nextStep: 'Write the login fix.',
      decisions: ['- D1 Use Postgres: the reports need joins.', '- D2 Retry Rule: retry each call once.']
    }),
    threadCommit(
      start + 60,
      {
        slug: 'fix-login',
        status: 'active',
        nextStep: 'Run the suite.',
        decisions: ['- D1 Use Postgres: the reports need joins.', '- D2 Retry Rule: retry each call once.']
      },
      'update fix-login: changed Next step'
    )
  ])
  return commitsOf(repo, THREADS)
}

test('search.finds-text-in-a-current-document', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const [, opened] = searchFixture(repo)
    const result = searchHistory(rt, paths, 'postgres')
    assert.ok(result.ok)
    assert.equal(result.value.length, 1)
    const [match] = result.value
    assert.ok(match !== undefined)
    assert.deepEqual(
      { commit: match.commit, subject: match.subject, file: match.file, lines: match.lines },
      { commit: opened, subject: 'open fix-login', file: 'fix-login.md', lines: ['- D1 Use Postgres: the reports need joins.'] }
    )
    const committed = rawGit(repo, ['show', '-s', '--format=%ct', opened ?? ''])
    assert.equal(Date.parse(match.date), Number(committed.stdout.trim()) * 1000)
  })
})

test('search.finds-text-only-in-an-earlier-version', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const start = baseTime()
    const base: DocumentInput = { slug: 'fix-login', status: 'active', nextStep: 'Write the login fix.' }
    const risk = '- R1 flaky login test hides real failures.'
    importCommits(repo, [
      threadCommit(start, base),
      threadCommit(start + 60, { ...base, risks: [risk] }, 'update fix-login: add R1'),
      threadCommit(start + 120, base, 'update fix-login: retire R1')
    ])
    const [removing, adding] = commitsOf(repo, THREADS)
    const result = searchHistory(rt, paths, 'flaky login test')
    assert.ok(result.ok)
    assert.deepEqual(
      result.value.map((match) => ({ commit: match.commit, subject: match.subject, file: match.file, lines: match.lines })),
      [
        { commit: removing, subject: 'update fix-login: retire R1', file: 'fix-login.md', lines: [risk] },
        { commit: adding, subject: 'update fix-login: add R1', file: 'fix-login.md', lines: [risk] }
      ]
    )
  })
})

test('search.finds-text-in-the-archived-ledger', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const start = baseTime()
    const decisionId = ulid()
    const decision = {
      id: decisionId,
      title: 'How flaky calls are handled',
      outcome: 'Adopt the retry rule for flaky calls.'
    }
    importCommits(repo, [
      threadCommit(start, { slug: 'fix-login', status: 'active', nextStep: 'Write the login fix.' }),
      {
        ref: ARCHIVE,
        at: start + 60,
        message: 'record decision',
        files: { [`decisions/${decisionId}.json`]: `${JSON.stringify(decision, null, 2)}\n` }
      }
    ])
    const [archived] = commitsOf(repo, ARCHIVE)
    const result = searchHistory(rt, paths, 'retry rule')
    assert.ok(result.ok)
    assert.deepEqual(
      result.value.map((match) => ({ commit: match.commit, file: match.file, lines: match.lines })),
      [
        {
          commit: archived,
          file: `decisions/${decisionId}.json`,
          lines: ['  "outcome": "Adopt the retry rule for flaky calls."']
        }
      ]
    )
  })
})

test('search.ignores-case', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const [, opened] = searchFixture(repo)
    const result = searchHistory(rt, paths, 'retry rule')
    assert.ok(result.ok)
    assert.deepEqual(
      result.value.map((match) => ({ commit: match.commit, file: match.file, lines: match.lines })),
      [{ commit: opened, file: 'fix-login.md', lines: ['- D2 Retry Rule: retry each call once.'] }]
    )
  })
})

test('search.finds-nothing', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    searchFixture(repo)
    assert.deepEqual(searchHistory(rt, paths, 'absent phrase'), { ok: true, value: [] })
  })
})

test('search.refuses-a-blank-text', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    searchFixture(repo)
    for (const text of ['', '   ']) {
      const result = searchHistory(rt, paths, text)
      assert.equal(result.ok, false)
      assert.equal(result.ok ? null : result.field, 'text')
    }
  })
})

test('roster.lists-same-second-threads-in-commit-order', async () => {
  const { listRoster } = await import('../../src/thread/roster.ts')
  withRoster(({ repo, rt, paths }) => {
    const at = baseTime()
    importCommits(repo, [
      threadCommit(at, { slug: 'alpha', status: 'active', nextStep: 'Write the login fix.' }),
      threadCommit(at, { slug: 'zeta', status: 'active', nextStep: 'Write the login fix.' })
    ])
    const roster = listRoster(rt, paths, { includeClosed: false })
    assert.deepEqual(
      roster.threads.map((thread) => thread.slug),
      ['zeta', 'alpha']
    )
  })
})

test('search.refuses-at-once-when-history-objects-are-missing', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  const work = mkdtempSync(join(tmpdir(), 'logbook-thread-roster-partial-'))
  try {
    const origin = join(work, 'origin.git')
    const clone = join(work, 'clone')
    const recorder = join(work, 'recorder.sh')
    const log = join(work, 'recorder.log')
    const home = join(work, 'home')
    mkdirSync(home)
    const initial = spawnSync('git', ['init', '--bare', '--initial-branch=main', origin], { env: GIT_ENV, encoding: 'utf8' })
    assert.equal(initial.status, 0, initial.stderr)
    for (const args of [
      ['config', 'uploadpack.allowFilter', 'true'],
      ['config', 'uploadpack.allowAnySHA1InWant', 'true']
    ]) {
      const set = rawGit(origin, args)
      assert.equal(set.status, 0, set.stderr)
    }
    const start = baseTime()
    const base: DocumentInput = { slug: 'fix-login', status: 'active', nextStep: 'Write the login fix.' }
    importCommits(origin, [
      threadCommit(start, { ...base, decisions: ['- D1 Retry rule: retry each call once.'] }),
      threadCommit(start + 60, { ...base, nextStep: 'Run the suite.' }, 'update fix-login: changed Next step')
    ])
    const cloned = spawnSync('git', ['clone', '-q', '--filter=blob:none', `file://${origin}`, clone], {
      env: GIT_ENV,
      encoding: 'utf8'
    })
    assert.equal(cloned.status, 0, cloned.stderr)
    const fetched = rawGit(clone, ['fetch', '--no-tags', 'origin', `+${THREADS}:${THREADS}`])
    assert.equal(fetched.status, 0, fetched.stderr)
    writeFileSync(recorder, `#!/bin/sh\necho started >> '${log}'\nexit 1\n`)
    chmodSync(recorder, 0o755)
    const wired = rawGit(clone, ['config', 'remote.origin.uploadpack', recorder])
    assert.equal(wired.status, 0, wired.stderr)
    const rt = testRuntime({ cwd: clone, env: { PATH: process.env.PATH, HOME: home } })
    const found = findRepository(rt, clone)
    assert.ok(found.ok, found.ok ? '' : found.message)
    const result = searchHistory(rt, found.value, 'retry rule')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? null : result.field, THREADS)
    assert.equal(result.ok ? null : result.retryable, true)
    assert.equal(result.ok ? null : result.example, 'sync_ledger')
    const message = result.ok ? '' : result.message
    assert.ok(message.startsWith(`git log failed while searching the history of ${THREADS} (exit 128): `), message)
    assert.ok(message.includes('could not fetch'), message)
    assert.match(message, /the first missing is [0-9a-f]{40}\)/)
    assert.ok(!message.includes('\n'), message)
    assert.ok(message.endsWith('run sync_ledger, which fetches them, and search again'), message)
    assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

const REFETCH = 'git fetch --refetch --no-filter --no-write-fetch-head origin refs/logbook/ledger'

test('search.points-at-the-ledger-refetch-when-only-the-archive-lacks-objects', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  const work = mkdtempSync(join(tmpdir(), 'logbook-thread-roster-archive-'))
  try {
    const origin = join(work, 'origin.git')
    const clone = join(work, 'clone')
    const recorder = join(work, 'recorder.sh')
    const log = join(work, 'recorder.log')
    const home = join(work, 'home')
    mkdirSync(home)
    const initial = spawnSync('git', ['init', '--bare', '--initial-branch=main', origin], { env: GIT_ENV, encoding: 'utf8' })
    assert.equal(initial.status, 0, initial.stderr)
    for (const args of [
      ['config', 'uploadpack.allowFilter', 'true'],
      ['config', 'uploadpack.allowAnySHA1InWant', 'true']
    ]) {
      const set = rawGit(origin, args)
      assert.equal(set.status, 0, set.stderr)
    }
    const start = baseTime()
    const decision = (outcome: string): string => `${JSON.stringify({ id: ulid(), title: 'How flaky calls are handled', outcome }, null, 2)}\n`
    importCommits(origin, [
      threadCommit(start, { slug: 'fix-login', status: 'active', nextStep: 'Write the login fix.' }),
      {
        ref: 'refs/logbook/ledger',
        at: start + 60,
        message: 'record decision',
        files: { 'decision.json': decision('Adopt the retry rule for flaky calls.') }
      },
      {
        ref: 'refs/logbook/ledger',
        at: start + 120,
        message: 'record decision again',
        files: { 'decision.json': decision('Keep calls as they are.') }
      }
    ])
    const cloned = spawnSync('git', ['clone', '-q', '--filter=blob:none', `file://${origin}`, clone], {
      env: GIT_ENV,
      encoding: 'utf8'
    })
    assert.equal(cloned.status, 0, cloned.stderr)
    const threads = rawGit(clone, ['fetch', '--no-tags', '--refetch', '--no-filter', 'origin', `+${THREADS}:${THREADS}`])
    assert.equal(threads.status, 0, threads.stderr)
    const ledger = rawGit(clone, ['fetch', '--no-tags', 'origin', '+refs/logbook/ledger:refs/logbook/ledger'])
    assert.equal(ledger.status, 0, ledger.stderr)
    const read = rawGit(clone, ['cat-file', '-p', 'refs/logbook/ledger:decision.json'])
    assert.equal(read.status, 0, read.stderr)
    const archived = rawGit(clone, ['update-ref', ARCHIVE, 'refs/logbook/ledger'])
    assert.equal(archived.status, 0, archived.stderr)
    writeFileSync(recorder, `#!/bin/sh\necho started >> '${log}'\nexit 1\n`)
    chmodSync(recorder, 0o755)
    const wired = rawGit(clone, ['config', 'remote.origin.uploadpack', recorder])
    assert.equal(wired.status, 0, wired.stderr)
    const rt = testRuntime({ cwd: clone, env: { PATH: process.env.PATH, HOME: home } })
    const found = findRepository(rt, clone)
    assert.ok(found.ok, found.ok ? '' : found.message)
    const result = searchHistory(rt, found.value, 'retry rule')
    assert.equal(result.ok, false)
    assert.equal(result.ok ? null : result.field, ARCHIVE)
    assert.equal(result.ok ? null : result.retryable, true)
    assert.equal(result.ok ? null : result.example, REFETCH)
    const message = result.ok ? '' : result.message
    assert.ok(message.startsWith(`git log failed while searching the history of ${THREADS} (exit 128): `), message)
    assert.ok(message.includes('could not fetch'), message)
    assert.match(message, /the first missing is [0-9a-f]{40}\)/)
    assert.ok(!message.includes('\n'), message)
    assert.ok(message.endsWith(`run \`${REFETCH}\`, and search again`), message)
    assert.equal(existsSync(log) ? readFileSync(log, 'utf8') : '', '')
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
})

const withThreadsRepo = <T>(env: (work: string) => Record<string, string | undefined>, fn: (context: RosterContext) => T): T =>
  withRepo((repo) => {
    const work = mkdtempSync(join(tmpdir(), 'logbook-thread-roster-git-'))
    try {
      importCommits(repo, [threadCommit(baseTime(), { slug: 'fix-login', status: 'active', nextStep: 'Write the login fix.' })])
      const rt = testRuntime({ cwd: repo, env: { HOME: work, ...env(work) } })
      const found = findRepository(rt, repo)
      assert.ok(found.ok, found.ok ? '' : found.message)
      return fn({ repo, rt, paths: found.value })
    } finally {
      rmSync(work, { recursive: true, force: true })
    }
  })

test('search.says-when-git-writes-no-error', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  const located = spawnSync('/bin/sh', ['-c', 'command -v git'], { env: GIT_ENV, encoding: 'utf8' })
  assert.equal(located.status, 0, located.stderr)
  const realGit = located.stdout.trim()
  withThreadsRepo(
    (work) => {
      const bin = join(work, 'bin')
      mkdirSync(bin)
      const script = join(bin, 'git')
      writeFileSync(script, `#!/bin/sh\nfor arg in "$@"; do\n  if [ "$arg" = log ]; then exit 128; fi\ndone\nexec '${realGit}' "$@"\n`)
      chmodSync(script, 0o755)
      return { PATH: `${bin}:${process.env.PATH}` }
    },
    ({ rt, paths }) => {
      const result = searchHistory(rt, paths, 'retry rule')
      assert.equal(result.ok, false)
      assert.equal(result.ok ? null : result.field, THREADS)
      assert.equal(result.ok ? null : result.retryable, false)
      assert.equal(
        result.ok ? null : result.message,
        `git log failed while searching the history of ${THREADS} (exit 128): git wrote no error output; nothing was searched`
      )
    }
  )
})

test('search.names-the-runners-message-for-a-text-too-long-to-pass', async () => {
  const { searchHistory } = await import('../../src/thread/roster.ts')
  withThreadsRepo(
    () => ({ PATH: process.env.PATH }),
    ({ rt, paths }) => {
      const result = searchHistory(rt, paths, 'a'.repeat(2_000_000))
      assert.equal(result.ok, false)
      assert.equal(result.ok ? null : result.field, THREADS)
      assert.equal(result.ok ? null : result.retryable, false)
      assert.equal(
        result.ok ? null : result.message,
        `git log failed while searching the history of ${THREADS} (exit -1): spawnSync git E2BIG; nothing was searched`
      )
    }
  )
})
