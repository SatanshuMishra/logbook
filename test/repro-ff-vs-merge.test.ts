import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { testRuntime } from './support/runtime.ts'
import type { Runtime } from '../src/runtime/runtime.ts'
import { openThreadTool } from '../src/server/tools/open_thread.ts'
import { syncLedgerTool } from '../src/server/tools/sync_ledger.ts'
import { resumeThreadTool } from '../src/server/tools/resume_thread.ts'
import { logSessionEventTool } from '../src/server/tools/log_session_event.ts'
import { openStore } from '../src/store/records.ts'
import { PARK_THREAD_ACTOR } from '../src/domain/session-log.ts'

const ctx = {} as never
const BASE_ENV: Record<string, string | undefined> = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
const rawGit = (repo: string, args: string[], stdin?: string, extra: Record<string, string | undefined> = {}) => {
  const r = spawnSync('git', ['-C', repo, ...args], { env: { ...BASE_ENV, ...extra }, encoding: 'utf8', ...(stdin === undefined ? {} : { input: stdin }) })
  return { status: r.status ?? -1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' }
}
const id = (lead: string): string => `01${lead}${'A'.repeat(23)}`
const THREAD_ID = id('A'), NOTE1 = id('B'), FORGED = id('C'), NOTE2 = id('D'), BROKEN = id('E')

const setup = (remote: string, name: string, ids: string[], sessionId: string) => {
  const repo = mkdtempSync(join(tmpdir(), `lb-${name}-`))
  for (const args of [['clone', remote, '.'], ['config', 'user.name', name], ['config', 'user.email', `${name}@example.test`]]) {
    const r = rawGit(repo, args); if (r.status !== 0) throw new Error(`${args.join(' ')}: ${r.stderr}`)
  }
  const pluginData = mkdtempSync(join(tmpdir(), `lb-data-${name}-`))
  const base = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo, sessionId })
  const queue = [...ids]
  const rt: Runtime = { ...base, cwd: repo, sessionId, ulid: () => queue.shift() ?? base.ulid() }
  return { repo, pluginData, rt }
}
const must = <T>(r: { ok: true; text: string; structured: T } | { ok: false; refusal: unknown }): T => {
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`); return r.structured
}

test('the reserved-actor control and the unparseable gate are both absent on the fast-forward path', async () => {
  const remote = mkdtempSync(join(tmpdir(), 'lb-remote-'))
  rawGit(remote, ['init', '--bare', '--initial-branch=main'])
  const ana = setup(remote, 'ana', [id('9'), THREAD_ID, NOTE1, NOTE2], 'ana-session')
  const ben = setup(remote, 'ben', [], 'ben-session')
  try {
    must(await openThreadTool.handler(ana.rt, ctx, {
      title: 'shared thread', slug: 'shared', completion_criteria: [{ text: 'ship it', check: 'npm test exits 0' }]
    }))
    for (const body of ['EARLIEST note from ana', 'LATEST note from ana']) {
      must(await logSessionEventTool.handler(ana.rt, ctx, { thread_id: THREAD_ID, actor: 'ana', body }))
    }

    console.log('CONTROL A -- log_session_event with the reserved actor, through the tool:')
    const refused = await logSessionEventTool.handler(ana.rt, ctx, { thread_id: THREAD_ID, actor: PARK_THREAD_ACTOR, body: 'x' })
    console.log('  ->', refused.ok ? 'ACCEPTED' : `REFUSED (${(refused as { refusal: { field: string } }).refusal.field})`)
    assert.equal(refused.ok, false)

    must(await syncLedgerTool.handler(ana.rt, ctx, {}))

    console.log('\nThe same two records written straight onto the ref with plain git, then pushed:')
    const forged = { id: FORGED, thread_id: THREAD_ID, actor: PARK_THREAD_ACTOR, body: 'planted by a peer', created_at: '2024-01-01T00:00:10.000Z' }
    const broken = { id: 'not-a-ulid', nonsense: true }
    const bF = rawGit(ana.repo, ['hash-object', '-w', '--stdin'], JSON.stringify(forged)).stdout.trim()
    const bB = rawGit(ana.repo, ['hash-object', '-w', '--stdin'], JSON.stringify(broken)).stdout.trim()
    const head = rawGit(ana.repo, ['rev-parse', 'refs/logbook/ledger']).stdout.trim()
    const env: Record<string, string | undefined> = { GIT_INDEX_FILE: join(ana.pluginData, 'idx') }
    rawGit(ana.repo, ['read-tree', head], undefined, env)
    rawGit(ana.repo, ['update-index', '--add', '--cacheinfo', `100644,${bF},sessions/${THREAD_ID}/${FORGED}.json`], undefined, env)
    rawGit(ana.repo, ['update-index', '--add', '--cacheinfo', `100644,${bB},threads/${BROKEN}.json`], undefined, env)
    const tree = rawGit(ana.repo, ['write-tree'], undefined, env).stdout.trim()
    const commit = rawGit(ana.repo, ['commit-tree', tree, '-p', head, '-m', 'peer write'], undefined,
      { ...env, GIT_AUTHOR_NAME: 'ana', GIT_AUTHOR_EMAIL: 'a@e.test', GIT_COMMITTER_NAME: 'ana', GIT_COMMITTER_EMAIL: 'a@e.test' }).stdout.trim()
    const pushed = rawGit(ana.repo, ['push', 'origin', `${commit}:refs/logbook/ledger`])
    console.log('  push status', pushed.status, '->', commit.slice(0, 12))

    console.log('\nBEN syncs:')
    const benSync = must(await syncLedgerTool.handler(ben.rt, ctx, {})) as { action: string }
    console.log('  sync_ledger action ->', benSync.action, '(the unparseable gate never fired)')

    const store = openStore(ben.rt, ben.repo)
    if (!store.ok) throw new Error('store')
    console.log('  session slots  ->', store.value.readSessionEntries(THREAD_ID).map((s) => s.quarantined ? 'QUARANTINED' : `${s.record.id.slice(0,4)} actor=${s.record.actor}`))
    console.log('  thread slots   ->', store.value.readThreads().map((s) => s.quarantined ? `QUARANTINED ${s.path.split('/').pop()}` : s.record.id.slice(0,4)))

    const briefing = (must(await resumeThreadTool.handler(ben.rt, ctx, { thread_id: THREAD_ID })) as { briefing: string }).briefing
    console.log('\n----- BEN BRIEFING, Last session -----')
    console.log(briefing.split('**Last session:**')[1]?.split('**Completion')[0]?.trim())
    console.log('--------------------------------------')
    console.log('  EARLIEST note visible to Ben?', briefing.includes('EARLIEST note from ana'))
    console.log('  LATEST note visible to Ben?  ', briefing.includes('LATEST note from ana'))
  } finally {
    for (const d of [ana.repo, ana.pluginData, ben.repo, ben.pluginData, remote]) rmSync(d, { recursive: true, force: true })
  }
})
