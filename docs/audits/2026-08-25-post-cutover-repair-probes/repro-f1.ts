import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { openThreadTool } = await import(`${R}/src/server/tools/open_thread.ts`)
const { recordDecisionTool } = await import(`${R}/src/server/tools/record_decision.ts`)
const { resumeThreadTool } = await import(`${R}/src/server/tools/resume_thread.ts`)
const { openStore } = await import(`${R}/src/store/records.ts`)
const { layoutFor } = await import(`${R}/src/store/layout.ts`)

const rawGit = (repo: string, args: string[]) =>
  spawnSync('git', ['-C', repo, ...args], {
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' },
    encoding: 'utf8'
  })

const repo = mkdtempSync(path.join(tmpdir(), 'f1-repro-repo-'))
const pluginData = mkdtempSync(path.join(tmpdir(), 'f1-repro-data-'))
for (const args of [
  ['init', '--initial-branch=main'],
  ['config', 'user.name', 'F1 Repro'],
  ['config', 'user.email', 'f1@repro.test']
]) rawGit(repo, args)
writeFileSync(path.join(repo, 'README.md'), 'f1 repro\n')
rawGit(repo, ['add', 'README.md'])
rawGit(repo, ['commit', '-m', 'initial'])

let tick = 0
let seq = 0
const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const rt = {
  now: () => new Date(Date.parse('2024-01-01T00:00:00.000Z') + tick++ * 1000).toISOString(),
  ulid: () => {
    let v = seq++
    const c: string[] = []
    for (let i = 0; i < 16; i += 1) { c.unshift(ALPHA[v % 32]!); v = Math.floor(v / 32) }
    return `01ARZ3NDEK${c.join('')}`
  },
  env: Object.freeze({ CLAUDE_PLUGIN_DATA: pluginData }),
  cwd: repo,
  log: () => {},
  sessionId: 'f1-repro-session'
}
const CTX = {} as never

const opened = await openThreadTool.handler(rt, CTX, {
  title: 'audit the record_decision spine link',
  slug: 'f1-audit',
  completion_criteria: ['the defect is reproduced']
})
if (!opened.ok) throw new Error('open_thread refused: ' + JSON.stringify(opened.refusal))
const threadId = opened.structured.thread_id
console.log('STEP 1  open_thread            ->', threadId)

const rec = await recordDecisionTool.handler(rt, CTX, {
  thread_id: threadId,
  title: 'link decisions into the spine automatically',
  context: 'a decision recorded alone never reaches the briefing',
  options: ['auto-link in record_decision', 'require a follow-up update_thread'],
  outcome: 'auto-link, because the follow-up is silently optional'
})
if (!rec.ok) throw new Error('record_decision refused: ' + JSON.stringify(rec.refusal))
console.log('STEP 2  record_decision        -> ok=true decision_id=' + rec.structured.decision_id)
console.log('        tool text             ->', rec.text)

const layout = layoutFor(rt, repo)
if (!layout.ok) throw new Error('layout failed')
const store = openStore(rt, repo)
if (!store.ok) throw new Error('store failed')

const slot = store.value.readThread(threadId)
console.log('\nSTEP 3  thread record after record_decision')
console.log('        spine.key_decisions   ->', JSON.stringify(slot.record.spine.key_decisions))
console.log('        thread.updated_at     ->', slot.record.updated_at)

const decisionsDir = path.join(layout.value.records, 'decisions')
console.log('        decisions/ on disk    ->', existsSync(decisionsDir) ? readdirSync(decisionsDir) : '(absent)')

const brief = await resumeThreadTool.handler(rt, CTX, { thread_id: threadId })
if (!brief.ok) throw new Error('resume_thread refused: ' + JSON.stringify(brief.refusal))
console.log('\nSTEP 4  resume_thread briefing')
console.log('-------------------------------------------')
console.log(brief.structured.briefing)
console.log('-------------------------------------------')

const b = brief.structured.briefing
const titleShown = b.includes('link decisions into the spine automatically')
console.log('\nVERDICT')
console.log('  decision file written on disk        :', existsSync(decisionsDir) && readdirSync(decisionsDir).length > 0)
console.log('  spine.key_decisions length           :', slot.record.spine.key_decisions.length)
console.log('  decision title appears in briefing   :', titleShown)
process.exit(titleShown ? 1 : 0)
