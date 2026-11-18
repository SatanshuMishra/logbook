import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { stop, type StopOutput } from '../../src/hook/stop.ts'
import { findRepository, holdPath, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const SLUG = 'fix-login'
const S = 'session-s'
const FOLDED_MS = Date.UTC(2026, 10, 17, 9, 0)
const FOLDED_AT = new Date(FOLDED_MS).toISOString()
const AFTER = new Date(FOLDED_MS + 60_000).toISOString()
const PROVISIONAL_LINE =
  'Logbook picked this thread up at session start; record only work that belongs to thread fix-login.'

type Line = Record<string, unknown>

type Fixture = { repo: string; paths: RepoPaths; rt: Runtime; transcript: string }

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const fixLogin = (): string =>
  [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${FOLDED_AT}`,
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

const writeJsonFile = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const withProvisionalHold = async (fn: (fixture: Fixture) => void): Promise<void> => {
  const scratch = mkdtempSync(join(tmpdir(), 'logbook-stop-provisional-'))
  try {
    const repo = join(scratch, 'repo')
    const home = join(scratch, 'home')
    mkdirSync(repo)
    mkdirSync(home)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Stop Provisional Tester'])
    mustGit(repo, ['config', 'user.email', 'stop-provisional@logbook.test'])
    const rt = testRuntime({
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: home, PLUGIN_METRICS_DIR: join(scratch, 'metrics') },
      sessionId: S
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: SLUG, text: fixLogin(), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, JSON.stringify(seeded))
    const file = holdPath(found.value, SLUG)
    assert.ok(file.ok, 'the hold path must be built')
    writeJsonFile(
      file.value,
      JSON.stringify({
        slug: SLUG,
        holder: S,
        transcripts: [],
        folded_at: FOLDED_AT,
        nudged_prompt_id: null,
        process: null,
        released_from: null,
        provisional: true
      })
    )
    fn({ repo, paths: found.value, rt, transcript: join(home, 'transcripts', `${S}.jsonl`) })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

const writeTranscript = (file: string, lines: readonly Line[]): void =>
  writeJsonFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`)

const assistantContent = (content: Record<string, unknown>, timestamp: string): Line => ({
  type: 'assistant',
  timestamp,
  message: { role: 'assistant', content: [content] }
})

const runStop = (fixture: Fixture): StopOutput =>
  stop({
    event: {
      session_id: S,
      transcript_path: fixture.transcript,
      cwd: fixture.repo,
      hook_event_name: 'Stop',
      stop_hook_active: false
    },
    sessionId: S,
    paths: fixture.paths,
    rt: fixture.rt
  })

const contextOf = (output: StopOutput): string | undefined =>
  'hookSpecificOutput' in output ? output.hookSpecificOutput.additionalContext : undefined

test('stop-provisional.first-changed-turn-asks-once', async () => {
  await withProvisionalHold((fixture) => {
    writeTranscript(fixture.transcript, [
      assistantContent(
        { type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'npm run build' } },
        AFTER
      ),
      {
        type: 'user',
        timestamp: AFTER,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: 'built' }] }
      }
    ])
    const first = contextOf(runStop(fixture))
    assert.equal(typeof first, 'string', 'the first stop must make an update request')
    assert.ok(first?.split('\n').includes(PROVISIONAL_LINE), first)
    assert.equal(contextOf(runStop(fixture)), undefined)
  })
})

test('stop-provisional.unchanged-turn-asks-nothing', async () => {
  await withProvisionalHold((fixture) => {
    writeTranscript(fixture.transcript, [assistantContent({ type: 'text', text: 'Nothing to change.' }, AFTER)])
    assert.equal(contextOf(runStop(fixture)), undefined)
  })
})
