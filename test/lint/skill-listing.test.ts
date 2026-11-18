import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SKILLS_ROOT = fileURLToPath(new URL('../../skills', import.meta.url))
const FRONTMATTER_FENCE = '---'
const HIDDEN_LINE = 'disable-model-invocation: true'

const skillNames = (): string[] =>
  readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()

const frontmatterOf = (name: string): string[] => {
  const lines = readFileSync(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8').split('\n')
  const open = lines.indexOf(FRONTMATTER_FENCE)
  const close = lines.indexOf(FRONTMATTER_FENCE, open + 1)
  assert.ok(open === 0 && close > open, `skills/${name}/SKILL.md must open with frontmatter between two --- lines`)
  return lines.slice(open + 1, close)
}

test('skill-listing.skills-load-only-when-typed', () => {
  const names = skillNames()
  assert.ok(names.length > 0, 'skills/ holds no skill; a check over no skills proves nothing')

  const listed = names.filter((name) => !frontmatterOf(name).some((line) => line.trim() === HIDDEN_LINE))

  assert.deepEqual(listed, [], `these skills do not set ${HIDDEN_LINE}: ${listed.join(', ')}`)
})
