import { spawnSync, fork } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { openThreadTool } = await import(`${R}/src/server/tools/open_thread.ts`)
const { openStore } = await import(`${R}/src/store/records.ts`)
const { layoutFor } = await import(`${R}/src/store/layout.ts`)

const rawGit = (repo: string, args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], { env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM:'1', GIT_CONFIG_GLOBAL:'/dev/null', GIT_TERMINAL_PROMPT:'0' }, encoding:'utf8' })

const repo = mkdtempSync(path.join(tmpdir(), 'f1-cc2-repo-'))
const pluginData = mkdtempSync(path.join(tmpdir(), 'f1-cc2-data-'))
for (const a of [['init','--initial-branch=main'],['config','user.name','C'],['config','user.email','c@c.test']]) rawGit(repo,a)
writeFileSync(path.join(repo,'README.md'),'x\n'); rawGit(repo,['add','README.md']); rawGit(repo,['commit','-m','i'])

let tick=0, seq=0
const ALPHA='0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const rt = { now:()=>new Date(Date.parse('2024-01-01T00:00:00.000Z')+tick++*1000).toISOString(),
  ulid:()=>{let v=seq++;const c:string[]=[];for(let i=0;i<16;i+=1){c.unshift(ALPHA[v%32]!);v=Math.floor(v/32)}return `01ARZ3NDEK${c.join('')}`},
  env:Object.freeze({CLAUDE_PLUGIN_DATA:pluginData, HOME:process.env.HOME}), cwd:repo, log:()=>{}, sessionId:'parent' }

const opened = await openThreadTool.handler(rt, {} as never, { title:'cc2', slug:'cc2', completion_criteria:['c'] })
if (!opened.ok) throw new Error('open refused')
const threadId = opened.structured.thread_id

const CHILD = '/private/tmp/claude-501/-Users-satanshumishra-Documents-DevLabs-logbook/5a4fa12e-ad6d-44b3-9fcf-a076ad5382be/child-autolink.mjs'
const N = 8
const kids = Array.from({length:N},(_,i)=>{
  const c = fork(CHILD, [JSON.stringify({ repo, pluginData, threadId, tag: String(i) })], { stdio:['pipe','pipe','pipe','ipc'] })
  let out='', err=''
  c.stdout!.on('data',d=>out+=d); c.stderr!.on('data',d=>err+=d)
  const ready = new Promise<void>(r=>c.once('message',()=>r()))
  const done = new Promise<{code:number|null,out:string,err:string}>(r=>c.once('exit',code=>r({code,out,err})))
  return { c, ready, done }
})
await Promise.all(kids.map(k=>k.ready))
for (const k of kids) k.c.send({ type:'go' })
const results = await Promise.all(kids.map(k=>k.done))

console.log('child exit codes:', results.map(r=>r.code).join(','))
const failed = results.filter(r=>r.code!==0)
if (failed.length) console.log('first failure stderr tail:', failed[0]!.err.split('\n').slice(-4).join(' | '))

// Read the LEDGER REF directly — the source of truth, bypassing the materialised working copy.
const refBlob = rawGit(repo, ['cat-file','-p',`refs/logbook/ledger:threads/${threadId}.json`])
const fromRef = refBlob.status === 0 ? JSON.parse(refBlob.stdout) : null
const commitCount = rawGit(repo, ['rev-list','--count','refs/logbook/ledger'])

const layout = layoutFor(rt, repo); if (!layout.ok) throw new Error('layout')
const wcPath = path.join(layout.value.records, 'threads', `${threadId}.json`)
const fromWorkingCopy = JSON.parse(readFileSync(wcPath,'utf8'))

console.log('\nLEDGER REF (source of truth):')
console.log('  commits on ref                :', commitCount.stdout.trim())
console.log('  spine.key_decisions on ref    :', fromRef ? fromRef.spine.key_decisions.length : 'unreadable')
console.log('WORKING COPY (materialised cache):')
console.log('  spine.key_decisions in copy   :', fromWorkingCopy.spine.key_decisions.length)
console.log('  ref and working copy agree    :', JSON.stringify(fromRef) === JSON.stringify(fromWorkingCopy))

const decisionsOnRef = rawGit(repo, ['ls-tree','--name-only','refs/logbook/ledger:decisions/'])
console.log('  decision records on ref       :', decisionsOnRef.status===0 ? decisionsOnRef.stdout.trim().split('\n').filter(Boolean).length : 0)
