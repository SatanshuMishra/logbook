import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const SESSION = 's1'
const THREADS_REF = 'refs/logbook/threads'

type Fixture = { repo: string; home: string; spawned: SpawnedServer }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const makeRepo = (): string => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-open-thread-repo-'))
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

const withServer = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = makeRepo()
  const home = mkdtempSync(join(tmpdir(), 'logbook-open-thread-home-'))
  try {
    const spawned = await spawnServer({
      projectRoot: repo,
      entry: ENTRY,
      env: { CLAUDE_CODE_SESSION_ID: SESSION, HOME: home }
    })
    try {
      await fn({ repo, home, spawned })
    } finally {
      await spawned.close()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
    rmSync(repo, { recursive: true, force: true })
  }
}

const openThread = async (fixture: Fixture, args: Record<string, unknown>): Promise<CallToolResult> =>
  (await fixture.spawned.client.callTool({ name: 'open_thread', arguments: args })) as CallToolResult

const fixLoginArgs = (extra: Record<string, unknown>): Record<string, unknown> => ({
  slug: 'fix-login',
  title: 'Fix the login page',
  goal: 'Users can log in again.',
  next_step: 'Reproduce the failing submit.',
  ...extra
})

const textOf = (reply: CallToolResult): string => {
  const first = reply.content[0]
  assert.ok(first !== undefined && first.type === 'text', 'the reply must carry a text content block')
  return first.text
}

const refusalLines = (reply: CallToolResult): { field: string; accepted: string; text: string } => {
  assert.equal(reply.isError, true, `expected a refusal, got: ${JSON.stringify(reply)}`)
  const text = textOf(reply)
  const lines = text.split('\n')
  const index = lines.findIndex((line) => line.startsWith('field: '))
  assert.ok(index >= 0, `the refusal must have a "field: " line, got:\n${text}`)
  const accepted = lines[index + 1] ?? ''
  assert.ok(accepted.startsWith('accepted: '), `the field line must be followed by an "accepted: " line, got:\n${text}`)
  return { field: (lines[index] ?? '').slice('field: '.length), accepted: accepted.slice('accepted: '.length), text }
}

const assertSucceeded = (reply: CallToolResult): void => {
  assert.equal(reply.isError, undefined, `expected success, got: ${JSON.stringify(reply)}`)
}

const refExists = (repo: string): boolean => rawGit(repo, ['rev-parse', '--verify', '--quiet', THREADS_REF]).status === 0

const storedText = (repo: string, slug: string): string => mustGit(repo, ['cat-file', 'blob', `${THREADS_REF}:${slug}.md`])

const holdFile = (repo: string, slug: string): string => join(repo, '.git', 'logbook', 'holds', `${slug}.json`)

const sectionBody = (lines: readonly string[], heading: string): string[] => {
  const start = lines.indexOf(heading)
  assert.ok(start >= 0, `the document must have a "${heading}" heading`)
  const after = lines.slice(start + 1)
  const end = after.findIndex((line) => line.startsWith('## '))
  return (end < 0 ? after : after.slice(0, end)).filter((line) => line.trim() !== '')
}

const workingCopiesNamed = (home: string, name: string): string[] => {
  const root = join(home, '.logbook')
  if (!existsSync(root)) return []
  return readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((entry) => basename(entry) === name)
}

const lockThreadsRef = (repo: string): void => {
  const commonDir = mustGit(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()
  const folder = join(commonDir, 'refs', 'logbook')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'threads.lock'), '')
}

test('open_thread.spawn.contract', async () => {
  await import('../../../src/server/tools/open_thread.ts')
  await withServer(async (fixture) => {
    const reply = await openThread(
      fixture,
      fixLoginArgs({ criteria: ['The page loads', 'Errors show'], details: ['Spec: docs/specs/login.md'] })
    )

    assertSucceeded(reply)
    const structured = reply.structuredContent as { thread_id: string; path: string }
    assert.deepEqual(Object.keys(structured).sort(), ['path', 'thread_id'])
    assert.equal(structured.thread_id, 'fix-login')
    assert.equal(basename(structured.path), 'fix-login.md')
    assert.equal(realpathSync(dirname(dirname(structured.path))), realpathSync(join(fixture.home, '.logbook')))
    assert.equal(
      textOf(reply),
      `opened thread fix-login. Its state document is ${structured.path}. Keep it true by editing that file with the Edit tool.`
    )

    const stored = storedText(fixture.repo, 'fix-login')
    const lines = stored.split('\n')
    assert.equal(lines[0], '# fix-login: Fix the login page')
    assert.ok(lines.includes('- [ ] c1 The page loads'), `c1 must be stored, got:\n${stored}`)
    assert.ok(lines.includes('- [ ] c2 Errors show'), `c2 must be stored, got:\n${stored}`)
    assert.ok(lines.includes('- Spec: docs/specs/login.md'), `the detail line must be stored, got:\n${stored}`)
    assert.ok(lines.includes('Next ids: c3 D1 R1 S1'), `the next ids must follow the criteria, got:\n${stored}`)
    assert.equal(mustGit(fixture.repo, ['log', '-1', '--format=%B', THREADS_REF]).trim(), 'open_thread fix-login: opened')
    assert.equal(readFileSync(structured.path, 'utf8'), stored)

    const hold = JSON.parse(readFileSync(holdFile(fixture.repo, 'fix-login'), 'utf8')) as Record<string, unknown>
    assert.equal(hold.slug, 'fix-login')
    assert.equal(hold.holder, 's1')
    assert.equal(typeof hold.folded_at, 'string')
    const foldedAt = String(hold.folded_at)
    assert.equal(new Date(foldedAt).toISOString(), foldedAt, `folded_at must be an ISO time, got ${foldedAt}`)
  })
})

test('open_thread.opens-without-criteria', async () => {
  await import('../../../src/server/tools/open_thread.ts')
  await withServer(async (fixture) => {
    const reply = await openThread(fixture, fixLoginArgs({}))

    assertSucceeded(reply)
    const lines = storedText(fixture.repo, 'fix-login').split('\n')
    assert.deepEqual(sectionBody(lines, '## Done when'), [])
    assert.deepEqual(sectionBody(lines, '## Where the details live'), [])
    assert.ok(lines.includes('Next ids: c1 D1 R1 S1'), `unexpected document:\n${lines.join('\n')}`)
  })
})

test('open_thread.rejects-invalid', async () => {
  await import('../../../src/server/tools/open_thread.ts')
  await withServer(async (fixture) => {
    const calls: [string, Record<string, unknown>][] = [
      ['slug', fixLoginArgs({ slug: 'Fix Login' })],
      ['title', fixLoginArgs({ title: '  ' })],
      ['pickup', fixLoginArgs({ pickup: true })]
    ]

    for (const [field, args] of calls) {
      const refusal = refusalLines(await openThread(fixture, args))
      assert.equal(refusal.field, field)
    }
    assert.equal(refExists(fixture.repo), false, 'a refused call must create no ref')
  })
})

test('open_thread.refuses-a-slug-longer-than-64', async () => {
  await import('../../../src/server/tools/open_thread.ts')
  await withServer(async (fixture) => {
    const slug = 'a'.repeat(65)

    const refusal = refusalLines(await openThread(fixture, fixLoginArgs({ slug })))

    assert.equal(refusal.field, 'slug')
    assert.ok(refusal.accepted.includes('pattern=^[a-z0-9][a-z0-9-]*$'), `the pattern must be named, got: ${refusal.accepted}`)
    assert.ok(refusal.accepted.includes('maxLength=64'), `the length limit must be named, got: ${refusal.accepted}`)
    assert.equal(refExists(fixture.repo), false, 'a refused call must create no ref')
    assert.deepEqual(workingCopiesNamed(fixture.home, `${slug}.md`), [])
    assert.equal(existsSync(holdFile(fixture.repo, slug)), false, 'a refused call must create no hold')
  })
})

test('open_thread.refuses-a-taken-slug', async () => {
  await import('../../../src/server/tools/open_thread.ts')
  await withServer(async (fixture) => {
    assertSucceeded(await openThread(fixture, fixLoginArgs({})))

    const refusal = refusalLines(await openThread(fixture, fixLoginArgs({ title: 'Fix the login page again' })))

    assert.equal(refusal.field, 'slug')
    assert.ok(refusal.text.includes('thread fix-login already exists'), `unexpected refusal:\n${refusal.text}`)
    assert.ok(refusal.text.includes('resume_thread'), `the refusal must name resume_thread:\n${refusal.text}`)
    assert.equal(mustGit(fixture.repo, ['rev-list', '--count', THREADS_REF]).trim(), '1')
  })
})

test('open_thread.refuses-a-blank-criterion', async () => {
  await import('../../../src/server/tools/open_thread.ts')
  await withServer(async (fixture) => {
    const refusal = refusalLines(await openThread(fixture, fixLoginArgs({ criteria: ['The page loads', ' '] })))

    assert.equal(refusal.field, 'criteria.1')
    assert.equal(refExists(fixture.repo), false, 'a refused call must create no ref')
  })
})

test('open_thread.returns-gits-error-when-the-ref-cannot-be-updated', async () => {
  await import('../../../src/server/tools/open_thread.ts')
  await withServer(async (fixture) => {
    lockThreadsRef(fixture.repo)

    const refusal = refusalLines(await openThread(fixture, fixLoginArgs({})))

    assert.equal(refusal.field, 'refs/logbook/threads')
    assert.ok(
      refusal.text.includes('git update-ref failed for refs/logbook/threads'),
      `the refusal must say git could not update the ref:\n${refusal.text}`
    )
    assert.ok(refusal.text.includes('threads.lock'), `the refusal must hold git's error output:\n${refusal.text}`)
    assert.ok(!refusal.text.includes('already exists'), `the refusal must not say the slug is taken:\n${refusal.text}`)
    assert.equal(refExists(fixture.repo), false, 'a failed commit must leave refs/logbook/threads absent')
    assert.deepEqual(workingCopiesNamed(fixture.home, 'fix-login.md'), [])
    assert.equal(existsSync(holdFile(fixture.repo, 'fix-login')), false, 'a failed commit must take no hold')
  })
})
