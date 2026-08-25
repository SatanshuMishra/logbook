import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { openThreadTool } = await import(`${R}/src/server/tools/open_thread.ts`)
const { parkThreadTool } = await import(`${R}/src/server/tools/park_thread.ts`)
const { resumeThreadTool } = await import(`${R}/src/server/tools/resume_thread.ts`)
const { layoutFor } = await import(`${R}/src/store/layout.ts`)
const { readPointer } = await import(`${R}/src/domain/pointer.ts`)

const CTX = {} as any
const ENV = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
const g = (repo: string, args: string[]) => spawnSync('git', ['-C', repo, ...args], { env: ENV, encoding: 'utf8' })
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const mkRuntime = (repo: string, pd: string, sid: string) => {
  let t = 0, s = 0
  return { now: () => new Date(Date.parse('2024-01-01T00:00:00.000Z') + (t++) * 1000).toISOString(),
    ulid: () => { let v = s++; const c: string[] = []; for (let i = 0; i < 16; i++) { c.unshift(ALPHA[v % 32]!); v = Math.floor(v / 32) } return `01ARZ3NDEK${c.join('')}` },
    env: Object.freeze({ CLAUDE_PLUGIN_DATA: pd, PATH: process.env.PATH, HOME: process.env.HOME }), cwd: repo, log: () => {}, sessionId: sid }
}
const repo = mkdtempSync(join(tmpdir(), 'logbook-c7-'))
const pd = mkdtempSync(join(tmpdir(), 'logbook-c7-data-'))
g(repo, ['init', '--initial-branch=main']); g(repo, ['config','user.name','C7']); g(repo, ['config','user.email','c7@t.test'])
writeFileSync(join(repo,'README.md'),'c7\n'); g(repo,['add','README.md']); g(repo,['commit','-m','init'])

const rt = mkRuntime(repo, pd, 'session-Q')
const a = await openThreadTool.handler(rt, CTX, { title: 'quarantine target', slug: 'q-a', completion_criteria: ['c'] })
const b = await openThreadTool.handler(rt, CTX, { title: 'escape hatch', slug: 'q-b', completion_criteria: ['c'] })
await resumeThreadTool.handler(rt, CTX, { thread_id: a.structured.thread_id })

const lay = layoutFor(rt, repo).value
const ptrPath = join(lay.state, 'active-thread.json')
console.log(`pointer present after resume        : ${existsSync(ptrPath)} -> ${readPointer(rt, lay).kind}`)

// Quarantine the pointed-at thread record.
writeFileSync(join(lay.records, 'threads', `${a.structured.thread_id}.json`), '{not-json', 'utf8')

const park = await parkThreadTool.handler(rt, CTX, { outcome: 'MARKER-QUARANTINE 8000-char stand-in' })
console.log(`\npark on quarantined record:`)
console.log(`  reply.ok                          : ${park.ok}`)
console.log(`  refusal.field / retryable         : ${park.ok ? 'n/a' : park.refusal.field + ' / retryable=' + park.refusal.retryable}`)
console.log(`  pointer STILL present after park  : ${existsSync(ptrPath)}`)

const reResume = await resumeThreadTool.handler(rt, CTX, { thread_id: a.structured.thread_id })
console.log(`\nre-resume the SAME quarantined thread:`)
console.log(`  reply.ok                          : ${reResume.ok}`)
console.log(`  refusal.field                     : ${reResume.ok ? 'n/a' : reResume.refusal.field}`)
console.log(`  pointer still present             : ${existsSync(ptrPath)}`)

const escape = await resumeThreadTool.handler(rt, CTX, { thread_id: b.structured.thread_id })
console.log(`\nresume a DIFFERENT healthy thread (the escape hatch):`)
console.log(`  reply.ok                          : ${escape.ok}`)
const after = readPointer(rt, lay)
console.log(`  pointer now names                 : ${after.kind === 'pointer' ? (after.value.thread_id === b.structured.thread_id ? 'thread B (overwritten)' : 'thread A (stuck)') : after.kind}`)

rmSync(repo, { recursive: true, force: true }); rmSync(pd, { recursive: true, force: true })
