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
const NOT_SHOWN_MARKER_RESERVE = 600
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

const FULL_CLIP: RenderClip = {
  risk: RISK_TEXT_NATURAL_MAX,
  keyDecision: KEY_DECISION_TITLE_NATURAL_MAX,
  outOfScope: OUT_OF_SCOPE_TEXT_NATURAL_MAX,
  criterion: CRITERION_TEXT_NATURAL_MAX
}

const clippablePoolCount = (
  criteria: Laned<Criterion>,
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: Laned<OutOfScope>
): number => criteria.shown.length + risks.shown.length + keyDecisions.shown.length + outOfScope.shown.length

const clippablePoolNaturalTextLen = (
  criteria: Laned<Criterion>,
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: Laned<OutOfScope>
): number => {
  const criterionLen = criteria.shown.reduce((sum, item) => sum + escapeStored(item.text).length, 0)
  const riskLen = risks.shown.reduce((sum, item) => sum + escapeStored(item.text).length, 0)
  const keyDecisionLen = keyDecisions.shown.reduce((sum, item) => sum + escapeStored(item.title).length, 0)
  const outOfScopeLen = outOfScope.shown.reduce((sum, item) => sum + escapeStored(item.text).length, 0)
  return criterionLen + riskLen + keyDecisionLen + outOfScopeLen
}

const shrunkClip = (
  overage: number,
  criteria: Laned<Criterion>,
  risks: Laned<Risk>,
  keyDecisions: Laned<KeyDecision>,
  outOfScope: Laned<OutOfScope>
): RenderClip => {
  const poolCount = clippablePoolCount(criteria, risks, keyDecisions, outOfScope)
  if (poolCount === 0) return FULL_CLIP
  const naturalTextLen = clippablePoolNaturalTextLen(criteria, risks, keyDecisions, outOfScope)
  const targetTextLen = Math.max(poolCount * MIN_TEXT_CLIP, naturalTextLen - overage - NOT_SHOWN_MARKER_RESERVE)
  const perItemClip = Math.max(MIN_TEXT_CLIP, Math.floor(targetTextLen / poolCount))
  return { risk: perItemClip, keyDecision: perItemClip, outOfScope: perItemClip, criterion: perItemClip }
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

export const renderBriefing = (
  thread: Thread,
  decisionIntegrity: DecisionIntegrity,
  pointer: Pointer | null,
  predecessor: Thread | null
): string => {
  const criteriaById = new Map(thread.completion_criteria.map((criterion) => [criterion.id, criterion] as const))
  const currentId = currentCriterionId(thread.completion_criteria)

  const risks = laneSplit(thread.spine.open_risks, criteriaById, currentId, LANE_A_RISKS_MAX, LANE_B_RISKS_MAX)
  const keyDecisions = laneSplit(thread.spine.key_decisions, criteriaById, currentId, LANE_A_TITLES_MAX, LANE_B_TITLES_MAX)
  const outOfScope = capList(thread.spine.out_of_scope, OUT_OF_SCOPE_SHOWN_MAX)
  const criteria = capCriteria(thread.completion_criteria, CRITERIA_SHOWN_MAX)
  const dangling = capList(decisionIntegrity.dangling, DECISION_ID_SHOWN_MAX)
  const quarantined = capList(decisionIntegrity.quarantined, DECISION_ID_SHOWN_MAX)

  const unclipped = assembleBriefing(
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
    FULL_CLIP,
    false
  )
  if (unclipped.length <= BRIEFING_MAX_CHARS) return unclipped

  const overage = unclipped.length - BRIEFING_MAX_CHARS
  const renderClip = shrunkClip(overage, criteria, risks, keyDecisions, outOfScope)

  return assembleBriefing(
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
    true
  )
}
