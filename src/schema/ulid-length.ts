import { ULID_PATTERN } from './ids.ts'

const ULID_QUANTIFIER_PATTERN = /\{(\d+)\}/

const deriveUlidLength = (): number => {
  const match = ULID_QUANTIFIER_PATTERN.exec(ULID_PATTERN.source)
  const captured = match?.[1]
  if (captured === undefined) {
    throw new Error('schema/ulid-length: ULID_PATTERN.source no longer carries a {n} quantifier to derive its length from')
  }
  return Number(captured)
}

export const ULID_LENGTH = deriveUlidLength()
