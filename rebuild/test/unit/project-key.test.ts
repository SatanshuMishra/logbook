import assert from 'node:assert/strict'
import test from 'node:test'
import { projectKey } from '../../src/store/project-key.ts'

const mulberry32 = (seed: number): (() => number) => {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PATH_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789-_'

const randomSegment = (rng: () => number): string => {
  const length = 3 + Math.floor(rng() * 8)
  let segment = ''
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(rng() * PATH_CHARS.length)
    segment += PATH_CHARS[index] ?? 'a'
  }
  return segment
}

const randomAbsolutePath = (rng: () => number): string => {
  const depth = 2 + Math.floor(rng() * 4)
  const segments: string[] = []
  for (let i = 0; i < depth; i += 1) {
    segments.push(randomSegment(rng))
  }
  return `/${segments.join('/')}`
}

const mutateOneByte = (value: string, rng: () => number): string => {
  const index = Math.floor(rng() * value.length)
  const chars = value.split('')
  const original = chars[index] ?? ''
  let replacement = original
  while (replacement === original) {
    const pick = Math.floor(rng() * PATH_CHARS.length)
    replacement = PATH_CHARS[pick] ?? 'a'
  }
  chars[index] = replacement
  return chars.join('')
}

test('key.is-injective', () => {
  assert.notEqual(projectKey('/a/b-c'), projectKey('/a/b/c'))

  const rng = mulberry32(20260822)
  for (let i = 0; i < 2000; i += 1) {
    const base = randomAbsolutePath(rng)
    const mutated = mutateOneByte(base, rng)
    assert.notEqual(projectKey(base), projectKey(mutated))
  }
})
