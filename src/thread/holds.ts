import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { durableWrite } from '../store/durable-write.ts'
import {
  SESSION_ID_PATTERN,
  THREAD_SLUG_PATTERN,
  checkSessionId,
  holdPath,
  redirectPath,
  type RepoPaths
} from './paths.ts'

export type Hold = {
  slug: string
  holder: string | null
  transcripts: string[]
  folded_at: string | null
  nudged_prompt_id: string | null
}

const HOLDS_FOLDER = 'holds'
const HOLD_SUFFIX = '.json'
const TRANSCRIPT_SUFFIX = '.jsonl'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

const writeJson = (rt: Runtime, file: string, value: unknown): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  durableWrite(file, JSON.stringify(value), { log: rt.log })
}

const refused = (refusal: Refusal): Error => new Error(`${refusal.field}: ${refusal.message}`)

const parseHold = (slug: string, value: unknown): Hold | null => {
  if (!isPlainObject(value)) return null
  const { slug: storedSlug, holder, transcripts, folded_at: foldedAt, nudged_prompt_id: nudgedPromptId } = value
  if (storedSlug !== slug) return null
  if (!isStringOrNull(holder) || !isStringList(transcripts)) return null
  if (!isStringOrNull(foldedAt) || !isStringOrNull(nudgedPromptId)) return null
  return { slug, holder, transcripts: [...transcripts], folded_at: foldedAt, nudged_prompt_id: nudgedPromptId }
}

export const readHold = (paths: RepoPaths, slug: string): Hold | null => {
  const file = holdPath(paths, slug)
  return file.ok ? parseHold(slug, readJson(file.value)) : null
}

const sameHold = (left: Hold, right: Hold): boolean => JSON.stringify(left) === JSON.stringify(right)

const storeHold = (rt: Runtime, paths: RepoPaths, previous: Hold | null, next: Hold): Hold => {
  const file = holdPath(paths, next.slug)
  if (!file.ok) throw refused(file)
  if (previous === null || !sameHold(previous, next)) writeJson(rt, file.value, next)
  return next
}

const withTranscript = (transcripts: string[], transcript: string | null): string[] =>
  transcript === null || transcripts.includes(transcript) ? transcripts : [...transcripts, transcript]

const holdSlugs = (paths: RepoPaths): string[] => {
  try {
    return readdirSync(path.join(paths.logbookDir, HOLDS_FOLDER))
      .filter((name) => name.endsWith(HOLD_SUFFIX))
      .map((name) => name.slice(0, name.length - HOLD_SUFFIX.length))
      .filter((slug) => THREAD_SLUG_PATTERN.test(slug))
      .sort()
  } catch {
    return []
  }
}

const holdsOf = (paths: RepoPaths, session: string): Hold[] =>
  holdSlugs(paths).flatMap((slug) => {
    const hold = readHold(paths, slug)
    return hold !== null && hold.holder === session ? [hold] : []
  })

export const heldBy = (paths: RepoPaths, session: string): string | null => holdsOf(paths, session)[0]?.slug ?? null

export const takeHold = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  session: string,
  transcript: string | null
): Hold => {
  const file = holdPath(paths, slug)
  if (!file.ok) throw refused(file)
  for (const other of holdsOf(paths, session).filter((hold) => hold.slug !== slug)) {
    storeHold(rt, paths, other, { ...other, holder: null })
  }
  const previous = readHold(paths, slug)
  const next: Hold =
    previous === null
      ? { slug, holder: session, transcripts: withTranscript([], transcript), folded_at: null, nudged_prompt_id: null }
      : { ...previous, holder: session, transcripts: withTranscript(previous.transcripts, transcript) }
  return storeHold(rt, paths, previous, next)
}

const updateHold = (rt: Runtime, paths: RepoPaths, slug: string, change: (hold: Hold) => Hold): Hold | null => {
  const previous = readHold(paths, slug)
  return previous === null ? null : storeHold(rt, paths, previous, change(previous))
}

export const addTranscript = (rt: Runtime, paths: RepoPaths, slug: string, transcript: string): Hold | null =>
  updateHold(rt, paths, slug, (hold) => ({ ...hold, transcripts: withTranscript(hold.transcripts, transcript) }))

const isTranscriptOf = (holder: string | null, transcript: string): boolean =>
  holder === null || path.basename(transcript) === `${holder}${TRANSCRIPT_SUFFIX}`

export const foldHold = (rt: Runtime, paths: RepoPaths, slug: string, at: string): Hold | null =>
  updateHold(rt, paths, slug, (hold) => ({
    ...hold,
    transcripts: hold.transcripts.filter((transcript) => isTranscriptOf(hold.holder, transcript)),
    folded_at: at,
    nudged_prompt_id: null
  }))

export const releaseHold = (rt: Runtime, paths: RepoPaths, slug: string): Hold | null =>
  updateHold(rt, paths, slug, (hold) => ({ ...hold, holder: null }))

export const setNudged = (rt: Runtime, paths: RepoPaths, slug: string, promptId: string): Hold | null =>
  updateHold(rt, paths, slug, (hold) => ({ ...hold, nudged_prompt_id: promptId }))

const readRedirect = (paths: RepoPaths, session: string): string | null => {
  const file = redirectPath(paths, session)
  if (!file.ok) return null
  const value = readJson(file.value)
  if (!isPlainObject(value)) return null
  const { session: next } = value
  return typeof next === 'string' && SESSION_ID_PATTERN.test(next) ? next : null
}

export const writeRedirect = (rt: Runtime, paths: RepoPaths, from: string, to: string): void => {
  const file = redirectPath(paths, from)
  if (!file.ok) throw refused(file)
  const target = checkSessionId('session', to)
  if (target !== null) throw refused(target)
  writeJson(rt, file.value, { session: to })
}

export const actingSession = (paths: RepoPaths, session: string): string => {
  const seen = new Set<string>([session])
  let current = session
  let next = readRedirect(paths, current)
  while (next !== null && !seen.has(next)) {
    seen.add(next)
    current = next
    next = readRedirect(paths, current)
  }
  return current
}
