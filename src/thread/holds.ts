import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
  process: number | null
  released_from: string | null
}

const HOLDS_FOLDER = 'holds'
const HOLD_SUFFIX = '.json'
const TRANSCRIPT_SUFFIX = '.jsonl'
const ENDED_TRANSCRIPT_AGE_MS = 24 * 60 * 60 * 1000
const PROBE_SIGNAL = 0
const NO_SUCH_PROCESS = 'ESRCH'

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

const recordedProcess = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null

const parseHold = (slug: string, value: unknown): Hold | null => {
  if (!isPlainObject(value)) return null
  const {
    slug: storedSlug,
    holder,
    transcripts,
    folded_at: foldedAt,
    nudged_prompt_id: nudgedPromptId,
    process: storedProcess,
    released_from: releasedFrom = null
  } = value
  if (storedSlug !== slug) return null
  if (!isStringOrNull(holder) || !isStringList(transcripts)) return null
  if (!isStringOrNull(foldedAt) || !isStringOrNull(nudgedPromptId) || !isStringOrNull(releasedFrom)) return null
  return {
    slug,
    holder,
    transcripts: [...transcripts],
    folded_at: foldedAt,
    nudged_prompt_id: nudgedPromptId,
    process: recordedProcess(storedProcess),
    released_from: releasedFrom
  }
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

const allHolds = (paths: RepoPaths): Hold[] =>
  holdSlugs(paths).flatMap((slug) => {
    const hold = readHold(paths, slug)
    return hold === null ? [] : [hold]
  })

const holdsOf = (paths: RepoPaths, session: string): Hold[] => allHolds(paths).filter((hold) => hold.holder === session)

export const heldBy = (paths: RepoPaths, session: string): string | null => holdsOf(paths, session)[0]?.slug ?? null

export const takeHold = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  session: string,
  transcript: string | null,
  process: number | null = null
): Hold => {
  const file = holdPath(paths, slug)
  if (!file.ok) throw refused(file)
  const others = allHolds(paths).filter(
    (hold) => hold.slug !== slug && (hold.holder === session || hold.released_from === session)
  )
  for (const other of others) {
    storeHold(rt, paths, other, {
      ...other,
      holder: other.holder === session ? null : other.holder,
      released_from: other.released_from === session ? null : other.released_from
    })
  }
  const previous = readHold(paths, slug)
  const next: Hold =
    previous === null
      ? {
          slug,
          holder: session,
          transcripts: withTranscript([], transcript),
          folded_at: null,
          nudged_prompt_id: null,
          process,
          released_from: null
        }
      : {
          ...previous,
          holder: session,
          transcripts: withTranscript(previous.transcripts, transcript),
          process,
          released_from: null
        }
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

export const recordProcess = (rt: Runtime, paths: RepoPaths, slug: string, process: number | null): Hold | null =>
  updateHold(rt, paths, slug, (hold) => ({ ...hold, process }))

const errorCode = (error: unknown): unknown =>
  typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined

const processRuns = (processId: number): boolean => {
  try {
    process.kill(processId, PROBE_SIGNAL)
    return true
  } catch (error) {
    return errorCode(error) !== NO_SUCH_PROCESS
  }
}

const changedBefore = (transcript: string, cutoffMs: number): boolean => {
  try {
    return statSync(transcript).mtimeMs < cutoffMs
  } catch {
    return false
  }
}

const sessionEnded = (hold: Hold, nowMs: number): boolean =>
  hold.process !== null
    ? !processRuns(hold.process)
    : hold.transcripts.length > 0 &&
      hold.transcripts.every((transcript) => changedBefore(transcript, nowMs - ENDED_TRANSCRIPT_AGE_MS))

const stillJudged = (judged: Hold, current: Hold | null): current is Hold =>
  current !== null && current.holder === judged.holder && current.process === judged.process

export const releaseEndedHolds = (rt: Runtime, paths: RepoPaths, startingSession: string): Hold[] => {
  const nowMs = Date.parse(rt.now())
  return allHolds(paths)
    .filter((hold) => hold.holder !== null && hold.holder !== startingSession && sessionEnded(hold, nowMs))
    .flatMap((judged) => {
      const current = readHold(paths, judged.slug)
      return stillJudged(judged, current)
        ? [storeHold(rt, paths, current, { ...current, holder: null, process: null, released_from: current.holder })]
        : []
    })
}

export const takeBackHolds = (rt: Runtime, paths: RepoPaths, session: string): Hold | null => {
  if (heldBy(paths, session) !== null) return null
  const released = allHolds(paths).find((hold) => hold.holder === null && hold.released_from === session)
  return released === undefined ? null : takeHold(rt, paths, released.slug, session, null, released.process)
}

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
