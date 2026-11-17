import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { runTool, type ToolOutcome } from '../../../src/server/register.ts'
import { updateThreadTool } from '../../../src/server/tools/update_thread.ts'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const THREADS = 'refs/logbook/threads'
const START = '2026-11-17T09:00:00.000Z'
const SESSION = 'session-s'
const STAND = 'The form renders but submitting it fails.'
const D1_LINE = '- D1 Keep the session cookie: the mobile app reads it\n'
const C1_LINE = '- [ ] c1 The login page loads\n'
const NOTE_REMEDY = 'send the line "Removed: D1 because <reason>" in the call\'s note'

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
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-removal-remedy-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Removal Remedy Tester'])
    mustGit(repo, ['config', 'user.email', 'removal-remedy@logbook.test'])
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

const refusalOf = <O>(outcome: ToolOutcome<O>) => {
  assert.equal(outcome.kind, 'refused', JSON.stringify(outcome))
  if (outcome.kind !== 'refused') throw new Error('unreachable')
  return outcome.refusal
}

test('removal-remedy.removal-without-a-reason-asks-for-a-note-line', async () => {
  await withThread(async ({ repo, rt }) => {
    const before = tipOf(repo)
    const refusal = refusalOf(
      await runTool(rt, updateThreadTool, { thread_id: 'fix-login', edits: [{ old_text: D1_LINE, new_text: '' }] })
    )
    assert.ok(refusal.message.includes(NOTE_REMEDY), refusal.message)
    assert.equal(refusal.message.includes('adding that section'), false, refusal.message)
    assert.equal(tipOf(repo), before)
  })
})

test('removal-remedy.an-edit-adding-the-note-section-is-told-to-use-note', async () => {
  await withThread(async ({ repo, rt }) => {
    const before = tipOf(repo)
    const refusal = refusalOf(
      await runTool(rt, updateThreadTool, {
        thread_id: 'fix-login',
        edits: [
          { old_text: D1_LINE, new_text: '' },
          {
            old_text: '- Spec: docs/specs/login.md\n',
            new_text: '- Spec: docs/specs/login.md\n\n## This update\n\nRemoved: D1 because it was reversed\n'
          }
        ]
      })
    )
    assert.ok(
      refusal.message.includes('logbook writes "## This update" from the call\'s note; take the section out of the edits and send its lines in note'),
      refusal.message
    )
    assert.equal(refusal.message.includes('move it and its lines to the end of the document'), false, refusal.message)
    assert.equal(tipOf(repo), before)
  })
})
