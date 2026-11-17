import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Runtime } from '../../../src/runtime/runtime.ts'
import { runTool } from '../../../src/server/register.ts'
import { resumeThreadTool } from '../../../src/server/tools/resume_thread.ts'
import { updateThreadTool } from '../../../src/server/tools/update_thread.ts'
import {
  addTranscript,
  readHold,
  releaseEndedHolds,
  takeBackHolds,
  takeHold,
  type Hold
} from '../../../src/thread/holds.ts'
import { findRepository, holdPath, type RepoPaths } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const START = '2026-11-17T09:00:00.000Z'
const SLUG = 'fix-login'
const S = 'session-s'
const A = 'session-a'
const B = 'session-b'
const C = 'session-c'

type Fixture = { scratch: string; home: string; paths: RepoPaths; runtimeFor: (session: string) => Runtime }

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const fixLogin = (): string =>
  [
    '# fix-login: Fix the login page',
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
    'The form renders but submitting it fails.',
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

const withThread = async (fn: (fixture: Fixture) => Promise<void> | void): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-provisional-hold-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Provisional Hold Tester'])
    mustGit(repo, ['config', 'user.email', 'provisional-hold@logbook.test'])
    const runtimeFor = (session: string): Runtime =>
      testRuntime({
        cwd: repo,
        env: { PATH: process.env.PATH, HOME: home, PLUGIN_METRICS_DIR: join(scratch, 'metrics') },
        sessionId: session,
        start: START
      })
    const rt = runtimeFor(S)
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: SLUG, text: fixLogin(), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, JSON.stringify(seeded))
    await fn({ scratch, home, paths: found.value, runtimeFor })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const writeHoldFile = (paths: RepoPaths, value: Record<string, unknown>): void => {
  const file = holdPath(paths, SLUG)
  assert.ok(file.ok, 'the hold path must be built')
  mkdirSync(dirname(file.value), { recursive: true })
  writeFileSync(file.value, JSON.stringify(value))
}

const releasedFromA = (paths: RepoPaths): void =>
  writeHoldFile(paths, {
    slug: SLUG,
    holder: null,
    transcripts: [],
    folded_at: null,
    nudged_prompt_id: null,
    process: null,
    released_from: A
  })

const storedHold = (paths: RepoPaths): Hold => {
  const hold = readHold(paths, SLUG)
  assert.ok(hold !== null, 'the hold of fix-login must be readable')
  return hold
}

const isProvisional = (hold: Hold): boolean => hold.provisional ?? false

const exitedProcess = (home: string): number => {
  const child = spawnSync(process.execPath, ['-e', ''], { env: { HOME: home } })
  assert.equal(child.status, 0, 'the short-lived child process must exit cleanly')
  assert.equal(typeof child.pid, 'number', 'the short-lived child process must have a process id')
  return child.pid as number
}

test('provisional-hold.take-records-it', async () => {
  await withThread(({ home, paths, runtimeFor }) => {
    const rt = runtimeFor(S)
    const transcript = join(home, 'transcripts', `${S}.jsonl`)
    takeHold(rt, paths, SLUG, S, transcript, null, { provisional: true })
    addTranscript(rt, paths, SLUG, transcript)
    const hold = storedHold(paths)
    assert.equal(hold.holder, S)
    assert.equal(isProvisional(hold), true)
    assert.deepEqual(hold.transcripts, [])
  })
})

test('provisional-hold.accepted-session-write-makes-it-full', async () => {
  await withThread(async ({ paths, runtimeFor }) => {
    const rt = runtimeFor(S)
    takeHold(rt, paths, SLUG, S, null, null, { provisional: true })
    const outcome = await runTool(rt, updateThreadTool, { thread_id: SLUG, next_step: 'Ship it.' })
    assert.equal(outcome.kind, 'ok', JSON.stringify(outcome))
    const hold = storedHold(paths)
    assert.equal(isProvisional(hold), false)
    assert.equal(hold.holder, S)
  })
})

test('provisional-hold.resume-makes-it-full', async () => {
  await withThread(async ({ paths, runtimeFor }) => {
    const rt = runtimeFor(S)
    takeHold(rt, paths, SLUG, S, null, null, { provisional: true })
    const outcome = await runTool(rt, resumeThreadTool, { thread_id: SLUG })
    assert.equal(outcome.kind, 'ok', JSON.stringify(outcome))
    const hold = storedHold(paths)
    assert.equal(isProvisional(hold), false)
    assert.equal(hold.holder, S)
  })
})

test('provisional-hold.old-hold-reads-as-full', async () => {
  await withThread(({ paths }) => {
    writeHoldFile(paths, {
      slug: SLUG,
      holder: S,
      transcripts: [],
      folded_at: START,
      nudged_prompt_id: null,
      process: null,
      released_from: null
    })
    const hold = storedHold(paths)
    assert.equal(hold.holder, S)
    assert.equal(isProvisional(hold), false)
  })
})

test('provisional-hold.release-keeps-the-earlier-owner', async () => {
  await withThread(({ home, paths, runtimeFor }) => {
    releasedFromA(paths)
    takeHold(runtimeFor(B), paths, SLUG, B, null, exitedProcess(home), { provisional: true })
    releaseEndedHolds(runtimeFor(C), paths, C)
    const hold = storedHold(paths)
    assert.equal(hold.holder, null)
    assert.equal(hold.released_from, A)
    assert.equal(isProvisional(hold), false)
  })
})

test('provisional-hold.releasing-session-takes-it-back', async () => {
  await withThread(({ paths, runtimeFor }) => {
    releasedFromA(paths)
    takeHold(runtimeFor(B), paths, SLUG, B, null, process.pid, { provisional: true })
    takeBackHolds(runtimeFor(A), paths, A)
    const hold = storedHold(paths)
    assert.equal(hold.holder, A)
    assert.equal(isProvisional(hold), false)
  })
})
