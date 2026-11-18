import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTRUCTIONS } from '../../src/server/instructions.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const INSTRUCTIONS_BYTE_LIMIT = 640
const LEDGER_TOOL_NAMES: readonly string[] = [
  'open_thread',
  'resume_thread',
  'record_decision',
  'park_thread',
  'close_thread',
  'list_threads',
  'search_ledger',
  'sync_ledger'
]
const SHIPPED_FOLDERS: readonly string[] = ['skills', 'src']
const HELD_OUT_TEXTS: readonly string[] = ['auth-hardening', 'authsvc', 'lockout', 'Bob will take this work over']

const readSkill = (name: string): string => readFileSync(join(PROJECT_ROOT, 'skills', name, 'SKILL.md'), 'utf8')

const filesUnder = (folder: string): string[] =>
  readdirSync(folder, { withFileTypes: true })
    .map((entry) => ({ entry, path: join(folder, entry.name) }))
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap(({ entry, path }) => (entry.isDirectory() ? filesUnder(path) : entry.isFile() ? [path] : []))

test('one-command-text.skills-name-the-command', () => {
  const debrief = readSkill('debrief')
  const preflight = readSkill('preflight')

  assert.ok(debrief.includes('logbook update_thread --args -'), 'skills/debrief/SKILL.md holds logbook update_thread --args -')
  assert.ok(debrief.includes('logbook park_thread'), 'skills/debrief/SKILL.md holds logbook park_thread')
  assert.ok(preflight.includes('logbook resume_thread'), 'skills/preflight/SKILL.md holds logbook resume_thread')
  assert.match(
    preflight,
    /state document in your context[^\n]*with no call/i,
    'skills/preflight/SKILL.md says a state document already in context needs no call'
  )
})

test('one-command-text.instructions-fit-and-name-the-command', () => {
  const bytes = Buffer.byteLength(INSTRUCTIONS, 'utf8')

  assert.ok(bytes <= INSTRUCTIONS_BYTE_LIMIT, `the server instructions are ${bytes} bytes`)
  assert.ok(INSTRUCTIONS.includes('logbook update_thread'), 'the server instructions hold logbook update_thread')
  assert.ok(INSTRUCTIONS.includes('state document'), 'the server instructions hold state document')
  assert.ok(INSTRUCTIONS.includes('do not print'), 'the server instructions hold do not print')
  assert.deepEqual(
    LEDGER_TOOL_NAMES.filter((name) => INSTRUCTIONS.includes(name)),
    [],
    'the server instructions name no ledger tool'
  )
})

test('one-command-text.no-held-out-eval-text', () => {
  const found = SHIPPED_FOLDERS.flatMap((folder) => filesUnder(join(PROJECT_ROOT, folder))).flatMap((file) => {
    const text = readFileSync(file, 'utf8').toLowerCase()
    return HELD_OUT_TEXTS.filter((heldOut) => text.includes(heldOut.toLowerCase())).map(
      (heldOut) => `${relative(PROJECT_ROOT, file)} holds ${heldOut}`
    )
  })

  assert.deepEqual(found, [])
})
