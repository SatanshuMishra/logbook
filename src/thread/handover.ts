import { mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Refusal } from '../schema/declare.ts'
import { durableWrite } from '../store/durable-write.ts'
import { SESSION_ID_PATTERN, THREAD_SLUG_PATTERN, checkSlug, handoverPath, type RepoPaths } from './paths.ts'

export type Handover = { session: string; slug: string | null; transcript: string | null; at: string }

export const HANDOVER_MAX_AGE_MS = 60000

type HandoverFile = { file: string; handover: Handover; atMs: number }

const HANDOVER_FOLDER = 'handover'
const HANDOVER_SUFFIX = '.json'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringOrNull = (value: unknown): value is string | null => value === null || typeof value === 'string'

const isSlugOrNull = (value: unknown): value is string | null =>
  value === null || (typeof value === 'string' && THREAD_SLUG_PATTERN.test(value))

const refused = (refusal: Refusal): Error => new Error(`${refusal.field}: ${refusal.message}`)

const readJson = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

const removeIfPresent = (file: string): void => {
  try {
    unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export const writeHandover = (rt: Runtime, paths: RepoPaths, handover: Handover): void => {
  const file = handoverPath(paths, handover.session)
  if (!file.ok) throw refused(file)
  const slugRefusal = handover.slug === null ? null : checkSlug('slug', handover.slug)
  if (slugRefusal !== null) throw refused(slugRefusal)
  const stored: Handover = {
    session: handover.session,
    slug: handover.slug,
    transcript: handover.transcript,
    at: handover.at
  }
  mkdirSync(path.dirname(file.value), { recursive: true })
  durableWrite(file.value, `${JSON.stringify(stored)}\n`, { log: rt.log })
}

const parseHandover = (session: string, value: unknown): Handover | null => {
  if (!isPlainObject(value)) return null
  const { session: storedSession, slug, transcript, at } = value
  if (storedSession !== session || !isSlugOrNull(slug) || !isStringOrNull(transcript)) return null
  if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) return null
  return { session, slug, transcript, at }
}

const handoverSessions = (folder: string): string[] => {
  try {
    return readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(HANDOVER_SUFFIX))
      .map((entry) => entry.name.slice(0, entry.name.length - HANDOVER_SUFFIX.length))
      .filter((session) => SESSION_ID_PATTERN.test(session))
      .sort()
  } catch {
    return []
  }
}

const readHandoverFiles = (paths: RepoPaths): HandoverFile[] =>
  handoverSessions(path.join(paths.logbookDir, HANDOVER_FOLDER)).flatMap((session): HandoverFile[] => {
    const file = handoverPath(paths, session)
    if (!file.ok) return []
    const handover = parseHandover(session, readJson(file.value))
    return handover === null ? [] : [{ file: file.value, handover, atMs: Date.parse(handover.at) }]
  })

const sameFolder = (transcriptPath: string | null, entry: HandoverFile): boolean =>
  transcriptPath !== null &&
  entry.handover.transcript !== null &&
  path.dirname(entry.handover.transcript) === path.dirname(transcriptPath)

const newerOf = (left: HandoverFile, right: HandoverFile): HandoverFile => {
  if (left.atMs !== right.atMs) return left.atMs > right.atMs ? left : right
  return left.file > right.file ? left : right
}

export const takeHandover = (rt: Runtime, paths: RepoPaths, transcriptPath: string | null): Handover | null => {
  const nowMs = Date.parse(rt.now())
  const entries = readHandoverFiles(paths)
  const expired = entries.filter((entry) => nowMs - entry.atMs >= HANDOVER_MAX_AGE_MS)
  expired.forEach((entry) => removeIfPresent(entry.file))
  const candidates = entries.filter(
    (entry) => nowMs - entry.atMs < HANDOVER_MAX_AGE_MS && sameFolder(transcriptPath, entry)
  )
  const [first, ...rest] = candidates
  if (first === undefined) return null
  const chosen = rest.reduce(newerOf, first)
  removeIfPresent(chosen.file)
  return chosen.handover
}
