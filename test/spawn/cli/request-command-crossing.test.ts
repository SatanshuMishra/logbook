import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { delimiter, join } from 'node:path'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { parseDocument } from '../../../src/doc/document.ts'
import { updateRequest } from '../../../src/doc/rules.ts'
import { takeHold } from '../../../src/thread/holds.ts'
import { findRepository } from '../../../src/thread/paths.ts'
import { commitDocuments } from '../../../src/thread/store.ts'
import { rawGit } from '../../support/git-fixture.ts'
import { testRuntime } from '../../support/runtime.ts'

const BIN_FOLDER = join(fileURLToPath(new URL('../../..', import.meta.url)), 'bin')
const STORED_DOCUMENT = 'refs/logbook/threads:fix-login.md'
const SPAWN_LIMIT_MS = 120000
const SESSION = 'sess-1'
const STORED_STANDING = 'The form renders but submitting it fails.'
const COMMAND_OPENING = "logbook update_thread --args - <<'EOF'"

const STATE_DOCUMENT = [
  '# fix-login: Fix the login page',
  'Status: active',
  'Updated: 2023-12-31T09:00:00.000Z',
  'Next ids: c2 D1 R1 S1',
  '',
  '## Goal',
  '',
  'Users can log in again.',
  '',
  '## Done when',
  '',
  '- [ ] c1 The login page loads.',
  '',
  '## Where things stand',
  '',
  STORED_STANDING,
  '',
  '## Next step',
  '',
  'Find the fault.',
  '',
  '## Decisions in force',
  '',
  '## Open risks',
  '',
  '## Settled, do not reopen',
  '',
  '## Where the details live',
  ''
].join('\n')

const FILLED_JSON = JSON.stringify({
  thread_id: 'fix-login',
  next_step: 'Run the release.',
  edits: [{ old_text: STORED_STANDING, new_text: 'The fix is merged.' }]
})

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const withHeldThread = (fn: (repo: string, env: Record<string, string>) => void): void => {
  const root = mkdtempSync(join(tmpdir(), 'logbook-request-command-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    const metrics = join(root, 'metrics')
    mkdirSync(repo)
    mkdirSync(home)
    mkdirSync(metrics)
    mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
    mustGit(repo, ['config', 'user.name', 'Request Tester'])
    mustGit(repo, ['config', 'user.email', 'request@logbook.test'])
    writeFileSync(join(repo, 'README.md'), 'request command test repository\n')
    mustGit(repo, ['add', 'README.md'])
    mustGit(repo, ['commit', '--quiet', '-m', 'initial commit'])
    const env = { PATH: process.env.PATH ?? '', HOME: home, PLUGIN_METRICS_DIR: metrics }
    const rt = testRuntime({ env, sessionId: SESSION })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the scratch repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: STATE_DOCUMENT, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, `the thread must be seeded: ${JSON.stringify(seeded)}`)
    takeHold(rt, found.value, 'fix-login', SESSION, null)
    fn(repo, env)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const filledCommandBlock = (): string => {
  const lines = updateRequest({
    path: '/unused/fix-login.md',
    documentText: STATE_DOCUMENT,
    reason: { kind: 'milestone', detail: 'Bash: git commit -m fix' }
  }).split('\n')
  const opening = lines.indexOf(COMMAND_OPENING)
  assert.ok(opening >= 0, 'the update request must hold the command block')
  return [lines[opening], FILLED_JSON, lines[opening + 2]].join('\n')
}

const sectionBody = (text: string, name: string): string =>
  (parseDocument(text).sections.find((section) => section.name === name)?.body ?? [])
    .filter((line) => line.trim() !== '')
    .join('\n')

test('request-command-crossing.printed-command-records-the-update', () => {
  withHeldThread((repo, env) => {
    const run = spawnSync('sh', ['-c', filledCommandBlock()], {
      cwd: repo,
      env: {
        ...env,
        PATH: `${BIN_FOLDER}${delimiter}${env.PATH}`,
        CLAUDE_CODE_SESSION_ID: SESSION,
        CLAUDE_PID: String(process.pid)
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: SPAWN_LIMIT_MS
    })
    assert.equal(run.error, undefined, `sh must start: ${String(run.error)}`)
    assert.equal(run.status, 0, `stdout ${run.stdout}, stderr ${run.stderr}`)
    const stored = mustGit(repo, ['cat-file', 'blob', STORED_DOCUMENT])
    assert.equal(sectionBody(stored, 'Where things stand'), 'The fix is merged.')
    assert.equal(sectionBody(stored, 'Next step'), 'Run the release.')
  })
})
