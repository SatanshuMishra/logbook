import { mkdtempSync, symlinkSync, writeFileSync, linkSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const REPO = '/Users/satanshumishra/Documents/DevLabs/logbook'
const { guardDecision } = await import(pathToFileURL(path.join(REPO, 'src/hooklib/guard.ts')).href)
const { layoutFor, createStoreDirectories } = await import(pathToFileURL(path.join(REPO, 'src/store/layout.ts')).href)

const projectRoot = mkdtempSync(path.join(tmpdir(), 'probe2-project-'))
const pluginData = mkdtempSync(path.join(tmpdir(), 'probe2-plugin-data-'))
const rt = { now: () => '', ulid: () => '', env: Object.freeze({ CLAUDE_PLUGIN_DATA: pluginData }), cwd: projectRoot, log: () => {}, sessionId: 'p' }
const layout = layoutFor(rt, projectRoot)
if (!layout.ok) throw new Error('layout failed')
createStoreDirectories(layout.value)

const g = (label, ev) => {
  let out
  try { out = guardDecision(rt, ev) } catch (e) { out = { kind: 'THREW: ' + e.message } }
  console.log(String(out.kind).padEnd(7), '|', label)
}

const rel = path.relative(projectRoot, path.join(layout.value.root, 'records', 'x.json'))
g('relative traversal from projectRoot: ' + rel.slice(0, 30) + '...', { tool_name: 'Write', tool_input: { file_path: rel }, cwd: projectRoot })

// symlink placed INSIDE a benign dir pointing at a file inside the store
const benign = path.join(projectRoot, 'benign')
mkdirSync(benign)
const realTarget = path.join(layout.value.records, 'real.json')
writeFileSync(realTarget, '{}')
const linkToStoreFile = path.join(benign, 'alias.json')
symlinkSync(realTarget, linkToStoreFile)
g('symlink (inside project) -> existing store FILE', { tool_name: 'Write', tool_input: { file_path: linkToStoreFile }, cwd: projectRoot })

// symlink to store DIR then a NEW (nonexistent) file under it
const dirAlias = path.join(benign, 'diralias')
symlinkSync(layout.value.records, dirAlias)
g('symlink -> store DIR, new file under it', { tool_name: 'Write', tool_input: { file_path: path.join(dirAlias, 'new.json') }, cwd: projectRoot })

// HARDLINK: hardlink outside the store to a file inside the store
const hard = path.join(benign, 'hardlink.json')
try { linkSync(realTarget, hard); g('HARDLINK (outside store) -> store file', { tool_name: 'Write', tool_input: { file_path: hard }, cwd: projectRoot }) }
catch (e) { console.log('hardlink setup failed:', e.message) }

// Bash forms
g('Bash: quoted store path', { tool_name: 'Bash', tool_input: { command: `rm -rf "${layout.value.root}"` }, cwd: projectRoot })
g('Bash: store path via shell var', { tool_name: 'Bash', tool_input: { command: `D=${layout.value.root.slice(0,10)}; rm -rf "$D"*` }, cwd: projectRoot })
g('Bash: store path via $(...)', { tool_name: 'Bash', tool_input: { command: 'rm -rf $(cat /tmp/where)' }, cwd: projectRoot })
g('Bash: relative traversal', { tool_name: 'Bash', tool_input: { command: `rm -rf ${rel}` }, cwd: projectRoot })
g('Bash: no slash at all (cd then rm)', { tool_name: 'Bash', tool_input: { command: `cd ${layout.value.root} && rm -rf records` }, cwd: projectRoot })
g('Bash: array command (non-string)', { tool_name: 'Bash', tool_input: { command: ['rm','-rf'] }, cwd: projectRoot })
g('Bash: git ref name', { tool_name: 'Bash', tool_input: { command: 'git update-ref -d refs/logbook/ledger' }, cwd: projectRoot })

// unresolvable store, ledger-prefixed name
const rt2 = { ...rt, env: Object.freeze({}) }
let v
try { v = guardDecision(rt2, { tool_name: 'mcp__ledger__totally_made_up', tool_input: {}, cwd: projectRoot }) } catch (e) { v = { kind: 'THREW ' + e.message } }
console.log(String(v.kind).padEnd(7), '| CLAUDE_PLUGIN_DATA unset + prefixed unregistered name')
let w
try { w = guardDecision(rt2, { tool_name: 'Write', tool_input: { file_path: path.join(layout.value.root, 'x.json') }, cwd: projectRoot }) } catch (e) { w = { kind: 'THREW ' + e.message } }
console.log(String(w.kind).padEnd(7), '| CLAUDE_PLUGIN_DATA unset + Write into store')
