import type { Thread, Criterion, Risk, KeyDecision, OutOfScope, Artifact } from '../schema/thread.ts'
import { criterionSettledness } from '../schema/thread.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Pointer } from '../domain/pointer.ts'
import { previousSessionEntries } from '../domain/session-log.ts'
import { escapeStored, escapeStoredBlock, firstNonEmptyStoredLine } from './escape.ts'
import { CLIP_MARKER_GRAPHEMES, clipWithMarker, clipWithMarkerFloor } from './clip.ts'
import {
  ARTIFACT_LABEL_MAX,
  ARTIFACT_POINTER_MAX,
  CRITERION_CHECK_MAX,
  CRITERION_TEXT_MAX,
  KEY_DECISION_TITLE_MAX,
  OUT_OF_SCOPE_TEXT_MAX,
  RISK_REF_MAX,
  SESSION_BODY_MAX,
  SPINE_ACTIVE_GOAL_MAX,
  SPINE_LANDED_MAX,
  SPINE_LAST_SESSION_MAX,
  SPINE_NEXT_STEP_MAX,
  THREAD_BLOCKED_BY_MAX,
  THREAD_SLUG_MAX,
  THREAD_TITLE_MAX
} from '../schema/caps.ts'

const FORMER_RISK_TEXT_MAX = 500
const FORMER_CRITERION_SETTLED_BY_MAX = 500

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

export const BRIEFING_HEADING = '# Your Preflight Briefing'
export const BRIEFING_MAX_CHARS = 12000
export const RESUME_PAYLOAD_MAX_BYTES = 12418

const RESUME_PAYLOAD_RESERVE_BYTES = 200
export const RESUME_PAYLOAD_TARGET_BYTES = RESUME_PAYLOAD_MAX_BYTES - RESUME_PAYLOAD_RESERVE_BYTES

const BRIEFING_COPIES_IN_RESUME_PAYLOAD = 1
const RESUME_PAYLOAD_SCAFFOLD_BYTES = 114
export const PREVIOUS_SESSION_NULL_BYTES = 4
export const PREVIOUS_SESSION_LARGEST_BYTES = 82
const PREVIOUS_SESSION_PRESENT_EXTRA_BYTES = PREVIOUS_SESSION_LARGEST_BYTES - PREVIOUS_SESSION_NULL_BYTES
const PREVIOUS_SESSION_ABSENT_EXTRA_BYTES = 0
const PREVIOUS_SESSION_DEFAULT_PRESENT = true
const JSON_STRING_DELIMITER_BYTES = 2

const jsonEscapedByteLen = (text: string): number =>
  Buffer.byteLength(JSON.stringify(text), 'utf8') - JSON_STRING_DELIMITER_BYTES

export const resumePayloadBytes = (
  briefing: string,
  threadId: string,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): number =>
  BRIEFING_COPIES_IN_RESUME_PAYLOAD * jsonEscapedByteLen(briefing) +
  jsonEscapedByteLen(threadId) +
  RESUME_PAYLOAD_SCAFFOLD_BYTES +
  (hasPreviousSession ? PREVIOUS_SESSION_PRESENT_EXTRA_BYTES : PREVIOUS_SESSION_ABSENT_EXTRA_BYTES)

const fitsBudget = (briefing: string, threadId: string, hasPreviousSession: boolean): boolean =>
  briefing.length <= BRIEFING_MAX_CHARS &&
  resumePayloadBytes(briefing, threadId, hasPreviousSession) <= RESUME_PAYLOAD_TARGET_BYTES

export const RELATED_TITLE_FLOOR = 100
export const RELATED_SLUG_FLOOR = THREAD_SLUG_MAX
export const RISK_TEXT_FLOOR = FORMER_RISK_TEXT_MAX
export const RISK_REF_FLOOR = RISK_REF_MAX
export const KEY_DECISION_TITLE_FLOOR = KEY_DECISION_TITLE_MAX
export const OUT_OF_SCOPE_TEXT_FLOOR = OUT_OF_SCOPE_TEXT_MAX
export const CRITERION_TEXT_FLOOR = CRITERION_TEXT_MAX
export const CRITERION_CHECK_FLOOR = CRITERION_CHECK_MAX
export const CRITERION_RESULT_FLOOR = 500
export const CRITERION_SETTLED_BY_FLOOR = FORMER_CRITERION_SETTLED_BY_MAX
export const SESSION_ENTRY_TEXT_FLOOR = 200
export const ARTIFACT_LABEL_FLOOR = ARTIFACT_LABEL_MAX
export const ARTIFACT_POINTER_FLOOR = ARTIFACT_POINTER_MAX

const HEADER_FIELD_ESCAPED_GRAPHEME_MAX = Math.max(
  THREAD_TITLE_MAX,
  THREAD_BLOCKED_BY_MAX,
  SPINE_ACTIVE_GOAL_MAX,
  SPINE_NEXT_STEP_MAX,
  SPINE_LAST_SESSION_MAX,
  SPINE_LANDED_MAX
)

export const MIN_TEXT_CLIP = CLIP_MARKER_GRAPHEMES
const NO_CLIP = Number.POSITIVE_INFINITY

export const NOT_RECORDED = 'not recorded'

const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'

const LAST_SESSION_HEADING = '**Last session:**'

const CONTINUATION_RULE =
  'Artifacts carry the route this thread is following. The goals are what the work must satisfy: check what lands against them as it lands, not only at the end.'

const LEGACY_LAST_SESSION_MARKER =
  '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead'

const CRITERIA_OWED_LINE = '- none recorded; a definition of done is still owed.'

const CRITERIA_ALL_STRUCK_OWED_LINE = '- every criterion recorded here was struck; a definition of done is still owed.'

const TEXT_CLIPPED_BULLET =
  '- some text on this briefing was shortened to fit the size budget for one reply; every shortened value ends with ...[shortened]'

export const BUDGET_EXCEEDED_BULLET =
  '- this briefing does not fit the size budget for one reply even with every field rendered at its guaranteed minimum length, so it is over that budget'

const clip = (text: string, max: number): string => clipWithMarker(escapeStored(text), max)

const clipFloor = (text: string, min: number): string => clipWithMarkerFloor(escapeStored(text), min)

const wasClipped = (text: string, min: number): boolean => {
  const escaped = escapeStored(text)
  return clipWithMarkerFloor(escaped, min) !== escaped
}

const headerInlineWasShortened = (value: string): boolean =>
  clip(value, HEADER_FIELD_ESCAPED_GRAPHEME_MAX) !== clip(value, NO_CLIP)

const blockWasShortened = (text: string, max: number): boolean =>
  escapeStoredBlock(text, max) !== escapeStoredBlock(text, NO_CLIP)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const settlednessLabel = (criterion: Criterion): string => {
  const settledness = criterionSettledness(criterion)
  switch (settledness) {
    case 'confirmed':
      return 'confirmed'
    case 'proposed':
      return 'proposed'
    case 'unsettled':
      return 'unsettled'
    default: {
      const exhaustive: never = settledness
      throw new Error(
        `settlednessLabel received a criterion settledness it does not recognise: ${escapeStored(String(exhaustive))}.`
      )
    }
  }
}

const renderCriterionLine = (criterion: Criterion, textClip: number): string => {
  const text = clipFloor(criterion.text, textClip)
  const label = `- c${criterion.ordinal} [${criterionStatus(criterion)}] [${settlednessLabel(criterion)}]:`
  const withText = text.length === 0 ? label : `${label} ${text}`
  return `${withText} (id ${escapeStored(criterion.id)})`
}

const renderCheckLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.check === 'string'
    ? `  - check: ${clipFloor(criterion.check, textClip)}`
    : `  - check: ${NOT_RECORDED}`

const renderSettledByLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.settled_by === 'string'
    ? `  - settled by: ${clipFloor(criterion.settled_by, textClip)}`
    : `  - settled by: ${NOT_RECORDED}`

const renderResultStatus = (criterion: Criterion): string => escapeStored(criterion.result_status ?? NOT_RECORDED)

const renderResultLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.result === 'string'
    ? `  - result: ${clipFloor(criterion.result, textClip)} (${renderResultStatus(criterion)})`
    : `  - result: ${NOT_RECORDED} (${renderResultStatus(criterion)})`

const renderCriterionBlock = (criterion: Criterion, renderClip: RenderClip): string =>
  [
    renderCriterionLine(criterion, renderClip.criterion),
    renderCheckLine(criterion, renderClip.criterionCheck),
    ...[criterion].filter((entry) => entry.done).map((entry) => renderResultLine(entry, renderClip.criterionResult)),
    ...[criterion]
      .filter((entry) => criterionSettledness(entry) === 'confirmed')
      .map((entry) => renderSettledByLine(entry, renderClip.criterionSettledBy))
  ].join('\n')

const renderRiskBlock = (risk: Risk, renderClip: RenderClip): string =>
  [
    `- ${escapeStored(risk.id)} ${clipFloor(risk.text, renderClip.risk)}`,
    ...risk.refs.map((ref) => `  - ref: ${clipFloor(ref, renderClip.riskRef)}`)
  ].join('\n')

const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- ${clipFloor(keyDecision.title, textClip)} (decision ${escapeStored(keyDecision.decision_id)})`

const renderOutOfScopeLine = (outOfScope: OutOfScope, textClip: number): string => `- ${clipFloor(outOfScope.text, textClip)}`

const renderArtifactLine = (artifact: Artifact, renderClip: RenderClip): string =>
  `- ${clipFloor(artifact.label, renderClip.artifactLabel)}: ${clipFloor(artifact.pointer, renderClip.artifactPointer)}`

const renderSessionHeadlineLine = (entry: SessionEntry, textClip: number): string => {
  const headline = clipFloor(firstNonEmptyStoredLine(entry.body), textClip)
  const label = `- ${escapeStored(entry.id)}`
  return headline.length === 0 ? label : `${label} ${headline}`
}

const renderNewestSessionEntryBlock = (entry: SessionEntry, textClip: number): string =>
  [`- ${escapeStored(entry.id)}`, escapeStoredBlock(entry.body, textClip)].join('\n')

const OLDER_SESSION_ENTRIES_SINGULAR = 'older session log entry on this thread is shown as its first line only'
const OLDER_SESSION_ENTRIES_PLURAL = 'older session log entries on this thread are shown as their first line only'

const renderOlderSessionEntriesLine = (count: number, threadId: string): string =>
  `- ${count} ${count === 1 ? OLDER_SESSION_ENTRIES_SINGULAR : OLDER_SESSION_ENTRIES_PLURAL}; see logbook://sessions/${escapeStored(threadId)} for the complete record`

const renderUnreadableSessionEntriesLine = (count: number, threadId: string): string =>
  `- ${count} session log entr${count === 1 ? 'y' : 'ies'} on this thread could not be read; see logbook://sessions/${escapeStored(threadId)} for the complete record`

const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
  `- risk ${escapeStored(risk.id)} ${clipFloor(risk.text, textClip)}`

const renderSettledKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- decision ${escapeStored(keyDecision.decision_id)} ${clipFloor(keyDecision.title, textClip)}`

const renderDanglingLine = (decisionId: string): string => `- dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `- quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread, renderClip: RenderClip): string =>
  `- succeeds: ${clipFloor(predecessor.title, renderClip.relatedTitle)} (${clipFloor(predecessor.slug, renderClip.relatedSlug)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${clip(blockedBy, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

type Lane = 'live' | 'settled'

const laneFor = (criterionId: string | undefined, criteriaById: ReadonlyMap<string, Criterion>): Lane => {
  if (criterionId === undefined) return 'live'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'live'
  if (criterion.struck_by !== null || criterion.done) return 'settled'
  return 'live'
}

type Laned<T> = { live: T[]; settled: T[] }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>
): Laned<T> => ({
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'settled')
})

type PreviousSession = { newest: SessionEntry[]; older: SessionEntry[] }

const splitNewestFromOlder = (entries: readonly SessionEntry[]): PreviousSession => ({
  newest: entries.filter((_entry, index) => index === 0),
  older: entries.filter((_entry, index) => index > 0)
})

type RenderClip = {
  relatedTitle: number
  relatedSlug: number
  risk: number
  riskRef: number
  keyDecision: number
  outOfScope: number
  criterion: number
  criterionCheck: number
  criterionResult: number
  criterionSettledBy: number
  sessionHeadline: number
  newestSession: number
  settledRisk: number
  settledKeyDecision: number
  artifactLabel: number
  artifactPointer: number
}

export const CLIP_SEARCH_UPPER_BOUND = SESSION_BODY_MAX
export const CLIP_SEARCH_AXIS_LOWER_BOUND = SESSION_ENTRY_TEXT_FLOOR
export const CLIP_SEARCH_AXIS_UPPER_BOUND = CLIP_SEARCH_UPPER_BOUND + (CLIP_SEARCH_UPPER_BOUND - MIN_TEXT_CLIP)

const perItemClipAt = (axisPoint: number): number =>
  axisPoint <= CLIP_SEARCH_UPPER_BOUND ? MIN_TEXT_CLIP : MIN_TEXT_CLIP + (axisPoint - CLIP_SEARCH_UPPER_BOUND)

const newestSessionClipAt = (axisPoint: number): number => (axisPoint <= CLIP_SEARCH_UPPER_BOUND ? axisPoint : NO_CLIP)

const clipAt = (axisPoint: number): RenderClip => {
  const perItemClip = perItemClipAt(axisPoint)
  return {
    relatedTitle: Math.max(perItemClip, RELATED_TITLE_FLOOR),
    relatedSlug: Math.max(perItemClip, RELATED_SLUG_FLOOR),
    risk: Math.max(perItemClip, RISK_TEXT_FLOOR),
    riskRef: Math.max(perItemClip, RISK_REF_FLOOR),
    keyDecision: Math.max(perItemClip, KEY_DECISION_TITLE_FLOOR),
    outOfScope: Math.max(perItemClip, OUT_OF_SCOPE_TEXT_FLOOR),
    criterion: Math.max(perItemClip, CRITERION_TEXT_FLOOR),
    criterionCheck: Math.max(perItemClip, CRITERION_CHECK_FLOOR),
    criterionResult: Math.max(perItemClip, CRITERION_RESULT_FLOOR),
    criterionSettledBy: Math.max(perItemClip, CRITERION_SETTLED_BY_FLOOR),
    sessionHeadline: Math.max(perItemClip, SESSION_ENTRY_TEXT_FLOOR),
    newestSession: newestSessionClipAt(axisPoint),
    settledRisk: Math.max(perItemClip, RISK_TEXT_FLOOR),
    settledKeyDecision: Math.max(perItemClip, KEY_DECISION_TITLE_FLOOR),
    artifactLabel: Math.max(perItemClip, ARTIFACT_LABEL_FLOOR),
    artifactPointer: Math.max(perItemClip, ARTIFACT_POINTER_FLOOR)
  }
}

const UNCLIPPED: RenderClip = {
  relatedTitle: NO_CLIP,
  relatedSlug: NO_CLIP,
  risk: NO_CLIP,
  riskRef: NO_CLIP,
  keyDecision: NO_CLIP,
  outOfScope: NO_CLIP,
  criterion: NO_CLIP,
  criterionCheck: NO_CLIP,
  criterionResult: NO_CLIP,
  criterionSettledBy: NO_CLIP,
  sessionHeadline: NO_CLIP,
  newestSession: NO_CLIP,
  settledRisk: NO_CLIP,
  settledKeyDecision: NO_CLIP,
  artifactLabel: NO_CLIP,
  artifactPointer: NO_CLIP
}

type ClipSearch = { briefing: string; passes: number }

const largestFittingClipRender = (
  renderAtClip: (axisPoint: number) => string,
  fits: (briefing: string) => boolean,
  renderBudgetExceeded: () => string
): ClipSearch => {
  let accepted = CLIP_SEARCH_AXIS_LOWER_BOUND - 1
  let ceiling = CLIP_SEARCH_AXIS_UPPER_BOUND
  let bestFitting: string | null = null
  let passes = 0

  while (accepted < ceiling) {
    const candidate = Math.ceil((accepted + ceiling) / 2)
    const rendered = renderAtClip(candidate)
    passes += 1
    if (fits(rendered)) {
      accepted = candidate
      bestFitting = rendered
    } else {
      ceiling = candidate - 1
    }
  }

  if (bestFitting !== null) return { briefing: bestFitting, passes }
  return { briefing: renderBudgetExceeded(), passes: passes + 1 }
}

const criterionTextWasShortened = (criterion: Criterion, renderClip: RenderClip): boolean =>
  wasClipped(criterion.text, renderClip.criterion) ||
  (typeof criterion.check === 'string' && wasClipped(criterion.check, renderClip.criterionCheck)) ||
  (criterion.done && typeof criterion.result === 'string' && wasClipped(criterion.result, renderClip.criterionResult)) ||
  (criterionSettledness(criterion) === 'confirmed' &&
    typeof criterion.settled_by === 'string' &&
    wasClipped(criterion.settled_by, renderClip.criterionSettledBy))

const riskTextWasShortened = (risk: Risk, textClip: number, refClip: number): boolean =>
  wasClipped(risk.text, textClip) || risk.refs.some((ref) => wasClipped(ref, refClip))

const itemTextWasShortened = (
  predecessor: Thread | null,
  artifacts: readonly Artifact[],
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: readonly OutOfScope[],
  criteria: readonly Criterion[],
  sessions: PreviousSession,
  renderClip: RenderClip
): boolean =>
  (predecessor !== null &&
    (wasClipped(predecessor.title, renderClip.relatedTitle) || wasClipped(predecessor.slug, renderClip.relatedSlug))) ||
  artifacts.some(
    (artifact) => wasClipped(artifact.label, renderClip.artifactLabel) || wasClipped(artifact.pointer, renderClip.artifactPointer)
  ) ||
  risks.live.some((risk) => riskTextWasShortened(risk, renderClip.risk, renderClip.riskRef)) ||
  keyDecisions.live.some((keyDecision) => wasClipped(keyDecision.title, renderClip.keyDecision)) ||
  outOfScope.some((item) => wasClipped(item.text, renderClip.outOfScope)) ||
  criteria.some((criterion) => criterionTextWasShortened(criterion, renderClip)) ||
  sessions.older.some((entry) => wasClipped(firstNonEmptyStoredLine(entry.body), renderClip.sessionHeadline)) ||
  sessions.newest.some((entry) => blockWasShortened(entry.body, renderClip.newestSession)) ||
  risks.settled.some((risk) => wasClipped(risk.text, renderClip.settledRisk)) ||
  keyDecisions.settled.some((keyDecision) => wasClipped(keyDecision.title, renderClip.settledKeyDecision))

const assembleBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  artifacts: readonly Artifact[],
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: readonly OutOfScope[],
  criteria: readonly Criterion[],
  sessions: PreviousSession,
  renderClip: RenderClip,
  unreadableSessionEntryCount: number,
  budgetExceeded: boolean
): string => {
  const notShownAddress = `logbook://thread/${escapeStored(thread.id)}`
  const unreadableDecisionCount = decisionIntegrity.dangling.length + decisionIntegrity.quarantined.length
  const previousEntryCount = sessions.newest.length + sessions.older.length

  const activeGoalLines = thread.spine.active_goal.length === 0 ? [] : [thread.spine.active_goal]
  const legacyLastSessionText =
    previousEntryCount > 0 || thread.spine.last_session.length === 0 ? [] : [thread.spine.last_session]
  const olderSessionEntryLines = [sessions.older.length]
    .filter((count) => count > 0)
    .map((count) => renderOlderSessionEntriesLine(count, thread.id))
  const unreadableSessionEntryLines = [unreadableSessionEntryCount]
    .filter((count) => count > 0)
    .map((count) => renderUnreadableSessionEntriesLine(count, thread.id))
  const lastSessionHeading =
    previousEntryCount + legacyLastSessionText.length + unreadableSessionEntryLines.length === 0
      ? []
      : [LAST_SESSION_HEADING]
  const landedLines = thread.spine.landed.length === 0 ? [] : [thread.spine.landed]
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]

  const headerInlineValues = [thread.title, ...(thread.blocked_by === null ? [] : [thread.blocked_by])]
  const headerBlockValues = [...activeGoalLines, ...legacyLastSessionText, ...landedLines, ...nextStepLines]
  const headerWasShortened =
    headerInlineValues.some(headerInlineWasShortened) ||
    headerBlockValues.some((value) => blockWasShortened(value, HEADER_FIELD_ESCAPED_GRAPHEME_MAX))
  const itemTextWasClipped = itemTextWasShortened(
    predecessor,
    artifacts,
    risks,
    keyDecisions,
    outOfScope,
    criteria,
    sessions,
    renderClip
  )

  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map((item) => renderRelatedLine(item, renderClip))
  const artifactLines = artifacts.map((item) => renderArtifactLine(item, renderClip))
  const riskBlocks = risks.live.map((item) => renderRiskBlock(item, renderClip))
  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
  const outOfScopeLines = outOfScope.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
  const criterionBlocks =
    criteria.length === 0
      ? [CRITERIA_OWED_LINE]
      : [
          ...criteria.map((item) => renderCriterionBlock(item, renderClip)),
          ...(criteria.every((item) => item.struck_by !== null) ? [CRITERIA_ALL_STRUCK_OWED_LINE] : [])
        ]
  const settledLines = [
    ...risks.settled.map((item) => renderSettledRiskLine(item, renderClip.settledRisk)),
    ...keyDecisions.settled.map((item) => renderSettledKeyDecisionLine(item, renderClip.settledKeyDecision))
  ]

  const notShownBulletLines = [
    ...[unreadableDecisionCount]
      .filter((count) => count > 0)
      .map((count) => `- ${count} linked decision records could not be read; their ids are listed under Decisions above`),
    ...[itemTextWasClipped || headerWasShortened].filter(Boolean).map(() => TEXT_CLIPPED_BULLET),
    ...[budgetExceeded].filter(Boolean).map(() => BUDGET_EXCEEDED_BULLET)
  ]

  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${clip(thread.title, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    '',
    CONTINUATION_RULE,
    ...artifactLines.slice(0, 1).map(() => ''),
    ...artifactLines.slice(0, 1).map(() => '**Artifacts:**'),
    ...artifactLines,
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.slice(0, 1).map(() => '**Active goal:**'),
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.map((value) => escapeStoredBlock(value, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)),
    ...lastSessionHeading.slice(0, 1).map(() => ''),
    ...lastSessionHeading.slice(0, 1).map(() => LAST_SESSION_HEADING),
    ...lastSessionHeading.slice(0, 1).map(() => ''),
    ...sessions.newest.map((entry) => renderNewestSessionEntryBlock(entry, renderClip.newestSession)),
    ...sessions.older.map((entry) => renderSessionHeadlineLine(entry, renderClip.sessionHeadline)),
    ...olderSessionEntryLines,
    ...legacyLastSessionText.slice(0, 1).map(() => LEGACY_LAST_SESSION_MARKER),
    ...legacyLastSessionText.map((value) => escapeStoredBlock(value, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)),
    ...unreadableSessionEntryLines,
    ...landedLines.slice(0, 1).map(() => ''),
    ...landedLines.slice(0, 1).map(() => '**Landed:**'),
    ...landedLines.slice(0, 1).map(() => ''),
    ...landedLines.map((value) => escapeStoredBlock(value, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStoredBlock(value, HEADER_FIELD_ESCAPED_GRAPHEME_MAX)),
    ...relatedThreads.slice(0, 1).map(() => ''),
    ...relatedThreads.slice(0, 1).map(() => '**Related:**'),
    ...relatedLines,
    ...riskBlocks.slice(0, 1).map(() => ''),
    ...riskBlocks.slice(0, 1).map(() => '**Open risks:**'),
    ...riskBlocks,
    ...keyDecisionLines.slice(0, 1).map(() => ''),
    ...keyDecisionLines.slice(0, 1).map(() => '**Key decisions:**'),
    ...keyDecisionLines,
    ...outOfScopeLines.slice(0, 1).map(() => ''),
    ...outOfScopeLines.slice(0, 1).map(() => '**Out of scope:**'),
    ...outOfScopeLines,
    ...criterionBlocks.slice(0, 1).map(() => ''),
    ...criterionBlocks.slice(0, 1).map(() => '**Completion criteria:**'),
    ...criterionBlocks,
    ...settledLines.slice(0, 1).map(() => ''),
    ...settledLines.slice(0, 1).map(() => SETTLED_HEADING),
    ...settledLines,
    '',
    '**Decisions:**',
    `- resolved: ${decisionIntegrity.resolved}`,
    ...decisionIntegrity.dangling.map(renderDanglingLine),
    ...decisionIntegrity.quarantined.map(renderQuarantinedLine),
    ...notShownBulletLines.slice(0, 1).map(() => ''),
    ...notShownBulletLines.slice(0, 1).map(() => '**Not shown:**'),
    ...notShownBulletLines,
    ...notShownBulletLines
      .slice(0, 1)
      .map(() => `See ${notShownAddress} for the complete record.`)
  ].join('\n')
}

export type BriefingRender = { briefing: string; passes: number; withinBudget: boolean }

export const renderBriefingWithPasses = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT,
  sessionEntries: readonly SessionEntry[] = [],
  unreadableSessionEntryCount: number = 0
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const liveRisks = thread.spine.open_risks.filter((risk) => !risk.retired)
  const liveArtifacts = (thread.artifacts ?? []).filter((artifact) => !artifact.retired)

  const risks = laneSplit(liveRisks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)
  const sessions = splitNewestFromOlder(previousSessionEntries(sessionEntries))

  const renderWith = (renderClip: RenderClip, budgetExceeded: boolean): string =>
    assembleBriefing(
      thread,
      decisionIntegrity,
      pointer,
      predecessor,
      liveArtifacts,
      risks,
      keyDecisions,
      thread.spine.out_of_scope,
      thread.completion_criteria,
      sessions,
      renderClip,
      unreadableSessionEntryCount,
      budgetExceeded
    )

  const finish = (briefing: string, passes: number): BriefingRender => ({
    briefing,
    passes,
    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession)
  })

  const unclipped = renderWith(UNCLIPPED, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)

  const search = largestFittingClipRender(
    (axisPoint) => renderWith(clipAt(axisPoint), false),
    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession),
    () => renderWith(clipAt(CLIP_SEARCH_AXIS_LOWER_BOUND), true)
  )
  return finish(search.briefing, search.passes + 1)
}

export const renderBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT,
  sessionEntries: readonly SessionEntry[] = [],
  unreadableSessionEntryCount: number = 0
): string =>
  renderBriefingWithPasses(
    thread,
    decisionIntegrity,
    pointer,
    predecessor,
    hasPreviousSession,
    sessionEntries,
    unreadableSessionEntryCount
  ).briefing
