import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const readSkill = (name: string): string => readFileSync(join(PROJECT_ROOT, 'skills', name, 'SKILL.md'), 'utf8')

const namesArgument = (text: string, tool: string, argument: string): boolean =>
  text.includes(`\`${argument}\``) || text.includes(`\`${tool}.${argument}\``)

test('skills.preflight-resumes-without-printing', () => {
  const text = readSkill('preflight')

  assert.ok(text.includes('`resume_thread`'), 'skills/preflight/SKILL.md names resume_thread')
  assert.ok(text.includes('`list_threads`'), 'skills/preflight/SKILL.md names list_threads')
  assert.match(text, /never print the document/i, 'skills/preflight/SKILL.md says not to print the document')
  assert.match(
    text,
    /in one sentence which thread[^\n]*next step/i,
    'skills/preflight/SKILL.md asks for one sentence naming the thread and its next step'
  )
})

test('skills.file-opens-a-thread', () => {
  const text = readSkill('file')

  assert.ok(text.includes('`open_thread`'), 'skills/file/SKILL.md names open_thread')
  for (const argument of ['slug', 'title', 'goal', 'next_step', 'criteria']) {
    assert.ok(namesArgument(text, 'open_thread', argument), `skills/file/SKILL.md names the argument ${argument}`)
  }
})

test('skills.debrief-edits-then-parks', () => {
  const text = readSkill('debrief')

  const editAt = text.indexOf('Edit tool')
  const parkAt = text.indexOf('park_thread')
  assert.ok(editAt >= 0, 'skills/debrief/SKILL.md names the Edit tool')
  assert.ok(parkAt >= 0, 'skills/debrief/SKILL.md names park_thread')
  assert.ok(editAt < parkAt, 'skills/debrief/SKILL.md names the Edit tool before park_thread')
})

test('skills.name-no-removed-tool', () => {
  const forbidden = ['amend_criteria', 'bind_branch', 'log_session_event', 'resolve_conflict', 'verbatim']

  for (const name of ['preflight', 'file', 'debrief']) {
    const text = readSkill(name).toLowerCase()
    for (const word of forbidden) {
      assert.ok(!text.includes(word), `skills/${name}/SKILL.md holds ${word}`)
    }
  }
})

test('skills.debrief-states-the-update-rules', async () => {
  const { UPDATE_RULES } = await import('../../src/doc/rules.ts')
  const text = readSkill('debrief')

  assert.equal(UPDATE_RULES.length, 14)
  const ruleLines = text
    .split('\n')
    .filter((line) => line.startsWith('   - '))
    .map((line) => line.slice('   - '.length))
  const positions = UPDATE_RULES.map((rule) => ruleLines.indexOf(rule))
  for (const [index, rule] of UPDATE_RULES.entries()) {
    assert.ok((positions[index] ?? -1) >= 0, `skills/debrief/SKILL.md holds the rule on its own line: ${rule}`)
  }
  assert.deepEqual(
    positions,
    [...positions].sort((left, right) => left - right),
    'skills/debrief/SKILL.md holds the rules in the order UPDATE_RULES holds them'
  )
  assert.ok(!text.includes('finished work as one line'), 'skills/debrief/SKILL.md holds "finished work as one line"')
})
