import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const REGISTER_PATH = fileURLToPath(new URL('../../docs/registers/size-limits.json', import.meta.url))

export type LimitBasis = 'measured' | 'derived' | 'external' | 'chosen' | 'unrecorded'
export type MirrorRelation = 'equal' | 'at-most' | 'at-least'

export type LimitRow = {
  name: string
  site: string
  value: number | 'Infinity' | '-Infinity'
  basis: LimitBasis
  reason: string | null
  mirrors: string | null
  mirror_relation: MirrorRelation | null
}

const LIMIT_BASES: readonly LimitBasis[] = ['measured', 'derived', 'external', 'chosen', 'unrecorded']
const MIRROR_RELATIONS: readonly MirrorRelation[] = ['equal', 'at-most', 'at-least']
const SITE_PATTERN = /^.+:\d+$/

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isRegisterValue = (value: unknown): value is number | 'Infinity' | '-Infinity' =>
  (typeof value === 'number' && Number.isFinite(value)) || value === 'Infinity' || value === '-Infinity'

const parseLimitRow = (sourceLabel: string, index: number, raw: unknown): LimitRow => {
  const where = `${sourceLabel}[${index}]`
  if (!isPlainObject(raw)) {
    throw new Error(`limits-register: ${where} is not an object; every register row must be an object`)
  }
  const { name, site, value, basis, reason, mirrors, mirror_relation: mirrorRelation } = raw

  if (typeof name !== 'string' || name.length === 0) {
    throw new Error(`limits-register: ${where} has no non-empty string "name"; found ${JSON.stringify(name)}`)
  }
  if (typeof site !== 'string' || !SITE_PATTERN.test(site)) {
    throw new Error(
      `limits-register: ${where} (${name}) has no "site" matching "<repo-relative-path>:<line>"; found ${JSON.stringify(site)}`
    )
  }
  if (!isRegisterValue(value)) {
    throw new Error(
      `limits-register: ${where} (${name}) has a "value" that is neither a finite number nor "Infinity"/"-Infinity"; found ${JSON.stringify(value)}`
    )
  }
  if (typeof basis !== 'string' || !LIMIT_BASES.includes(basis as LimitBasis)) {
    throw new Error(
      `limits-register: ${where} (${name}) has an invalid "basis"; found ${JSON.stringify(basis)}, expected one of ${LIMIT_BASES.join(', ')}`
    )
  }
  if (reason === null) {
    if (basis !== 'unrecorded') {
      throw new Error(
        `limits-register: ${where} (${name}) has "reason": null but "basis" is "${basis}"; reason may be null only when basis is "unrecorded"`
      )
    }
  } else if (typeof reason !== 'string' || reason.length === 0) {
    throw new Error(
      `limits-register: ${where} (${name}) has a "reason" that is neither null nor a non-empty string; found ${JSON.stringify(reason)}`
    )
  }
  if (mirrors !== null && (typeof mirrors !== 'string' || mirrors.length === 0)) {
    throw new Error(
      `limits-register: ${where} (${name}) has a "mirrors" that is neither null nor a non-empty string; found ${JSON.stringify(mirrors)}`
    )
  }
  if (mirrorRelation !== null && (typeof mirrorRelation !== 'string' || !MIRROR_RELATIONS.includes(mirrorRelation as MirrorRelation))) {
    throw new Error(
      `limits-register: ${where} (${name}) has an invalid "mirror_relation"; found ${JSON.stringify(mirrorRelation)}, expected null or one of ${MIRROR_RELATIONS.join(', ')}`
    )
  }
  if ((mirrors === null) !== (mirrorRelation === null)) {
    throw new Error(
      `limits-register: ${where} (${name}) has "mirrors" and "mirror_relation" that disagree on nullness; both must be null together or both non-null together`
    )
  }

  return {
    name,
    site,
    value,
    basis: basis as LimitBasis,
    reason: reason as string | null,
    mirrors: mirrors as string | null,
    mirror_relation: mirrorRelation as MirrorRelation | null
  }
}

export const parseLimitsRegisterRows = (raw: unknown, sourceLabel: string): LimitRow[] => {
  if (!Array.isArray(raw)) {
    throw new Error(`limits-register: ${sourceLabel} must hold a JSON array at its root; found ${JSON.stringify(raw)}`)
  }
  return raw.map((entry, index) => parseLimitRow(sourceLabel, index, entry))
}

export const loadLimitsRegister = (): LimitRow[] => {
  let text: string
  try {
    text = readFileSync(REGISTER_PATH, 'utf8')
  } catch (cause) {
    throw new Error(`limits-register: could not read the register at ${REGISTER_PATH}: ${String(cause)}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`limits-register: ${REGISTER_PATH} is not valid JSON: ${String(cause)}`)
  }
  return parseLimitsRegisterRows(parsed, REGISTER_PATH)
}
