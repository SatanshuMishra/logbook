import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, type Dirent } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import type { Declared } from '../../src/schema/declare.ts'
import { DecisionRecord, type Decision } from '../../src/schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../../src/schema/session.ts'
import { ThreadRecord, type Thread } from '../../src/schema/thread.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import type { RecordChange } from '../../src/store/write-path.ts'
import { sync } from '../../src/merge/sync.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { Teammate } from '../support/clone-fixture.ts'
import { withTwoClones } from '../support/clone-fixture.ts'

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')
const RECORDS_MODULE = path.join(SRC_ROOT, 'store', 'records.ts')

const ANA_DECISION_ULID_PREFIX = '01ANADEC01'
const BEN_DECISION_ULID_PREFIX = '01BENDEC01'
const ANA_ROUND2_ULID_PREFIX = '01ANADEC02'
const BEN_ROUND2_ULID_PREFIX = '01BENDEC02'
const ANA_RACE_ULID_PREFIX = '01ANARACE1'
const BEN_RACE_ULID_PREFIX = '01BENRACE1'
const CONFLICT_MARKERS = ['<<<<<<<', '=======', '>>>>>>>']

const layoutIn = (teammate: Teammate): StoreLayout => {
  const result = layoutFor(teammate.rt, teammate.repo)
  assert.equal(result.ok, true)
  if (!result.ok) throw new Error('expected layoutFor to succeed')
  return result.value
}

const makeThread = (rt: Runtime, slug: string): RecordChange => ({
  kind: 'thread',
  record: {
    id: rt.ulid(),
    slug,
    title: `thread ${slug}`,
    status: 'open',
    blocked_by: null,
    completion_criteria: [],
    spine: {
      active_goal: 'goal',
      next_step: 'next',
      last_session: 'last',
      open_risks: [],
      key_decisions: [],
      out_of_scope: []
    },
    created_at: rt.now(),
    updated_at: rt.now()
  }
})

const buildDecisionRecorderScript = (params: {
  repo: string
  pluginData: string
  threadId: string
  actor: string
  ulidPrefix: string
  title: string
}): string => `
import { openStore } from ${JSON.stringify(RECORDS_MODULE)}

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const encodeMonotonicSuffix = (seq) => {
  let value = seq
  const chars = []
  for (let i = 0; i < 16; i += 1) {
    chars.unshift(CROCKFORD_ALPHABET[value % 32])
    value = Math.floor(value / 32)
  }
  return chars.join('')
}

const repo = ${JSON.stringify(params.repo)}
const pluginData = ${JSON.stringify(params.pluginData)}
const threadId = ${JSON.stringify(params.threadId)}
const actor = ${JSON.stringify(params.actor)}
const ulidPrefix = ${JSON.stringify(params.ulidPrefix)}
const title = ${JSON.stringify(params.title)}

let ulidSeq = 0
const rt = {
  now: () => new Date().toISOString(),
  ulid: () => {
    const suffix = encodeMonotonicSuffix(ulidSeq)
    ulidSeq += 1
    return ulidPrefix + suffix
  },
  env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData },
  cwd: repo,
  log: () => {}
}

const opened = openStore(rt, repo)
if (!opened.ok) {
  process.stderr.write('open-store-failed: ' + opened.message + '\\n')
  process.exit(1)
}

const decision = {
  id: rt.ulid(),
  thread_id: threadId,
  title,
  context: actor + ' recorded this while offline',
  options: ['keep it simple', 'add more detail'],
  outcome: actor + ' chose to keep it simple',
  commit: null,
  supersedes: [],
  created_at: rt.now()
}

const result = opened.value.commit([{ kind: 'decision', record: decision }], actor + ': record decision offline')
if (!result.ok) {
  process.stderr.write('commit-failed: ' + result.detail + '\\n')
  process.exit(1)
}

process.stdout.write(JSON.stringify({ id: decision.id }))
`

const recordDecisionInSeparateProcess = (
  teammate: Teammate,
  threadId: string,
  actor: string,
  ulidPrefix: string,
  title: string
): string => {
  const pluginData = teammate.rt.env.CLAUDE_PLUGIN_DATA
  if (pluginData === undefined) {
    throw new Error(`teammate ${actor} has no CLAUDE_PLUGIN_DATA in its runtime environment`)
  }
  const scriptDir = mkdtempSync(path.join(tmpdir(), `logbook-decision-child-${actor}-`))
  const scriptPath = path.join(scriptDir, 'record-decision.mjs')
  writeFileSync(
    scriptPath,
    buildDecisionRecorderScript({ repo: teammate.repo, pluginData, threadId, actor, ulidPrefix, title }),
    'utf8'
  )
  try {
    const result = spawnSync(process.execPath, [scriptPath], { encoding: 'utf8', timeout: 15000 })
    assert.equal(result.status, 0, `decision-recording child for ${actor} failed: ${result.stderr}`)
    const parsed = JSON.parse(result.stdout.trim()) as { id: string }
    return parsed.id
  } finally {
    rmSync(scriptDir, { recursive: true, force: true })
  }
}

const collectJsonFiles = (dir: string): string[] => {
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(dir, { withFileTypes: true, encoding: 'utf8' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const files: string[] = []
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...collectJsonFiles(full))
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(full)
    }
  }
  return files
}

const listRecordFileIds = (dir: string): string[] => {
  let names: string[]
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.json'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return names.map((name) => name.slice(0, -'.json'.length))
}

const declaredFor = (
  filePath: string,
  layout: StoreLayout
): Declared<Thread> | Declared<Decision> | Declared<SessionEntry> => {
  const relative = path.relative(layout.records, filePath)
  const collection = relative.split(path.sep)[0]
  if (collection === 'threads') return ThreadRecord
  if (collection === 'decisions') return DecisionRecord
  if (collection === 'sessions') return SessionRecord
  throw new Error(`unclassifiable record path: ${relative}`)
}

const assertRecordsAreClean = (layout: StoreLayout): void => {
  const files = collectJsonFiles(layout.records)
  assert.ok(files.length > 0, 'expected at least one record file to inspect')
  for (const file of files) {
    const raw = readFileSync(file, 'utf8')
    for (const marker of CONFLICT_MARKERS) {
      assert.equal(raw.includes(marker), false, `${file} contains a conflict marker`)
    }
    let parsedJson: unknown = null
    let jsonError: string | null = null
    try {
      parsedJson = JSON.parse(raw)
    } catch (error) {
      jsonError = error instanceof Error ? error.message : String(error)
    }
    assert.equal(jsonError, null, `${file} is not valid JSON: ${jsonError}`)
    const declared = declaredFor(file, layout)
    const parsed = declared.parse(parsedJson)
    assert.equal(parsed.ok, true, `${file} failed schema validation`)
  }
}

const decisionReachableOnRemote = (rt: Runtime, remote: string, decisionId: string): boolean =>
  git(rt, remote, ['cat-file', '-e', `${LEDGER_REF}:decisions/${decisionId}.json`]).ok

const runOfflineMergeScenario = (pusherFirst: 'ana' | 'ben'): void => {
  withTwoClones((ana, ben, remote) => {
    const anaLayout = layoutIn(ana)
    const benLayout = layoutIn(ben)

    const sharedThread = makeThread(ana.rt, 'two-clones-thread')
    const createdThread = ana.store.commit([sharedThread], 'ana: create shared thread')
    assert.equal(createdThread.ok, true)

    const initialPush = sync(ana.rt, ana.store, anaLayout)
    assert.equal(initialPush.ok, true)

    const initialFastForward = sync(ben.rt, ben.store, benLayout)
    assert.equal(initialFastForward.ok, true)

    ana.goOffline()
    ben.goOffline()

    const anaDecisionId = recordDecisionInSeparateProcess(
      ana,
      sharedThread.record.id,
      'ana',
      ANA_DECISION_ULID_PREFIX,
      'ana records a decision offline'
    )
    const benDecisionId = recordDecisionInSeparateProcess(
      ben,
      sharedThread.record.id,
      'ben',
      BEN_DECISION_ULID_PREFIX,
      'ben records a decision offline'
    )

    assert.notEqual(anaDecisionId, benDecisionId)

    ana.goOnline()
    ben.goOnline()

    const first = pusherFirst === 'ana' ? ana : ben
    const second = pusherFirst === 'ana' ? ben : ana
    const firstLayout = pusherFirst === 'ana' ? anaLayout : benLayout
    const secondLayout = pusherFirst === 'ana' ? benLayout : anaLayout
    const firstDecisionId = pusherFirst === 'ana' ? anaDecisionId : benDecisionId
    const secondDecisionId = pusherFirst === 'ana' ? benDecisionId : anaDecisionId

    const firstSync = sync(first.rt, first.store, firstLayout)
    assert.equal(firstSync.ok, true)

    const secondSync = sync(second.rt, second.store, secondLayout)
    assert.equal(secondSync.ok, true)
    if (!secondSync.ok) return

    const decisionFileIds = listRecordFileIds(path.join(secondLayout.records, 'decisions'))
    assert.equal(decisionFileIds.length, 2)
    assert.deepEqual(new Set(decisionFileIds), new Set([firstDecisionId, secondDecisionId]))

    const secondSeesFirst = second.store.readDecision(firstDecisionId)
    assert.ok(secondSeesFirst !== null)
    const secondSeesSecond = second.store.readDecision(secondDecisionId)
    assert.ok(secondSeesSecond !== null)

    assertRecordsAreClean(secondLayout)

    assert.equal(secondSeesFirst?.quarantined, false)
    assert.equal(secondSeesSecond?.quarantined, false)

    const firstConverged = sync(first.rt, first.store, firstLayout)
    assert.equal(firstConverged.ok, true)
    const firstSeesSecond = first.store.readDecision(secondDecisionId)
    assert.ok(firstSeesSecond !== null && !firstSeesSecond.quarantined)

    const firstActorName = pusherFirst
    const secondActorName: 'ana' | 'ben' = pusherFirst === 'ana' ? 'ben' : 'ana'
    const secondRound2Prefix = secondActorName === 'ana' ? ANA_ROUND2_ULID_PREFIX : BEN_ROUND2_ULID_PREFIX
    const firstRacePrefix = firstActorName === 'ana' ? ANA_RACE_ULID_PREFIX : BEN_RACE_ULID_PREFIX

    recordDecisionInSeparateProcess(
      second,
      sharedThread.record.id,
      secondActorName,
      secondRound2Prefix,
      `${secondActorName} records another decision after converging`
    )

    let raceDecisionId: string | null = null
    const beforeSecondCas = (): void => {
      if (raceDecisionId !== null) return
      raceDecisionId = recordDecisionInSeparateProcess(
        first,
        sharedThread.record.id,
        firstActorName,
        firstRacePrefix,
        `${firstActorName} races a decision in while ${secondActorName} is mid-push`
      )
      const raceSync = sync(first.rt, first.store, firstLayout)
      assert.equal(raceSync.ok, true)
    }

    const racedSync = sync(second.rt, second.store, secondLayout, { beforeCas: beforeSecondCas })
    assert.equal(racedSync.ok, true)

    if (raceDecisionId === null) {
      throw new Error('the race hook never fired; the merge write was never reached')
    }
    assert.equal(decisionReachableOnRemote(second.rt, remote, raceDecisionId), true)
  })
}

test('sync.two-clones-offline.store', () => {
  runOfflineMergeScenario('ana')
})

test('sync.two-clones-offline.store.ben-pushes-first', () => {
  runOfflineMergeScenario('ben')
})
