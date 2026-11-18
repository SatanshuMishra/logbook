import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { runTool, type ToolOutcome } from '../../../src/server/register.ts'
import { parkThreadTool } from '../../../src/server/tools/park_thread.ts'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const THREADS = 'refs/logbook/threads'
const START = '2026-11-17T09:00:00.000Z'
const SESSION = 'session-s'
const PARKED_LINE = 'Status: parked'
const STAND = 'The form renders but submitting it fails.'
const D1_LINE = '- D1 Keep the session cookie: the mobile app reads it\n'
const C1_LINE = '- [ ] c1 The login page loads\n'

type Fixture = { repo: string; rt: Runtime }

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const fixLogin = (): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${START}`,
    'Next ids: c3 D2 R1 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    C1_LINE.trimEnd(),
    '- [ ] c2 Errors show under the form',
    '',
    '## Where things stand',
    '',
    STAND,
    '',
    '## Next step',
    '',
    'Fix the submit handler.',
    '',
    '## Decisions in force',
    '',
    D1_LINE.trimEnd(),
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

const withThread = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-park-edits-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Park Edits Tester'])
    mustGit(repo, ['config', 'user.email', 'park-edits@logbook.test'])
    const rt = testRuntime({
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: home, PLUGIN_METRICS_DIR: join(scratch, 'metrics') },
      sessionId: SESSION,
      start: START
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: fixLogin(), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, JSON.stringify(seeded))
    await fn({ repo, rt })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS]).trim()

const storedText = (repo: string): string => mustGit(repo, ['cat-file', 'blob', `${THREADS}:fix-login.md`])

const sectionBody = (text: string, name: string): string => {
  const lines = text.split('\n')
  const start = lines.indexOf(`## ${name}`)
  assert.notEqual(start, -1, `the document must have "## ${name}"`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
}

const refusalOf = <O>(outcome: ToolOutcome<O>) => {
  assert.equal(outcome.kind, 'refused', JSON.stringify(outcome))
  if (outcome.kind !== 'refused') throw new Error('unreachable')
  return outcome.refusal
}

const statusLine = (text: string): string | undefined => text.split('\n').find((line) => line.startsWith('Status: '))

test('park-edits.edits-and-note-land-in-the-park-commit', async () => {
  await withThread(async ({ repo, rt }) => {
    const before = tipOf(repo)
    const outcome = await runTool(rt, parkThreadTool, {
      thread_id: 'fix-login',
      next_step: 'Run the release.',
      edits: [
        { old_text: STAND, new_text: 'The fix is merged.' },
        { old_text: D1_LINE, new_text: '' }
      ],
      note: ['Removed: D1 because it was reversed']
    })

    assert.equal(outcome.kind, 'ok', JSON.stringify(outcome))
    const after = tipOf(repo)
    assert.equal(mustGit(repo, ['rev-list', '--count', `${before}..${after}`]).trim(), '1')
    const stored = storedText(repo)
    assert.equal(statusLine(stored), PARKED_LINE)
    assert.equal(sectionBody(stored, 'Where things stand'), 'The fix is merged.')
    assert.equal(sectionBody(stored, 'Next step'), 'Run the release.')
    assert.equal(/\bD1\b/.test(stored), false, stored)
    const message = mustGit(repo, ['log', '-1', '--format=%B', after])
    assert.ok(message.startsWith('park_thread fix-login:'), message)
    assert.ok(message.split('\n').includes('Removed: D1 because it was reversed'), message)
  })
})

test('park-edits.absent-old-text-parks-nothing', async () => {
  await withThread(async ({ repo, rt }) => {
    const before = tipOf(repo)
    const refusal = refusalOf(
      await runTool(rt, parkThreadTool, {
        thread_id: 'fix-login',
        edits: [{ old_text: 'The cache is warmed before every deploy.', new_text: 'x' }]
      })
    )

    assert.equal(refusal.field, 'edits.0.old_text')
    assert.equal(tipOf(repo), before)
    assert.equal(statusLine(storedText(repo)), 'Status: active')
  })
})
