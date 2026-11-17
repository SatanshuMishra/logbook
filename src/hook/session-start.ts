import { parseDocument, type Section } from '../doc/document.ts'
import { differenceSentence, differenceUserLine } from '../doc/render.ts'
import { recordCommandLines, UPDATE_RULES } from '../doc/rules.ts'
import { recordEvent } from '../metrics/record.ts'
import { claudeProcessOf, type Runtime } from '../runtime/runtime.ts'
import { git } from '../store/git.ts'
import { activityLine, buildActivity } from '../thread/activity.ts'
import { takeHandover } from '../thread/handover.ts'
import {
  actingSession,
  addTranscript,
  heldBy,
  readHold,
  releaseEndedHolds,
  takeBackHolds,
  takeFreeHold,
  takeHold,
  writeRedirect
} from '../thread/holds.ts'
import { listMarkers } from '../thread/inflight.ts'
import { migrateIfNeeded } from '../thread/migrate.ts'
import { checkSessionId, workingCopyPath, type RepoPaths } from '../thread/paths.ts'
import { listRoster, pickupRoster, sessionStartRoster, workingCopyParts } from '../thread/roster.ts'
import { readDocument, THREADS_REF } from '../thread/store.ts'
import { syncThreads } from '../thread/sync.ts'
import { comparisonText } from '../thread/working-copy.ts'
import type { EmptyHookOutput, SessionStartHookOutput } from './output.ts'

export type SessionStartInput = {
  event: Record<string, unknown>
  sessionId: string
  paths: RepoPaths
  rt: Runtime
  syncError?: string | null
}

export type SessionStartOutput = EmptyHookOutput | SessionStartHookOutput

type ListPart =
  | { kind: 'latest'; heading: string; lines: readonly string[]; replacement: (count: number) => string }
  | { kind: 'roster'; lines: readonly string[]; replacement: (count: number) => string; tail: readonly string[] }

type Pickup = {
  opening: string
  warnings: readonly string[]
  pending: string
  document: string
  shortDocument: string
  activity: ListPart
  markers: ListPart
  guide: readonly string[]
  roster: ListPart
}

type Shape = { document: string; delivered: 'document' | 'short'; activity: number; markers: number; roster: number }

type Fitted = { context: string; delivered: 'document' | 'short'; activityLines: number }

type StartupExtras = { warnings: string[]; guide: string[]; roster: ListPart }

const HOOK_EVENT = 'SessionStart'
const STARTUP_SOURCE = 'startup'
const RESUME_SOURCE = 'resume'
const CLEAR_SOURCE = 'clear'
const PICKUP_SOURCES: ReadonlySet<string> = new Set([RESUME_SOURCE, 'compact', CLEAR_SOURCE])
const UNATTENDED_ENV_KEY = 'HARNESS_UNATTENDED'
const UNATTENDED_VALUE = '1'
const CONTEXT_CEILING = 9500
const HEADER_LINE_LIMIT = 500
const NEXT_STEP_LIMIT = 2000
const CUT_MARK = '...'
const LINE_BREAK = '\n'
const BLOCK_SEPARATOR = '\n\n'
const NEXT_STEP_SECTION = 'Next step'
const ACTIVITY_HEADING = 'Activity since the last update:'
const MARKERS_HEADING = 'Was running when the session ended:'
const RULES_HEADING = 'Rules:'
const STARTUP_SYNC_LIMIT_MS = 8000
const NO_ORIGIN_ERROR = 'no-origin'
const DOCUMENT_SUFFIX = '.md'
const NO_ROSTER: ListPart = { kind: 'roster', lines: [], replacement: () => '', tail: [] }

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const openingLine = (slug: string): string =>
  `Logbook: this session holds thread ${slug}. Its state document follows and is now in your context; do not print it. Keep it true with logbook update_thread when logbook asks.`

const startupOpeningLine = (slug: string): string =>
  `Logbook picked up thread ${slug} at session start, the newest open thread no running session holds. Its state document follows and is now in your context; do not print it. If this session's work belongs to another thread or none, leave it.`

const syncWarning = (error: string): string =>
  `Logbook could not sync threads with origin: ${error}. This copy may be behind origin.`

const notParkedWarning = (slug: string): string =>
  `Thread ${slug} was not parked after its last change: the session that last worked on it may not have recorded its latest changes, or they may not have reached origin.`

const parkSubjectPrefix = (slug: string): string => `park_thread ${slug}:`

const rulesBlock = (): string => [RULES_HEADING, ...UPDATE_RULES.map((rule) => `- ${rule}`)].join(LINE_BREAK)

const pendingBlock = (file: string, parts: readonly string[]): string =>
  parts.length === 0
    ? ''
    : `${differenceSentence(file, parts)} Logbook has not committed it; read the working copy before acting on the next step below.`

const readFileLine = (file: string): string => `The document is too long to include; Read ${file} now.`

const earlierLinesLine = (count: number): string => `(${count} earlier lines left out)`

const runningToolsLine = (count: number): string => `(${count} running tools left out)`

const cutTo = (limit: number, text: string): string =>
  text.length > limit ? `${text.slice(0, limit - CUT_MARK.length)}${CUT_MARK}` : text

const withoutTrailingBlank = (lines: readonly string[]): string[] =>
  lines.slice(0, lines.reduce((end, line, index) => (line.trim() === '' ? end : index + 1), 0))

const sectionText = (lines: readonly string[], section: Section): string =>
  [lines[section.line - 1] ?? '', ...withoutTrailingBlank(section.body)].join(LINE_BREAK)

const shortDocumentOf = (text: string, file: string): string => {
  const parsed = parseDocument(text)
  const lines = text.split(LINE_BREAK)
  const statusLine = parsed.statusLine === null ? [] : [cutTo(HEADER_LINE_LIMIT, lines[parsed.statusLine - 1] ?? '')]
  const header = [cutTo(HEADER_LINE_LIMIT, lines[0] ?? ''), ...statusLine].join(LINE_BREAK)
  const section = parsed.sections.find((candidate) => candidate.name === NEXT_STEP_SECTION)
  const nextStep = section === undefined ? [] : [cutTo(NEXT_STEP_LIMIT, sectionText(lines, section))]
  return [header, ...nextStep, readFileLine(file)].join(BLOCK_SEPARATOR)
}

const listBlock = (part: ListPart, kept: number): string => {
  const dropped = part.lines.length - kept
  const more = dropped > 0 ? [part.replacement(dropped)] : []
  if (part.kind === 'latest') {
    return [...(kept > 0 ? [part.heading] : []), ...more, ...part.lines.slice(dropped)].join(LINE_BREAK)
  }
  return part.lines.length === 0 ? '' : [...part.lines.slice(0, kept), ...more, ...part.tail].join(LINE_BREAK)
}

const rendered = (pickup: Pickup, shape: Shape): string =>
  [
    pickup.opening,
    ...pickup.warnings,
    pickup.pending,
    shape.document,
    listBlock(pickup.activity, shape.activity),
    listBlock(pickup.markers, shape.markers),
    ...pickup.guide,
    listBlock(pickup.roster, shape.roster)
  ]
    .filter((block) => block.length > 0)
    .join(BLOCK_SEPARATOR)

const largestFitting = (pickup: Pickup, count: number, shapeOf: (kept: number) => Shape): Fitted | null => {
  for (let kept = count; kept >= 0; kept -= 1) {
    const shape = shapeOf(kept)
    const context = rendered(pickup, shape)
    if (context.length <= CONTEXT_CEILING) return { context, delivered: shape.delivered, activityLines: shape.activity }
  }
  return null
}

const fittedContext = (pickup: Pickup): Fitted => {
  const whole = (shape: Omit<Shape, 'document' | 'delivered'>): Shape => ({
    document: pickup.document,
    delivered: 'document',
    ...shape
  })
  const allActivity = pickup.activity.lines.length
  const allMarkers = pickup.markers.lines.length
  return (
    largestFitting(pickup, pickup.roster.lines.length, (roster) =>
      whole({ activity: allActivity, markers: allMarkers, roster })
    ) ??
    largestFitting(pickup, allActivity, (activity) => whole({ activity, markers: allMarkers, roster: 0 })) ??
    largestFitting(pickup, allMarkers, (markers) => whole({ activity: 0, markers, roster: 0 })) ?? {
      context: rendered(pickup, { document: pickup.shortDocument, delivered: 'short', activity: 0, markers: 0, roster: 0 }),
      delivered: 'short',
      activityLines: 0
    }
  )
}

const contextOutput = (additionalContext: string, systemMessage: string | null): SessionStartOutput => ({
  hookSpecificOutput: { hookEventName: HOOK_EVENT, additionalContext },
  ...(systemMessage === null ? {} : { systemMessage })
})

const isUnattendedChild = (rt: Runtime): boolean => rt.env[UNATTENDED_ENV_KEY] === UNATTENDED_VALUE

const parkedLast = (rt: Runtime, paths: RepoPaths, slug: string): boolean | null => {
  const log = git(rt, paths.root, ['log', '-1', '--format=%s', THREADS_REF, '--', `${slug}${DOCUMENT_SUFFIX}`])
  if (!log.ok) {
    rt.log({ level: 'warn', event: 'session-start.last-commit-unreadable', slug, reason: log.stderr.trim() })
    return null
  }
  return log.stdout.startsWith(parkSubjectPrefix(slug))
}

const rosterOutput = (rt: Runtime, paths: RepoPaths, warnings: readonly string[]): SessionStartOutput => {
  const roster = sessionStartRoster(rt, paths)
  const blocks = [...warnings, ...(roster === null ? [] : [roster])]
  return blocks.length === 0 ? {} : contextOutput(blocks.join(BLOCK_SEPARATOR), null)
}

const startupOutput = (rt: Runtime, paths: RepoPaths, sessionId: string, syncError: string | null): SessionStartOutput => {
  const migrated = migrateIfNeeded(rt, paths)
  if (!migrated.ok) rt.log({ level: 'warn', event: 'session-start.migration-failed', reason: migrated.message })
  if (isUnattendedChild(rt)) return {}
  const syncWarnings = syncError === null ? [] : [syncWarning(syncError)]
  if (heldBy(paths, sessionId) !== null) return rosterOutput(rt, paths, syncWarnings)
  const roster = listRoster(rt, paths, { includeClosed: false })
  const holdProcess = claudeProcessOf(rt.env) ?? rt.parentProcess
  const picked = roster.threads.find((thread) => takeFreeHold(rt, paths, thread.slug, sessionId, holdProcess) !== null)
  if (picked === undefined) return rosterOutput(rt, paths, syncWarnings)
  const slug = picked.slug
  const others = pickupRoster(roster, slug)
  return pickupOutput(rt, paths, sessionId, slug, STARTUP_SOURCE, {
    warnings: [...syncWarnings, ...(parkedLast(rt, paths, slug) === false ? [notParkedWarning(slug)] : [])],
    guide: [recordCommandLines(slug).join(LINE_BREAK), rulesBlock()],
    roster: { kind: 'roster', ...others }
  })
}

const passHandover = (rt: Runtime, paths: RepoPaths, sessionId: string, transcript: string | null): void => {
  if (checkSessionId('session_id', sessionId) !== null) return
  const handover = takeHandover(rt, paths, transcript)
  if (handover === null) return
  writeRedirect(rt, paths, handover.session, sessionId)
  if (handover.slug === null) return
  const handedOver = readHold(paths, handover.slug)
  const provisional = handedOver?.provisional === true ? { provisional: true } : {}
  takeHold(rt, paths, handover.slug, sessionId, transcript, handedOver?.process ?? null, provisional)
}

const pickupOutput = (
  rt: Runtime,
  paths: RepoPaths,
  sessionId: string,
  slug: string,
  source: string,
  extras: StartupExtras | null = null
): SessionStartOutput => {
  const file = workingCopyPath(paths, slug)
  const stored = readDocument(rt, paths, slug)
  const hold = readHold(paths, slug)
  if (!file.ok || stored === null || hold === null) return {}
  const activity = buildActivity({ transcripts: hold.transcripts, since: hold.folded_at, workingCopyPath: file.value })
  const markerLines = listMarkers(paths, slug)
    .filter((marker) => marker.session !== sessionId)
    .map((marker) => activityLine(marker.tool, marker.summary))
  const document = stored.text.replace(/\n+$/, '')
  const parts = workingCopyParts(file.value, comparisonText(rt, paths, slug, stored.text))
  const fitted = fittedContext({
    opening: extras === null ? openingLine(slug) : startupOpeningLine(slug),
    warnings: extras?.warnings ?? [],
    pending: pendingBlock(file.value, parts),
    document,
    shortDocument: shortDocumentOf(document, file.value),
    activity: { kind: 'latest', heading: ACTIVITY_HEADING, lines: activity.lines, replacement: earlierLinesLine },
    markers: { kind: 'latest', heading: MARKERS_HEADING, lines: markerLines, replacement: runningToolsLine },
    guide: extras?.guide ?? [],
    roster: extras?.roster ?? NO_ROSTER
  })
  recordEvent(rt, paths, slug, 'thread.pickup', {
    source,
    delivered: fitted.delivered,
    activity_lines: fitted.activityLines,
    context_chars: fitted.context.length
  })
  return contextOutput(fitted.context, differenceUserLine(stored.text, file.value, parts))
}

export const sessionStart = (input: SessionStartInput): SessionStartOutput => {
  const { event, paths, rt, sessionId } = input
  const source = nonEmptyString(event.source)
  if (source === null || (source !== STARTUP_SOURCE && !PICKUP_SOURCES.has(source))) return {}
  releaseEndedHolds(rt, paths, actingSession(paths, sessionId))
  if (source === STARTUP_SOURCE) return startupOutput(rt, paths, sessionId, input.syncError ?? null)
  const transcript = nonEmptyString(event.transcript_path)
  if (source === CLEAR_SOURCE) passHandover(rt, paths, sessionId, transcript)
  takeBackHolds(rt, paths, sessionId)
  const held = heldBy(paths, sessionId)
  if (held === null) return {}
  if (transcript !== null) addTranscript(rt, paths, held, transcript)
  return pickupOutput(rt, paths, sessionId, held, source)
}

export const runSessionStart = async (input: SessionStartInput): Promise<SessionStartOutput> => {
  const { event, paths, rt } = input
  if (nonEmptyString(event.source) !== STARTUP_SOURCE || isUnattendedChild(rt)) return sessionStart(input)
  const synced = await syncThreads(rt, paths, { limitMs: STARTUP_SYNC_LIMIT_MS })
  const syncError = synced.error === NO_ORIGIN_ERROR ? null : synced.error
  if (syncError !== null) rt.log({ level: 'warn', event: 'session-start.sync-failed', reason: syncError })
  return sessionStart({ ...input, syncError })
}
