import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { ToolReply } from '../../src/server/register.ts'
import { TOOL_SPECS } from '../../src/server/tools/index.ts'
import type { Decision } from '../../src/schema/decision.ts'
import type { SessionEntry } from '../../src/schema/session.ts'
import type { Risk, Thread } from '../../src/schema/thread.ts'
import { git } from '../../src/store/git.ts'
import { layoutFor, type StoreLayout } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import { relativePathFor, type RecordChange } from '../../src/store/write-path.ts'
import {
  advanceMaterialisedStampIfStillCurrent,
  getRecordReadCounter,
  resetRecordReadCounter
} from '../../src/store/read-path.ts'
import { indexRecords } from '../../src/domain/record-index.ts'
import { fileRecordsContext, renderRecordsNaming } from '../../src/hooklib/file-records.ts'
import { readLedgerHead } from '../../src/hooklib/ledger-presence.ts'
import { rawGit } from '../support/git-fixture.ts'
import { STUB_TOOL_CTX } from '../support/criterion-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

type Structured = Record<string, unknown>

type Fixture = { rt: Runtime; repo: string; layout: StoreLayout; scratch: string }

type SeedShape = { decisions: number; entries: number; entryChars: number }

const THREAD_COUNT = 10
const NAMED_FILE = 'src/flat/named.ts'
const UNNAMED_FILE = 'src/flat/nobody-names-this.ts'
const SMALL_STORE: SeedShape = { decisions: 33, entries: 67, entryChars: 400 }
const LARGE_STORE: SeedShape = { decisions: 1000, entries: 2000, entryChars: 4000 }
const AREA_COUNT = 100
const TIMED_TOUCHES = 5
const FIRST_TOUCH_BUDGET_MS = 50
const MEASUREMENT_RUNS = 2
const FILES_HOLDING_NAMING_RECORDS = 2

const halt = (detail: string): never => {
  throw new Error(`file-records-flat fixture: ${detail}`)
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) halt(`git ${args.join(' ')}: ${result.stderr}`)
}

const withFixture = async (fn: (fx: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(path.join(tmpdir(), 'logbook-file-records-flat-repo-'))
  const home = mkdtempSync(path.join(tmpdir(), 'logbook-file-records-flat-plugin-data-'))
  const pluginData = path.join(home, 'plugin-data')
  const scratch = path.join(home, 'scratch')
  mkdirSync(pluginData)
  mkdirSync(scratch)
  try {
    runSetupStep(repo, ['init', '--initial-branch=main'])
    runSetupStep(repo, ['config', 'user.name', 'Logbook File Records Flat Fixture'])
    runSetupStep(repo, ['config', 'user.email', 'file-records-flat@logbook.test'])
    writeFileSync(path.join(repo, 'README.md'), 'logbook file-records-flat fixture repository\n')
    runSetupStep(repo, ['add', 'README.md'])
    runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
    const rt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo })
    const layout = layoutFor(rt, repo)
    if (!layout.ok) return halt(`layoutFor refused: ${layout.message}`)
    await fn({ rt, repo, layout: layout.value, scratch })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const storeOf = (fx: Fixture): Store => {
  const opened = openStore(fx.rt, fx.repo)
  return opened.ok ? opened.value : halt(`openStore refused: ${opened.message}`)
}

const gitOk = (fx: Fixture, args: string[], opts: { stdin?: string; indexFile?: string } = {}): string => {
  const result = git(fx.rt, fx.repo, args, opts)
  return result.ok ? result.stdout.trim() : halt(`git ${args[0] ?? ''} failed: ${result.stderr}`)
}

type RecordFileChange = Exclude<RecordChange, { kind: 'raw' }>

const commitInOneStep = (fx: Fixture, changes: readonly RecordFileChange[]): void => {
  storeOf(fx)
  const parent = readLedgerHead(fx.rt, fx.repo)
  const relPaths = changes.map((change) => relativePathFor(change).split(path.sep).join('/'))
  const targets = relPaths.map((relPath) => path.join(fx.layout.records, ...relPath.split('/')))
  changes.forEach((change, index) => {
    const target = targets[index] ?? halt('a seeded record lost its target')
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify(change.record))
  })
  const blobIds = gitOk(fx, ['hash-object', '-w', '--stdin-paths'], { stdin: `${targets.join('\n')}\n` }).split('\n')
  const indexFile = path.join(fx.scratch, `seed-index-${changes.length}-${parent ?? 'root'}`)
  if (parent !== null) gitOk(fx, ['read-tree', parent], { indexFile })
  const indexInfo = relPaths.map((relPath, index) => `100644 ${blobIds[index] ?? halt('a blob id is missing')}\t${relPath}`)
  gitOk(fx, ['update-index', '--add', '--index-info'], { stdin: `${indexInfo.join('\n')}\n`, indexFile })
  const tree = gitOk(fx, ['write-tree'], { indexFile })
  const commit = gitOk(fx, ['commit-tree', tree, ...(parent === null ? [] : ['-p', parent]), '-m', 'seed the fixture ledger'])
  gitOk(fx, ['update-ref', LEDGER_REF, commit, ...(parent === null ? [] : [parent])])
  const advanced = advanceMaterialisedStampIfStillCurrent(fx.rt, fx.layout, parent, commit)
  assert.equal(advanced.advanced, true, 'the seeded records must be marked as materialised for the seeded commit')
}

const baseThread = (rt: Runtime, index: number, risks: Risk[]): Thread => ({
  id: rt.ulid(),
  slug: `flat-thread-${index}`,
  title: `flat thread ${index}`,
  status: 'open',
  blocked_by: null,
  completion_criteria: [],
  spine: {
    active_goal: `keep area ${index} bounded`,
    next_step: `read area ${index}`,
    landed: '',
    last_session: 'seeded',
    open_risks: risks,
    key_decisions: [],
    out_of_scope: []
  },
  created_at: rt.now(),
  updated_at: rt.now()
})

const areaFile = (area: number): string => `src/area-${area}/module.ts`

const seedStore = (fx: Fixture, shape: SeedShape): Thread[] => {
  const { rt } = fx
  const namingRisk: Risk = {
    id: rt.ulid(),
    scope: 'flat',
    text: `changing ${NAMED_FILE} may break the flat area`,
    refs: [],
    criterion_id: null,
    retired: false
  }
  const threads = Array.from({ length: THREAD_COUNT }, (_unused, index) => baseThread(rt, index, index === 0 ? [namingRisk] : []))
  const threadAt = (index: number): Thread => threads[index % THREAD_COUNT] ?? halt('a seeded thread is missing')
  const decisions: Decision[] = Array.from({ length: shape.decisions }, (_unused, index) => ({
    id: rt.ulid(),
    thread_id: threadAt(index).id,
    title: `rule ${index} for ${index === 0 ? NAMED_FILE : areaFile(index % AREA_COUNT)}`,
    context: `the module ${index === 0 ? NAMED_FILE : areaFile(index % AREA_COUNT)} needed a ruling`,
    options: ['keep it', 'change it'],
    outcome: `keep it, ruling ${index}`,
    commit: null,
    supersedes: [],
    created_at: rt.now()
  }))
  const filler = 'measured the gateway latency and noted it '
  const entries: SessionEntry[] = Array.from({ length: shape.entries }, (_unused, index) => ({
    id: rt.ulid(),
    thread_id: threadAt(index).id,
    actor: 'claude',
    body: `${index} ${filler.repeat(Math.ceil(shape.entryChars / filler.length))}`.slice(0, shape.entryChars),
    created_at: rt.now()
  }))
  commitInOneStep(fx, [
    ...threads.map((record): RecordFileChange => ({ kind: 'thread', record })),
    ...decisions.map((record): RecordFileChange => ({ kind: 'decision', record })),
    ...entries.map((record): RecordFileChange => ({ kind: 'session', record }))
  ])
  return threads
}

const touchEvent = (fx: Fixture, sessionId: string, relative: string): Structured => ({
  session_id: sessionId,
  cwd: fx.repo,
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_input: { file_path: path.join(fx.repo, ...relative.split('/')) }
})

const firstTouch = (fx: Fixture, sessionId: string, relative: string): string | null =>
  fileRecordsContext(fx.rt, touchEvent(fx, sessionId, relative))

const readsForFirstTouch = (fx: Fixture, sessionId: string, relative: string): { reads: number; context: string | null } => {
  resetRecordReadCounter()
  const context = firstTouch(fx, sessionId, relative)
  return { reads: getRecordReadCounter(), context }
}

const uncachedContext = (fx: Fixture, relative: string): string | null =>
  renderRecordsNaming(indexRecords(storeOf(fx)), relative)

const callTool = async (fx: Fixture, name: string, input: Structured): Promise<Structured> => {
  const spec = TOOL_SPECS.find((candidate) => candidate.name === name) ?? halt(`no tool is named ${name}`)
  const reply: ToolReply<Structured> = await spec.handler(fx.rt, STUB_TOOL_CTX, spec.input.parse(input) as never)
  return reply.ok ? reply.structured : halt(`${name} refused: ${reply.refusal.message}`)
}

const textOf = (structured: Structured, key: string): string => {
  const value = structured[key]
  return typeof value === 'string' ? value : halt(`the reply carries no string ${key}`)
}

const cachedCommit = (fx: Fixture): unknown =>
  (JSON.parse(readFileSync(path.join(fx.layout.state, 'hook-record-index.json'), 'utf8')) as Structured).commit

const firstTouchReadsAt = async (shape: SeedShape): Promise<number> => {
  let reads = -1
  await withFixture(async (fx) => {
    seedStore(fx, shape)
    firstTouch(fx, 'flat-reads-session', UNNAMED_FILE)
    const touched = readsForFirstTouch(fx, 'flat-reads-session', NAMED_FILE)
    assert.ok(
      touched.reads <= FILES_HOLDING_NAMING_RECORDS,
      `a first touch with a current index read ${touched.reads} record files, more than the ${FILES_HOLDING_NAMING_RECORDS} holding records that name ${NAMED_FILE}`
    )
    assert.notEqual(touched.context, null, `the records naming ${NAMED_FILE} must still be shown`)
    assert.equal(touched.context, uncachedContext(fx, NAMED_FILE))
    reads = touched.reads
  })
  return reads
}

test('hook.file-records.first-touch-reads-stay-flat-as-the-ledger-grows', async () => {
  const small = await firstTouchReadsAt(SMALL_STORE)
  const large = await firstTouchReadsAt(LARGE_STORE)
  assert.equal(large, small, `a first touch read ${small} record files at 100 records and ${large} at 3,000`)
})

test('hook.file-records.a-write-rereads-only-what-it-changed', async () => {
  await withFixture(async (fx) => {
    const threads = seedStore(fx, LARGE_STORE)
    const thread = threads[1] ?? halt('the seeded thread is missing')
    firstTouch(fx, 'flat-write-session', UNNAMED_FILE)
    const before = readLedgerHead(fx.rt, fx.repo) ?? halt('the seeded ledger has no head')

    await callTool(fx, 'record_decision', {
      thread_id: thread.id,
      title: `Rule on ${areaFile(7)} again`,
      context: `${areaFile(7)} needs a second ruling`,
      options: ['keep it', 'change it'],
      outcome: 'change it, because the first ruling no longer holds'
    })
    const after = readLedgerHead(fx.rt, fx.repo) ?? halt('the ledger has no head after the write')
    const changed = rawGit(fx.repo, ['diff', '--name-only', before, after]).stdout.split('\n').filter((line) => line.length > 0)
    assert.ok(changed.length > 0, 'the write must change at least one record file')

    const touched = readsForFirstTouch(fx, 'flat-write-session', areaFile(7))
    assert.ok(
      touched.reads <= changed.length,
      `the touch after one write read ${touched.reads} record files, more than the ${changed.length} the write changed`
    )
    assert.equal(touched.context, uncachedContext(fx, areaFile(7)))
    assert.equal(cachedCommit(fx), after, 'the index must be written back at the new ledger head')
  })
})

test('hook.file-records.cached-context-matches-the-uncached-context', async () => {
  await withFixture(async (fx) => {
    writeFileSync(path.join(fx.repo, 'README.md'), 'logbook file-records-flat fixture repository, touched\n')
    const opened = await callTool(fx, 'open_thread', {
      title: 'the gateway timeout thread',
      slug: 'gateway-timeout',
      active_goal: 'keep the gateway timeout honest',
      next_step: 'read the gateway module',
      next_step_records: []
    })
    const riskThreadId = textOf(opened, 'thread_id')
    const other = await callTool(fx, 'open_thread', {
      title: 'the retry thread',
      slug: 'retry-budget',
      active_goal: 'keep retries bounded',
      next_step: 'read the retry module',
      next_step_records: []
    })
    const otherThreadId = textOf(other, 'thread_id')
    await callTool(fx, 'update_thread', {
      thread_id: riskThreadId,
      risks_add: [{ text: `raising the timeout in ${NAMED_FILE} may stall callers`, scope: 'gateway', criterion_id: null }]
    })
    const firstRuling = textOf(
      await callTool(fx, 'record_decision', {
        thread_id: otherThreadId,
        title: `Keep the timeout in ${NAMED_FILE} at 5000`,
        context: `the first ruling on ${NAMED_FILE}`,
        options: ['keep it at 5000', 'lower it'],
        outcome: 'keep it at 5000'
      }),
      'decision_id'
    )
    const staleRuling = textOf(
      await callTool(fx, 'record_decision', {
        thread_id: riskThreadId,
        title: `Raise the timeout in ${NAMED_FILE}`,
        context: `callers asked to raise the timeout in ${NAMED_FILE}`,
        options: ['raise it', 'leave it'],
        outcome: 'raise it to 8000'
      }),
      'decision_id'
    )
    const supersededEarlier = textOf(
      await callTool(fx, 'record_decision', {
        thread_id: riskThreadId,
        title: `An early ruling on ${NAMED_FILE}`,
        context: `the earliest note on ${NAMED_FILE}`,
        options: ['note it', 'ignore it'],
        outcome: 'note it'
      }),
      'decision_id'
    )
    await callTool(fx, 'record_decision', {
      thread_id: riskThreadId,
      title: 'Replace the early ruling',
      context: 'the early ruling was too vague',
      options: ['replace it', 'keep it'],
      outcome: 'replace it',
      supersedes: [supersededEarlier]
    })
    await callTool(fx, 'log_session_event', { thread_id: riskThreadId, actor: 'claude', body: `read ${NAMED_FILE} to find the timeout` })

    const initial = firstTouch(fx, 'flat-match-one', NAMED_FILE)
    assert.notEqual(initial, null, 'the seeded records name the file')
    assert.equal(initial, uncachedContext(fx, NAMED_FILE))
    assert.ok(initial?.includes(firstRuling) && initial.includes(staleRuling), 'both live rulings must be shown')
    assert.equal(initial?.includes(supersededEarlier), false, 'a superseded decision must not be shown')

    await callTool(fx, 'record_decision', {
      thread_id: otherThreadId,
      title: 'Lower the timeout after all',
      context: 'the upstream deadline forbids raising it',
      options: ['lower it', 'raise it'],
      outcome: 'lower it to 3000',
      supersedes: [staleRuling]
    })
    const afterSupersede = firstTouch(fx, 'flat-match-two', NAMED_FILE)
    assert.equal(afterSupersede, uncachedContext(fx, NAMED_FILE))
    assert.equal(afterSupersede?.includes(staleRuling), false, 'a decision superseded by the write must drop out')

    await callTool(fx, 'close_thread', { thread_id: riskThreadId, outcome: 'abandoned', detail: 'the gateway work moved elsewhere' })
    const afterClose = firstTouch(fx, 'flat-match-three', NAMED_FILE)
    assert.equal(afterClose, uncachedContext(fx, NAMED_FILE))
    assert.notEqual(afterClose, afterSupersede, 'closing the risk thread must change what the context shows')
    assert.equal(cachedCommit(fx), readLedgerHead(fx.rt, fx.repo), 'the index must follow the ledger head')
  })
})

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? halt('no timing was taken')
}

test('hook.file-records.first-touch-time-stays-flat', async () => {
  await withFixture(async (fx) => {
    seedStore(fx, LARGE_STORE)
    firstTouch(fx, 'flat-time-session', UNNAMED_FILE)
    for (let run = 0; run < MEASUREMENT_RUNS; run += 1) {
      const timings = Array.from({ length: TIMED_TOUCHES }, (_unused, index) => {
        const relative = areaFile(run * TIMED_TOUCHES + index + 1)
        const started = performance.now()
        const context = firstTouch(fx, 'flat-time-session', relative)
        const elapsed = performance.now() - started
        assert.notEqual(context, null, `the seeded rulings name ${relative}`)
        return elapsed
      })
      const middle = median(timings)
      assert.ok(
        middle < FIRST_TOUCH_BUDGET_MS,
        `run ${run + 1}: the median first touch took ${middle.toFixed(1)} ms over ${TIMED_TOUCHES} touches at 3,000 records, not under ${FIRST_TOUCH_BUDGET_MS} ms`
      )
    }
  })
})

test('hook.file-records.a-rewritten-ledger-leaves-no-stale-record-in-the-cache', async () => {
  for (const parentage of ['child', 'orphan'] as const) {
    await withFixture(async (fx) => {
      const opened = await callTool(fx, 'open_thread', {
        title: 'the retry thread',
        slug: 'retry-policy',
        active_goal: 'keep retries bounded',
        next_step: 'read the retry module',
        next_step_records: []
      })
      const threadId = textOf(opened, 'thread_id')
      for (const otherFile of ['lib/flat/one.ts', 'lib/flat/two.ts', 'lib/flat/three.ts']) {
        await callTool(fx, 'record_decision', {
          thread_id: threadId,
          title: `Keep the timeout policy in ${otherFile} as it is`,
          context: 'the upstream deadline is fixed at three seconds for every caller',
          options: ['keep the timeout policy as it is', 'change the timeout policy'],
          outcome: 'keep it, because the deadline is fixed'
        })
      }
      const ruling = textOf(
        await callTool(fx, 'record_decision', {
          thread_id: threadId,
          title: `Keep the retry policy in ${NAMED_FILE} as it is`,
          context: 'the upstream deadline is fixed at three seconds for every caller',
          options: ['keep the retry policy as it is', 'change the retry policy'],
          outcome: 'keep it, because the deadline is fixed'
        }),
        'decision_id'
      )
      assert.ok((firstTouch(fx, `session-before-${parentage}`, NAMED_FILE) ?? '').includes(ruling), 'the ruling governs the file before the rewrite')
      const before = gitOk(fx, ['rev-parse', LEDGER_REF])
      const rulingJson = JSON.parse(gitOk(fx, ['show', `${before}:decisions/${ruling}.json`])) as Record<string, unknown>
      const sibling = '01KZZZZZZZZZZZZZZZZZZZZZZZ'
      const indexFile = path.join(fx.scratch, `rewrite-index-${parentage}`)
      gitOk(fx, ['read-tree', before], { indexFile })
      gitOk(fx, ['update-index', '--force-remove', `decisions/${ruling}.json`], { indexFile })
      const blob = gitOk(fx, ['hash-object', '-w', '--stdin'], {
        stdin: JSON.stringify({ ...rulingJson, id: sibling, title: 'Keep the retry policy in lib/flat/other.ts as it is' })
      })
      gitOk(fx, ['update-index', '--add', '--cacheinfo', `100644,${blob},decisions/${sibling}.json`], { indexFile })
      const tree = gitOk(fx, ['write-tree'], { indexFile })
      const rewritten = gitOk(fx, ['commit-tree', tree, ...(parentage === 'child' ? ['-p', before] : []), '-m', 'rewrite the ledger without the ruling'])
      gitOk(fx, ['update-ref', LEDGER_REF, rewritten, before])
      const touched = readsForFirstTouch(fx, `session-after-${parentage}`, NAMED_FILE)
      assert.equal(touched.context, uncachedContext(fx, NAMED_FILE), `the ${parentage} rewrite must leave the cached context equal to the uncached one`)
      assert.ok(touched.context === null || !touched.context.includes(ruling), `the ${parentage} rewrite must drop the removed ruling`)
      const changedPaths = 2
      if (parentage === 'child') {
        assert.ok(touched.reads <= changedPaths, `the child rewrite must re-read only the ${changedPaths} paths it changed, and read ${touched.reads}`)
      } else {
        assert.ok(touched.reads > changedPaths, `the orphan rewrite must rebuild the cache from the whole store, and read only ${touched.reads}`)
      }
    })
  }
})

test('hook.file-records.cached-context-matches-the-uncached-context-whatever-the-git-settings', async () => {
  const placements = ['the repository root', 'a subdirectory'] as const
  const settings: readonly (readonly [string, string])[][] = [
    [],
    [['diff.relative', 'true']],
    [
      ['diff.relative', 'true'],
      ['diff.renames', 'copies'],
      ['diff.noprefix', 'true'],
      ['color.ui', 'always'],
      ['core.quotePath', 'false']
    ]
  ]
  for (const placement of placements) {
    for (const setting of settings) {
      const root = mkdtempSync(path.join(tmpdir(), 'logbook-file-records-settings-'))
      try {
        const repo = path.join(root, 'repo')
        const home = path.join(root, 'home')
        const pluginData = path.join(root, 'plugin-data')
        const project = placement === 'a subdirectory' ? path.join(repo, 'pkg') : repo
        mkdirSync(project, { recursive: true })
        mkdirSync(home)
        mkdirSync(pluginData)
        writeFileSync(path.join(home, '.gitconfig'), '')
        runSetupStep(repo, ['init', '--initial-branch=main'])
        runSetupStep(repo, ['config', 'user.name', 'Logbook File Records Settings Fixture'])
        runSetupStep(repo, ['config', 'user.email', 'file-records-settings@logbook.test'])
        writeFileSync(path.join(project, 'README.md'), 'logbook file-records settings fixture\n')
        runSetupStep(repo, ['add', '.'])
        runSetupStep(repo, ['commit', '-m', 'fixture: initial commit'])
        setting.forEach(([key, value]) => runSetupStep(repo, ['config', key, value]))
        const rt = testRuntime({ env: { HOME: home, CLAUDE_PLUGIN_DATA: pluginData, CLAUDE_PROJECT_DIR: project }, cwd: project })
        const call = async (name: string, input: Structured): Promise<Structured> => {
          const spec = TOOL_SPECS.find((candidate) => candidate.name === name) ?? halt(`no tool is named ${name}`)
          const reply: ToolReply<Structured> = await spec.handler(rt, STUB_TOOL_CTX, spec.input.parse(input) as never)
          return reply.ok ? reply.structured : halt(`${name} refused: ${JSON.stringify(reply)}`)
        }
        const touch = (sessionId: string): string | null =>
          fileRecordsContext(rt, {
            session_id: sessionId,
            cwd: project,
            hook_event_name: 'PreToolUse',
            tool_name: 'Read',
            tool_input: { file_path: path.join(project, NAMED_FILE) }
          })
        const uncached = (): string | null => {
          const opened = openStore(rt, project)
          return opened.ok ? renderRecordsNaming(indexRecords(opened.value), NAMED_FILE) : halt(`openStore refused: ${opened.message}`)
        }
        const label = `${placement} with ${setting.length === 0 ? 'no settings' : setting.map(([key, value]) => `${key}=${value}`).join(', ')}`
        const threadId = textOf(
          await call('open_thread', {
            title: 'the gateway timeout thread',
            slug: 'gateway-timeout',
            active_goal: 'keep the gateway timeout honest',
            next_step: 'read the gateway module',
            next_step_records: []
          }),
          'thread_id'
        )
        const first = textOf(
          await call('record_decision', {
            thread_id: threadId,
            title: `Raise the timeout in ${NAMED_FILE}`,
            context: `callers asked to raise the timeout in ${NAMED_FILE}`,
            options: ['raise it', 'leave it'],
            outcome: 'raise it to 8000'
          }),
          'decision_id'
        )
        assert.ok(touch('settings-touch-one')?.includes(first), `${label}: the first touch names the first ruling`)
        const second = textOf(
          await call('record_decision', {
            thread_id: threadId,
            title: `Lower the timeout in ${NAMED_FILE}`,
            context: 'the upstream deadline forbids raising it',
            options: ['lower it', 'raise it'],
            outcome: 'lower it to 3000',
            supersedes: [first]
          }),
          'decision_id'
        )
        const cached = touch('settings-touch-two')
        assert.equal(cached, uncached(), `${label}: the cached context must equal the whole-ledger context`)
        assert.ok(cached?.includes(second), `${label}: the superseding ruling must be shown`)
        assert.equal(cached?.includes(first), false, `${label}: the superseded ruling must drop out`)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  }
})
