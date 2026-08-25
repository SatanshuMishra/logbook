import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, readdirSync, readFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const R = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { openThreadTool } = await import(`${R}/src/server/tools/open_thread.ts`)
const { parkThreadTool } = await import(`${R}/src/server/tools/park_thread.ts`)
const { resumeThreadTool } = await import(`${R}/src/server/tools/resume_thread.ts`)
const { closeThreadTool } = await import(`${R}/src/server/tools/close_thread.ts`)
const { layoutFor } = await import(`${R}/src/store/layout.ts`)
const caps = await import(`${R}/src/schema/caps.ts`)

const CTX = {} as any
const ENV = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' }
const g = (repo: string, args: string[]) => spawnSync('git', ['-C', repo, ...args], { env: ENV, encoding: 'utf8' })

const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const mkRuntime = (repo: string, pluginData: string, sessionId: string) => {
  let tick = 0, seq = 0
  return {
    now: () => new Date(Date.parse('2024-01-01T00:00:00.000Z') + (tick++) * 1000).toISOString(),
    ulid: () => { let v = seq++; const c: string[] = []; for (let i = 0; i < 16; i++) { c.unshift(ALPHA[v % 32]!); v = Math.floor(v / 32) } return `01ARZ3NDEK${c.join('')}` },
    env: Object.freeze({ CLAUDE_PLUGIN_DATA: pluginData, PATH: process.env.PATH, HOME: process.env.HOME }),
    cwd: repo,
    log: () => {},
    sessionId
  }
}

const buildRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-f7-repro-'))
  g(repo, ['init', '--initial-branch=main']); g(repo, ['config', 'user.name', 'F7 Repro']); g(repo, ['config', 'user.email', 'f7@repro.test'])
  writeFileSync(join(repo, 'README.md'), 'f7\n'); g(repo, ['add', 'README.md']); g(repo, ['commit', '-m', 'init'])
  return repo
}

// Walk the whole plugin-data store AND every git object on the ledger ref, hunting for the marker.
const markerOnDisk = (root: string, marker: string): string[] => {
  const hits: string[] = []
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name)
      if (e.isDirectory()) { if (e.name === '.git') continue; walk(p); continue }
      try { if (readFileSync(p, 'utf8').includes(marker)) hits.push(p) } catch {}
    }
  }
  if (existsSync(root)) walk(root)
  return hits
}
const markerInLedgerGit = (repo: string, marker: string): boolean => {
  const refs = g(repo, ['for-each-ref', '--format=%(refname)']).stdout.split('\n').filter(Boolean)
  for (const ref of refs) {
    const files = g(repo, ['ls-tree', '-r', '--name-only', ref]).stdout.split('\n').filter(Boolean)
    for (const f of files) {
      if (g(repo, ['show', `${ref}:${f}`]).stdout.includes(marker)) return true
    }
  }
  return false
}

const scenario = async (name: string, run: (env: any) => Promise<{ marker: string; result: any }>) => {
  const repo = buildRepo()
  const pluginData = mkdtempSync(join(tmpdir(), 'logbook-f7-data-'))
  try {
    const { marker, result } = await run({ repo, pluginData })
    const diskHits = markerOnDisk(pluginData, marker)
    const gitHit = markerInLedgerGit(repo, marker)
    console.log(`\n=== ${name} ===`)
    console.log(`  reply.ok            : ${result.ok}`)
    console.log(`  status              : ${result.ok ? result.structured.status : '(refusal) ' + result.refusal.field}`)
    console.log(`  session_entry_ids   : ${result.ok ? JSON.stringify(result.structured.session_entry_ids) : 'n/a'}`)
    console.log(`  text                : ${result.ok ? result.text : result.refusal.message}`)
    console.log(`  outcome on disk     : ${diskHits.length} file(s) ${JSON.stringify(diskHits.map(h => h.slice(pluginData.length)))}`)
    console.log(`  outcome in ledger   : ${gitHit}`)
    console.log(`  VERDICT             : ${diskHits.length === 0 && !gitHit ? 'LOG DISCARDED' : 'log persisted'}`)
  } finally {
    rmSync(repo, { recursive: true, force: true }); rmSync(pluginData, { recursive: true, force: true })
  }
}

const bigOutcome = (marker: string) => marker + 'x'.repeat(caps.SESSION_BODY_MAX - marker.length)

await scenario('A. nothing-to-park (no pointer at all)', async ({ repo, pluginData }) => {
  const rt = mkRuntime(repo, pluginData, 'session-A')
  const o = await openThreadTool.handler(rt, CTX, { title: 'repro thread', slug: 'repro-a', completion_criteria: ['c'] })
  if (!o.ok) throw new Error('open failed: ' + JSON.stringify(o))
  const marker = 'MARKER-NOTHING-TO-PARK-8000'
  const outcome = bigOutcome(marker)
  console.log(`  [outcome length     : ${outcome.length} chars, cap is ${caps.SESSION_BODY_MAX}]`)
  const result = await parkThreadTool.handler(rt, CTX, { outcome })
  return { marker, result }
})

await scenario('B. not-the-worked-thread (mismatched thread_id)', async ({ repo, pluginData }) => {
  const rt = mkRuntime(repo, pluginData, 'session-B')
  const a = await openThreadTool.handler(rt, CTX, { title: 't a', slug: 'repro-b-a', completion_criteria: ['c'] })
  const b = await openThreadTool.handler(rt, CTX, { title: 't b', slug: 'repro-b-b', completion_criteria: ['c'] })
  await resumeThreadTool.handler(rt, CTX, { thread_id: a.structured.thread_id })
  const marker = 'MARKER-NOT-THE-WORKED-THREAD'
  const result = await parkThreadTool.handler(rt, CTX, { thread_id: b.structured.thread_id, outcome: bigOutcome(marker) })
  return { marker, result }
})

await scenario('C. terminal-pointer-released (thread already closed)', async ({ repo, pluginData }) => {
  const rt = mkRuntime(repo, pluginData, 'session-C')
  const o = await openThreadTool.handler(rt, CTX, { title: 't', slug: 'repro-c', completion_criteria: ['c'] })
  await resumeThreadTool.handler(rt, CTX, { thread_id: o.structured.thread_id })
  await closeThreadTool.handler(rt, CTX, { thread_id: o.structured.thread_id, outcome: 'abandoned', detail: 'repro' })
  const marker = 'MARKER-TERMINAL-POINTER'
  const result = await parkThreadTool.handler(rt, CTX, { outcome: bigOutcome(marker) })
  return { marker, result }
})

await scenario('D. stale-pointer-released (corrupt pointer file)', async ({ repo, pluginData }) => {
  const rt = mkRuntime(repo, pluginData, 'session-D')
  await openThreadTool.handler(rt, CTX, { title: 't', slug: 'repro-d', completion_criteria: ['c'] })
  const lay = layoutFor(rt, repo)
  mkdirSync(lay.value.state, { recursive: true })
  writeFileSync(join(lay.value.state, 'active-thread.json'), 'not-json{{{', 'utf8')
  const marker = 'MARKER-STALE-POINTER'
  const result = await parkThreadTool.handler(rt, CTX, { outcome: bigOutcome(marker) })
  return { marker, result }
})

await scenario('E. CONTROL: parked (pointer held) - the log MUST survive', async ({ repo, pluginData }) => {
  const rt = mkRuntime(repo, pluginData, 'session-E')
  const o = await openThreadTool.handler(rt, CTX, { title: 't', slug: 'repro-e', completion_criteria: ['c'] })
  await resumeThreadTool.handler(rt, CTX, { thread_id: o.structured.thread_id })
  const marker = 'MARKER-HAPPY-PATH-PARKED'
  const result = await parkThreadTool.handler(rt, CTX, { outcome: bigOutcome(marker) })
  return { marker, result }
})
