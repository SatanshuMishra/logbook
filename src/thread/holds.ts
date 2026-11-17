import { closeSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { durableWrite } from '../store/durable-write.ts'
import {
  SESSION_ID_PATTERN,
  THREAD_SLUG_PATTERN,
  checkSessionId,
  holdPath,
  pickupLockPath,
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
  provisional?: true
  provisional_asked?: true
}

export type TakeHoldOptions = { provisional?: boolean }

export type PickupClaim = { release: () => void }

export type FreeHoldTake = { kind: 'taken'; hold: Hold } | { kind: 'held' } | { kind: 'contended' }

const HOLDS_FOLDER = 'holds'
const HOLD_SUFFIX = '.json'
const TRANSCRIPT_SUFFIX = '.jsonl'
const ENDED_TRANSCRIPT_AGE_MS = 24 * 60 * 60 * 1000
const PROBE_SIGNAL = 0
const NO_SUCH_PROCESS = 'ESRCH'
const NO_SUCH_FILE = 'ENOENT'
const FILE_EXISTS = 'EEXIST'
const CREATE_EXCLUSIVELY = 'wx'
const PICKUP_LOCK_WRITE_GRACE_MS = 60 * 1000

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')

const isAbsentOrBoolean = (value: unknown): boolean => value === undefined || typeof value === 'boolean'

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
    released_from: releasedFrom = null,
    provisional,
    provisional_asked: provisionalAsked
  } = value
  if (storedSlug !== slug) return null
  if (!isStringOrNull(holder) || !isStringList(transcripts)) return null
  if (!isStringOrNull(foldedAt) || !isStringOrNull(nudgedPromptId) || !isStringOrNull(releasedFrom)) return null
  if (!isAbsentOrBoolean(provisional) || !isAbsentOrBoolean(provisionalAsked)) return null
  return {
    slug,
    holder,
    transcripts: [...transcripts],
    folded_at: foldedAt,
    nudged_prompt_id: nudgedPromptId,
    process: recordedProcess(storedProcess),
    released_from: releasedFrom,
    ...(provisional === true ? { provisional: true } : {}),
    ...(provisionalAsked === true ? { provisional_asked: true } : {})
  }
}

const asFull = (hold: Hold): Hold => ({
  slug: hold.slug,
  holder: hold.holder,
  transcripts: hold.transcripts,
  folded_at: hold.folded_at,
  nudged_prompt_id: hold.nudged_prompt_id,
  process: hold.process,
  released_from: hold.released_from
})

const isProvisional = (hold: Hold): boolean => hold.provisional === true

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
  process: number | null = null,
  opts: TakeHoldOptions = {}
): Hold => {
  const file = holdPath(paths, slug)
  if (!file.ok) throw refused(file)
  const others = allHolds(paths).filter(
    (hold) => hold.slug !== slug && (hold.holder === session || hold.released_from === session)
  )
  for (const other of others) {
    updateHold(rt, paths, other.slug, (current) => ({
      ...current,
      holder: current.holder === session ? null : current.holder,
      released_from: current.released_from === session ? null : current.released_from
    }))
  }
  const previous = readHold(paths, slug)
  const next =
    opts.provisional === true
      ? provisionalTake(slug, session, process, previous)
      : fullTake(slug, session, transcript, process, previous)
  return storeHold(rt, paths, previous, next)
}

const fullTake = (
  slug: string,
  session: string,
  transcript: string | null,
  process: number | null,
  previous: Hold | null
): Hold =>
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
        ...asFull(previous),
        holder: session,
        transcripts: withTranscript(previous.transcripts, transcript),
        process,
        released_from: null
      }

const provisionalTake = (slug: string, session: string, process: number | null, previous: Hold | null): Hold => ({
  ...(previous === null
    ? { slug, holder: session, transcripts: [], folded_at: null, nudged_prompt_id: null, process, released_from: null }
    : { ...asFull(previous), holder: session, process }),
  provisional: true
})

const updateHold = (rt: Runtime, paths: RepoPaths, slug: string, change: (hold: Hold) => Hold): Hold | null => {
  const previous = readHold(paths, slug)
  return previous === null ? null : storeHold(rt, paths, previous, change(previous))
}

export const addTranscript = (rt: Runtime, paths: RepoPaths, slug: string, transcript: string): Hold | null =>
  updateHold(rt, paths, slug, (hold) =>
    isProvisional(hold) ? hold : { ...hold, transcripts: withTranscript(hold.transcripts, transcript) }
  )

export const markProvisionalAsked = (rt: Runtime, paths: RepoPaths, slug: string): Hold | null =>
  updateHold(rt, paths, slug, (hold) => (isProvisional(hold) ? { ...hold, provisional_asked: true } : hold))

const isTranscriptOf = (holder: string | null, transcript: string): boolean =>
  holder === null || path.basename(transcript) === `${holder}${TRANSCRIPT_SUFFIX}`

export const foldHold = (rt: Runtime, paths: RepoPaths, slug: string, at: string): Hold | null =>
  updateHold(rt, paths, slug, (hold) => ({
    ...asFull(hold),
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

const releasedOwner = (hold: Hold): string | null =>
  isProvisional(hold) ? hold.released_from : hold.holder

export const releaseEndedHolds = (rt: Runtime, paths: RepoPaths, startingSession: string): Hold[] => {
  const nowMs = Date.parse(rt.now())
  return allHolds(paths)
    .filter((hold) => hold.holder !== null && hold.holder !== startingSession && sessionEnded(hold, nowMs))
    .flatMap((judged) => {
      const current = readHold(paths, judged.slug)
      return stillJudged(judged, current)
        ? [
            storeHold(rt, paths, current, {
              ...asFull(current),
              holder: null,
              process: null,
              released_from: releasedOwner(current)
            })
          ]
        : []
    })
}

export const takeBackHolds = (rt: Runtime, paths: RepoPaths, session: string): Hold | null => {
  if (heldBy(paths, session) !== null) return null
  const isReleasedFrom = (hold: Hold | null): hold is Hold =>
    hold !== null &&
    hold.released_from === session &&
    (hold.holder === null || (isProvisional(hold) && hold.holder !== session))
  const released = allHolds(paths).find(isReleasedFrom)
  if (released === undefined) return null
  const current = readHold(paths, released.slug)
  if (!isReleasedFrom(current)) return null
  return takeHold(rt, paths, current.slug, session, null, current.holder === null ? current.process : null)
}

const removeFile = (file: string): void => {
  try {
    unlinkSync(file)
  } catch (error) {
    if (errorCode(error) !== NO_SUCH_FILE) throw error
  }
}

const createdLock = (lock: string, contents: string): boolean => {
  mkdirSync(path.dirname(lock), { recursive: true })
  let descriptor: number
  try {
    descriptor = openSync(lock, CREATE_EXCLUSIVELY)
  } catch (error) {
    if (errorCode(error) === FILE_EXISTS) return false
    throw error
  }
  try {
    writeSync(descriptor, contents)
  } catch (error) {
    closeSync(descriptor)
    removeFile(lock)
    throw error
  }
  closeSync(descriptor)
  return true
}

const lockAgeMs = (rt: Runtime, lock: string): number | null => {
  try {
    return Date.parse(rt.now()) - statSync(lock).mtimeMs
  } catch (error) {
    if (errorCode(error) === NO_SUCH_FILE) return null
    throw error
  }
}

const lockOwnerRuns = (rt: Runtime, slug: string, lock: string): boolean => {
  const ageMs = lockAgeMs(rt, lock)
  if (ageMs === null) return false
  const value = readJson(lock)
  if (value === undefined && ageMs < PICKUP_LOCK_WRITE_GRACE_MS) return true
  const claimant = isPlainObject(value) ? recordedProcess(value.process) : null
  if (claimant !== null && processRuns(claimant)) return true
  rt.log({ level: 'info', event: 'holds.ended-pickup-claim-removed', slug })
  removeFile(lock)
  return false
}

export const claimPickup = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  session: string,
  claimant: number
): PickupClaim | null => {
  const lock = pickupLockPath(paths, slug)
  if (!lock.ok) throw refused(lock)
  const contents = JSON.stringify({ session, process: claimant })
  const won =
    createdLock(lock.value, contents) || (!lockOwnerRuns(rt, slug, lock.value) && createdLock(lock.value, contents))
  return won ? { release: () => removeFile(lock.value) } : null
}

export const takeFreeHold = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  session: string,
  holdProcess: number | null
): FreeHoldTake => {
  const claim = claimPickup(rt, paths, slug, session, process.pid)
  if (claim === null) return { kind: 'contended' }
  try {
    const hold = readHold(paths, slug)
    return hold === null || hold.holder === null
      ? { kind: 'taken', hold: takeHold(rt, paths, slug, session, null, holdProcess, { provisional: true }) }
      : { kind: 'held' }
  } finally {
    claim.release()
  }
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
