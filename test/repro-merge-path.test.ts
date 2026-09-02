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
import { escapeStored } from '../src/render/escape.ts'

const ctx = {} as never
const PAYLOAD = '![alt](https://attacker.example/pixel.png)'
const BASE_ENV: Record<string, string | undefined> = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
const rawGit = (repo: string, args: string[]) => spawnSync('git', ['-C', repo, ...args], { env: BASE_ENV, encoding: 'utf8' })
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const sfx = (n: number): string => { let v = n; const o: string[] = []; for (let i=0;i<16;i+=1){o.unshift(ALPHABET[v%32] as string); v=Math.floor(v/32)} return o.join('') }
const setup = (remote: string, name: string, prefix: string) => {
  const repo = mkdtempSync(join(tmpdir(), `lb-${name}-`))
  for (const a of [['clone', remote, '.'], ['config','user.name',name], ['config','user.email',`${name}@e.test`]]) rawGit(repo, a)
  const pluginData = mkdtempSync(join(tmpdir(), `lb-d-${name}-`))
  const base = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData }, cwd: repo, sessionId: `${name}-session` })
  let s = 0
  const rt: Runtime = { ...base, cwd: repo, sessionId: `${name}-session`, ulid: () => `${prefix}${sfx(s++)}` }
  const off = () => rawGit(repo, ['remote','set-url','origin', join(tmpdir(), `gone-${name}`)])
  const on = () => rawGit(repo, ['remote','set-url','origin', remote])
  return { repo, pluginData, rt, off, on }
}
const must = <T>(r: { ok: true; text: string; structured: T } | { ok: false; refusal: unknown }): T => {
  if (!r.ok) throw new Error(`refused: ${JSON.stringify(r.refusal)}`); return r.structured
}

test('escapeStored leaves the payload byte-identical at every offset', () => {
  const filler = 'the quick brown fox jumps over the lazy dog'
  let worst: string | null = null
  for (let i = 0; i <= filler.length; i += 1) {
    const input = filler.slice(0, i) + PAYLOAD + filler.slice(i)
    const out = escapeStored(input)
    if (!out.includes(PAYLOAD)) worst = `offset ${i}: ${out}`
  }
  console.log('offsets swept:', filler.length + 1, '| payload altered at:', worst ?? 'none')
  assert.equal(worst, null)
  console.log('line-start form:', JSON.stringify(escapeStored(PAYLOAD)))
  console.log('double-escaped :', JSON.stringify(escapeStored(escapeStored(PAYLOAD))))
})

test('the merge path also delivers a peer-authored thread into the readers briefing', async () => {
  const remote = mkdtempSync(join(tmpdir(), 'lb-remote-'))
  rawGit(remote, ['init','--bare','--initial-branch=main'])
  const ana = setup(remote, 'ana', '01ANATEAMA')
  const ben = setup(remote, 'ben', '01BENTEAMB')
  try {
    ben.off()
    const benOwn = must(await openThreadTool.handler(ben.rt, ctx, {
      title: 'bens own thread', slug: 'ben-own', completion_criteria: [{ text: 'benwork', check: 'npm test exits 0' }]
    })) as { thread_id: string }
    const anaT = must(await openThreadTool.handler(ana.rt, ctx, {
      title: `ana thread ${PAYLOAD}`, slug: 'ana-thread', completion_criteria: [{ text: `ana criterion ${PAYLOAD}`, check: 'npm test exits 0' }]
    })) as { thread_id: string }
    console.log('ana sync ->', JSON.stringify(must(await syncLedgerTool.handler(ana.rt, ctx, {}))))
    ben.on()
    const benSync = must(await syncLedgerTool.handler(ben.rt, ctx, {})) as { action: string }
    console.log('ben sync ->', benSync.action, '(ben had his own commit, so the refs had diverged)')
    assert.equal(benSync.action, 'merged')
    const b = (must(await resumeThreadTool.handler(ben.rt, ctx, { thread_id: anaT.thread_id })) as { briefing: string }).briefing
    console.log('ben own thread id', benOwn.thread_id.slice(0,12), '| ana thread readable by ben:', b.split('\n')[2])
    console.log('payload occurrences in bens briefing:', b.split(PAYLOAD).length - 1)
    assert.ok(b.includes(PAYLOAD))
  } finally {
    for (const d of [ana.repo, ana.pluginData, ben.repo, ben.pluginData, remote]) rmSync(d, { recursive: true, force: true })
  }
})
