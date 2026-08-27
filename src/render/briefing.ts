import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import * as caps from '../schema/caps.ts'
import { escapeStored, clipGraphemes } from './escape.ts'

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

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

const LANE_A_RISKS_MAX = 8
const LANE_B_RISKS_MAX = 4
const RISK_TEXT_NATURAL_MAX = 500

const LANE_A_TITLES_MAX = 10
const LANE_B_TITLES_MAX = 5
const KEY_DECISION_TITLE_NATURAL_MAX = 200

const OUT_OF_SCOPE_SHOWN_MAX = 10
const OUT_OF_SCOPE_TEXT_NATURAL_MAX = 300

const CRITERIA_SHOWN_MAX = caps.CRITERIA_MAX_ELEMENTS
const CRITERION_TEXT_NATURAL_MAX = 500

const DECISION_ID_SHOWN_MAX = 6

const MIN_TEXT_CLIP = 0
const TEXT_CLIPPED_BULLET =
  '- some criterion, risk, key decision or out-of-scope text was shortened to fit the character budget'

const clip = (text: string, max: number): string => clipGraphemes(escapeStored(text), max)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const renderCriterionLine = (criterion: Criterion, textClip: number): string =>
  `c${criterion.ordinal} [${criterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${clip(criterion.text, textClip)}`

const renderRiskLine = (risk: Risk, textClip: number): string => `- ${escapeStored(risk.id)} ${clip(risk.text, textClip)}`

const renderKeyDecisionLine = (keyDecision: KeyDecision, textClip: number): string => `- ${clip(keyDecision.title, textClip)}`

const renderOutOfScopeLine = (outOfScope: OutOfScope, textClip: number): string => `- ${clip(outOfScope.text, textClip)}`

const renderDanglingLine = (decisionId: string): string => `dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${clip(predecessor.title, RELATED_TITLE_CLIP)} (${clip(predecessor.slug, RELATED_SLUG_CLIP)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? 'Blockage: none' : `Blocked: ${escapeStored(blockedBy)}`

const renderPointerStatus = (pointer: Pointer | null, threadId: string): string =>
  pointer !== null && pointer.thread_id === threadId ? 'Currently being worked: yes' : 'Currently being worked: no'

type Lane = 'A' | 'B' | 'C'

const currentCriterionId = (criteria: readonly Criterion[]): string | null => {
  const current = criteria.find((criterion) => criterion.struck_by === null && !criterion.done)
  return current === undefined ? null : current.id
}

const laneFor = (
  criterionId: string | undefined,
  criteriaById: ReadonlyMap<string, Criterion>,
  currentId: string | null
): Lane => {
  if (criterionId === undefined) return 'B'
  const criterion = criteriaById.get(criterionId)
  if (criterion === undefined) return 'B'
  if (criterion.struck_by !== null || criterion.done) return 'C'
  return criterion.id === currentId ? 'A' : 'B'
}

type Laned<T> = { shown: T[]; hidden: number }

const laneSplit = <T extends { criterion_id?: string | undefined }>(
  items: readonly T[],
  criteriaById: ReadonlyMap<string, Criterion>,
  currentId: string | null,
  capA: number,
  capB: number
): Laned<T> => {
  const laneA = items.filter((item) => laneFor(item.criterion_id, criteriaById, currentId) === 'A')
  const laneB = items.filter((item) => laneFor(item.criterion_id, criteriaById, currentId) === 'B')
  const shownA = laneA.slice(0, capA)
  const shownB = laneB.slice(0, capB)
  return { shown: [...shownA, ...shownB], hidden: items.length - shownA.length - shownB.length }
}

const capList = <T>(items: readonly T[], cap: number): Laned<T> => ({
  shown: items.slice(0, cap),
  hidden: Math.max(0, items.length - cap)
})

const CRITERION_RANK_OPEN = 0
const CRITERION_RANK_DONE = 1
const CRITERION_RANK_STRUCK = 2

const criterionRank = (criterion: Criterion): number => {
  const status = criterionStatus(criterion)
  if (status === 'open') return CRITERION_RANK_OPEN
  return status === 'done' ? CRITERION_RANK_DONE : CRITERION_RANK_STRUCK
}

type RankedCriterion = { criterion: Criterion; index: number; rank: number }

const byRankThenOriginalIndex = (left: RankedCriterion, right: RankedCriterion): number =>
  left.rank === right.rank ? left.index - right.index : left.rank - right.rank

const capCriteria = (criteria: readonly Criterion[], cap: number): Laned<Criterion> => {
  const ranked: RankedCriterion[] = criteria.map((criterion, index) => ({
    criterion,
    index,
    rank: criterionRank(criterion)
  }))
  const selectedIndices = new Set(
    [...ranked]
      .sort(byRankThenOriginalIndex)
      .slice(0, Math.max(0, cap))
      .map((entry) => entry.index)
  )
  return {
    shown: ranked.filter((entry) => selectedIndices.has(entry.index)).map((entry) => entry.criterion),
    hidden: criteria.length - selectedIndices.size
  }
}

type RenderClip = { risk: number; keyDecision: number; outOfScope: number; criterion: number }

const clipAt = (perItemClip: number): RenderClip => ({
  risk: Math.min(perItemClip, RISK_TEXT_NATURAL_MAX),
  keyDecision: Math.min(perItemClip, KEY_DECISION_TITLE_NATURAL_MAX),
  outOfScope: Math.min(perItemClip, OUT_OF_SCOPE_TEXT_NATURAL_MAX),
  criterion: Math.min(perItemClip, CRITERION_TEXT_NATURAL_MAX)
})

const MAX_ITEM_CLIP = Math.max(
  RISK_TEXT_NATURAL_MAX,
  KEY_DECISION_TITLE_NATURAL_MAX,
  OUT_OF_SCOPE_TEXT_NATURAL_MAX,
  CRITERION_TEXT_NATURAL_MAX
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
  outOfScope: Laned<OutOfScope>,
  criteria: Laned<Criterion>,
  dangling: Laned<string>,
  quarantined: Laned<string>,
  renderClip: RenderClip,
  textWasClipped: boolean
): string => {
  const notShownAddress = `logbook://thread/${escapeStored(thread.id)}`
  const danglingOrQuarantinedHidden = dangling.hidden + quarantined.hidden

  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderRelatedLine)
  const riskLines = risks.shown.map((item) => renderRiskLine(item, renderClip.risk))
  const keyDecisionLines = keyDecisions.shown.map((item) => renderKeyDecisionLine(item, renderClip.keyDecision))
  const outOfScopeLines = outOfScope.shown.map((item) => renderOutOfScopeLine(item, renderClip.outOfScope))
  const criterionLines = criteria.shown.map((item) => renderCriterionLine(item, renderClip.criterion))

  const notShownBulletLines = [
    ...[risks.hidden].filter((count) => count > 0).map((count) => `- ${count} risks not shown`),
    ...[keyDecisions.hidden].filter((count) => count > 0).map((count) => `- ${count} key decisions not shown`),
    ...[outOfScope.hidden].filter((count) => count > 0).map((count) => `- ${count} out-of-scope items not shown`),
    ...[criteria.hidden].filter((count) => count > 0).map((count) => `- ${count} completion criteria not shown`),
    ...[danglingOrQuarantinedHidden]
      .filter((count) => count > 0)
      .map((count) => `- ${count} dangling or quarantined decision ids not shown`),
    ...[textWasClipped].filter(Boolean).map(() => TEXT_CLIPPED_BULLET)
  ]

  return [
    `Thread: ${escapeStored(thread.title)}`,
    `Status: ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    `Active goal: ${escapeStored(thread.spine.active_goal)}`,
    `Next step: ${escapeStored(thread.spine.next_step)}`,
    `Last session: ${escapeStored(thread.spine.last_session)}`,
    ...relatedThreads.slice(0, 1).map(() => 'Related:'),
    ...relatedLines,
    ...risks.shown.slice(0, 1).map(() => 'Open risks:'),
    ...riskLines,
    ...keyDecisions.shown.slice(0, 1).map(() => 'Key decisions:'),
    ...keyDecisionLines,
    ...outOfScope.shown.slice(0, 1).map(() => 'Out of scope:'),
    ...outOfScopeLines,
    ...criteria.shown.slice(0, 1).map(() => 'Completion criteria:'),
    ...criterionLines,
    'Decisions:',
    `resolved: ${decisionIntegrity.resolved}`,
    ...dangling.shown.map(renderDanglingLine),
    ...quarantined.shown.map(renderQuarantinedLine),
    ...notShownBulletLines.slice(0, 1).map(() => 'Not shown:'),
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
  const currentId = currentCriterionId(thread.completion_criteria)

  const risks = laneSplit(thread.spine.open_risks, criteriaById, currentId, LANE_A_RISKS_MAX, LANE_B_RISKS_MAX)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById, currentId, LANE_A_TITLES_MAX, LANE_B_TITLES_MAX)
  const outOfScope = capList(thread.spine.out_of_scope, OUT_OF_SCOPE_SHOWN_MAX)
  const criteria = capCriteria(thread.completion_criteria, CRITERIA_SHOWN_MAX)
  const dangling = capList(decisionIntegrity.dangling, DECISION_ID_SHOWN_MAX)
  const quarantined = capList(decisionIntegrity.quarantined, DECISION_ID_SHOWN_MAX)

  const renderWith = (renderClip: RenderClip, textWasClipped: boolean): string =>
    assembleBriefing(
      thread,
      decisionIntegrity,
      pointer,
      predecessor,
      risks,
      keyDecisions,
      outOfScope,
      criteria,
      dangling,
      quarantined,
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
