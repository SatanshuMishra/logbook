import type { Thread, Criterion, Risk, KeyDecision, OutOfScope, Artifact } from '../schema/thread.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Pointer } from '../domain/pointer.ts'
import { previousSessionEntries } from '../domain/session-log.ts'
import { escapeStored } from './escape.ts'
import { CLIP_MARKER_GRAPHEMES, clipWithMarker } from './clip.ts'
import { THREAD_SLUG_MAX } from '../schema/caps.ts'

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

export const BRIEFING_HEADING = '# Your Preflight Briefing'
export const BRIEFING_MAX_CHARS = 12000
export const RESUME_PAYLOAD_MAX_BYTES = 24000

const RESUME_PAYLOAD_RESERVE_BYTES = 200
const RESUME_PAYLOAD_TARGET_BYTES = RESUME_PAYLOAD_MAX_BYTES - RESUME_PAYLOAD_RESERVE_BYTES

const BRIEFING_COPIES_IN_RESUME_PAYLOAD = 2
const RESUME_PAYLOAD_SCAFFOLD_BYTES = 114
const PREVIOUS_SESSION_NULL_BYTES = 4
const PREVIOUS_SESSION_LARGEST_BYTES = 82
const PREVIOUS_SESSION_PRESENT_EXTRA_BYTES = PREVIOUS_SESSION_LARGEST_BYTES - PREVIOUS_SESSION_NULL_BYTES
const PREVIOUS_SESSION_ABSENT_EXTRA_BYTES = 0
const PREVIOUS_SESSION_DEFAULT_PRESENT = true
const JSON_STRING_DELIMITER_BYTES = 2
const FOCUS_FIELD_DEFAULT_COUNT = 0
const FOCUS_FIELD_PREFIX_BYTES = 9
const FOCUS_ID_SERIALISED_BYTES = 28
const FOCUS_ID_SEPARATOR_BYTES = 1

const jsonEscapedByteLen = (text: string): number =>
  Buffer.byteLength(JSON.stringify(text), 'utf8') - JSON_STRING_DELIMITER_BYTES

const focusFieldBytes = (focusCount: number): number =>
  FOCUS_FIELD_PREFIX_BYTES +
  2 +
  focusCount * FOCUS_ID_SERIALISED_BYTES +
  Math.max(0, focusCount - 1) * FOCUS_ID_SEPARATOR_BYTES

export const resumePayloadBytes = (
  briefing: string,
  threadId: string,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT,
  focusCount: number = FOCUS_FIELD_DEFAULT_COUNT
): number =>
  BRIEFING_COPIES_IN_RESUME_PAYLOAD * jsonEscapedByteLen(briefing) +
  jsonEscapedByteLen(threadId) +
  RESUME_PAYLOAD_SCAFFOLD_BYTES +
  (hasPreviousSession ? PREVIOUS_SESSION_PRESENT_EXTRA_BYTES : PREVIOUS_SESSION_ABSENT_EXTRA_BYTES) +
  focusFieldBytes(focusCount)

const fitsBudget = (briefing: string, threadId: string, hasPreviousSession: boolean, focusCount: number): boolean =>
  briefing.length <= BRIEFING_MAX_CHARS &&
  resumePayloadBytes(briefing, threadId, hasPreviousSession, focusCount) <= RESUME_PAYLOAD_TARGET_BYTES

const RELATED_TITLE_NATURAL_MAX = 100
const RELATED_SLUG_NATURAL_MAX = 64
const RISK_TEXT_NATURAL_MAX = 500
const RISK_REF_NATURAL_MAX = 200
const KEY_DECISION_TITLE_NATURAL_MAX = 200
const OUT_OF_SCOPE_TEXT_NATURAL_MAX = 300
const CRITERION_TEXT_NATURAL_MAX = 500
const CRITERION_CHECK_NATURAL_MAX = 500
const CRITERION_RESULT_NATURAL_MAX = 500
const LAST_SESSION_TEXT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120
const ARTIFACT_LABEL_NATURAL_MAX = 200
const ARTIFACT_POINTER_NATURAL_MAX = 500

const MIN_TEXT_CLIP = CLIP_MARKER_GRAPHEMES
const NO_CLIP = Number.POSITIVE_INFINITY

export const NOT_RECORDED = 'not recorded'

const FOCUS_NOT_SET_LINE =
  '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'

const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'

const LAST_SESSION_HEADING = '**Last session:**'

const LEGACY_LAST_SESSION_MARKER =
  '(legacy) no session log entry exists for the previous session, so the hand-written summary below is shown instead'

const TEXT_CLIPPED_BULLET =
  '- some text on this briefing was shortened to fit the character budget; every shortened value ends with ...[shortened]'

const clip = (text: string, max: number): string => clipWithMarker(escapeStored(text), max)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderCriterionLine = (criterion: Criterion, textClip: number): string => {
  const text = clip(criterion.text, textClip)
  const label = `- c${criterion.ordinal} [${criterionStatus(criterion)}]:`
  const withText = text.length === 0 ? label : `${label} ${text}`
  return `${withText} (id ${escapeStored(criterion.id)})`
}

const renderCheckLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.check === 'string'
    ? `  - check: ${clip(criterion.check, textClip)}`
    : `  - check: ${NOT_RECORDED}`

const renderResultStatus = (criterion: Criterion): string => escapeStored(criterion.result_status ?? NOT_RECORDED)

const renderResultLine = (criterion: Criterion, textClip: number): string =>
  typeof criterion.result === 'string'
    ? `  - result: ${clip(criterion.result, textClip)} (${renderResultStatus(criterion)})`
    : `  - result: ${NOT_RECORDED} (${renderResultStatus(criterion)})`

const renderCriterionBlock = (criterion: Criterion, renderClip: RenderClip): string =>
  [
    renderCriterionLine(criterion, renderClip.criterion),
    renderCheckLine(criterion, renderClip.criterionCheck),
    ...[criterion].filter((entry) => entry.done).map((entry) => renderResultLine(entry, renderClip.criterionResult))
  ].join('\n')

const renderRiskBlock = (risk: Risk, renderClip: RenderClip): string =>
  [
    `- ${escapeStored(risk.id)} ${clip(risk.text, renderClip.risk)}`,
    ...risk.refs.map((ref) => `  - ref: ${clip(ref, renderClip.riskRef)}`)
  ].join('\n')

const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- ${clip(keyDecision.title, textClip)} (decision ${escapeStored(keyDecision.decision_id)})`

const renderOutOfScopeLine = (outOfScope: OutOfScope, textClip: number): string => `- ${clip(outOfScope.text, textClip)}`

const renderArtifactLine = (artifact: Artifact, renderClip: RenderClip): string =>
  `- ${clip(artifact.label, renderClip.artifactLabel)}: ${clip(artifact.pointer, renderClip.artifactPointer)}`

const renderSessionEntryLine = (entry: SessionEntry, textClip: number): string =>
  `- ${escapeStored(entry.id)} ${clip(entry.body, textClip)}`

const renderUnreadableSessionEntriesLine = (count: number, threadId: string): string =>
  `- ${count} session log entr${count === 1 ? 'y' : 'ies'} on this thread could not be read; see logbook://sessions/${escapeStored(threadId)} for the complete record`

const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
  `- risk ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderSettledKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- decision ${escapeStored(keyDecision.decision_id)} ${clip(keyDecision.title, textClip)}`

const renderDanglingLine = (decisionId: string): string => `- dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `- quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread, renderClip: RenderClip): string =>
  `- succeeds: ${clip(predecessor.title, renderClip.relatedTitle)} (${clip(predecessor.slug, renderClip.relatedSlug)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

const focusLabel = (id: string, criteriaById: ReadonlyMap<string, Criterion>): string => {
  const criterion = criteriaById.get(id)
  return criterion === undefined ? escapeStored(id) : `c${criterion.ordinal}`
}

const renderFocusLine = (focus: readonly string[], criteriaById: ReadonlyMap<string, Criterion>): string => {
  if (focus.length === 0) return FOCUS_NOT_SET_LINE
  const labels = focus.map((id) => focusLabel(id, criteriaById)).join(', ')
  return `**Focus:** ${labels}. Risks and key decisions on those goals render first, then the rest in the order they were recorded, apart from those on a goal already met or struck.`
}

type Lane = 'focused' | 'live' | 'settled'

const laneFor = (
  criterionId: string | undefined,
  criteriaById: ReadonlyMap<string, Criterion>,
  focus: readonly string[]
): Lane => {
  if (criterionId === undefined) return 'live'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'live'
  if (criterion.struck_by !== null || criterion.done) return 'settled'
  return focus.includes(criterionId) ? 'focused' : 'live'
}

type Laned<T> = { focused: T[]; live: T[]; settled: T[] }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>,
  focus: readonly string[]
): Laned<T> => ({
  focused: items.filter((item) => laneFor(item.criterion_id, criteriaById, focus) === 'focused'),
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById, focus) === 'live'),
  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById, focus) === 'settled')
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
  lastSession: number
  settled: number
  artifactLabel: number
  artifactPointer: number
}

const clipAt = (perItemClip: number): RenderClip => ({
  relatedTitle: Math.min(perItemClip, RELATED_TITLE_NATURAL_MAX),
  relatedSlug: THREAD_SLUG_MAX,
  risk: Math.min(perItemClip, RISK_TEXT_NATURAL_MAX),
  riskRef: Math.min(perItemClip, RISK_REF_NATURAL_MAX),
  keyDecision: Math.min(perItemClip, KEY_DECISION_TITLE_NATURAL_MAX),
  outOfScope: Math.min(perItemClip, OUT_OF_SCOPE_TEXT_NATURAL_MAX),
  criterion: Math.min(perItemClip, CRITERION_TEXT_NATURAL_MAX),
  criterionCheck: Math.min(perItemClip, CRITERION_CHECK_NATURAL_MAX),
  criterionResult: Math.min(perItemClip, CRITERION_RESULT_NATURAL_MAX),
  lastSession: Math.min(perItemClip, LAST_SESSION_TEXT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX),
  artifactLabel: Math.min(perItemClip, ARTIFACT_LABEL_NATURAL_MAX),
  artifactPointer: Math.min(perItemClip, ARTIFACT_POINTER_NATURAL_MAX)
})

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
  lastSession: NO_CLIP,
  settled: NO_CLIP,
  artifactLabel: NO_CLIP,
  artifactPointer: NO_CLIP
}

const MAX_ITEM_CLIP = Math.max(
  RELATED_TITLE_NATURAL_MAX,
  RELATED_SLUG_NATURAL_MAX,
  RISK_TEXT_NATURAL_MAX,
  RISK_REF_NATURAL_MAX,
  KEY_DECISION_TITLE_NATURAL_MAX,
  OUT_OF_SCOPE_TEXT_NATURAL_MAX,
  CRITERION_TEXT_NATURAL_MAX,
  CRITERION_CHECK_NATURAL_MAX,
  CRITERION_RESULT_NATURAL_MAX,
  LAST_SESSION_TEXT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX,
  ARTIFACT_LABEL_NATURAL_MAX,
  ARTIFACT_POINTER_NATURAL_MAX
)

type ClipSearch = { briefing: string; passes: number }

const largestFittingClipRender = (
  renderAtClip: (perItemClip: number) => string,
  fits: (briefing: string) => boolean,
  unclipped: string
): ClipSearch => {
  let accepted = MIN_TEXT_CLIP - 1
  let ceiling = MAX_ITEM_CLIP
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
  const floorRender = renderAtClip(MIN_TEXT_CLIP)
  const smallest = floorRender.length < unclipped.length ? floorRender : unclipped
  return { briefing: smallest, passes: passes + 1 }
}

const assembleBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  focus: readonly string[],
  criteriaById: ReadonlyMap<string, Criterion>,
  predecessor: Thread | null,
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: readonly OutOfScope[],
  criteria: readonly Criterion[],
  previousEntries: readonly SessionEntry[],
  renderClip: RenderClip,
  textWasClipped: boolean,
  unreadableSessionEntryCount: number
): string => {
  const notShownAddress = `logbook://thread/${escapeStored(thread.id)}`
  const unreadableDecisionCount = decisionIntegrity.dangling.length + decisionIntegrity.quarantined.length

  const activeGoalLines = thread.spine.active_goal.length === 0 ? [] : [thread.spine.active_goal]
  const legacyLastSessionText =
    previousEntries.length > 0 || thread.spine.last_session.length === 0 ? [] : [thread.spine.last_session]
  const unreadableSessionEntryLines = [unreadableSessionEntryCount]
    .filter((count) => count > 0)
    .map((count) => renderUnreadableSessionEntriesLine(count, thread.id))
  const lastSessionHeading =
    previousEntries.length + legacyLastSessionText.length + unreadableSessionEntryLines.length === 0
      ? []
      : [LAST_SESSION_HEADING]
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]

  const artifacts = thread.artifacts ?? []
  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map((item) => renderRelatedLine(item, renderClip))
  const artifactLines = artifacts.map((item) => renderArtifactLine(item, renderClip))
  const riskBlocks = [...risks.focused, ...risks.live].map((item) => renderRiskBlock(item, renderClip))
  const keyDecisionLines = [...keyDecisions.focused, ...keyDecisions.live].map((item) =>
    renderKeyDecisionLine(item, renderClip.keyDecision)
  )
  const outOfScopeLines = outOfScope.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
  const criterionBlocks = criteria.map((item) => renderCriterionBlock(item, renderClip))
  const settledLines = [
    ...risks.settled.map((item) => renderSettledRiskLine(item, renderClip.settled)),
    ...keyDecisions.settled.map((item) => renderSettledKeyDecisionLine(item, renderClip.settled))
  ]

  const notShownBulletLines = [
    ...[unreadableDecisionCount]
      .filter((count) => count > 0)
      .map((count) => `- ${count} linked decision records could not be read; their ids are listed under Decisions above`),
    ...[textWasClipped].filter(Boolean).map(() => TEXT_CLIPPED_BULLET)
  ]

  return [
    BRIEFING_HEADING,
    '',
    `**Thread:** ${escapeStored(thread.title)}`,
    `**Status:** ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    renderFocusLine(focus, criteriaById),
    ...artifactLines.slice(0, 1).map(() => ''),
    ...artifactLines.slice(0, 1).map(() => '**Artifacts:**'),
    ...artifactLines,
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.slice(0, 1).map(() => '**Active goal:**'),
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.map((value) => escapeStored(value)),
    ...lastSessionHeading.slice(0, 1).map(() => ''),
    ...lastSessionHeading.slice(0, 1).map(() => LAST_SESSION_HEADING),
    ...lastSessionHeading.slice(0, 1).map(() => ''),
    ...previousEntries.map((entry) => renderSessionEntryLine(entry, renderClip.lastSession)),
    ...legacyLastSessionText.slice(0, 1).map(() => LEGACY_LAST_SESSION_MARKER),
    ...legacyLastSessionText.map((value) => escapeStored(value)),
    ...unreadableSessionEntryLines,
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStored(value)),
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
  const focus = pointer !== null && pointer.thread_id === thread.id ? pointer.focus : []

  const risks = laneSplit(thread.spine.open_risks, criteriaById, focus)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById, focus)
  const previousEntries = previousSessionEntries(sessionEntries)

  const renderWith = (renderClip: RenderClip, textWasClipped: boolean): string =>
    assembleBriefing(
      thread,
      decisionIntegrity,
      pointer,
      focus,
      criteriaById,
      predecessor,
      risks,
      keyDecisions,
      thread.spine.out_of_scope,
      thread.completion_criteria,
      previousEntries,
      renderClip,
      textWasClipped,
      unreadableSessionEntryCount
    )

  const finish = (briefing: string, passes: number): BriefingRender => ({
    briefing,
    passes,
    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession, focus.length)
  })

  const unclipped = renderWith(UNCLIPPED, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession, focus.length)) return finish(unclipped, 1)

  const search = largestFittingClipRender(
    (perItemClip) => renderWith(clipAt(perItemClip), true),
    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession, focus.length),
    unclipped
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
