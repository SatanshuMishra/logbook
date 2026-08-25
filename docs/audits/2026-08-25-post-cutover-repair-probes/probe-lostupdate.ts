import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { openThreadTool } = await import(`${R}/src/server/tools/open_thread.ts`)
const { openStore } = await import(`${R}/src/store/records.ts`)
const { layoutFor } = await import(`${R}/src/store/layout.ts`)
const { writeRecords } = await import(`${R}/src/store/write-path.ts`)

const rawGit = (repo: string, args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], {
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8'
  })

const repo = mkdtempSync(path.join(tmpdir(), 'f1-lu-repo-'))
const pluginData = mkdtempSync(path.join(tmpdir(), 'f1-lu-data-'))
for (const a of [['init','--initial-branch=main'],['config','user.name','L'],['config','user.email','l@l.test']]) rawGit(repo, a)
writeFileSync(path.join(repo,'README.md'),'x\n'); rawGit(repo,['add','README.md']); rawGit(repo,['commit','-m','i'])

let tick = 0, seq = 0
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const mkUlid = () => { let v = seq++; const c: string[] = []; for (let i=0;i<16;i+=1){c.unshift(ALPHA[v%32]!);v=Math.floor(v/32)} return `01ARZ3NDEK${c.join('')}` }
const rt = { now: () => new Date(Date.parse('2024-01-01T00:00:00.000Z') + tick++ * 1000).toISOString(),
  ulid: mkUlid, env: Object.freeze({ CLAUDE_PLUGIN_DATA: pluginData }), cwd: repo, log: () => {}, sessionId: 's' }

const opened = await openThreadTool.handler(rt, {} as never, { title:'lost update', slug:'lu', completion_criteria:['c'] })
if (!opened.ok) throw new Error('open refused')
const threadId = opened.structured.thread_id
const store = openStore(rt, repo); if (!store.ok) throw new Error('store')
const layout = layoutFor(rt, repo); if (!layout.ok) throw new Error('layout')

const base = store.value.readThread(threadId)!.record

// Process A holds this stale copy and intends to add a key_decision to it.
const aVersion = { ...base, spine: { ...base.spine, key_decisions: [{ id: mkUlid(), decision_id: mkUlid(), title: 'A: auto-linked decision', scope: 'c1' }] }, updated_at: rt.now() }

// Between A building its tree and A's CAS, process B lands a risk on the SAME thread.
let interfered = false
const beforeCas = () => {
  if (interfered) return
  interfered = true
  const fresh = openStore(rt, repo)
  if (!fresh.ok) throw new Error('B store')
  const current = fresh.value.readThread(threadId)!.record
  const bVersion = { ...current, spine: { ...current.spine, open_risks: [{ id: mkUlid(), scope:'c1', text:'B: a risk that must survive', refs: [] }] }, updated_at: rt.now() }
  const r = fresh.value.commit([{ kind:'thread', record: bVersion }], 'B: add a risk')
  console.log("process B's commit landed :", r.ok)
}

const aResult = writeRecords(rt, layout.value, [{ kind:'thread', record: aVersion }], 'A: auto-link a decision', { beforeCas })
console.log("process A's commit landed :", aResult.ok, aResult.ok ? '' : JSON.stringify(aResult))

const finalStore = openStore(rt, repo); if (!finalStore.ok) throw new Error('final')
const final = finalStore.value.readThread(threadId)!.record
console.log('\nFINAL thread record after both writes:')
console.log('  key_decisions (A wrote 1) :', final.spine.key_decisions.length, final.spine.key_decisions.map(k=>k.title))
console.log('  open_risks    (B wrote 1) :', final.spine.open_risks.length, final.spine.open_risks.map(r=>r.text))
console.log('\nVERDICT: B lost =', final.spine.open_risks.length === 0, '| A lost =', final.spine.key_decisions.length === 0)
