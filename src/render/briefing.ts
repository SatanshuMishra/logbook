import type { Thread, Criterion, Risk, KeyDecision, OutOfScope } from '../schema/thread.ts'
import type { Pointer } from '../domain/pointer.ts'
import { escapeStored, clipGraphemes } from './escape.ts'

export type DecisionIntegrity = {
  resolved: number
  dangling: string[]
  quarantined: string[]
}

export const BRIEFING_MAX_CHARS = 12000
export const RESUME_PAYLOAD_MAX_BYTES = 24000

const SCALAR_FIELD_CLIP = 80
const RELATED_TITLE_CLIP = 100
const RELATED_SLUG_CLIP = 64

const CRITERIA_SECTION_BUDGET = 7200
const CRITERION_LINE_OVERHEAD = 42
const CRITERION_TEXT_MIN_CLIP = 3
const CRITERION_TEXT_MAX_CLIP = 300

const LANE_A_RISKS_MAX = 8
const LANE_B_RISKS_MAX = 4
const RISK_TEXT_CLIP = 60

const LANE_A_TITLES_MAX = 10
const LANE_B_TITLES_MAX = 5
const KEY_DECISION_TITLE_CLIP = 60

const OUT_OF_SCOPE_SHOWN_MAX = 10
const OUT_OF_SCOPE_TEXT_CLIP = 60

const DECISION_ID_SHOWN_MAX = 6

const clip = (text: string, max: number): string => clipGraphemes(escapeStored(text), max)

const criterionStatus = (criterion: Criterion): string => {
  if (criterion.struck_by !== null) return 'struck'
  return criterion.done ? 'done' : 'open'
}

const perItemClip = (budget: number, overhead: number, count: number, min: number, max: number): number => {
  if (count === 0) return max
  const remaining = budget - overhead * count
  return Math.min(max, Math.max(min, Math.floor(remaining / count)))
}

const renderCriterionLine = (criterion: Criterion, textClip: number): string =>
  `c${criterion.ordinal} [${criterionStatus(criterion)}] ${escapeStored(criterion.id)}: ${clip(criterion.text, textClip)}`

const renderRiskLine = (risk: Risk): string => `- ${escapeStored(risk.id)} ${clip(risk.text, RISK_TEXT_CLIP)}`

const renderKeyDecisionLine = (keyDecision: KeyDecision): string => `- ${clip(keyDecision.title, KEY_DECISION_TITLE_CLIP)}`

const renderOutOfScopeLine = (outOfScope: OutOfScope): string => `- ${clip(outOfScope.text, OUT_OF_SCOPE_TEXT_CLIP)}`

const renderDanglingLine = (decisionId: string): string => `dangling: ${escapeStored(decisionId)}`
const renderQuarantinedLine = (decisionId: string): string => `quarantined: ${escapeStored(decisionId)}`

const renderRelatedLine = (predecessor: Thread): string =>
  `- succeeds: ${clip(predecessor.title, RELATED_TITLE_CLIP)} (${clip(predecessor.slug, RELATED_SLUG_CLIP)})`

const renderBlockage = (blockedBy: string | null): string =>
  blockedBy === null ? 'Blockage: none' : `Blocked: ${clip(blockedBy, SCALAR_FIELD_CLIP)}`

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
  const dangling = capList(decisionIntegrity.dangling, DECISION_ID_SHOWN_MAX)
  const quarantined = capList(decisionIntegrity.quarantined, DECISION_ID_SHOWN_MAX)
  const notShownAddress = `logbook://thread/${escapeStored(thread.id)}`
  const danglingOrQuarantinedHidden = dangling.hidden + quarantined.hidden

  const criteriaTextClip = perItemClip(
    CRITERIA_SECTION_BUDGET,
    CRITERION_LINE_OVERHEAD,
    thread.completion_criteria.length,
    CRITERION_TEXT_MIN_CLIP,
    CRITERION_TEXT_MAX_CLIP
  )

  const relatedThreads = predecessor === null ? [] : [predecessor]
  const relatedLines = relatedThreads.map(renderRelatedLine)
  const riskLines = risks.shown.map(renderRiskLine)
  const keyDecisionLines = keyDecisions.shown.map(renderKeyDecisionLine)
  const outOfScopeLines = outOfScope.shown.map(renderOutOfScopeLine)
  const criterionLines = thread.completion_criteria.map((criterion) => renderCriterionLine(criterion, criteriaTextClip))

  const notShownBulletLines = [
    ...[risks.hidden].filter((count) => count > 0).map((count) => `- ${count} risks not shown`),
    ...[keyDecisions.hidden].filter((count) => count > 0).map((count) => `- ${count} key decisions not shown`),
    ...[outOfScope.hidden].filter((count) => count > 0).map((count) => `- ${count} out-of-scope items not shown`),
    ...[danglingOrQuarantinedHidden]
      .filter((count) => count > 0)
      .map((count) => `- ${count} dangling or quarantined decision ids not shown`)
  ]

  return [
    `Thread: ${clip(thread.title, SCALAR_FIELD_CLIP)}`,
    `Status: ${escapeStored(thread.status)}`,
    renderBlockage(thread.blocked_by),
    renderPointerStatus(pointer, thread.id),
    `Active goal: ${clip(thread.spine.active_goal, SCALAR_FIELD_CLIP)}`,
    `Next step: ${clip(thread.spine.next_step, SCALAR_FIELD_CLIP)}`,
    `Last session: ${clip(thread.spine.last_session, SCALAR_FIELD_CLIP)}`,
    ...relatedThreads.slice(0, 1).map(() => 'Related:'),
    ...relatedLines,
    ...risks.shown.slice(0, 1).map(() => 'Open risks:'),
    ...riskLines,
    ...keyDecisions.shown.slice(0, 1).map(() => 'Key decisions:'),
    ...keyDecisionLines,
    ...outOfScope.shown.slice(0, 1).map(() => 'Out of scope:'),
    ...outOfScopeLines,
    ...thread.completion_criteria.slice(0, 1).map(() => 'Completion criteria:'),
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
