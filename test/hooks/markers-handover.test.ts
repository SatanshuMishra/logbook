import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { readHold, takeHold } from '../../src/thread/holds.ts'
import { listMarkers, writeMarker } from '../../src/thread/inflight.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { rawGit } from '../support/git-fixture.ts'
import type { HookProcessResult } from '../support/run-hook.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime }

const mustGit = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
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
  const repo = mkdtempSync(join(tmpdir(), 'logbook-markers-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-markers-home-'))
  try {
    initRepo(repo)
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 's1' })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    await fn({ repo, home, paths: found.value, rt })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const transcriptOf = (fixture: Fixture, session: string): string => join(fixture.home, 'transcripts', `${session}.jsonl`)

const preEvent = (fixture: Fixture, session: string, fields: Record<string, unknown>): Record<string, unknown> => ({
  session_id: session,
  transcript_path: transcriptOf(fixture, session),
  cwd: fixture.repo,
  prompt_id: 'p1',
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'npm test', description: 'run the tests' },
  ...fields
})

const endEvent = (fixture: Fixture, session: string, fields: Record<string, unknown>): Record<string, unknown> => ({
  session_id: session,
  transcript_path: transcriptOf(fixture, session),
  cwd: fixture.repo,
  hook_event_name: 'SessionEnd',
  ...fields
})

const runEntry = async (fixture: Fixture, hook: string, event: Record<string, unknown>): Promise<HookProcessResult> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook, event, env: { HOME: fixture.home } })
  assert.equal(run.code, 0, run.stderr)
  return run
}

const filesUnder = (root: string): string[] => {
  const walk = (dir: string): string[] =>
    existsSync(dir)
      ? readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = join(dir, entry.name)
          return entry.isDirectory() ? walk(full) : [relative(root, full)]
        })
      : []
  return walk(root).sort()
}

const markerFile = (fixture: Fixture, toolUseId: string): string =>
  join(fixture.paths.logbookDir, 'inflight', 'fix-login', `${toolUseId}.json`)

const handoverFile = (fixture: Fixture, session: string): string =>
  join(fixture.paths.logbookDir, 'handover', `${session}.json`)

const HOLD_ONLY = [join('holds', 'fix-login.json')]

test('markers.pre-tool-use-writes-a-marker', async () => {
  await withFixture(async (fixture) => {
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    const run = await runEntry(fixture, 'pre-tool-use', preEvent(fixture, 's1', { tool_use_id: 'toolu_01' }))
    assert.equal(run.stdout, '{}')
    assert.ok(existsSync(join(fixture.paths.logbookDir, 'inflight', 'fix-login', 'toolu_01.json')))
    const [marker, ...others] = listMarkers(fixture.paths, 'fix-login')
    assert.deepEqual(others, [])
    assert.equal(marker?.tool_use_id, 'toolu_01')
    assert.equal(marker?.tool, 'Bash')
    assert.equal(marker?.session, 's1')
  })
})

test('markers.pre-tool-use-without-a-tool-use-id', async () => {
  await withFixture(async (fixture) => {
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    const missing = await runEntry(fixture, 'pre-tool-use', preEvent(fixture, 's1', {}))
    assert.equal(missing.stdout, '{}')
    const traversal = await runEntry(fixture, 'pre-tool-use', preEvent(fixture, 's1', { tool_use_id: '../x' }))
    assert.equal(traversal.stdout, '{}')
    assert.deepEqual(filesUnder(fixture.paths.logbookDir), HOLD_ONLY)
    assert.deepEqual(listMarkers(fixture.paths, 'fix-login'), [])
    const usable = await runEntry(fixture, 'pre-tool-use', preEvent(fixture, 's1', { tool_use_id: 'toolu_03' }))
    assert.equal(usable.stdout, '{}')
    assert.ok(existsSync(markerFile(fixture, 'toolu_03')))
  })
})

test('markers.pre-tool-use-ignores-a-call-inside-a-subagent', async () => {
  await withFixture(async (fixture) => {
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    const inside = await runEntry(
      fixture,
      'pre-tool-use',
      preEvent(fixture, 's1', { tool_use_id: 'toolu_02', agent_id: 'a1', agent_type: 'general-purpose' })
    )
    assert.equal(inside.stdout, '{}')
    assert.deepEqual(filesUnder(fixture.paths.logbookDir), HOLD_ONLY)
    const outside = await runEntry(fixture, 'pre-tool-use', preEvent(fixture, 's1', { tool_use_id: 'toolu_02' }))
    assert.equal(outside.stdout, '{}')
    assert.ok(existsSync(markerFile(fixture, 'toolu_02')))
  })
})

test('markers.pre-tool-use-ignores-a-session-holding-nothing', async () => {
  await withFixture(async (fixture) => {
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's9', null)
    const run = await runEntry(fixture, 'pre-tool-use', preEvent(fixture, 's1', { tool_use_id: 'toolu_04' }))
    assert.equal(run.stdout, '{}')
    assert.deepEqual(filesUnder(fixture.paths.logbookDir), HOLD_ONLY)
    const holder = await runEntry(fixture, 'pre-tool-use', preEvent(fixture, 's9', { tool_use_id: 'toolu_04' }))
    assert.equal(holder.stdout, '{}')
    assert.ok(existsSync(markerFile(fixture, 'toolu_04')))
  })
})

test('handover.session-end-clear-writes-a-handover', async () => {
  await withFixture(async (fixture) => {
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', null)
    const before = Date.now()
    const holding = await runEntry(fixture, 'session-end', endEvent(fixture, 's1', { reason: 'clear' }))
    assert.equal(holding.stdout, '{}')
    const empty = await runEntry(fixture, 'session-end', endEvent(fixture, 's2', { reason: 'clear' }))
    assert.equal(empty.stdout, '{}')
    const after = Date.now()
    assert.deepEqual(filesUnder(join(fixture.paths.logbookDir, 'handover')), ['s1.json', 's2.json'])
    const first = JSON.parse(readFileSync(handoverFile(fixture, 's1'), 'utf8'))
    const second = JSON.parse(readFileSync(handoverFile(fixture, 's2'), 'utf8'))
    const { at: firstAt, ...firstRest } = first
    const { at: secondAt, ...secondRest } = second
    assert.deepEqual(firstRest, { session: 's1', slug: 'fix-login', transcript: transcriptOf(fixture, 's1') })
    assert.deepEqual(secondRest, { session: 's2', slug: null, transcript: transcriptOf(fixture, 's2') })
    for (const at of [firstAt, secondAt]) {
      assert.equal(typeof at, 'string')
      const atMs = Date.parse(at)
      assert.ok(atMs >= before && atMs <= after, `handover time ${at} lies outside the run`)
    }
  })
})

test('handover.session-end-other-keeps-the-hold', async () => {
  await withFixture(async (fixture) => {
    takeHold(fixture.rt, fixture.paths, 'fix-login', 's1', transcriptOf(fixture, 's1'))
    writeMarker(fixture.rt, fixture.paths, 'fix-login', {
      toolUseId: 'toolu_01',
      tool: 'Bash',
      toolInput: { command: 'npm test' },
      session: 's1'
    })
    const holdBefore = readHold(fixture.paths, 'fix-login')
    assert.equal(holdBefore?.holder, 's1')
    const other = await runEntry(fixture, 'session-end', endEvent(fixture, 's1', { reason: 'other' }))
    assert.equal(other.stdout, '{}')
    const missing = await runEntry(fixture, 'session-end', endEvent(fixture, 's1', {}))
    assert.equal(missing.stdout, '{}')
    assert.equal(existsSync(join(fixture.paths.logbookDir, 'handover')), false)
    assert.deepEqual(readHold(fixture.paths, 'fix-login'), holdBefore)
    assert.ok(existsSync(markerFile(fixture, 'toolu_01')))
    const clear = await runEntry(fixture, 'session-end', endEvent(fixture, 's1', { reason: 'clear' }))
    assert.equal(clear.stdout, '{}')
    assert.ok(existsSync(handoverFile(fixture, 's1')))
  })
})
