import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { readHold, takeHold } from '../../src/thread/holds.ts'
import { listMarkers, writeMarker } from '../../src/thread/inflight.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments, readDocument } from '../../src/thread/store.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const timeAt = (minute: number): string => new Date(Date.UTC(2026, 9, 14, 9, minute)).toISOString()

const STORED_AT = timeAt(0)
const SETUP_AT = timeAt(5)
const ACCEPT_AT = timeAt(30)
const STEP_MS = 60000

const C1_OPEN = '- [ ] c1 The login page loads'
const C1_TICKED = '- [x] c1 The login page loads evidence: test login.loads passed'
const C2_OPEN = '- [ ] c2 Errors show under the form'
const R1 = '- R1 The staging database may be stale'
const R2 = '- R2 The cookie domain may differ between hosts'

const HELPER_PATH = fileURLToPath(new URL('../../bin/logbook-push.ts', import.meta.url))

type DocParts = {
  updated: string
  status?: string
  nextIds?: string
  criteria?: string[]
  stand?: string
  nextStep?: string
  risks?: string[]
  note?: string[]
}

const fixLogin = (parts: DocParts): string => {
  const risks = parts.risks ?? [R1]
  const lines = [
    '# fix-login: Fix the login page',
    `Status: ${parts.status ?? 'active'}`,
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
    parts.stand ?? 'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    parts.nextStep ?? 'Fix the submit handler.',
    '',
    '## Decisions in force',
    '',
    '- D1 Keep the session cookie: the mobile app reads it',
    '',
    '## Open risks',
    '',
    ...(risks.length === 0 ? [] : [...risks, '']),
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md',
    ...(parts.note === undefined ? [] : ['', '## This update', '', ...parts.note])
  ]
  return `${lines.join('\n')}\n`
}

const VALID_EDIT = fixLogin({
  updated: STORED_AT,
  criteria: [C1_TICKED, C2_OPEN],
  risks: [],
  note: ['Ticked c1.', 'Removed: R1 because it passed']
})

type Context = { repo: string; paths: RepoPaths; setup: Runtime; rt: Runtime; workingCopy: string }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', 'refs/logbook/threads']).trim()

const commitCount = (repo: string): number =>
  Number(mustGit(repo, ['rev-list', '--count', 'refs/logbook/threads']).trim())

const messageOf = (repo: string, commit: string): string =>
  mustGit(repo, ['log', '-1', '--format=%B', commit]).replace(/\n+$/, '')

const parentsOf = (repo: string, commit: string): string[] =>
  mustGit(repo, ['rev-list', '--parents', '-n', '1', commit]).trim().split(' ').slice(1)

const storedText = (repo: string, commit = 'refs/logbook/threads'): string =>
  mustGit(repo, ['cat-file', 'blob', `${commit}:fix-login.md`])

const updatedOf = (text: string): string => {
  const updated = /^Updated: (.*)$/m.exec(text)?.[1]
  assert.ok(updated !== undefined, 'the document must have an Updated line')
  return updated
}

const writeWorkingCopy = (context: Context, text: string): void => {
  mkdirSync(dirname(context.workingCopy), { recursive: true })
  writeFileSync(context.workingCopy, text)
}

const readWorkingCopy = (context: Context): string => readFileSync(context.workingCopy, 'utf8')

const contextFor = (repo: string, home: string): Context => {
  const env = { PATH: process.env.PATH, HOME: home }
  const setup = testRuntime({ cwd: repo, env, sessionId: 's1', start: SETUP_AT })
  const found = findRepository(setup, repo)
  assert.ok(found.ok, 'the test repository must be found')
  const seeded = commitDocuments(setup, found.value, {
    changes: [{ slug: 'fix-login', text: fixLogin({ updated: STORED_AT }), expectedBlob: null }],
    message: 'open_thread fix-login: opened'
  })
  assert.ok(seeded.ok, 'the stored document must be seeded')
  takeHold(setup, found.value, 'fix-login', 's1', null)
  return {
    repo,
    paths: found.value,
    setup,
    rt: testRuntime({ cwd: repo, env, sessionId: 's1', start: ACCEPT_AT, stepMs: STEP_MS }),
    workingCopy: join(found.value.workingDir, 'fix-login.md')
  }
}

const withThread = <T>(fn: (context: Context) => T): T =>
  withRepo((repo) => {
    const home = mkdtempSync(join(tmpdir(), 'logbook-reconcile-home-'))
    try {
      return fn(contextFor(repo, home))
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

const withThreadAsync = async <T>(fn: (context: Context, scratch: string) => Promise<T>): Promise<T> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-reconcile-push-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Reconcile Tester'])
    mustGit(repo, ['config', 'user.email', 'reconcile@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'reconcile test repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '-m', 'initial commit'])
    return await fn(contextFor(repo, home), scratch)
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const addOrigin = (repo: string, scratch: string): string => {
  const origin = join(scratch, 'origin.git')
  mustGit(scratch, ['init', '--bare', origin])
  mustGit(repo, ['remote', 'add', 'origin', origin])
  return origin
}

const exitOf = (child: ChildProcess): Promise<number | null> =>
  new Promise((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.once('error', () => resolve(null))
  })

const nextStepChange = (text: string) => ({
  ok: true as const,
  text: text.replace('Fix the submit handler.', 'Run the login tests.'),
  summary: 'next step set',
  details: [],
  noteLines: []
})

test('reconcile.materialises-an-absent-working-copy', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = tipOf(context.repo)
    assert.equal(existsSync(context.workingCopy), false)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.deepEqual(result, { kind: 'materialised' })
    assert.equal(readWorkingCopy(context), fixLogin({ updated: STORED_AT }))
    assert.equal(tipOf(context.repo), before)
  })
})

test('reconcile.does-nothing-for-an-identical-copy', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = tipOf(context.repo)
    writeWorkingCopy(context, fixLogin({ updated: STORED_AT }))
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.deepEqual(result, { kind: 'unchanged' })
    assert.equal(tipOf(context.repo), before)
    assert.equal(readWorkingCopy(context), fixLogin({ updated: STORED_AT }))
  })
})

test('reconcile.ignores-header-only-changes', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = tipOf(context.repo)
    const edited = fixLogin({ updated: timeAt(45), nextIds: 'c1 D1 R1 S1' })
    writeWorkingCopy(context, edited)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.deepEqual(result, { kind: 'unchanged' })
    assert.equal(tipOf(context.repo), before)
    assert.equal(readWorkingCopy(context), edited)
  })
})

test('reconcile.accepts-a-valid-edit', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = commitCount(context.repo)
    writeMarker(context.setup, context.paths, 'fix-login', {
      toolUseId: 'toolu_other_session',
      tool: 'Bash',
      toolInput: { command: 'npm test' },
      session: 's2'
    })
    writeMarker(context.setup, context.paths, 'fix-login', {
      toolUseId: 'toolu_this_session',
      tool: 'Bash',
      toolInput: { command: 'npm run lint' },
      session: 's1'
    })
    writeWorkingCopy(context, VALID_EDIT)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.ok('kind' in result && result.kind === 'accepted', JSON.stringify(result))
    assert.deepEqual(result.removed, ['R1'])
    assert.equal(result.push, null)
    assert.equal(commitCount(context.repo), before + 1)
    assert.equal(tipOf(context.repo), result.commit)
    assert.equal(messageOf(context.repo, result.commit), 'update fix-login: Ticked c1.\n\nRemoved: R1 because it passed')
    const expected = fixLogin({ updated: ACCEPT_AT, criteria: [C1_TICKED, C2_OPEN], risks: [] })
    assert.equal(storedText(context.repo), expected)
    assert.equal(readWorkingCopy(context), expected)
    assert.equal(readHold(context.paths, 'fix-login')?.folded_at, ACCEPT_AT)
    assert.deepEqual(
      listMarkers(context.paths, 'fix-login').map((marker) => marker.tool_use_id),
      ['toolu_this_session']
    )
  })
})

test('reconcile.refuses-an-edit-with-violations', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = tipOf(context.repo)
    const edited = fixLogin({ updated: STORED_AT, risks: [] })
    writeWorkingCopy(context, edited)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.ok('kind' in result && result.kind === 'refused', JSON.stringify(result))
    assert.deepEqual(
      result.violations.map((violation) => violation.id),
      ['R1']
    )
    assert.ok(result.violations[0]?.message.includes('Removed: R1 because <reason>'))
    assert.equal(tipOf(context.repo), before)
    assert.equal(readWorkingCopy(context), edited)
  })
})

test('reconcile.refuses-a-working-copy-that-is-not-a-file', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = tipOf(context.repo)
    mkdirSync(context.workingCopy, { recursive: true })
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    if ('kind' in result) assert.fail(`expected a refusal, got ${JSON.stringify(result)}`)
    assert.equal(result.field, 'working_copy')
    assert.ok(result.message.includes(context.workingCopy), result.message)
    assert.equal(tipOf(context.repo), before)
  })
})

test('reconcile.checks-again-when-the-thread-moved', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  const edit = fixLogin({ updated: STORED_AT, criteria: [C1_TICKED, C2_OPEN], note: ['Ticked c1.'] })
  withThread((context) => {
    const stored = readDocument(context.setup, context.paths, 'fix-login')
    assert.ok(stored !== null)
    writeWorkingCopy(context, edit)
    const concurrent: string[] = []
    const result = reconcileThread(context.rt, context.paths, 'fix-login', {
      beforeCas: () => {
        if (concurrent.length > 0) return
        const moved = commitDocuments(context.setup, context.paths, {
          changes: [
            {
              slug: 'fix-login',
              text: fixLogin({ updated: timeAt(10), stand: 'Another session confirmed the failure.' }),
              expectedBlob: stored.blob
            }
          ],
          message: 'update fix-login: confirmed the failure'
        })
        assert.ok(moved.ok)
        concurrent.push(moved.value.commit)
      }
    })
    assert.ok('kind' in result && result.kind === 'accepted', JSON.stringify(result))
    assert.equal(concurrent.length, 1)
    assert.equal(commitCount(context.repo), 3)
    assert.deepEqual(parentsOf(context.repo, result.commit), concurrent)
    const text = storedText(context.repo)
    assert.equal(text, fixLogin({ updated: updatedOf(text), criteria: [C1_TICKED, C2_OPEN] }))
    assert.notEqual(updatedOf(text), STORED_AT)
    assert.notEqual(updatedOf(text), timeAt(10))
    assert.equal(readWorkingCopy(context), text)
  })
  withThread((context) => {
    const stored = readDocument(context.setup, context.paths, 'fix-login')
    assert.ok(stored !== null)
    writeWorkingCopy(context, edit)
    const concurrent: string[] = []
    const result = reconcileThread(context.rt, context.paths, 'fix-login', {
      beforeCas: () => {
        if (concurrent.length > 0) return
        const moved = commitDocuments(context.setup, context.paths, {
          changes: [
            {
              slug: 'fix-login',
              text: fixLogin({ updated: timeAt(10), nextIds: 'c3 D2 R3 S1', risks: [R1, R2] }),
              expectedBlob: stored.blob
            }
          ],
          message: 'update fix-login: added a risk'
        })
        assert.ok(moved.ok)
        concurrent.push(moved.value.commit)
      }
    })
    assert.ok('kind' in result && result.kind === 'refused', JSON.stringify(result))
    assert.deepEqual(
      result.violations.map((violation) => violation.id),
      ['R2']
    )
    assert.deepEqual([tipOf(context.repo)], concurrent)
    assert.equal(readWorkingCopy(context), edit)
  })
})

test('reconcile.refuses-an-unknown-thread', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const result = reconcileThread(context.rt, context.paths, 'ghost')
    if ('kind' in result) assert.fail(`expected a refusal, got ${JSON.stringify(result)}`)
    assert.equal(result.field, 'thread_id')
    assert.equal(existsSync(join(context.paths.workingDir, 'ghost.md')), false)
  })
})

test('reconcile.tool-change-without-pending-edits', async () => {
  const { applyToolChange } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = commitCount(context.repo)
    writeWorkingCopy(context, fixLogin({ updated: STORED_AT }))
    const result = applyToolChange(context.rt, context.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange
    })
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(commitCount(context.repo), before + 1)
    assert.equal(messageOf(context.repo, result.value.commit), 'update_thread fix-login: next step set')
    const expected = fixLogin({ updated: ACCEPT_AT, nextStep: 'Run the login tests.' })
    assert.equal(readWorkingCopy(context), expected)
    assert.equal(storedText(context.repo), expected)
    assert.equal(result.value.text, expected)
    assert.deepEqual(result.value.removed, [])
    assert.equal(result.value.push, null)
    assert.equal(readHold(context.paths, 'fix-login')?.folded_at, ACCEPT_AT)
  })
})

test('reconcile.tool-change-folds-a-pending-valid-edit-first', async () => {
  const { applyToolChange } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = commitCount(context.repo)
    writeWorkingCopy(context, fixLogin({ updated: STORED_AT, criteria: [C1_TICKED, C2_OPEN], note: ['Ticked c1.'] }))
    const result = applyToolChange(context.rt, context.paths, 'fix-login', {
      tool: 'update_thread',
      change: (text) => ({
        ok: true,
        text: text.replace(R1, `${R1}\n${R2}`),
        summary: 'added R2',
        details: [],
        noteLines: []
      })
    })
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(commitCount(context.repo), before + 2)
    const [editCommit] = parentsOf(context.repo, result.value.commit)
    assert.ok(editCommit !== undefined)
    assert.equal(messageOf(context.repo, editCommit), 'update fix-login: Ticked c1.')
    assert.equal(messageOf(context.repo, result.value.commit), 'update_thread fix-login: added R2')
    const editText = storedText(context.repo, editCommit)
    assert.equal(editText, fixLogin({ updated: updatedOf(editText), criteria: [C1_TICKED, C2_OPEN] }))
    const copy = readWorkingCopy(context)
    assert.equal(
      copy,
      fixLogin({ updated: updatedOf(copy), nextIds: 'c3 D2 R3 S1', criteria: [C1_TICKED, C2_OPEN], risks: [R1, R2] })
    )
    assert.equal(storedText(context.repo), copy)
    assert.equal(readHold(context.paths, 'fix-login')?.folded_at, updatedOf(copy))
  })
})

test('reconcile.tool-change-refused-by-a-pending-invalid-edit', async () => {
  const { applyToolChange } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = tipOf(context.repo)
    const edited = fixLogin({ updated: STORED_AT, risks: [] })
    writeWorkingCopy(context, edited)
    const result = applyToolChange(context.rt, context.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange
    })
    if (result.ok) assert.fail(`expected a refusal, got ${JSON.stringify(result)}`)
    assert.equal(result.field, 'document')
    assert.ok(result.message.includes('R1'), result.message)
    assert.ok(result.message.includes(context.workingCopy), result.message)
    assert.equal(tipOf(context.repo), before)
    assert.equal(readWorkingCopy(context), edited)
  })
})

test('reconcile.tool-change-refused-by-the-checker', async () => {
  const { applyToolChange } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    const before = tipOf(context.repo)
    writeWorkingCopy(context, fixLogin({ updated: STORED_AT }))
    const result = applyToolChange(context.rt, context.paths, 'fix-login', {
      tool: 'close_thread',
      change: (text) => ({
        ok: true,
        text: text.replace('Status: active', 'Status: done'),
        summary: 'closed',
        details: [],
        noteLines: []
      })
    })
    if (result.ok) assert.fail(`expected a refusal, got ${JSON.stringify(result)}`)
    assert.equal(result.field, 'document')
    assert.ok(result.message.includes('c1 is still open'), result.message)
    assert.equal(tipOf(context.repo), before)
    assert.equal(readWorkingCopy(context), fixLogin({ updated: STORED_AT }))
  })
})

test('reconcile.accept-pushes-in-the-background', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  await withThreadAsync(async (context, scratch) => {
    const origin = addOrigin(context.repo, scratch)
    writeWorkingCopy(context, VALID_EDIT)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.ok('kind' in result && result.kind === 'accepted', JSON.stringify(result))
    assert.ok(result.push !== null, 'a repository with origin must start a push')
    assert.equal(await exitOf(result.push), 0)
    assert.equal(tipOf(origin), tipOf(context.repo))
    assert.equal(tipOf(origin), result.commit)
  })
})

test('reconcile.accept-without-origin-starts-nothing', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  withThread((context) => {
    writeWorkingCopy(context, VALID_EDIT)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.ok('kind' in result && result.kind === 'accepted', JSON.stringify(result))
    assert.equal(result.push, null)
  })
})

test('reconcile.accept-push-has-a-time-limit', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  await withThreadAsync(async (context, scratch) => {
    addOrigin(context.repo, scratch)
    writeWorkingCopy(context, VALID_EDIT)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.ok('kind' in result && result.kind === 'accepted', JSON.stringify(result))
    const child = result.push
    assert.ok(child !== null, 'a repository with origin must start a push')
    const exited = exitOf(child)
    try {
      const [helper, top, timeout] = child.spawnargs.slice(-3)
      assert.ok(helper !== undefined && top !== undefined)
      assert.equal(realpathSync(helper), realpathSync(HELPER_PATH))
      assert.equal(realpathSync(top), realpathSync(context.repo))
      assert.equal(timeout, '15000')
    } finally {
      await exited
    }
  })
})

test('reconcile.rejected-push-changes-nothing', async () => {
  const { reconcileThread } = await import('../../src/thread/reconcile.ts')
  await withThreadAsync(async (context, scratch) => {
    const origin = addOrigin(context.repo, scratch)
    mustGit(context.repo, ['push', 'origin', 'refs/logbook/threads:refs/logbook/threads'])
    const shared = tipOf(origin)
    const originOnly = mustGit(origin, [
      '-c',
      'user.name=Origin Tester',
      '-c',
      'user.email=origin@logbook.test',
      'commit-tree',
      `${shared}^{tree}`,
      '-p',
      shared,
      '-m',
      'update fix-login: written by another clone'
    ]).trim()
    mustGit(origin, ['update-ref', 'refs/logbook/threads', originOnly])
    writeWorkingCopy(context, VALID_EDIT)
    const result = reconcileThread(context.rt, context.paths, 'fix-login')
    assert.ok('kind' in result && result.kind === 'accepted', JSON.stringify(result))
    assert.ok(result.push !== null, 'a repository with origin must start a push')
    assert.equal(await exitOf(result.push), 1)
    assert.equal(tipOf(context.repo), result.commit)
    assert.deepEqual(parentsOf(context.repo, result.commit), [shared])
    assert.equal(tipOf(origin), originOnly)
  })
})
