import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, workingCopyPath, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime }

type DocParts = {
  slug?: string
  title?: string
  status?: string
  updated?: string
  nextIds?: string
  standing?: string
  nextStep?: string
}

const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()
const EDITED_AT = new Date(Date.UTC(2026, 9, 15, 11, 30)).toISOString()
const COMMITTED_NEXT_STEP = 'Fix the submit handler. Then rerun the login tests.'
const PENDING_BLOCK_TAIL = ' Logbook has not committed it; read the working copy before acting on the next step below.'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const stateDocument = (parts: DocParts = {}): string => {
  const lines = [
    `# ${parts.slug ?? 'fix-login'}: ${parts.title ?? 'Fix the login page'}`,
    `Status: ${parts.status ?? 'active'}`,
    `Updated: ${parts.updated ?? STORED_AT}`,
    `Next ids: ${parts.nextIds ?? 'c2 D2 R1 S1'}`,
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
    parts.standing ?? 'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    parts.nextStep ?? COMMITTED_NEXT_STEP,
    '',
    '## Decisions in force',
    '',
    '- D1 Keep the session cookie: the mobile app reads it',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md'
  ]
  return `${lines.join('\n')}\n`
}

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const withFixture = async (fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-working-copy-difference-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-working-copy-difference-home-'))
  try {
    initRepo(repo)
    const rt = testRuntime({
      start: new Date().toISOString(),
      cwd: repo,
      env: { PATH: process.env.PATH, HOME: home },
      sessionId: 's1'
    })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    await fn({ repo, home, paths: found.value, rt })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const seedThreads = (fixture: Fixture, documents: Record<string, string>): void => {
  const seeded = commitDocuments(fixture.rt, fixture.paths, {
    changes: Object.entries(documents).map(([slug, text]) => ({ slug, text, expectedBlob: null })),
    message: 'open_thread: seeded'
  })
  assert.ok(seeded.ok, 'the stored documents must be seeded')
}

const workingCopyOf = (fixture: Fixture, slug: string): string => {
  const file = workingCopyPath(fixture.paths, slug)
  assert.ok(file.ok, 'the working copy path must be built')
  return file.value
}

const writeWorkingCopy = (fixture: Fixture, slug: string, text: string): string => {
  const file = workingCopyOf(fixture, slug)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
  return file
}

const writeHoldJson = (fixture: Fixture, slug: string, hold: Record<string, unknown>): void => {
  const file = join(fixture.paths.commonDir, 'logbook', 'holds', `${slug}.json`)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(hold))
}

const threadsTip = (fixture: Fixture): string => mustGit(fixture.repo, ['rev-parse', THREADS_REF]).trim()

const differenceSentence = (file: string, parts: string): string =>
  `The working copy ${file} differs from the committed document in ${parts}.`

const runStart = async (fixture: Fixture, session: string, source: string): Promise<Record<string, unknown>> => {
  const { sessionStart } = await import('../../src/hook/session-start.ts')
  const event = {
    session_id: session,
    transcript_path: join(fixture.home, 'transcripts', `${session}.jsonl`),
    cwd: fixture.repo,
    hook_event_name: 'SessionStart',
    source
  }
  const output: unknown = sessionStart({ event, sessionId: session, paths: fixture.paths, rt: fixture.rt })
  assert.ok(isRecord(output), 'sessionStart must return an object')
  return output
}

const contextOf = (output: Record<string, unknown>): string => {
  const specific = output.hookSpecificOutput
  assert.ok(isRecord(specific), `the output must carry hookSpecificOutput, got ${JSON.stringify(output)}`)
  assert.equal(typeof specific.additionalContext, 'string')
  return String(specific.additionalContext)
}

const rosterLineOf = (context: string, slug: string): string => {
  const line = context.split('\n').find((candidate) => candidate.startsWith(`${slug} - `))
  assert.ok(line !== undefined, `the roster must list ${slug}:\n${context}`)
  return line
}

test('the startup roster names an uncommitted next step instead of the committed one', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, { 'fix-login': stateDocument() })
    const file = writeWorkingCopy(fixture, 'fix-login', stateDocument({ nextStep: 'Ship the fix.' }))
    const copyBefore = readFileSync(file, 'utf8')
    const tipBefore = threadsTip(fixture)
    const context = contextOf(await runStart(fixture, 's1', 'startup'))
    const expected = `fix-login - active - Next: read the working copy. ${differenceSentence(file, 'Next step')}`
    assert.ok(context.split('\n').includes(expected), `the roster must hold the line\n${expected}\ngot:\n${context}`)
    assert.equal(context.includes('Fix the submit handler'), false, context)
    assert.equal(readFileSync(file, 'utf8'), copyBefore)
    assert.equal(threadsTip(fixture), tipBefore)
  })
})

test('the startup roster keeps the next step and names a difference elsewhere but not a header-only difference', async () => {
  await withFixture(async (fixture) => {
    seedThreads(fixture, {
      alpha: stateDocument({ slug: 'alpha', title: 'Build the parser' }),
      beta: stateDocument({ slug: 'beta', title: 'Ship the release' })
    })
    const alphaFile = writeWorkingCopy(
      fixture,
      'alpha',
      stateDocument({ slug: 'alpha', title: 'Build the parser', standing: 'The submit handler is half rewritten.' })
    )
    writeWorkingCopy(fixture, 'beta', stateDocument({ slug: 'beta', title: 'Ship the release', updated: EDITED_AT, nextIds: 'c2 D3 R2 S1' }))
    const context = contextOf(await runStart(fixture, 's1', 'startup'))
    const alphaLine = rosterLineOf(context, 'alpha')
    assert.ok(alphaLine.includes('Next: Fix the submit handler'), alphaLine)
    const alphaSentence = differenceSentence(alphaFile, 'Where things stand')
    assert.ok(alphaLine.endsWith(alphaSentence), `alpha's roster line must end with\n${alphaSentence}\ngot:\n${alphaLine}`)
    const betaLine = rosterLineOf(context, 'beta')
    assert.ok(betaLine.includes('Next: Fix the submit handler'), betaLine)
    assert.equal(betaLine.includes('differs from the committed document'), false, betaLine)
  })
})

test('the pickup names the difference right after its opening line', async () => {
  await withFixture(async (fixture) => {
    const document = stateDocument()
    seedThreads(fixture, { 'fix-login': document })
    writeHoldJson(fixture, 'fix-login', {
      slug: 'fix-login',
      holder: 's1',
      transcripts: [],
      folded_at: null,
      nudged_prompt_id: null,
      process: process.pid,
      released_from: null
    })
    const file = writeWorkingCopy(fixture, 'fix-login', stateDocument({ status: 'parked', nextStep: 'Ship the fix.' }))
    const output = await runStart(fixture, 's1', 'compact')
    const context = contextOf(output)
    const sentence = differenceSentence(file, 'Status, Next step')
    const blocks = context.split('\n\n')
    assert.equal(blocks[1], `${sentence}${PENDING_BLOCK_TAIL}`)
    const documentAt = context.indexOf(document.trimEnd())
    assert.ok(documentAt > context.indexOf(sentence), `the committed document must still follow:\n${context}`)
    assert.equal(output.systemMessage, `Logbook: Fix the login page - active. Next: read the working copy. ${sentence}`)
  })
})
