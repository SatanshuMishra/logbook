import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { refuse } from '../../src/schema/refusal.ts'
import * as caps from '../../src/schema/caps.ts'
import { escapeStored } from '../../src/render/escape.ts'
import { CLIP_MARKER } from '../../src/render/clip.ts'

const Shape = z.strictObject({ name: z.string().min(1) })
const jsonSchema = z.toJSONSchema(Shape, { target: 'draft-7', io: 'input' }) as Record<string, unknown>

const rejectExtraKeys = (extra: Record<string, unknown>): z.core.$ZodIssue[] => {
  const result = Shape.safeParse({ name: 'ok', ...extra })
  assert.equal(result.success, false)
  if (result.success) {
    throw new Error('expected the strict object to reject the unrecognized keys')
  }
  return result.error.issues
}

test('refusal.unrecognized-key-is-escaped', () => {
  const forgedKey = '# Forged\naccepted: true'
  const issues = rejectExtraKeys({ [forgedKey]: 'x' })

  const refusal = refuse(jsonSchema, issues)
  assert.equal(refusal.ok, false)
  assert.equal(refusal.field, escapeStored(forgedKey))
  assert.equal(refusal.field.includes('\n'), false)
  assert.equal(refusal.message.includes('\n'), false)
})

test('refusal.unrecognized-keys-are-count-bounded', () => {
  const manyKeys = Object.fromEntries(
    Array.from({ length: caps.UNRECOGNIZED_KEYS_SHOWN_MAX + 20 }, (_, i) => [`extra${i}`, 'x'])
  )
  const issues = rejectExtraKeys(manyKeys)

  const refusal = refuse(jsonSchema, issues)
  const shownKeys = refusal.field.split(',').filter((part) => part.startsWith('extra'))
  assert.ok(shownKeys.length <= caps.UNRECOGNIZED_KEYS_SHOWN_MAX)
  assert.match(refusal.field, /more/)
})

test('refusal.unrecognized-key-name-is-length-bounded', () => {
  const longKey = 'x'.repeat(caps.UNRECOGNIZED_KEY_NAME_MAX + 200)
  const issues = rejectExtraKeys({ [longKey]: 'x' })

  const refusal = refuse(jsonSchema, issues)
  assert.ok(refusal.field.length <= caps.UNRECOGNIZED_KEY_NAME_MAX)
})

test('refusal.an-over-long-unrecognized-key-carries-the-clip-marker', () => {
  const longKey = 'x'.repeat(caps.UNRECOGNIZED_KEY_NAME_MAX + 200)
  const issues = rejectExtraKeys({ [longKey]: 'x' })

  const refusal = refuse(jsonSchema, issues)
  assert.ok(
    refusal.field.endsWith(CLIP_MARKER),
    `a key long enough to force a clip must carry the clip marker, got: ${refusal.field}`
  )
})

test('refusal.an-unrecognized-key-that-fits-carries-no-clip-marker', () => {
  const shortKey = 'x'.repeat(caps.UNRECOGNIZED_KEY_NAME_MAX - 10)
  const issues = rejectExtraKeys({ [shortKey]: 'x' })

  const refusal = refuse(jsonSchema, issues)
  assert.equal(
    refusal.field.endsWith(CLIP_MARKER),
    false,
    `a key that fits within the cap must not carry the clip marker, got: ${refusal.field}`
  )
})

const isWellFormedUtf16 = (value: string): boolean => {
  try {
    encodeURIComponent(value)
    return true
  } catch {
    return false
  }
}

test('refusal.unrecognized-key-name-is-clipped-by-grapheme-not-code-unit', () => {
  const emojiKey = 'a' + '😀'.repeat(100)
  const issues = rejectExtraKeys({ [emojiKey]: 'x' })

  const refusal = refuse(jsonSchema, issues)
  assert.equal(isWellFormedUtf16(refusal.field), true, 'clipping a surrogate pair in half must never reach the caller')
})
