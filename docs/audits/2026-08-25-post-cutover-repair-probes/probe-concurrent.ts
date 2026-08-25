import { spawnSync, fork } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { openThreadTool } = await import(`${R}/src/server/tools/open_thread.ts`)
const { openStore } = await import(`${R}/src/store/records.ts`)

const rawGit = (repo: string, args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], { env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null', GIT_TERMINAL_PROMPT:'0' }, encoding:'utf8' })

const repo = mkdtempSync(path.join(tmpdir(), 'f1-cc-repo-'))
const pluginData = mkdtempSync(path.join(tmpdir(), 'f1-cc-data-'))
for (const a of [['init','--initial-branch=main'],['config','user.name','C'],['config','user.email','c@c.test']]) rawGit(repo,a)
writeFileSync(path.join(repo,'README.md'),'x\n'); rawGit(repo,['add','README.md']); rawGit(repo,['commit','-m','i'])

let tick=0, seq=0
const ALPHA='0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const rt = { now:()=>new Date(Date.parse('2024-01-01T00:00:00.000Z')+tick++*1000).toISOString(),
  ulid:()=>{let v=seq++;const c:string[]=[];for(let i=0;i<16;i+=1){c.unshift(ALPHA[v%32]!);v=Math.floor(v/32)}return `01ARZ3NDEK${c.join('')}`},
  env:Object.freeze({CLAUDE_PLUGIN_DATA:pluginData, HOME:process.env.HOME}), cwd:repo, log:()=>{}, sessionId:'parent' }

const opened = await openThreadTool.handler(rt, {} as never, { title:'concurrent autolink', slug:'cc', completion_criteria:['c'] })
if (!opened.ok) throw new Error('open refused')
const threadId = opened.structured.thread_id

const CHILD = '/private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/5a4fa12e-ad6d-44b3-9fcf-a076ad5382be/child-autolink.mjs'
const N = 8
const kids = Array.from({length:N},(_,i)=>{
  const c = fork(CHILD, [JSON.stringify({ repo, pluginData, threadId, tag: String(i) })], { stdio:['pipe','pipe','pipe','ipc'] })
  let out=''
  c.stdout!.on('data',d=>out+=d)
  const ready = new Promise<void>(r=>c.once('message',()=>r()))
  const done = new Promise<{code:number|null,out:string}>(r=>c.once('exit',code=>r({code,out})))
  return { c, ready, done }
})
await Promise.all(kids.map(k=>k.ready))
for (const k of kids) k.c.send({ type:'go' })
const results = await Promise.all(kids.map(k=>k.done))

const okCount = results.filter(r=>r.code===0).length
console.log(`children: ${N}, exited 0: ${okCount}`)

const finalStore = openStore(rt, repo); if (!finalStore.ok) throw new Error('store')
const final = finalStore.value.readThread(threadId)!.record
const ids = results.filter(r=>r.code===0).map(r=>JSON.parse(r.out).decisionId as string)
const readable = ids.filter(id=>{ const s = finalStore.value.readDecision(id); return s!==null && !s.quarantined }).length

console.log('\nRESULT of 8 concurrent "record + auto-link" calls against ONE thread:')
console.log('  decision records readable back :', readable, '/', N)
console.log('  spine.key_decisions links kept :', final.spine.key_decisions.length, '/', N)
console.log('\n  -> the existing assertion (all decision ids readable) would still PASS')
console.log('  -> but', N - final.spine.key_decisions.length, 'of', N, 'spine links are silently LOST')
