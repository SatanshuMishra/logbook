import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, type RepoPaths } from '../../src/thread/paths.ts'
import { withRepo } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const TRANSCRIPT_DIR = '/home/tester/.claude/projects/-home-tester-my-app'
const t1 = `${TRANSCRIPT_DIR}/s1.jsonl`
const t2 = `${TRANSCRIPT_DIR}/s2.jsonl`
const t3 = `${TRANSCRIPT_DIR}/s3.jsonl`

const minuteOfDay = (minute: number): string => new Date(Date.UTC(2026, 9, 14, 9, minute)).toISOString()

const withHolds = <T>(fn: (rt: Runtime, paths: RepoPaths, repo: string) => T): T =>
  withRepo((repo) => {
    const home = mkdtempSync(join(tmpdir(), 'logbook-holds-home-'))
    try {
      const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home } })
      const found = findRepository(rt, repo)
      assert.ok(found.ok, 'the fixture repository must be found')
      return fn(rt, found.value, repo)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

const holdsDir = (paths: RepoPaths): string => join(paths.logbookDir, 'holds')

const holdFile = (paths: RepoPaths, slug: string): string => join(holdsDir(paths), `${slug}.json`)

const redirectFile = (paths: RepoPaths, session: string): string => join(paths.logbookDir, 'sessions', `${session}.json`)

const writeRaw = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const writeHoldFile = (paths: RepoPaths, slug: string, hold: Record<string, unknown>): void =>
  writeRaw(holdFile(paths, slug), JSON.stringify(hold))

const readStored = (file: string): unknown => JSON.parse(readFileSync(file, 'utf8'))

test('holds.take-an-unheld-thread', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths, repo) => {
    const expected = { slug: 'fix-login', holder: 's1', transcripts: [t1], folded_at: null, nudged_prompt_id: null }
    const taken = holds.takeHold(rt, paths, 'fix-login', 's1', t1)
    assert.deepEqual(taken, expected)
    const stored = join(realpathSync(repo), '.git', 'logbook', 'holds', 'fix-login.json')
    assert.ok(existsSync(stored), `expected the hold at ${stored}`)
    assert.deepEqual(readStored(stored), expected)
    assert.deepEqual(holds.readHold(paths, 'fix-login'), expected)
    assert.equal(holds.heldBy(paths, 's1'), 'fix-login')
  })
})

test('holds.take-a-thread-another-session-held', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    const f = minuteOfDay(5)
    writeHoldFile(paths, 'fix-login', {
      slug: 'fix-login',
      holder: 's1',
      transcripts: [t1],
      folded_at: f,
      nudged_prompt_id: null
    })
    const taken = holds.takeHold(rt, paths, 'fix-login', 's2', t2)
    const expected = { slug: 'fix-login', holder: 's2', transcripts: [t1, t2], folded_at: f, nudged_prompt_id: null }
    assert.deepEqual(taken, expected)
    assert.deepEqual(readStored(holdFile(paths, 'fix-login')), expected)
    assert.equal(holds.heldBy(paths, 's1'), null)
    assert.equal(holds.heldBy(paths, 's2'), 'fix-login')
  })
})

test('holds.take-a-released-thread', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    writeHoldFile(paths, 'fix-login', {
      slug: 'fix-login',
      holder: null,
      transcripts: [t1],
      folded_at: null,
      nudged_prompt_id: null
    })
    const taken = holds.takeHold(rt, paths, 'fix-login', 's2', t2)
    assert.equal(taken.holder, 's2')
    assert.deepEqual(taken.transcripts, [t1, t2])
    const stored = readStored(holdFile(paths, 'fix-login')) as Record<string, unknown>
    assert.equal(stored.holder, 's2')
    assert.deepEqual(stored.transcripts, [t1, t2])
  })
})

test('holds.take-again-by-the-holder', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    const given = { slug: 'fix-login', holder: 's1', transcripts: [t1], folded_at: null, nudged_prompt_id: null }
    writeHoldFile(paths, 'fix-login', given)
    const before = readFileSync(holdFile(paths, 'fix-login'), 'utf8')
    const taken = holds.takeHold(rt, paths, 'fix-login', 's1', t1)
    assert.deepEqual(taken, given)
    assert.equal(readFileSync(holdFile(paths, 'fix-login'), 'utf8'), before)
  })
})

test('holds.taking-releases-the-sessions-other-thread', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    writeHoldFile(paths, 'alpha', { slug: 'alpha', holder: 's1', transcripts: [t1], folded_at: null, nudged_prompt_id: null })
    holds.takeHold(rt, paths, 'beta', 's1', t1)
    assert.deepEqual(readStored(holdFile(paths, 'beta')), {
      slug: 'beta',
      holder: 's1',
      transcripts: [t1],
      folded_at: null,
      nudged_prompt_id: null
    })
    assert.deepEqual(readStored(holdFile(paths, 'alpha')), {
      slug: 'alpha',
      holder: null,
      transcripts: [t1],
      folded_at: null,
      nudged_prompt_id: null
    })
    assert.equal(holds.heldBy(paths, 's1'), 'beta')
  })
})

test('holds.taking-with-no-other-thread', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    writeHoldFile(paths, 'alpha', { slug: 'alpha', holder: 's2', transcripts: [t2], folded_at: null, nudged_prompt_id: null })
    const alphaBefore = readFileSync(holdFile(paths, 'alpha'), 'utf8')
    const alphaInode = statSync(holdFile(paths, 'alpha')).ino
    holds.takeHold(rt, paths, 'beta', 's1', t1)
    assert.deepEqual(readdirSync(holdsDir(paths)).sort(), ['alpha.json', 'beta.json'])
    assert.equal(readFileSync(holdFile(paths, 'alpha'), 'utf8'), alphaBefore)
    assert.equal(statSync(holdFile(paths, 'alpha')).ino, alphaInode)
    assert.deepEqual(readStored(holdFile(paths, 'beta')), {
      slug: 'beta',
      holder: 's1',
      transcripts: [t1],
      folded_at: null,
      nudged_prompt_id: null
    })
  })
})

test('holds.hook-adds-a-new-transcript', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    writeHoldFile(paths, 'fix-login', {
      slug: 'fix-login',
      holder: 's1',
      transcripts: [t1],
      folded_at: null,
      nudged_prompt_id: null
    })
    const added = holds.addTranscript(rt, paths, 'fix-login', t3)
    assert.deepEqual(added?.transcripts, [t1, t3])
    const stored = readStored(holdFile(paths, 'fix-login')) as Record<string, unknown>
    assert.deepEqual(stored.transcripts, [t1, t3])
    assert.equal(stored.holder, 's1')
  })
})

test('holds.accept-folds-and-clears-the-nudge', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    const p = randomUUID()
    const a = minuteOfDay(30)
    writeHoldFile(paths, 'fix-login', {
      slug: 'fix-login',
      holder: 's2',
      transcripts: [t1, t2],
      folded_at: minuteOfDay(5),
      nudged_prompt_id: p
    })
    const folded = holds.foldHold(rt, paths, 'fix-login', a)
    const expected = { slug: 'fix-login', holder: 's2', transcripts: [t2], folded_at: a, nudged_prompt_id: null }
    assert.deepEqual(folded, expected)
    assert.deepEqual(readStored(holdFile(paths, 'fix-login')), expected)
  })
})

test('holds.release-keeps-the-transcripts', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    const f = minuteOfDay(5)
    writeHoldFile(paths, 'fix-login', {
      slug: 'fix-login',
      holder: 's1',
      transcripts: [t1],
      folded_at: f,
      nudged_prompt_id: null
    })
    const released = holds.releaseHold(rt, paths, 'fix-login')
    const expected = { slug: 'fix-login', holder: null, transcripts: [t1], folded_at: f, nudged_prompt_id: null }
    assert.deepEqual(released, expected)
    assert.deepEqual(readStored(holdFile(paths, 'fix-login')), expected)
    assert.equal(holds.heldBy(paths, 's1'), null)
  })
})

test('holds.redirects-lead-to-the-newest-session', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    holds.writeRedirect(rt, paths, 's1', 's2')
    holds.writeRedirect(rt, paths, 's2', 's3')
    holds.writeRedirect(rt, paths, 's4', 's5')
    holds.writeRedirect(rt, paths, 's5', 's4')
    assert.deepEqual(readStored(redirectFile(paths, 's1')), { session: 's2' })
    assert.deepEqual(readStored(redirectFile(paths, 's2')), { session: 's3' })
    assert.equal(holds.actingSession(paths, 's1'), 's3')
    assert.equal(holds.actingSession(paths, 's3'), 's3')
    assert.equal(holds.actingSession(paths, 's4'), 's5')
  })
})

test('holds.broken-redirect-ends-the-chain', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((_rt, paths) => {
    for (const text of ['{', JSON.stringify({ session: 3 })]) {
      writeRaw(redirectFile(paths, 's1'), text)
      assert.equal(holds.actingSession(paths, 's1'), 's1', `sessions/s1.json holding ${text}`)
    }
  })
})

test('holds.reads-a-broken-hold-as-no-hold', async () => {
  const holds = await import('../../src/thread/holds.ts')
  withHolds((rt, paths) => {
    for (const text of ['{', JSON.stringify({ slug: 3 })]) {
      writeRaw(holdFile(paths, 'fix-login'), text)
      assert.equal(holds.readHold(paths, 'fix-login'), null, `holds/fix-login.json holding ${text}`)
      for (const session of ['s1', 's2']) {
        assert.equal(holds.heldBy(paths, session), null, `holds/fix-login.json holding ${text}, session ${session}`)
      }
      const expected = { slug: 'fix-login', holder: 's1', transcripts: [t1], folded_at: null, nudged_prompt_id: null }
      assert.deepEqual(holds.takeHold(rt, paths, 'fix-login', 's1', t1), expected)
      assert.deepEqual(readStored(holdFile(paths, 'fix-login')), expected)
    }
  })
})
