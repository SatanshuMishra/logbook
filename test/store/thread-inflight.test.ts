import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { rawGit, withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const STEP_MS = 1000
const START = new Date(Date.UTC(2026, 3, 5, 6, 7, 8)).toISOString()
const SECOND = new Date(Date.parse(START) + STEP_MS).toISOString()

type Thread = { repo: string; home: string; paths: RepoPaths; rt: Runtime }

const withThread = (fn: (thread: Thread) => void): void => {
  withRepo((repo) => {
    const home = mkdtempSync(join(tmpdir(), 'logbook-inflight-home-'))
    try {
      const env = { PATH: process.env.PATH, HOME: home }
      const found = findRepository(testRuntime({ cwd: repo, env }), repo)
      assert.ok(found.ok, 'the fixture repository should be found')
      const rt = testRuntime({ cwd: repo, env, sessionId: 'session-one', start: START, stepMs: STEP_MS })
      fn({ repo, home, paths: found.value, rt })
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
}

const markerFolder = (repo: string): string => join(repo, '.git', 'logbook', 'inflight', 'fix-login')

test('inflight.writes-a-marker', async () => {
  const { writeMarker } = await import('../../src/thread/inflight.ts')
  withThread(({ repo, paths, rt }) => {
    const written = writeMarker(rt, paths, 'fix-login', {
      toolUseId: 'toolu_01',
      tool: 'Bash',
      toolInput: { command: 'npm test' },
      session: 'session-one'
    })
    assert.equal(written, true)
    const file = join(markerFolder(repo), 'toolu_01.json')
    assert.ok(existsSync(file), 'inflight/fix-login/toolu_01.json should exist')
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), {
      tool_use_id: 'toolu_01',
      tool: 'Bash',
      summary: 'npm test',
      started_at: START,
      session: 'session-one'
    })
  })
})

test('inflight.refuses-an-unsafe-tool-use-id', async () => {
  const { writeMarker } = await import('../../src/thread/inflight.ts')
  withThread(({ repo, home, paths, rt }) => {
    const unsafe = ['../x', 'a/b', '', 'a'.repeat(129)]
    for (const toolUseId of unsafe) {
      const written = writeMarker(rt, paths, 'fix-login', {
        toolUseId,
        tool: 'Bash',
        toolInput: { command: 'npm test' },
        session: 'session-one'
      })
      assert.equal(written, false, `tool use id ${JSON.stringify(toolUseId)} should be refused`)
    }
    assert.equal(existsSync(join(repo, '.git', 'logbook')), false)
    assert.deepEqual(readdirSync(home), [])
    const status = rawGit(repo, ['status', '--porcelain', '--ignored'])
    assert.equal(status.status, 0)
    assert.equal(status.stdout, '')
  })
})

test('inflight.clears-a-marker', async () => {
  const { clearMarker, writeMarker } = await import('../../src/thread/inflight.ts')
  withThread(({ repo, paths, rt }) => {
    const written = writeMarker(rt, paths, 'fix-login', {
      toolUseId: 'toolu_01',
      tool: 'Bash',
      toolInput: { command: 'npm test' },
      session: 'session-one'
    })
    assert.equal(written, true)
    const file = join(markerFolder(repo), 'toolu_01.json')
    assert.ok(existsSync(file), 'the marker should exist before it is cleared')
    clearMarker(paths, 'fix-login', 'toolu_01')
    assert.equal(existsSync(file), false)
  })
})

test('inflight.clearing-a-missing-marker-succeeds', async () => {
  const { clearMarker } = await import('../../src/thread/inflight.ts')
  withThread(({ paths }) => {
    assert.doesNotThrow(() => clearMarker(paths, 'fix-login', 'toolu_01'))
  })
})

test('inflight.lists-markers-and-skips-broken-files', async () => {
  const { listMarkers, writeMarker } = await import('../../src/thread/inflight.ts')
  withThread(({ repo, paths, rt }) => {
    writeMarker(rt, paths, 'fix-login', {
      toolUseId: 'toolu_01',
      tool: 'Bash',
      toolInput: { command: 'npm test' },
      session: 'session-one'
    })
    writeMarker(rt, paths, 'fix-login', {
      toolUseId: 'toolu_02',
      tool: 'Agent',
      toolInput: { description: 'review the diff' },
      session: 'session-one'
    })
    writeFileSync(join(markerFolder(repo), 'toolu_03.json'), '{')
    assert.deepEqual(listMarkers(paths, 'fix-login'), [
      { tool_use_id: 'toolu_01', tool: 'Bash', summary: 'npm test', started_at: START, session: 'session-one' },
      { tool_use_id: 'toolu_02', tool: 'Agent', summary: 'review the diff', started_at: SECOND, session: 'session-one' }
    ])
  })
})

test('inflight.sweeps-other-sessions', async () => {
  const { listMarkers, sweepMarkers, writeMarker } = await import('../../src/thread/inflight.ts')
  withThread(({ repo, paths, rt }) => {
    writeMarker(rt, paths, 'fix-login', {
      toolUseId: 'toolu_01',
      tool: 'Bash',
      toolInput: { command: 'npm test' },
      session: 's1'
    })
    writeMarker(rt, paths, 'fix-login', {
      toolUseId: 'toolu_02',
      tool: 'Bash',
      toolInput: { command: 'npm run lint' },
      session: 's2'
    })
    sweepMarkers(paths, 'fix-login', 's2')
    assert.deepEqual(readdirSync(markerFolder(repo)), ['toolu_02.json'])
    assert.deepEqual(listMarkers(paths, 'fix-login'), [
      { tool_use_id: 'toolu_02', tool: 'Bash', summary: 'npm run lint', started_at: SECOND, session: 's2' }
    ])
  })
})
