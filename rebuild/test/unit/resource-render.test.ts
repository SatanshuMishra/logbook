import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Decision } from '../../src/schema/decision.ts'
import { renderDecisionResource } from '../../src/server/resource-render.ts'

const DECISION_WITHOUT_COMMIT: Omit<Decision, 'commit'> = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  title: 'widen the renderer census',
  context: 'array elements were never entered into the population',
  options: ['widen the collector', 'leave the census as it is'],
  outcome: 'widen the collector',
  supersedes: [],
  created_at: '2026-08-24T00:00:00.000Z'
}

const commitLineOf = (rendered: string): string | undefined =>
  rendered.split('\n').find((line) => line.startsWith('Commit:'))

test('resource-render.decision.renders-the-recorded-commit', () => {
  const rendered = renderDecisionResource({ ...DECISION_WITHOUT_COMMIT, commit: 'a1b2c3d' })
  assert.equal(commitLineOf(rendered), 'Commit: a1b2c3d')
})

test('resource-render.decision.renders-unknown-when-no-commit-was-recorded', () => {
  const rendered = renderDecisionResource({ ...DECISION_WITHOUT_COMMIT, commit: null })
  assert.equal(commitLineOf(rendered), 'Commit: unknown')
})

test('resource-render.decision.renders-unknown-when-the-commit-field-is-absent', () => {
  const rendered = renderDecisionResource(DECISION_WITHOUT_COMMIT as Decision)
  assert.equal(commitLineOf(rendered), 'Commit: unknown')
})
