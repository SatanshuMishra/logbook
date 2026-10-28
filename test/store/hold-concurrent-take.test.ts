import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { takeHold } from '../../src/thread/holds.ts'
import { withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const holdFile = (paths: RepoPaths, slug: string): string => join(paths.logbookDir, 'holds', `${slug}.json`)

const holdJson = (slug: string, holder: string | null, processId: number | null, releasedFrom: string | null): string =>
  JSON.stringify({ slug, holder, transcripts: [], folded_at: null, nudged_prompt_id: null, process: processId, released_from: releasedFrom })

const takenAfterFirstRead = (file: string, takenJson: string, act: () => void): void => {
  const original = fs.readFileSync
  let reads = 0
  fs.readFileSync = ((target: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    const result = (original as (...args: unknown[]) => unknown)(target, ...rest)
    if (String(target) === file && ++reads === 1) fs.writeFileSync(file, takenJson)
    return result
  }) as typeof fs.readFileSync
  syncBuiltinESMExports()
  try {
    act()
  } finally {
    fs.readFileSync = original
    syncBuiltinESMExports()
  }
}

for (const [label, seededHolder, seededReleasedFrom] of [
  ['released from the taking session', null, 'session-s'],
  ['held by the taking session', 'session-s', null]
] as const) {
  test(`taking a hold keeps another session's take of a hold ${label} made after the scan`, () =>
    withRepo((repo) => {
      const home = fs.mkdtempSync(join(tmpdir(), 'logbook-concurrent-take-home-'))
      try {
        const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home } })
        const found = findRepository(rt, repo)
        assert.ok(found.ok)
        const alpha = holdFile(found.value, 'alpha')
        fs.mkdirSync(join(found.value.logbookDir, 'holds'), { recursive: true })
        fs.writeFileSync(alpha, holdJson('alpha', seededHolder, null, seededReleasedFrom))
        takenAfterFirstRead(alpha, holdJson('alpha', 'session-t', process.pid, null), () =>
          takeHold(rt, found.value, 'beta', 'session-s', null, process.pid)
        )
        const stored = JSON.parse(fs.readFileSync(alpha, 'utf8'))
        assert.equal(stored.holder, 'session-t')
        assert.equal(stored.process, process.pid)
      } finally {
        fs.rmSync(home, { recursive: true, force: true })
      }
    }))
}
