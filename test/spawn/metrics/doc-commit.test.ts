import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { rawGit } from '../../support/git-fixture.ts'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const NOTE_HEADING = '## This update'

const OPEN_ARGS = {
  slug: 'fix-login',
  title: 'Fix the login page',
  goal: 'Users can log in again.',
  next_step: 'Fix the submit handler.',
  criteria: ['The login page loads', 'Errors show under the form']
}

const DECISION_ARGS = {
  thread_id: 'fix-login',
  title: 'Keep the session cookie',
  context: 'The mobile app reads the session cookie.',
  options: ['keep the cookie', 'move to a token'],
  outcome: 'keep the cookie, because the mobile app reads it'
}

type Line = Record<string, unknown>

const COUNTS = [
  'criteria_added',
  'criteria_ticked',
  'criteria_struck',
  'criteria_reopened',
  'decisions_added',
  'decisions_removed',
  'risks_added',
  'risks_removed',
  'settled_added',
  'settled_removed'
]

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
}

const scratch = (label: string): string => mkdtempSync(join(tmpdir(), `logbook-doc-commit-${label}-`))

const makeRepo = (): string => {
  const repo = scratch('repo')
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
  return repo
}

type Folders = { repo: string; home: string; store: string }

const withServer = async (fn: (spawned: SpawnedServer, folders: Folders) => Promise<void>): Promise<void> => {
  const folders = { repo: makeRepo(), home: scratch('home'), store: scratch('store') }
  try {
    const spawned = await spawnServer({
      projectRoot: folders.repo,
      entry: ENTRY,
      env: { HOME: folders.home, PLUGIN_METRICS_DIR: folders.store, CLAUDE_CODE_SESSION_ID: 's-1' }
    })
    try {
      await fn(spawned, folders)
    } finally {
      await spawned.close()
    }
  } finally {
    for (const folder of Object.values(folders)) rmSync(folder, { recursive: true, force: true })
  }
}

const callTool = async (
  spawned: SpawnedServer,
  name: string,
  args: Record<string, unknown>
): Promise<CallToolResult> => {
  const reply = (await spawned.client.callTool({ name, arguments: args })) as CallToolResult
  assert.equal(reply.isError, undefined, `expected ${name} to succeed, got: ${JSON.stringify(reply)}`)
  return reply
}

const openFixLogin = async (spawned: SpawnedServer): Promise<string> => {
  const reply = await callTool(spawned, 'open_thread', OPEN_ARGS)
  const file = (reply.structuredContent as Line | undefined)?.path
  assert.equal(typeof file, 'string', JSON.stringify(reply))
  return String(file)
}

const linesOf = (file: string): Line[] =>
  readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Line)

const docCommits = (folders: Folders): Line[] => {
  const folder = join(folders.store, 'plugin=logbook', 'kind=event', `repo=${basename(folders.repo)}`)
  const files = existsSync(folder) ? readdirSync(folder).filter((name) => name.startsWith('fix-login.')) : []
  return files.flatMap((name) => linesOf(join(folder, name))).filter((line) => line.event === 'doc.commit')
}

const lastDocCommit = (folders: Folders): Line => {
  const line = docCommits(folders).at(-1)
  assert.ok(line !== undefined, 'the run must hold a doc.commit line')
  return line
}

const countsOf = (line: Line): Line => Object.fromEntries(COUNTS.map((name) => [name, line[name]]))

const zeroCountsWith = (counts: Line): Line => ({ ...Object.fromEntries(COUNTS.map((name) => [name, 0])), ...counts })

const withoutNote = (text: string): string => {
  const index = text.indexOf(`\n${NOTE_HEADING}\n`)
  return index < 0 ? text : `${text.slice(0, index).replace(/\n+$/, '')}\n`
}

const editWorkingCopy = (file: string, edit: (lines: string[]) => string[], note: readonly string[]): void => {
  const kept = withoutNote(readFileSync(file, 'utf8')).replace(/\n+$/, '').split('\n')
  const tail = note.length === 0 ? [] : ['', NOTE_HEADING, '', ...note]
  writeFileSync(file, `${[...edit(kept), ...tail].join('\n')}\n`)
}

test('metrics.tool-commit-counts-decision', async () => {
  await withServer(async (spawned, folders) => {
    await openFixLogin(spawned)
    await callTool(spawned, 'record_decision', DECISION_ARGS)
    const line = lastDocCommit(folders)
    assert.equal(line.via, 'record_decision')
    assert.deepEqual(countsOf(line), zeroCountsWith({ decisions_added: 1 }))
  })
})

test('metrics.update-commit-counts-tick-and-risks', async () => {
  await withServer(async (spawned, folders) => {
    await openFixLogin(spawned)
    await callTool(spawned, 'update_thread', {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c1', result: 'the login test passed' }],
      risks_add: [{ text: 'The staging database may be stale' }, { text: 'The cookie may expire early' }]
    })
    const line = lastDocCommit(folders)
    assert.equal(line.via, 'update_thread')
    assert.deepEqual(countsOf(line), zeroCountsWith({ criteria_ticked: 1, risks_added: 2 }))
  })
})

test('metrics.edit-commit-counts-strike-and-removal', async () => {
  await withServer(async (spawned, folders) => {
    const file = await openFixLogin(spawned)
    await callTool(spawned, 'update_thread', {
      thread_id: 'fix-login',
      risks_add: [{ text: 'The staging database may be stale' }]
    })
    editWorkingCopy(
      file,
      (lines) =>
        lines
          .filter((line) => !line.startsWith('- R1 '))
          .map((line) =>
            line.startsWith('- [ ] c2 ')
              ? `${line.replace('- [ ] c2 ', '- [~] c2 ')} struck: moved to another thread`
              : line
          ),
      ['Removed: R1 because it no longer applies']
    )
    await callTool(spawned, 'resume_thread', { thread_id: 'fix-login' })
    const edits = docCommits(folders).filter((line) => line.via === 'edit')
    assert.deepEqual(edits.map(countsOf), [zeroCountsWith({ criteria_struck: 1, risks_removed: 1 })])
  })
})

test('metrics.edit-commit-counts-reopen', async () => {
  await withServer(async (spawned, folders) => {
    const file = await openFixLogin(spawned)
    await callTool(spawned, 'update_thread', {
      thread_id: 'fix-login',
      criteria_done: [{ criterion_id: 'c1', result: 'the login test passed' }]
    })
    editWorkingCopy(
      file,
      (lines) =>
        lines.map((line) =>
          line.startsWith('- [x] c1 ') ? `${line.replace('- [x] c1 ', '- [ ] c1 ')} reopened: the fix regressed` : line
        ),
      []
    )
    await callTool(spawned, 'resume_thread', { thread_id: 'fix-login' })
    const edits = docCommits(folders).filter((line) => line.via === 'edit')
    assert.deepEqual(edits.map(countsOf), [zeroCountsWith({ criteria_reopened: 1 })])
  })
})
