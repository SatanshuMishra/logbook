import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from 'ulid'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { RepoPaths } from '../../src/thread/paths.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const GIT_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const IDENTITY_ARGS = ['-c', 'user.name=Migration Tester', '-c', 'user.email=tester@logbook.test']

type Json = Record<string, unknown>

type MigrateContext = { repo: string; rt: Runtime; paths: RepoPaths }

const withTempDir = <T>(prefix: string, fn: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const gitWithInput = (repo: string, args: string[], input: string): string => {
  const result = spawnSync('git', ['-C', repo, ...args], { env: GIT_ENV, encoding: 'utf8', input })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const refOf = (repo: string, ref: string): string | null => {
  const result = rawGit(repo, ['rev-parse', '--verify', '--quiet', ref])
  return result.status === 0 ? result.stdout.trim() : null
}

const allRefs = (repo: string): string => mustGit(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])

const isoAt = (minute: number): string => new Date(Date.UTC(2026, 0, 5, 9, minute)).toISOString()

const hashBlob = (repo: string, text: string): string => gitWithInput(repo, ['hash-object', '-w', '--stdin'], text)

const makeTree = (repo: string, entries: string[]): string => gitWithInput(repo, ['mktree'], entries.join(''))

const buildLedger = (repo: string, files: Record<string, string>): string => {
  const folders = [...new Set(Object.keys(files).map((file) => file.split('/')[0] ?? ''))]
  const folderEntries = folders.map((folder) => {
    const blobs = Object.entries(files)
      .filter(([file]) => file.startsWith(`${folder}/`))
      .map(([file, text]) => `100644 blob ${hashBlob(repo, text)}\t${file.slice(folder.length + 1)}\n`)
    return `040000 tree ${makeTree(repo, blobs)}\t${folder}\n`
  })
  const tree = makeTree(repo, folderEntries)
  const commit = gitWithInput(repo, [...IDENTITY_ARGS, 'commit-tree', tree, '-m', 'old ledger'], '')
  mustGit(repo, ['update-ref', 'refs/logbook/ledger', commit])
  return commit
}

const threadFile = (thread: Json): string => `threads/${String(thread.id)}.json`

const decisionFile = (id: string): string => `decisions/${id}.json`

const ledgerOf = (threads: Json[], decisions: Record<string, Json | string> = {}): Record<string, string> => ({
  ...Object.fromEntries(threads.map((thread) => [threadFile(thread), JSON.stringify(thread, null, 2)])),
  ...Object.fromEntries(
    Object.entries(decisions).map(([id, decision]) => [
      decisionFile(id),
      typeof decision === 'string' ? decision : JSON.stringify(decision, null, 2)
    ])
  )
})

const spine = (overrides: Json = {}): Json => ({
  active_goal: 'Users can sign in again after their session expires',
  next_step: 'Write the refresh handler',
  landed: '',
  last_session: '',
  open_risks: [],
  key_decisions: [],
  out_of_scope: [],
  ...overrides
})

const oldThread = (overrides: Json = {}): Json => ({
  id: ulid(),
  slug: 'fix-login',
  title: 'Fix the login flow',
  status: 'open',
  blocked_by: null,
  created_at: isoAt(0),
  updated_at: isoAt(30),
  completion_criteria: [],
  spine: spine(),
  ...overrides
})

const criterion = (overrides: Json): Json => ({
  id: ulid(),
  ordinal: 1,
  text: 'A criterion',
  done: false,
  kind: 'planned',
  result: null,
  struck_by: null,
  ...overrides
})

const withMigrationRepo = <T>(fn: (context: MigrateContext) => T, findRepository: FindRepository): T =>
  withRepo((repo) =>
    withTempDir('logbook-migrate-home', (home) => {
      const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home } })
      const found = findRepository(rt, repo)
      assert.ok(found.ok, found.ok ? '' : found.message)
      return fn({ repo, rt, paths: found.value })
    })
  )

type FindRepository = (
  rt: Runtime,
  dir: string
) => { ok: true; value: RepoPaths } | { ok: false; message: string }

type PartialCloneContext = MigrateContext & { writer: string; log: string }

const REFETCH_COMMAND = 'git fetch --refetch --no-filter --no-write-fetch-head origin refs/logbook/ledger'

const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

const recordedStarts = (log: string): string => (existsSync(log) ? readFileSync(log, 'utf8') : '')

const missingFrom = (repo: string, ref: string): string[] =>
  mustGit(repo, ['rev-list', '--objects', '--no-walk', '--missing=print', ref])
    .split('\n')
    .filter((line) => line.startsWith('?'))
    .map((line) => line.slice(1))

const withPartialLedgerClone = <T>(
  filter: string,
  fn: (context: PartialCloneContext) => T,
  findRepository: FindRepository
): T =>
  withRepo((writer) =>
    withTempDir('logbook-migrate-partial', (dir) => {
      buildLedger(writer, ledgerOf([oldThread()]))
      const origin = join(dir, 'origin.git')
      mustGit(dir, ['init', '--bare', '--initial-branch=main', 'origin.git'])
      mustGit(origin, ['config', 'uploadpack.allowFilter', 'true'])
      mustGit(writer, ['push', origin, 'main', 'refs/logbook/ledger:refs/logbook/ledger'])
      mustGit(dir, ['clone', `--filter=${filter}`, `file://${origin}`, 'clone'])
      const repo = join(dir, 'clone')
      mustGit(repo, ['fetch', 'origin', '+refs/logbook/ledger:refs/logbook/ledger'])
      const log = join(dir, 'upload-pack-starts.log')
      const recorder = join(dir, 'record-upload-pack.sh')
      writeFileSync(recorder, `#!/bin/sh\necho started >> ${shellQuote(log)}\nexit 1\n`)
      chmodSync(recorder, 0o755)
      mustGit(repo, ['config', 'remote.origin.uploadpack', shellQuote(recorder)])
      return withTempDir('logbook-migrate-home', (home) => {
        const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home } })
        const found = findRepository(rt, repo)
        assert.ok(found.ok, found.ok ? '' : found.message)
        return fn({ repo, rt, paths: found.value, writer, log })
      })
    })
  )

const loadModules = async () => {
  const migrate = await import('../../src/thread/migrate.ts')
  const paths = await import('../../src/thread/paths.ts')
  const check = await import('../../src/doc/check.ts')
  return { ...migrate, findRepository: paths.findRepository, checkStructure: check.checkStructure }
}

const documentAt = (repo: string, slug: string): string =>
  mustGit(repo, ['cat-file', 'blob', `refs/logbook/threads:${slug}.md`])

const namesOnThreads = (repo: string): string[] =>
  mustGit(repo, ['ls-tree', '--name-only', 'refs/logbook/threads']).trim().split('\n').filter((name) => name !== '')

const aliasesOf = (repo: string): unknown =>
  JSON.parse(mustGit(repo, ['cat-file', 'blob', 'refs/logbook/threads:aliases.json']))

const sectionLines = (text: string, name: string): string[] => {
  const lines = text.split('\n')
  const start = lines.indexOf(`## ${name}`)
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => line.trim() !== '')
}

const headerLine = (text: string, prefix: string): string | undefined =>
  text.split('\n').find((line) => line.startsWith(prefix))

const convertedMark = (repo: string, slug: string): string =>
  join(realpathSync(repo), '.git', 'logbook', 'converted', slug)

test('migrate.leaves-a-repository-without-a-ledger-alone', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const before = allRefs(repo)
    const result = migrateIfNeeded(rt, paths)
    assert.deepEqual(result, { ok: true, value: { migrated: false, slugs: [], skipped: [] } })
    assert.equal(allRefs(repo), before)
    assert.equal(mustGit(repo, ['for-each-ref', 'refs/logbook']), '')
    assert.equal(existsSync(join(realpathSync(repo), '.git', 'logbook', 'converted')), false)
  }, findRepository)
})

test('migrate.ledger-without-threads', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const decisionId = ulid()
    const ledgerTip = buildLedger(repo, {
      [decisionFile(decisionId)]: JSON.stringify({ id: decisionId, title: 'Use git', outcome: 'chosen', supersedes: [] })
    })
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    assert.deepEqual(result.value.slugs, [])
    assert.deepEqual(namesOnThreads(repo), ['aliases.json'])
    assert.equal(mustGit(repo, ['cat-file', 'blob', 'refs/logbook/threads:aliases.json']), '{}\n')
    assert.equal(refOf(repo, 'refs/logbook/archive/ledger'), ledgerTip)
    assert.equal(refOf(repo, 'refs/logbook/ledger'), ledgerTip)
  }, findRepository)
})

test('migrate.runs-once', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    buildLedger(repo, ledgerOf([oldThread()]))
    const document = hashBlob(repo, '# kept: A thread already converted\nStatus: active\n')
    const tree = makeTree(repo, [`100644 blob ${document}\tkept.md\n`])
    const threads = gitWithInput(repo, [...IDENTITY_ARGS, 'commit-tree', tree, '-m', 'existing threads'], '')
    mustGit(repo, ['update-ref', 'refs/logbook/threads', threads])
    const before = allRefs(repo)
    const result = migrateIfNeeded(rt, paths)
    assert.deepEqual(result, { ok: true, value: { migrated: false, slugs: [], skipped: [] } })
    assert.equal(allRefs(repo), before)
    assert.equal(refOf(repo, 'refs/logbook/archive/ledger'), null)
  }, findRepository)
})

test('migrate.converts-an-open-thread', async () => {
  const { migrateIfNeeded, findRepository, checkStructure } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const doneId = ulid()
    const openId = ulid()
    const oldDecisionId = ulid()
    const liveDecisionId = ulid()
    const thread = oldThread({
      completion_criteria: [
        criterion({ id: openId, ordinal: 2, text: 'Sign-in succeeds after the session expires' }),
        criterion({
          id: doneId,
          ordinal: 1,
          text: 'Reproduce the expired-session failure',
          done: true,
          result: 'test/login.test.ts fails on main'
        })
      ],
      artifacts: [
        { id: ulid(), label: 'Login test', pointer: 'test/login.test.ts', retired: false },
        { id: ulid(), label: 'Old spike', pointer: 'spike/refresh.ts', retired: true }
      ],
      spine: spine({
        landed: 'The failing test is written.',
        open_risks: [
          {
            id: ulid(),
            scope: 'thread',
            text: 'The refresh endpoint may rate-limit.',
            refs: [],
            criterion_id: openId,
            retired: false
          },
          { id: ulid(), scope: 'thread', text: 'Cookies may be blocked.', refs: [], criterion_id: null, retired: true }
        ],
        key_decisions: [
          { id: ulid(), decision_id: oldDecisionId, title: 'Session handling', scope: 'thread' },
          { id: ulid(), decision_id: liveDecisionId, title: 'Session refresh', scope: 'thread' }
        ],
        out_of_scope: [{ id: ulid(), text: 'Single sign-on' }]
      })
    })
    buildLedger(
      repo,
      ledgerOf([thread], {
        [oldDecisionId]: { id: oldDecisionId, title: 'Session handling', outcome: 'log the user out', supersedes: [] },
        [liveDecisionId]: {
          id: liveDecisionId,
          title: 'Session refresh',
          outcome: 'refresh the token on expiry',
          supersedes: [oldDecisionId]
        }
      })
    )
    const result = migrateIfNeeded(rt, paths)
    assert.deepEqual(result, { ok: true, value: { migrated: true, slugs: ['fix-login'], skipped: [] } })
    assert.deepEqual(mustGit(repo, ['log', '--format=%s', 'refs/logbook/threads']).trim().split('\n'), [
      'migrate from the old ledger'
    ])
    const text = documentAt(repo, 'fix-login')
    assert.deepEqual(checkStructure(text, 'fix-login'), [])
    assert.equal(text.split('\n')[0], '# fix-login: Fix the login flow')
    assert.equal(headerLine(text, 'Status:'), 'Status: active')
    assert.equal(headerLine(text, 'Next ids:'), 'Next ids: c3 D2 R2 S2')
    assert.deepEqual(sectionLines(text, 'Goal'), ['Users can sign in again after their session expires'])
    assert.deepEqual(sectionLines(text, 'Done when'), [
      '- [x] c1 Reproduce the expired-session failure evidence: test/login.test.ts fails on main',
      '- [ ] c2 Sign-in succeeds after the session expires'
    ])
    assert.deepEqual(sectionLines(text, 'Where things stand'), ['The failing test is written.'])
    assert.deepEqual(sectionLines(text, 'Next step'), ['Write the refresh handler'])
    assert.deepEqual(sectionLines(text, 'Decisions in force'), ['- D1 Session refresh: refresh the token on expiry'])
    assert.deepEqual(sectionLines(text, 'Open risks'), ['- R1 The refresh endpoint may rate-limit. Bears on c2.'])
    assert.deepEqual(sectionLines(text, 'Settled, do not reopen'), ['- S1 Out of scope: Single sign-on'])
    assert.deepEqual(sectionLines(text, 'Where the details live'), [
      '- Login test: test/login.test.ts',
      `- Old ledger record: thread ${String(thread.id)} in refs/logbook/archive/ledger`
    ])
  }, findRepository)
})

test('migrate.converts-the-other-statuses', async () => {
  const { migrateIfNeeded, findRepository, checkStructure } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const blocked = oldThread({ slug: 'waiting-on-owner', blocked_by: 'the owner', created_at: isoAt(1) })
    const done = oldThread({ slug: 'shipped-work', status: 'done', created_at: isoAt(2) })
    const abandoned = oldThread({ slug: 'dropped-work', status: 'abandoned', created_at: isoAt(3) })
    buildLedger(repo, ledgerOf([blocked, done, abandoned]))
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    assert.deepEqual(result.value.slugs, ['waiting-on-owner', 'shipped-work', 'dropped-work'])
    assert.equal(headerLine(documentAt(repo, 'waiting-on-owner'), 'Status:'), 'Status: blocked: the owner')
    assert.equal(headerLine(documentAt(repo, 'shipped-work'), 'Status:'), 'Status: done')
    assert.equal(
      headerLine(documentAt(repo, 'dropped-work'), 'Status:'),
      'Status: abandoned: abandoned in the old ledger'
    )
    assert.deepEqual(checkStructure(documentAt(repo, 'waiting-on-owner'), 'waiting-on-owner'), [])
    assert.deepEqual(checkStructure(documentAt(repo, 'dropped-work'), 'dropped-work'), [])
  }, findRepository)
})

test('migrate.converts-criteria-without-results-and-struck', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const thread = oldThread({
      completion_criteria: [
        criterion({ ordinal: 1, text: 'The handler refreshes the token', done: true, result: null }),
        criterion({ ordinal: 2, text: 'The old cookie path is removed', struck_by: ulid() })
      ]
    })
    buildLedger(repo, ledgerOf([thread]))
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    assert.deepEqual(sectionLines(documentAt(repo, 'fix-login'), 'Done when'), [
      '- [x] c1 The handler refreshes the token evidence: marked done in the old ledger',
      '- [~] c2 The old cookie path is removed struck: struck in the old ledger'
    ])
  }, findRepository)
})

test('migrate.risk-without-a-criterion-and-a-missing-decision', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const thread = oldThread({
      spine: spine({
        open_risks: [
          { id: ulid(), scope: 'thread', text: 'The token store may be slow.', refs: [], criterion_id: null, retired: false }
        ],
        key_decisions: [{ id: ulid(), decision_id: ulid(), title: 'Token storage', scope: 'thread' }]
      })
    })
    buildLedger(repo, ledgerOf([thread]))
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    const text = documentAt(repo, 'fix-login')
    assert.deepEqual(sectionLines(text, 'Open risks'), ['- R1 The token store may be slow.'])
    assert.deepEqual(sectionLines(text, 'Decisions in force'), ['- D1 Token storage: decision record missing'])
  }, findRepository)
})

test('migrate.writes-aliases-and-the-archive', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const first = oldThread({ slug: 'fix-login', created_at: isoAt(1) })
    const second = oldThread({ slug: 'add-billing', title: 'Add billing', created_at: isoAt(2) })
    const ledgerTip = buildLedger(repo, ledgerOf([first, second]))
    const result = migrateIfNeeded(rt, paths)
    assert.deepEqual(result, { ok: true, value: { migrated: true, slugs: ['fix-login', 'add-billing'], skipped: [] } })
    assert.deepEqual(aliasesOf(repo), { [String(first.id)]: 'fix-login', [String(second.id)]: 'add-billing' })
    assert.equal(refOf(repo, 'refs/logbook/archive/ledger'), ledgerTip)
    assert.equal(refOf(repo, 'refs/logbook/ledger'), ledgerTip)
    assert.equal(readFileSync(convertedMark(repo, 'fix-login'), 'utf8'), '')
    assert.equal(readFileSync(convertedMark(repo, 'add-billing'), 'utf8'), '')
  }, findRepository)
})

test('migrate.renames-taken-and-bad-slugs', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const ids = [ulid(), ulid(), ulid()]
    const [firstId, secondId, thirdId] = ids
    const third = oldThread({ id: firstId, slug: 'same', created_at: isoAt(3) })
    const first = oldThread({ id: secondId, slug: 'same', created_at: isoAt(1) })
    const second = oldThread({ id: thirdId, slug: 'same', created_at: isoAt(2) })
    const spaced = oldThread({ slug: 'Bad Slug', created_at: isoAt(4) })
    const long = oldThread({ slug: 'a'.repeat(65), created_at: isoAt(5) })
    buildLedger(repo, ledgerOf([third, first, second, spaced, long]))
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    const spacedSlug = `thread-${String(spaced.id).toLowerCase()}`
    const longSlug = `thread-${String(long.id).toLowerCase()}`
    assert.deepEqual(result.value.slugs, ['same', 'same-2', 'same-3', spacedSlug, longSlug])
    assert.deepEqual(aliasesOf(repo), {
      [String(first.id)]: 'same',
      [String(second.id)]: 'same-2',
      [String(third.id)]: 'same-3',
      [String(spaced.id)]: spacedSlug,
      [String(long.id)]: longSlug
    })
    assert.deepEqual(
      namesOnThreads(repo).sort(),
      ['aliases.json', 'same-2.md', 'same-3.md', 'same.md', `${spacedSlug}.md`, `${longSlug}.md`].sort()
    )
    assert.equal(documentAt(repo, 'same-2').split('\n')[0], '# same-2: Fix the login flow')
  }, findRepository)
})

test('migrate.skips-a-file-that-is-not-json', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const brokenId = ulid()
    const valid = oldThread()
    buildLedger(repo, { ...ledgerOf([valid]), [`threads/${brokenId}.json`]: '{' })
    const result = migrateIfNeeded(rt, paths)
    assert.deepEqual(result, {
      ok: true,
      value: { migrated: true, slugs: ['fix-login'], skipped: [`threads/${brokenId}.json`] }
    })
    assert.deepEqual(namesOnThreads(repo), ['aliases.json', 'fix-login.md'])
  }, findRepository)
})

test('migrate.skips-a-thread-not-of-the-old-shape', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const valid = oldThread()
    const paused = oldThread({ slug: 'paused-work', status: 'paused' })
    const numberBlocked = oldThread({ slug: 'number-blocked', blocked_by: 3 })
    const { spine: dropped, ...spineless } = oldThread({ slug: 'no-spine' })
    assert.ok(dropped !== undefined)
    buildLedger(repo, ledgerOf([valid, paused, numberBlocked, spineless]))
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    assert.deepEqual(result.value.slugs, ['fix-login'])
    assert.deepEqual(
      [...result.value.skipped].sort(),
      [threadFile(paused), threadFile(numberBlocked), threadFile(spineless)].sort()
    )
    assert.deepEqual(namesOnThreads(repo), ['aliases.json', 'fix-login.md'])
  }, findRepository)
})

test('migrate.reads-absent-lists-as-empty-and-leaves-out-broken-entries', async () => {
  const { migrateIfNeeded, findRepository, checkStructure } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const { out_of_scope: droppedOutOfScope, ...spineWithoutOutOfScope } = spine({ open_risks: [3] })
    assert.ok(droppedOutOfScope !== undefined)
    const thread = oldThread({
      completion_criteria: [
        criterion({ ordinal: 1, text: 'The handler refreshes the token' }),
        { id: ulid(), ordinal: 2, done: false, kind: 'planned', struck_by: null }
      ],
      spine: spineWithoutOutOfScope
    })
    assert.equal(Object.hasOwn(thread, 'artifacts'), false)
    buildLedger(repo, ledgerOf([thread]))
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    assert.deepEqual(result.value.slugs, ['fix-login'])
    const text = documentAt(repo, 'fix-login')
    assert.deepEqual(checkStructure(text, 'fix-login'), [])
    assert.deepEqual(sectionLines(text, 'Done when'), ['- [ ] c1 The handler refreshes the token'])
    assert.deepEqual(sectionLines(text, 'Open risks'), [])
    assert.deepEqual(sectionLines(text, 'Settled, do not reopen'), [])
    assert.deepEqual(sectionLines(text, 'Where the details live'), [
      `- Old ledger record: thread ${String(thread.id)} in refs/logbook/archive/ledger`
    ])
  }, findRepository)
})

test('migrate.reads-a-decision-of-another-shape-as-missing', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withMigrationRepo(({ repo, rt, paths }) => {
    const decisionId = ulid()
    const thread = oldThread({
      spine: spine({ key_decisions: [{ id: ulid(), decision_id: decisionId, title: 'Token storage', scope: 'thread' }] })
    })
    buildLedger(repo, ledgerOf([thread], { [decisionId]: '{"title": 3}' }))
    const result = migrateIfNeeded(rt, paths)
    assert.ok(result.ok)
    assert.deepEqual(sectionLines(documentAt(repo, 'fix-login'), 'Decisions in force'), [
      '- D1 Token storage: decision record missing'
    ])
  }, findRepository)
})

test('migrate.ignores-a-threads-ref-on-origin', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withTempDir('logbook-migrate-origin', (origin) => {
    mustGit(origin, ['init', '--bare', '--initial-branch=main'])
    const remoteDocument = hashBlob(origin, '# remote-thread: Converted elsewhere\nStatus: active\n')
    const remoteTree = makeTree(origin, [`100644 blob ${remoteDocument}\tremote-thread.md\n`])
    const remoteTip = gitWithInput(origin, [...IDENTITY_ARGS, 'commit-tree', remoteTree, '-m', 'remote threads'], '')
    mustGit(origin, ['update-ref', 'refs/logbook/threads', remoteTip])
    withMigrationRepo(({ repo, rt, paths }) => {
      mustGit(repo, ['remote', 'add', 'origin', origin])
      buildLedger(repo, ledgerOf([oldThread()]))
      const result = migrateIfNeeded(rt, paths)
      assert.ok(result.ok)
      assert.deepEqual(result.value.slugs, ['fix-login'])
      const localTip = refOf(repo, 'refs/logbook/threads')
      assert.ok(localTip !== null)
      assert.deepEqual(mustGit(repo, ['rev-list', '--parents', '-n', '1', localTip]).trim().split(' '), [localTip])
      assert.equal(mustGit(repo, ['log', '-1', '--format=%s', localTip]).trim(), 'migrate from the old ledger')
      assert.equal(refOf(origin, 'refs/logbook/threads'), remoteTip)
      assert.equal(refOf(repo, 'refs/logbook/remotes/origin/threads'), null)
      assert.deepEqual(namesOnThreads(repo), ['aliases.json', 'fix-login.md'])
    }, findRepository)
  })
})

test('migrate.refuses-a-ledger-whose-objects-are-missing', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withPartialLedgerClone(
    'blob:none',
    ({ repo, rt, paths, writer, log }) => {
      const threadPath = mustGit(writer, ['ls-tree', '-r', '--name-only', 'refs/logbook/ledger', '--', 'threads']).trim()
      const threadBlob = mustGit(writer, ['rev-parse', `refs/logbook/ledger:${threadPath}`]).trim()
      assert.deepEqual(missingFrom(repo, 'refs/logbook/ledger'), [threadBlob])
      const result = migrateIfNeeded(rt, paths)
      assert.equal(result.ok, false)
      assert.ok(!result.ok)
      assert.equal(result.field, 'refs/logbook/ledger')
      assert.ok(result.message.includes(REFETCH_COMMAND), `the refusal must name the refetch command: ${result.message}`)
      assert.ok(result.message.includes(threadBlob), `the refusal must name the missing object: ${result.message}`)
      assert.equal(refOf(repo, 'refs/logbook/threads'), null)
      assert.equal(refOf(repo, 'refs/logbook/archive/ledger'), null)
      assert.equal(recordedStarts(log), '', 'the migration must not start the origin upload-pack')
    },
    findRepository
  )
})

test('migrate.refuses-a-ledger-whose-trees-are-missing', async () => {
  const { migrateIfNeeded, findRepository } = await loadModules()
  withPartialLedgerClone(
    'tree:0',
    ({ repo, rt, paths, writer, log }) => {
      const rootTree = mustGit(writer, ['rev-parse', 'refs/logbook/ledger^{tree}']).trim()
      assert.deepEqual(missingFrom(repo, 'refs/logbook/ledger'), [rootTree])
      const result = migrateIfNeeded(rt, paths)
      assert.equal(result.ok, false)
      assert.ok(!result.ok)
      assert.equal(result.field, 'refs/logbook/ledger')
      assert.ok(result.message.includes(REFETCH_COMMAND), `the refusal must name the refetch command: ${result.message}`)
      assert.ok(result.message.includes(rootTree), `the refusal must name the missing object: ${result.message}`)
      assert.equal(refOf(repo, 'refs/logbook/threads'), null)
      assert.equal(refOf(repo, 'refs/logbook/archive/ledger'), null)
      assert.equal(recordedStarts(log), '', 'the migration must not start the origin upload-pack')
    },
    findRepository
  )
})
