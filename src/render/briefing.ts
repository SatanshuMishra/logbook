import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored, clipGraphemes } from './escape.ts'

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

const RELATED_TITLE_CLIP = 100
const RELATED_SLUG_CLIP = 64

const RISK_TEXT_NATURAL_MAX = 500
const KEY_DECISION_TITLE_NATURAL_MAX = 200
const OUT_OF_SCOPE_TEXT_NATURAL_MAX = 300
const CRITERION_TEXT_NATURAL_MAX = 500
const SETTLED_TEXT_NATURAL_MAX = 120

const MIN_TEXT_CLIP = 0
const TEXT_CLIPPED_BULLET =
  '- some criterion, risk, key decision or out-of-scope text was shortened to fit the character budget'

const FOCUS_NOT_SET_LINE =
  '**Focus:** not set. Risks and key decisions render as one group in the order they were recorded, apart from those on a goal already met or struck.'

const SETTLED_HEADING = '**Settled items (on goals already met or struck):**'

const clip = (text: string, max: number): string => clipGraphemes(escapeStored(text), max)

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

const renderRiskLine = (risk: Risk, textClip: number): string => `- ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string => `- ${clip(keyDecision.title, textClip)}`

const renderOutOfScopeLine = (outOfScope: OutOfScope, textClip: number): string => `- ${clip(outOfScope.text, textClip)}`

const renderSettledRiskLine = (risk: Risk, textClip: number): string =>
  `- risk ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderSettledKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string =>
  `- decision ${escapeStored(keyDecision.decision_id)} ${clip(keyDecision.title, textClip)}`

const renderDanglingLine = (decisionId: string): string => `- dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `- quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${clip(predecessor.title, RELATED_TITLE_CLIP)} (${clip(predecessor.slug, RELATED_SLUG_CLIP)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? '**Blockage:** none' : `**Blocked:** ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? '**Currently being worked:** yes' : '**Currently being worked:** no'

type Lane = 'live' | 'settled'

const laneFor = (criterionId: string | undefined, criteriaById: ReadonlyMap<string, Criterion>): Lane => {
  if (criterionId === undefined) return 'live'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'live'
  return criterion.struck_by !== null || criterion.done ? 'settled' : 'live'
}

type Laned<T> = { live: T[]; settled: T[] }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>
): Laned<T> => ({
  live: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'live'),
  settled: items.filter((item) => laneFor(item.criterion_id, criteriaById) === 'settled')
})

type RenderClip = { risk: number; keyDecision: number; outOfScope: number; criterion: number; settled: number }

const clipAt = (perItemClip: number): RenderClip => ({
  risk: Math.min(perItemClip, RISK_TEXT_NATURAL_MAX),
  keyDecision: Math.min(perItemClip, KEY_DECISION_TITLE_NATURAL_MAX),
  outOfScope: Math.min(perItemClip, OUT_OF_SCOPE_TEXT_NATURAL_MAX),
  criterion: Math.min(perItemClip, CRITERION_TEXT_NATURAL_MAX),
  settled: Math.min(perItemClip, SETTLED_TEXT_NATURAL_MAX)
})

const MAX_ITEM_CLIP = Math.max(
  RISK_TEXT_NATURAL_MAX,
  KEY_DECISION_TITLE_NATURAL_MAX,
  OUT_OF_SCOPE_TEXT_NATURAL_MAX,
  CRITERION_TEXT_NATURAL_MAX,
  SETTLED_TEXT_NATURAL_MAX
)

const FULL_CLIP: RenderClip = clipAt(MAX_ITEM_CLIP)

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
  predecessor: Thread | null,
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: readonly OutOfScope[],
  criteria: readonly Criterion[],
  renderClip: RenderClip,
  textWasClipped: boolean
): string => {
  const notShownAddress = `logbook://thread/${escapeStored(thread.id)}`
  const unreadableDecisionCount = decisionIntegrity.dangling.length + decisionIntegrity.quarantined.length

  const activeGoalLines = thread.spine.active_goal.length === 0 ? [] : [thread.spine.active_goal]
  const lastSessionLines = thread.spine.last_session.length === 0 ? [] : [thread.spine.last_session]
  const nextStepLines = thread.spine.next_step.length === 0 ? [] : [thread.spine.next_step]

  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderRelatedLine)
  const riskLines = risks.live.map((item) => renderRiskLine(item, renderClip.risk))
  const keyDecisionLines = keyDecisions.live.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
  const outOfScopeLines = outOfScope.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
  const criterionLines = criteria.map((item) => renderCriterionLine(item, renderClip.criterion))
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
    FOCUS_NOT_SET_LINE,
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.slice(0, 1).map(() => '**Active goal:**'),
    ...activeGoalLines.slice(0, 1).map(() => ''),
    ...activeGoalLines.map((value) => escapeStored(value)),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.slice(0, 1).map(() => '**Last session:**'),
    ...lastSessionLines.slice(0, 1).map(() => ''),
    ...lastSessionLines.map((value) => escapeStored(value)),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.slice(0, 1).map(() => '**Next step:**'),
    ...nextStepLines.slice(0, 1).map(() => ''),
    ...nextStepLines.map((value) => escapeStored(value)),
    ...relatedThreads.slice(0, 1).map(() => ''),
    ...relatedThreads.slice(0, 1).map(() => '**Related:**'),
    ...relatedLines,
    ...riskLines.slice(0, 1).map(() => ''),
    ...riskLines.slice(0, 1).map(() => '**Open risks:**'),
    ...riskLines,
    ...keyDecisionLines.slice(0, 1).map(() => ''),
    ...keyDecisionLines.slice(0, 1).map(() => '**Key decisions:**'),
    ...keyDecisionLines,
    ...outOfScopeLines.slice(0, 1).map(() => ''),
    ...outOfScopeLines.slice(0, 1).map(() => '**Out of scope:**'),
    ...outOfScopeLines,
    ...criterionLines.slice(0, 1).map(() => ''),
    ...criterionLines.slice(0, 1).map(() => '**Completion criteria:**'),
    ...criterionLines,
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
    ...notShownBulletLines.slice(0, 1).map(() => `See ${clip(notShownAddress, 200)} for the complete record.`)
  ].join('\n')
}

export type BriefingRender = { briefing: string; passes: number; withinBudget: boolean }

export const renderBriefingWithPasses = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): BriefingRender => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))

  const risks = laneSplit(thread.spine.open_risks, criteriaById)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById)

  const renderWith = (renderClip: RenderClip, textWasClipped: boolean): string =>
    assembleBriefing(
      thread,
      decisionIntegrity,
      pointer,
      predecessor,
      risks,
      keyDecisions,
      thread.spine.out_of_scope,
      thread.completion_criteria,
      renderClip,
      textWasClipped
    )

  const finish = (briefing: string, passes: number): BriefingRender => ({
    briefing,
    passes,
    withinBudget: fitsBudget(briefing, thread.id, hasPreviousSession)
  })

  const unclipped = renderWith(FULL_CLIP, false)
  if (fitsBudget(unclipped, thread.id, hasPreviousSession)) return finish(unclipped, 1)

  const search = largestFittingClipRender(
    (perItemClip) => renderWith(clipAt(perItemClip), true),
    (briefing) => fitsBudget(briefing, thread.id, hasPreviousSession),
    unclipped
  )
  return finish(search.briefing, search.passes + 1)
}

export const renderBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null,
  hasPreviousSession: boolean = PREVIOUS_SESSION_DEFAULT_PRESENT
): string => renderBriefingWithPasses(thread, decisionIntegrity, pointer, predecessor, hasPreviousSession).briefing
