import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { openStore } from '/Users/satanshumishra/Documents/DevLabs/logbook/src/store/records.ts'
import { sync } from '/Users/satanshumishra/Documents/DevLabs/logbook/src/merge/sync.ts'

const sh = (cwd: string, args: string[]): string =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim()

const sandbox = mkdtempSync(path.join(tmpdir(), 'logbook-f6-'))
const remote = path.join(sandbox, 'remote.git')
const project = path.join(sandbox, 'project')
const pluginData = path.join(sandbox, 'plugin-data')
mkdirSync(pluginData, { recursive: true })

execFileSync('git', ['init', '--bare', '-q', remote])
execFileSync('git', ['init', '-q', project])
sh(project, ['config', 'user.name', 'Probe'])
sh(project, ['config', 'user.email', 'probe@example.invalid'])
sh(project, ['remote', 'add', 'origin', remote])
execFileSync('sh', ['-c', `echo hi > ${path.join(project, 'a.txt')}`])
sh(project, ['add', '-A'])
sh(project, ['commit', '-q', '-m', 'seed'])
sh(project, ['push', '-q', 'origin', 'HEAD:refs/heads/main'])

const rt = {
  now: () => new Date().toISOString(),
  ulid: () => '01M0000000000000000000000X',
  env: Object.freeze({ ...process.env, CLAUDE_PLUGIN_DATA: pluginData }),
  cwd: project,
  log: () => {},
  sessionId: 'probe-session'
}

const opened = openStore(rt as never, project)
if (!opened.ok) throw new Error('openStore refused: ' + JSON.stringify(opened))

const commit = opened.value.commit(
  [{ kind: 'raw', relPath: 'probe.json', content: '{"probe":true}' }],
  'probe write'
)
if (!commit.ok) throw new Error('commit failed: ' + JSON.stringify(commit))

const storeRoots = execFileSync('ls', [pluginData], { encoding: 'utf8' }).trim().split('\n')
const storeRoot = path.join(pluginData, storeRoots[0]!)
const lastSyncedFile = path.join(storeRoot, 'state', 'last-synced')

const localRef = sh(project, ['rev-parse', 'refs/logbook/ledger'])
const stamp = existsSync(lastSyncedFile) ? readFileSync(lastSyncedFile, 'utf8').trim() : '(absent)'
const remoteLs = sh(project, ['ls-remote', 'origin', 'refs/logbook/ledger'])

console.log('=== PROBE 1: after a LOCAL commit, before ANY push ===')
console.log('store root                :', storeRoot)
console.log('local refs/logbook/ledger :', localRef)
console.log('state/last-synced         :', stamp)
console.log('origin refs/logbook/ledger:', remoteLs === '' ? '(ABSENT ON REMOTE)' : remoteLs)
console.log('stamp === local tip       :', stamp === localRef)
console.log('stamp present on remote   :', remoteLs.includes(stamp))
console.log()

console.log('=== PROBE 2: push fails (origin removed), does the stamp survive/advance? ===')
sh(project, ['remote', 'remove', 'origin'])
const commit2 = opened.value.commit(
  [{ kind: 'raw', relPath: 'probe2.json', content: '{"probe":2}' }],
  'probe write 2'
)
if (!commit2.ok) throw new Error('commit2 failed')
const localRef2 = sh(project, ['rev-parse', 'refs/logbook/ledger'])
const stamp2 = readFileSync(lastSyncedFile, 'utf8').trim()
const outcome = sync(rt as never, opened.value, {
  root: storeRoot,
  records: path.join(storeRoot, 'records'),
  state: path.join(storeRoot, 'state'),
  projectRoot: project
})
const stamp3 = readFileSync(lastSyncedFile, 'utf8').trim()
console.log('local tip after commit2   :', localRef2)
console.log('stamp after commit2       :', stamp2, '  (advanced with no remote at all:', stamp2 === localRef2, ')')
console.log('sync() outcome            :', JSON.stringify(outcome))
console.log('stamp after failed sync   :', stamp3)
console.log('stamp still = local tip   :', stamp3 === localRef2)
console.log()
console.log('sandbox (disposable):', sandbox)
