import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readdirSync, existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openStore } from '/Users/satanshumishra/Documents/DevLabs/logbook/src/store/records.ts'
import { layoutFor, createStoreDirectories } from '/Users/satanshumishra/Documents/DevLabs/logbook/src/store/layout.ts'
import { ensureSingleStore } from '/Users/satanshumishra/Documents/DevLabs/logbook/src/store/single-store.ts'

const sh = (cwd: string, args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

const sandbox = mkdtempSync(path.join(tmpdir(), 'logbook-f3-'))
const project = path.join(sandbox, 'project')
const rootA = path.join(sandbox, 'data', 'logbook-inline')
const rootB = path.join(sandbox, 'data', 'logbook-logbook')
mkdirSync(rootA, { recursive: true })
mkdirSync(rootB, { recursive: true })

execFileSync('git', ['init', '-q', project])
sh(project, ['config', 'user.name', 'Probe'])
sh(project, ['config', 'user.email', 'probe@example.invalid'])
writeFileSync(path.join(project, 'a.txt'), 'hi')
sh(project, ['add', '-A']); sh(project, ['commit', '-q', '-m', 'seed'])

const mkRt = (pluginData: string) => ({
  now: () => new Date().toISOString(), ulid: () => 'x', cwd: project, log: () => {},
  sessionId: 's', env: Object.freeze({ ...process.env, CLAUDE_PLUGIN_DATA: pluginData })
})

const rtA = mkRt(rootA), rtB = mkRt(rootB)

const a = openStore(rtA as never, project)
if (!a.ok) throw new Error('A refused')
a.value.commit([{ kind: 'raw', relPath: 'threads/01ABC.json', content: '{"probe":1}' }], 'seed ledger')

const keyA = readdirSync(rootA)[0]!
console.log('=== PROBE 1: same project, two install-source data roots ===')
console.log('root A key:', keyA)

const layB = layoutFor(rtB as never, project)
if (!layB.ok) throw new Error('layoutFor B refused')
console.log('root B key:', path.basename(layB.value.root))
console.log('keys identical across roots:', keyA === path.basename(layB.value.root))

const guardA = ensureSingleStore(rtA as never, (layoutFor(rtA as never, project) as {ok:true;value:never}).value)
const guardB = ensureSingleStore(rtB as never, layB.value)
console.log('ensureSingleStore(root A) ->', guardA.ok ? 'PASS (no duplicate detected)' : 'REFUSED')
console.log('ensureSingleStore(root B) ->', guardB.ok ? 'PASS (no duplicate detected)' : 'REFUSED')
console.log()

console.log('=== PROBE 2: a hook creates root B WITHOUT materialising (stop-gate path) ===')
createStoreDirectories(layB.value)
const bFiles = () => {
  const out: string[] = []
  const walk = (d: string) => { for (const e of readdirSync(d, {withFileTypes:true})) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(path.relative(layB.value.root, p)) } }
  walk(layB.value.root); return out
}
console.log('root B contents after createStoreDirectories:', JSON.stringify(bFiles()))
console.log('root B has state/last-synced:', existsSync(path.join(layB.value.state, 'last-synced')))
console.log()

console.log('=== PROBE 3: poisoned stamp - materialiseTree fails but the stamp is written anyway ===')
const localTip = sh(project, ['rev-parse', 'refs/logbook/ledger'])
// Simulate a store whose records were lost but whose stamp already names the tip.
const b1 = openStore(rtB as never, project)
if (!b1.ok) throw new Error('B refused')
console.log('root B threads after a normal open:', readdirSync(path.join(layB.value.records, 'threads')).length)
rmSync(layB.value.records, { recursive: true, force: true })
mkdirSync(layB.value.records, { recursive: true })
console.log('records wiped; stamp still says:', readFileSync(path.join(layB.value.state, 'last-synced'),'utf8').trim())
console.log('local tip                     :', localTip)
const b2 = openStore(rtB as never, project)
if (!b2.ok) throw new Error('B refused 2')
const threadsNow = existsSync(path.join(layB.value.records,'threads')) ? readdirSync(path.join(layB.value.records,'threads')).length : 0
console.log('threads visible after reopen  :', threadsNow, '(0 = store stays EMPTY, no re-materialise, no error)')
console.log('readThreads() length          :', b2.value.readThreads().length)
console.log()
console.log('sandbox (disposable):', sandbox)
