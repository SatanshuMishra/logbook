import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { rawGit } from './support/git-fixture.ts'
import { testRuntime } from './support/runtime.ts'
import type { Runtime } from '../src/runtime/runtime.ts'
import { openThreadTool } from '../src/server/tools/open_thread.ts'
import { syncLedgerTool } from '../src/server/tools/sync_ledger.ts'
import { listThreadsTool } from '../src/server/tools/list_threads.ts'
import { resumeThreadTool } from '../src/server/tools/resume_thread.ts'
import { logSessionEventTool } from '../src/server/tools/log_session_event.ts'
import { git } from '../src/store/git.ts'
import { LEDGER_REF } from '../src/store/ref.ts'

const PAYLOAD = '![alt](https://attacker.example/pixel.png)'
const ctx = {} as never
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const suffix = (seq: number): string => {
  let v = seq
  const out: string[] = []
  for (let i = 0; i < 16; i += 1) { out.unshift(ALPHABET[v % 32] as string); v = Math.floor(v / 32) }
  return out.join('')
}

const setup = (remote: string, name: string, prefix: string, sessionId: string) => {
  const repo = mkdtempSync(join(tmpdir(), `lb-${name}-`))
  for (const args of [['clone', remote, '.'], ['config', 'user.name', name], ['config', 'user.email', `${name}@example.test`]]) {
    const r = rawGit(repo, args)
    if (r.status !== 0) throw new Error(`${args.join(' ')}: ${r.stderr}`)
  }
  const pluginData = mkdtempSync(join(tmpdir(), `lb-data-${name}-`))
  const base = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo, sessionId })
  let seq = 0
  const rt: Runtime = { ...base, cwd: repo, sessionId, ulid: () => `${prefix}${suffix(seq++)}` }
  return { repo, pluginData, rt }
}

const must = <T>(reply: { ok: true; text: string; structured: T } | { ok: false; refusal: unknown }): T => {
  if (!reply.ok) throw new Error(`refused: ${JSON.stringify(reply.refusal)}`)
  return reply.structured
}

test('a record Ana writes reaches Bens rendered briefing', async () => {
  const remote = mkdtempSync(join(tmpdir(), 'lb-remote-'))
  rawGit(remote, ['init', '--bare', '--initial-branch=main'])
  const ana = setup(remote, 'ana', '01ANATEAMA', 'ana-session')
  const ben = setup(remote, 'ben', '01BENTEAMB', 'ben-session')
  try {
    const opened = must(await openThreadTool.handler(ana.rt, ctx, {
      title: `hardening pass ${PAYLOAD}`,
      slug: 'hardening-pass',
      completion_criteria: [{ text: `close the gap ${PAYLOAD}`, check: 'npm test exits 0' }]
    })) as { thread_id: string; completion_criteria: { text: string }[] }
    console.log('STEP 1 ana open_thread ->', opened.thread_id)
    console.log('  stored criterion text:', JSON.stringify(opened.completion_criteria[0]?.text))

    must(await logSessionEventTool.handler(ana.rt, ctx, {
      thread_id: opened.thread_id, actor: 'ana', body: `progress note ${PAYLOAD}`
    }))
    console.log('STEP 2 ana log_session_event -> ok')

    console.log('STEP 3 ana sync_ledger ->', JSON.stringify(must(await syncLedgerTool.handler(ana.rt, ctx, {}))))

    const before = git(ben.rt, ben.repo, ['rev-parse', LEDGER_REF])
    console.log('STEP 4 ben ledger ref before ->', before.ok ? before.stdout.trim() : 'absent')

    console.log('STEP 5 ben sync_ledger ->', JSON.stringify(must(await syncLedgerTool.handler(ben.rt, ctx, {}))))

    const roster = must(await listThreadsTool.handler(ben.rt, ctx, {})) as { threads: { id: string; title: string }[] }
    console.log('STEP 6 ben list_threads ->', JSON.stringify(roster.threads))

    const resumed = must(await resumeThreadTool.handler(ben.rt, ctx, { thread_id: opened.thread_id })) as { briefing: string }
    console.log('STEP 7 ben resume_thread briefing:')
    console.log('----- BEGIN BRIEFING -----'); console.log(resumed.briefing); console.log('----- END BRIEFING -----')

    const n = resumed.briefing.split(PAYLOAD).length - 1
    console.log('VERDICT payload occurrences in Bens briefing:', n)
    assert.ok(n > 0)
  } finally {
    for (const d of [ana.repo, ana.pluginData, ben.repo, ben.pluginData, remote]) rmSync(d, { recursive: true, force: true })
  }
})
