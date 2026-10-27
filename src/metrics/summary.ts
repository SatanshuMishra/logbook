import { parseDocument } from '../doc/document.ts'

export type EventLine = Readonly<Record<string, unknown>>

export type RefusalRecord = { tool: string; field: string; count: number }

export type RuleRecord = { rule: string; count: number }

export type RunSummary = {
  status: string | null
  lifetime_seconds: number
  sessions: number
  tool_calls: number
  tool_refusals: number
  tool_crashes: number
  refusals: RefusalRecord[]
  edits_accepted: number
  edits_refused: number
  edits_failed: number
  edit_rules: RuleRecord[]
  commits: number
  criteria_added: number
  criteria_ticked: number
  criteria_struck: number
  criteria_reopened: number
  decisions_added: number
  decisions_removed: number
  risks_added: number
  risks_removed: number
  settled_added: number
  settled_removed: number
  criteria_total: number
  criteria_open: number
  pickups_resume: number
  pickups_compact: number
  pickups_clear: number
  pickups_short: number
  handovers: number
  requests_milestone: number
  requests_turn_changed: number
  requests_blocked_user_wrote: number
  context_chars: number
}

type CommitCount = (typeof COMMIT_COUNTS)[number]

const COMMIT_COUNTS = [
  'criteria_added',
  'criteria_ticked',
  'criteria_struck',
  'criteria_reopened',
  'decisions_added',
  'decisions_removed',
  'risks_added',
  'risks_removed',
  'settled_added',
  'settled_removed'
] as const

const MILLISECONDS_PER_SECOND = 1000

const textOf = (value: unknown): string | null => (typeof value === 'string' ? value : null)

const numberOf = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0)

const ofEvent = (lines: readonly EventLine[], event: string): EventLine[] =>
  lines.filter((line) => line.event === event)

const countWhere = (lines: readonly EventLine[], key: string, value: string): number =>
  lines.filter((line) => line[key] === value).length

const sumOf = (lines: readonly EventLine[], key: string): number =>
  lines.reduce((total, line) => total + numberOf(line[key]), 0)

const tally = (keys: readonly string[]): Map<string, number> =>
  keys.reduce((counts, key) => new Map(counts).set(key, (counts.get(key) ?? 0) + 1), new Map<string, number>())

const byText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const refusalRecords = (toolCalls: readonly EventLine[]): RefusalRecord[] => {
  const pairs = toolCalls
    .filter((line) => line.outcome === 'refused')
    .map((line) => JSON.stringify([textOf(line.tool) ?? '', textOf(line.refusal_field) ?? '']))
  return [...tally(pairs)]
    .map(([pair, count]) => {
      const [tool, field] = JSON.parse(pair) as [string, string]
      return { tool, field, count }
    })
    .sort((left, right) => byText(left.tool, right.tool) || byText(left.field, right.field))
}

const ruleRecords = (edits: readonly EventLine[]): RuleRecord[] => {
  const rules = edits
    .filter((line) => line.outcome === 'refused')
    .flatMap((line) => (Array.isArray(line.rules) ? line.rules : []))
    .filter((rule): rule is string => typeof rule === 'string')
  return [...tally(rules)]
    .map(([rule, count]) => ({ rule, count }))
    .sort((left, right) => byText(left.rule, right.rule))
}

export const secondsBetween = (startedAt: string, endedAt: string): number =>
  (Date.parse(endedAt) - Date.parse(startedAt)) / MILLISECONDS_PER_SECOND

const lifetimeSeconds = (lines: readonly EventLine[], summaryTs: string): number => {
  const first = textOf(lines[0]?.ts)
  const seconds = first === null ? Number.NaN : secondsBetween(first, summaryTs)
  return Number.isFinite(seconds) ? seconds : 0
}

const sessionCount = (lines: readonly EventLine[]): number =>
  new Set(lines.map((line) => line.session).filter((session) => session !== null && session !== undefined)).size

const commitSums = (commits: readonly EventLine[]): Record<CommitCount, number> =>
  Object.fromEntries(COMMIT_COUNTS.map((key) => [key, sumOf(commits, key)])) as Record<CommitCount, number>

export const buildSummary = (lines: readonly EventLine[], documentText: string, summaryTs: string): RunSummary => {
  const document = parseDocument(documentText)
  const criteria = document.items.filter((item) => item.letter === 'c')
  const toolCalls = ofEvent(lines, 'tool.call')
  const edits = ofEvent(lines, 'doc.edit')
  const commits = ofEvent(lines, 'doc.commit')
  const pickups = ofEvent(lines, 'thread.pickup')
  const requests = ofEvent(lines, 'doc.request')
  return {
    status: document.status?.kind ?? null,
    lifetime_seconds: lifetimeSeconds(lines, summaryTs),
    sessions: sessionCount(lines),
    tool_calls: toolCalls.length,
    tool_refusals: countWhere(toolCalls, 'outcome', 'refused'),
    tool_crashes: countWhere(toolCalls, 'outcome', 'crashed'),
    refusals: refusalRecords(toolCalls),
    edits_accepted: countWhere(edits, 'outcome', 'accepted'),
    edits_refused: countWhere(edits, 'outcome', 'refused'),
    edits_failed: countWhere(edits, 'outcome', 'failed'),
    edit_rules: ruleRecords(edits),
    commits: commits.length,
    ...commitSums(commits),
    criteria_total: criteria.length,
    criteria_open: criteria.filter((item) => item.box === ' ').length,
    pickups_resume: countWhere(pickups, 'source', 'resume'),
    pickups_compact: countWhere(pickups, 'source', 'compact'),
    pickups_clear: countWhere(pickups, 'source', 'clear'),
    pickups_short: countWhere(pickups, 'delivered', 'short'),
    handovers: ofEvent(lines, 'thread.handover').length,
    requests_milestone: countWhere(requests, 'reason', 'milestone'),
    requests_turn_changed: countWhere(requests, 'reason', 'turn-changed'),
    requests_blocked_user_wrote: countWhere(requests, 'reason', 'blocked-user-wrote'),
    context_chars: sumOf(pickups, 'context_chars')
  }
}
