import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { openThreadTool } = await import(`${R}/src/server/tools/open_thread.ts`)
const { recordDecisionTool } = await import(`${R}/src/server/tools/record_decision.ts`)
const { openStore } = await import(`${R}/src/store/records.ts`)
const { contributeToSpine } = await import(`${R}/src/domain/spine.ts`)
const { ThreadRecord } = await import(`${R}/src/schema/thread.ts`)
const caps = await import(`${R}/src/schema/caps.ts`)

const rawGit = (repo: string, args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], {
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8'
  })

const repo = mkdtempSync(path.join(tmpdir(), 'f1-bound-repo-'))
const pluginData = mkdtempSync(path.join(tmpdir(), 'f1-bound-data-'))
for (const a of [['init','--initial-branch=main'],['config','user.name','B'],['config','user.email','b@b.test']]) rawGit(repo, a)
writeFileSync(path.join(repo,'README.md'),'x\n'); rawGit(repo,['add','README.md']); rawGit(repo,['commit','-m','i'])

let tick = 0, seq = 0
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const mkUlid = () => { let v = seq++; const c: string[] = []; for (let i=0;i<16;i+=1){c.unshift(ALPHA[v%32]!);v=Math.floor(v/32)} return `01ARZ3NDEK${c.join('')}` }
const rt = { now: () => new Date(Date.parse('2024-01-01T00:00:00.000Z') + tick++ * 1000).toISOString(),
  ulid: mkUlid, env: Object.freeze({ CLAUDE_PLUGIN_DATA: pluginData }), cwd: repo, log: () => {}, sessionId: 's' }
const CTX = {} as never

const opened = await openThreadTool.handler(rt, CTX, { title:'boundary', slug:'boundary', completion_criteria:['c'] })
if (!opened.ok) throw new Error('open refused')
const threadId = opened.structured.thread_id
const store = openStore(rt, repo)
if (!store.ok) throw new Error('store')

const base = store.value.readThread(threadId)!.record
const kd = () => ({ id: mkUlid(), decision_id: mkUlid(), title: 'a linked decision', scope: 'c1' })
const saturated = { ...base, spine: { ...base.spine, key_decisions: Array.from({length: caps.KEY_DECISIONS_MAX_ELEMENTS}, kd) } }
const wrote = store.value.commit([{ kind:'thread', record: saturated }], 'saturate key_decisions at the element cap')
console.log('arranged: thread saturated at', caps.KEY_DECISIONS_MAX_ELEMENTS, 'key_decisions; commit ok =', wrote.ok)

const reread = store.value.readThread(threadId)!.record
console.log('stored key_decisions        =', reread.spine.key_decisions.length)
console.log('stored serialised bytes     =', Buffer.byteLength(JSON.stringify(reread),'utf8'), '/', caps.THREAD_RECORD_SERIALISED_MAX_BYTES)

console.log('\n=== TODAY: record_decision on a thread already at the key_decisions cap ===')
const today = await recordDecisionTool.handler(rt, CTX, {
  thread_id: threadId, title: 'the 201st decision', context: 'ctx',
  options: ['a','b'], outcome: 'chose a'
})
console.log('record_decision ->', today.ok ? 'SUCCEEDS (ok=true)' : `REFUSES field=${today.refusal.field}`)
if (today.ok) console.log('  text:', today.text)

console.log('\n=== IF AUTO-LINKING LANDED: the same call, routed through contributeToSpine ===')
const attempt = contributeToSpine(reread.spine, { key_decisions: [{ id: mkUlid(), decision_id: mkUlid(), title: 'the 201st decision', scope: 'c1' }] })
console.log('contributeToSpine ->', attempt.ok ? 'ACCEPTED' : `REFUSED field=${attempt.field}`)
if (!attempt.ok) console.log('  message:', attempt.message)

console.log('\n=== the OTHER cap: byte ceiling, reached below the element cap ===')
const fat = Array.from({length:129},()=>({ id: mkUlid(), decision_id: mkUlid(), title:'t'.repeat(200), scope:'c'.repeat(200) }))
const fatThread = { ...base, spine: { ...base.spine, key_decisions: fat } }
console.log('at 129 max-length entries: bytes =', Buffer.byteLength(JSON.stringify(fatThread),'utf8'), '-> ThreadRecord.parse', ThreadRecord.parse(fatThread).ok ? 'ACCEPTED' : 'REFUSED')
const fat130 = { ...fatThread, spine: { ...fatThread.spine, key_decisions: [...fat, { id: mkUlid(), decision_id: mkUlid(), title:'t'.repeat(200), scope:'c'.repeat(200) }] } }
const p130 = ThreadRecord.parse(fat130)
console.log('at 130 max-length entries: bytes =', Buffer.byteLength(JSON.stringify(fat130),'utf8'), '-> ThreadRecord.parse', p130.ok ? 'ACCEPTED' : 'REFUSED')
if (!p130.ok) console.log('  message:', p130.message)
const spineAt130 = contributeToSpine(fatThread.spine, { key_decisions: [{ id: mkUlid(), decision_id: mkUlid(), title:'t'.repeat(200), scope:'c'.repeat(200) }] })
console.log('  contributeToSpine at that same point ->', spineAt130.ok ? 'ACCEPTED (byte cap invisible to the spine check)' : `REFUSED ${spineAt130.field}`)
