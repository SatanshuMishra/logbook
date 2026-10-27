import { parseDocument, type Section } from '../doc/document.ts'
import { userLine } from '../doc/render.ts'
import { recordEvent } from '../metrics/record.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { activityLine, buildActivity } from '../thread/activity.ts'
import { takeHandover } from '../thread/handover.ts'
import { addTranscript, heldBy, readHold, takeHold, writeRedirect } from '../thread/holds.ts'
import { listMarkers } from '../thread/inflight.ts'
import { migrateIfNeeded } from '../thread/migrate.ts'
import { checkSessionId, workingCopyPath, type RepoPaths } from '../thread/paths.ts'
import { sessionStartRoster } from '../thread/roster.ts'
import { readDocument } from '../thread/store.ts'
import type { EmptyHookOutput, SessionStartHookOutput } from './output.ts'

export type SessionStartInput = { event: Record<string, unknown>; sessionId: string; paths: RepoPaths; rt: Runtime }

export type SessionStartOutput = EmptyHookOutput | SessionStartHookOutput

type ListPart = { heading: string; lines: readonly string[]; replacement: (count: number) => string }

type Pickup = { opening: string; document: string; shortDocument: string; activity: ListPart; markers: ListPart }

type Fitted = { context: string; delivered: 'document' | 'short'; activityLines: number }

const HOOK_EVENT = 'SessionStart'
const STARTUP_SOURCE = 'startup'
const CLEAR_SOURCE = 'clear'
const PICKUP_SOURCES: ReadonlySet<string> = new Set(['resume', 'compact', CLEAR_SOURCE])
const CONTEXT_CEILING = 9500
const HEADER_LINE_LIMIT = 500
const NEXT_STEP_LIMIT = 2000
const CUT_MARK = '...'
const LINE_BREAK = '\n'
const BLOCK_SEPARATOR = '\n\n'
const NEXT_STEP_SECTION = 'Next step'
const ACTIVITY_HEADING = 'Activity since the last update:'
const MARKERS_HEADING = 'Was running when the session ended:'

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const openingLine = (slug: string, file: string): string =>
  `Logbook: this session holds thread ${slug}. Its state document follows and is now in your context; do not print it. Keep it true by editing ${file} when logbook asks.`

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

const totalLength = (lines: readonly string[]): number => lines.reduce((sum, line) => sum + line.length, 0)

const listCost = (part: ListPart, kept: number, keptLength: number): number => {
  const dropped = part.lines.length - kept
  const frame = [...(kept > 0 ? [part.heading] : []), ...(dropped > 0 ? [part.replacement(dropped)] : [])]
  const entries = frame.length + kept
  if (entries === 0) return 0
  return BLOCK_SEPARATOR.length + totalLength(frame) + keptLength + (entries - 1) * LINE_BREAK.length
}

const blockCost = (text: string): number => (text.length === 0 ? 0 : BLOCK_SEPARATOR.length + text.length)

const keptCount = (part: ListPart, room: number): number | null => {
  let keptLength = totalLength(part.lines)
  for (let kept = part.lines.length; kept >= 0; kept -= 1) {
    if (listCost(part, kept, keptLength) <= room) return kept
    keptLength -= part.lines[part.lines.length - kept]?.length ?? 0
  }
  return null
}

const listBlock = (part: ListPart, kept: number): string => {
  const dropped = part.lines.length - kept
  return [
    ...(kept > 0 ? [part.heading] : []),
    ...(dropped > 0 ? [part.replacement(dropped)] : []),
    ...part.lines.slice(dropped)
  ].join(LINE_BREAK)
}

const rendered = (pickup: Pickup, document: string, activityKept: number, markersKept: number): string =>
  [pickup.opening, document, listBlock(pickup.activity, activityKept), listBlock(pickup.markers, markersKept)]
    .filter((block) => block.length > 0)
    .join(BLOCK_SEPARATOR)

const fittedContext = (pickup: Pickup): Fitted => {
  const fixed = pickup.opening.length + blockCost(pickup.document)
  const allMarkers = pickup.markers.lines.length
  const markersCost = listCost(pickup.markers, allMarkers, totalLength(pickup.markers.lines))
  const activityKept = keptCount(pickup.activity, CONTEXT_CEILING - fixed - markersCost)
  if (activityKept !== null) {
    const context = rendered(pickup, pickup.document, activityKept, allMarkers)
    return { context, delivered: 'document', activityLines: activityKept }
  }
  const markersKept = keptCount(pickup.markers, CONTEXT_CEILING - fixed - listCost(pickup.activity, 0, 0))
  if (markersKept !== null) {
    return { context: rendered(pickup, pickup.document, 0, markersKept), delivered: 'document', activityLines: 0 }
  }
  return { context: rendered(pickup, pickup.shortDocument, 0, 0), delivered: 'short', activityLines: 0 }
}

const contextOutput = (additionalContext: string, systemMessage: string | null): SessionStartOutput => ({
  hookSpecificOutput: { hookEventName: HOOK_EVENT, additionalContext },
  ...(systemMessage === null ? {} : { systemMessage })
})

const startupOutput = (rt: Runtime, paths: RepoPaths): SessionStartOutput => {
  const migrated = migrateIfNeeded(rt, paths)
  if (!migrated.ok) rt.log({ level: 'warn', event: 'session-start.migration-failed', reason: migrated.message })
  const roster = sessionStartRoster(rt, paths)
  return roster === null ? {} : contextOutput(roster, null)
}

const passHandover = (rt: Runtime, paths: RepoPaths, sessionId: string, transcript: string | null): void => {
  if (checkSessionId('session_id', sessionId) !== null) return
  const handover = takeHandover(rt, paths, transcript)
  if (handover === null) return
  writeRedirect(rt, paths, handover.session, sessionId)
  if (handover.slug !== null) takeHold(rt, paths, handover.slug, sessionId, transcript)
}

const pickupOutput = (
  rt: Runtime,
  paths: RepoPaths,
  sessionId: string,
  slug: string,
  source: string
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
  const fitted = fittedContext({
    opening: openingLine(slug, file.value),
    document,
    shortDocument: shortDocumentOf(document, file.value),
    activity: { heading: ACTIVITY_HEADING, lines: activity.lines, replacement: earlierLinesLine },
    markers: { heading: MARKERS_HEADING, lines: markerLines, replacement: runningToolsLine }
  })
  recordEvent(rt, paths, slug, 'thread.pickup', {
    source,
    delivered: fitted.delivered,
    activity_lines: fitted.activityLines,
    context_chars: fitted.context.length
  })
  return contextOutput(fitted.context, userLine(stored.text, file.value))
}

export const sessionStart = (input: SessionStartInput): SessionStartOutput => {
  const { event, paths, rt, sessionId } = input
  const source = nonEmptyString(event.source)
  if (source === STARTUP_SOURCE) return startupOutput(rt, paths)
  if (source === null || !PICKUP_SOURCES.has(source)) return {}
  const transcript = nonEmptyString(event.transcript_path)
  if (source === CLEAR_SOURCE) passHandover(rt, paths, sessionId, transcript)
  const held = heldBy(paths, sessionId)
  if (held === null) return {}
  if (transcript !== null) addTranscript(rt, paths, held, transcript)
  return pickupOutput(rt, paths, sessionId, held, source)
}
