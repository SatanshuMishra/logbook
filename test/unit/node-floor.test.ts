import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nodeFloorFailure } from '../../src/runtime/node-floor.ts'

test('runtime.node-floor.at-floor-passes', () => {
  assert.equal(nodeFloorFailure('22.18.0'), null)
})

test('runtime.node-floor.above-floor-patch-passes', () => {
  assert.equal(nodeFloorFailure('22.18.5'), null)
})

test('runtime.node-floor.above-floor-major-passes', () => {
  assert.equal(nodeFloorFailure('24.0.0'), null)
})

test('runtime.node-floor.well-above-floor-passes', () => {
  assert.equal(nodeFloorFailure('26.4.0'), null)
})

test('runtime.node-floor.below-floor-minor-fails', () => {
  const message = nodeFloorFailure('22.17.9')
  assert.notEqual(message, null)
  assert.ok(typeof message === 'string' && message.length > 0)
  assert.ok(message?.includes('22.17.9'))
})

test('runtime.node-floor.below-floor-major-fails', () => {
  const message = nodeFloorFailure('20.11.0')
  assert.notEqual(message, null)
  assert.ok(typeof message === 'string' && message.length > 0)
  assert.ok(message?.includes('20.11.0'))
})

test('runtime.node-floor.lexical-comparison-trap-fails', () => {
  const message = nodeFloorFailure('9.0.0')
  assert.notEqual(message, null)
  assert.ok(typeof message === 'string' && message.length > 0)
  assert.ok(message?.includes('9.0.0'))
})

test('runtime.node-floor.unparseable-version-fails', () => {
  const message = nodeFloorFailure('not-a-version')
  assert.notEqual(message, null)
  assert.ok(typeof message === 'string' && message.length > 0)
  assert.ok(message?.includes('not-a-version'))
})

test('runtime.node-floor.empty-string-fails', () => {
  const message = nodeFloorFailure('')
  assert.notEqual(message, null)
  assert.ok(typeof message === 'string' && message.length > 0)
})
