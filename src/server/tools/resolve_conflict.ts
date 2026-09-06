import { readFileSync, unlinkSync } from 'node:fs'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Refusal } from '../../schema/declare.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import {
  ThreadRecord,
  type Thread,
  type Criterion,
  type Risk,
  type KeyDecision,
  type OutOfScope,
  type Artifact
} from '../../schema/thread.ts'
import { DecisionRecord, type Decision } from '../../schema/decision.ts'
import type { Store } from '../../store/records.ts'
import { layoutFor } from '../../store/layout.ts'
import { git } from '../../store/git.ts'
import { advanceMaterialisedStampIfStillCurrent } from '../../store/read-path.ts'
import { writeRecords, type RecordChange } from '../../store/write-path.ts'
import type { Conflict } from '../../merge/conflict.ts'
import { TRACKING_REF } from '../../merge/sync.ts'
import { THREAD_RULES } from '../../merge/field-merge.ts'
import { LEDGER_REF } from '../../store/ref.ts'
import { withDetail } from '../../store/detail.ts'
import { clipGraphemes, escapeStored } from '../../render/escape.ts'
import { openProjectStore } from '../tool-support.ts'

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const RESOLUTIONS_MAX_ELEMENTS = 200
const FIELD_MAX = 300
const RECORD_PATTERN = /^(thread|decision):[0-9A-HJKMNP-TV-Z]{26}$/
const THREAD_RECORD_PATTERN = /^thread:([0-9A-HJKMNP-TV-Z]{26})$/
const DECISION_RECORD_PATTERN = /^decision:([0-9A-HJKMNP-TV-Z]{26})$/

const ResolutionSchema = z
  .strictObject({
    record: z
      .string()
      .regex(RECORD_PATTERN)
      .describe('which record this disagreement is on, thread:<id> or decision:<id>, exactly as sync_ledger reported it'),
    field: z
      .string()
      .min(1)
      .max(FIELD_MAX)
      .describe('which field disagreed, exactly as sync_ledger reported it, for example title or completion_criteria[<id>]'),
    winner: z.enum(['local', 'remote']).describe("which side wins for this field; the other side's value is discarded")
  })
  .describe('one settled disagreement')

const ResolveConflictInputSchema = z.strictObject({
  resolutions: z
    .array(ResolutionSchema)
    .min(1)
    .max(RESOLUTIONS_MAX_ELEMENTS)
    .describe('one winner per disagreement sync_ledger reported; every disagreement it reported must appear here exactly once')
})

const ResolveConflictOutputSchema = z.object({
  resolved: z
    .array(
      z.object({
        record: z.string().describe('the record this winner was applied to'),
        field: z.string().describe('the field this winner was applied to'),
        winner: z.enum(['local', 'remote']).describe('the side that won for this field')
      })
    )
    .describe('every disagreement this call settled, in the order supplied'),
  ref: z.string().describe('the ledger ref the resolution was committed to'),
  commit: z.string().describe('the new commit recorded on the ledger, a descendant of both the local and remote history at the time of the conflict')
})

type ResolveConflictInput = z.infer<typeof ResolveConflictInputSchema>
type ResolveConflictOutput = z.infer<typeof ResolveConflictOutputSchema>

type StoredConflict = Conflict

const isStoredConflict = (value: unknown): value is StoredConflict => {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return typeof record.record === 'string' && typeof record.field === 'string' && 'ours' in record && 'theirs' in record
}

export const noConflictsRefusal = (): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a project carrying conflicts recorded by a prior sync_ledger call',
  example: 'call sync_ledger first',
  retryable: true,
  message: 'no conflicts are currently recorded for this project; call sync_ledger first and only call resolve_conflict once it reports a conflict.'
})

export const conflictsUnreadableRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'resolutions',
      accepted: 'a readable conflicts state file',
      example: 'retry the call',
      retryable: true,
      message: 'the recorded conflicts could not be read; retry the call.'
    },
    detail
  )

export const corruptConflictsRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'resolutions',
      accepted: 'a well-formed conflicts state file',
      example: 'call sync_ledger again to regenerate it',
      retryable: true,
      message: 'the recorded conflicts are corrupted; call sync_ledger again to regenerate them.'
    },
    detail
  )

export const duplicateResolutionRefusal = (record: string, field: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'each disagreement named at most once',
  example: 'remove the repeated entry',
  retryable: true,
  message: `resolutions names ${record} ${field} more than once.`
})

export const unrecognisedResolutionRefusal = (record: string, field: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'only disagreements the last sync_ledger call reported',
  example: 'call sync_ledger to see what it currently reports',
  retryable: true,
  message: `resolutions names a disagreement that sync_ledger did not report: ${record} ${clipGraphemes(escapeStored(field), FIELD_MAX)}.`
})

export const missingResolutionRefusal = (missing: readonly string[]): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a winner for every disagreement the last sync_ledger call reported',
  example: 'add an entry naming a winner for each missing disagreement',
  retryable: true,
  message: `resolutions is missing a winner for: ${missing.join('; ')}.`
})

export const threadUnavailableRefusal = (threadId: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a thread that still exists and parses cleanly in the local ledger',
  example: 'call sync_ledger again to refresh the conflict list',
  retryable: true,
  message: `thread ${threadId} named in a conflict could not be loaded from the local ledger; call sync_ledger again to refresh the conflict list.`
})

export const staleRecordedValueRefusal = (record: string, field: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a recorded local value that still matches what is live in the local ledger',
  example: 'call sync_ledger again to refresh the conflict list',
  retryable: true,
  message: `${record} ${field} has changed locally since sync_ledger recorded this disagreement, so the recorded local value is stale; call sync_ledger again to refresh the conflict list before retrying resolve_conflict.`
})

export const unclassifiableFieldRefusal = (record: string, field: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a field this tool knows how to apply a winner to',
  example: 'title',
  retryable: false,
  message: `${record} names a field this tool does not know how to apply: ${field}.`
})

export const unclassifiableRecordRefusal = (record: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a record of the form thread:<id> or decision:<id>',
  example: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  retryable: false,
  message: `resolutions names a record this tool does not recognise: ${record}.`
})

export const invalidThreadAfterResolutionRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a thread record that stays within the whole-record byte cap after applying the chosen winners',
  example: 'resolve fewer disagreements on this thread in one call, or shorten the winning value first',
  retryable: true,
  message: `the thread record after applying these winners failed its stored-shape validation: ${issue}`
})

export const invalidDecisionAfterResolutionRefusal = (issue: string): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a decision record that stays within its stored-shape caps',
  example: 'resolve this disagreement in a separate call',
  retryable: true,
  message: `the decision record chosen by this resolution failed its stored-shape validation: ${issue}`
})

export const noRemotePositionRefusal = (): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a project where sync_ledger has already fetched the remote ledger',
  example: 'call sync_ledger again first',
  retryable: true,
  message: 'the remote ledger position from the last sync could not be found; call sync_ledger again first.'
})

export const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'resolutions',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for these resolutions did not complete; retry the call.'
    },
    detail
  )

export const unsafeRemoteDivergenceRefusal = (uncarried: readonly string[]): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a remote whose only divergence from the shared ancestor is the set of disagreements sync_ledger reported',
  example: 'call sync_ledger again once the remote and local histories have re-converged',
  retryable: true,
  message: `the remote ledger carries a change this resolution would not preserve, so nothing was written: ${uncarried.join('; ')}. Call sync_ledger again to pick it up before retrying resolve_conflict.`
})

export const divergenceUnverifiableRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'resolutions',
      accepted: 'a local git history this tool can diff against the remote tracking ref',
      example: 'retry the call',
      retryable: true,
      message: 'whether the remote ledger carries an unresolved change could not be checked, so nothing was written; retry the call.'
    },
    detail
  )

const readConflicts = (conflictsPath: string): { ok: true; value: StoredConflict[] } | { ok: false; refusal: Refusal } => {
  let raw: string
  try {
    raw = readFileSync(conflictsPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ok: false, refusal: noConflictsRefusal() }
    }
    return { ok: false, refusal: conflictsUnreadableRefusal(error instanceof Error ? error.message : String(error)) }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, refusal: corruptConflictsRefusal(error instanceof Error ? error.message : String(error)) }
  }

  if (!Array.isArray(parsed) || !parsed.every(isStoredConflict)) {
    return { ok: false, refusal: corruptConflictsRefusal('conflicts.json did not contain the expected array shape') }
  }
  if (parsed.length === 0) {
    return { ok: false, refusal: noConflictsRefusal() }
  }
  return { ok: true, value: parsed }
}

const clearConflictsFile = (conflictsPath: string): void => {
  try {
    unlinkSync(conflictsPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

const keyOf = (record: string, field: string): string => `${record}\0${field}`

const byIdAscending = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const replaceById = <T extends { id: string }>(items: readonly T[], id: string, value: T): T[] => {
  const found = items.some((item) => item.id === id)
  const next = found ? items.map((item) => (item.id === id ? value : item)) : [...items, value]
  return [...next].sort(byIdAscending)
}

const withRecomputedOrdinals = (criteria: readonly Criterion[]): Criterion[] =>
  criteria.map((criterion, index) => ({ ...criterion, ordinal: index + 1 }))

const loadThreadRaw = (store: Store, id: string): Thread | null => {
  const slot = store.readThread(id)
  if (slot === null || slot.quarantined) return null
  return slot.record
}

const loadDecisionRaw = (store: Store, id: string): Decision | null => {
  const slot = store.readDecision(id)
  if (slot === null || slot.quarantined) return null
  return slot.record
}

const escapeIfString = (value: unknown): unknown => (typeof value === 'string' ? escapeStored(value) : value)

const escapeCriterion = (criterion: Criterion): Criterion => ({ ...criterion, text: escapeStored(criterion.text) })

const escapeRisk = (risk: Risk): Risk => ({
  ...risk,
  scope: escapeStored(risk.scope),
  text: escapeStored(risk.text),
  refs: risk.refs.map((ref) => escapeStored(ref))
})

const escapeKeyDecision = (keyDecision: KeyDecision): KeyDecision => ({
  ...keyDecision,
  title: escapeStored(keyDecision.title),
  scope: escapeStored(keyDecision.scope)
})

const escapeOutOfScope = (outOfScope: OutOfScope): OutOfScope => ({ ...outOfScope, text: escapeStored(outOfScope.text) })

const escapeArtifact = (artifact: Artifact): Artifact => ({
  ...artifact,
  label: escapeStored(artifact.label),
  pointer: escapeStored(artifact.pointer)
})

type ScalarFieldHandling = {
  kind: 'scalar'
  read: (thread: Thread) => unknown
  apply: (thread: Thread, value: unknown) => Thread
  escape: (value: unknown) => unknown
}

type IndexedFieldHandling = {
  kind: 'indexed'
  find: (thread: Thread, id: string) => unknown
  replace: (thread: Thread, id: string, value: unknown) => Thread
  escape: (value: unknown) => unknown
}

type NoConflictFieldHandling = { kind: 'no-conflict' }

export type FieldHandling = ScalarFieldHandling | IndexedFieldHandling | NoConflictFieldHandling

const NO_CONFLICT_FIELD: NoConflictFieldHandling = { kind: 'no-conflict' }

export const FIELD_HANDLING_TABLE: Record<keyof typeof THREAD_RULES, FieldHandling> = {
  id: NO_CONFLICT_FIELD,
  slug: {
    kind: 'scalar',
    read: (thread) => thread.slug,
    apply: (thread, value) => ({ ...thread, slug: value as Thread['slug'] }),
    escape: (value) => value
  },
  title: {
    kind: 'scalar',
    read: (thread) => thread.title,
    apply: (thread, value) => ({ ...thread, title: value as Thread['title'] }),
    escape: escapeIfString
  },
  status: {
    kind: 'scalar',
    read: (thread) => thread.status,
    apply: (thread, value) => ({ ...thread, status: value as Thread['status'] }),
    escape: (value) => value
  },
  blocked_by: {
    kind: 'scalar',
    read: (thread) => thread.blocked_by,
    apply: (thread, value) => ({ ...thread, blocked_by: value as Thread['blocked_by'] }),
    escape: escapeIfString
  },
  predecessor_id: NO_CONFLICT_FIELD,
  completion_criteria: {
    kind: 'indexed',
    find: (thread, id) => thread.completion_criteria.find((item) => item.id === id) ?? null,
    replace: (thread, id, value) => ({
      ...thread,
      completion_criteria: withRecomputedOrdinals(replaceById(thread.completion_criteria, id, value as Criterion))
    }),
    escape: (value) => escapeCriterion(value as Criterion)
  },
  artifacts: {
    kind: 'indexed',
    find: (thread, id) => (thread.artifacts ?? []).find((item) => item.id === id) ?? null,
    replace: (thread, id, value) => ({ ...thread, artifacts: replaceById(thread.artifacts ?? [], id, value as Artifact) }),
    escape: (value) => escapeArtifact(value as Artifact)
  },
  spine: NO_CONFLICT_FIELD,
  created_at: NO_CONFLICT_FIELD,
  updated_at: NO_CONFLICT_FIELD,
  'spine.active_goal': {
    kind: 'scalar',
    read: (thread) => thread.spine.active_goal,
    apply: (thread, value) => ({ ...thread, spine: { ...thread.spine, active_goal: value as string } }),
    escape: escapeIfString
  },
  'spine.next_step': {
    kind: 'scalar',
    read: (thread) => thread.spine.next_step,
    apply: (thread, value) => ({ ...thread, spine: { ...thread.spine, next_step: value as string } }),
    escape: escapeIfString
  },
  'spine.landed': {
    kind: 'scalar',
    read: (thread) => thread.spine.landed,
    apply: (thread, value) => ({ ...thread, spine: { ...thread.spine, landed: value as string } }),
    escape: escapeIfString
  },
  'spine.last_session': {
    kind: 'scalar',
    read: (thread) => thread.spine.last_session,
    apply: (thread, value) => ({ ...thread, spine: { ...thread.spine, last_session: value as string } }),
    escape: escapeIfString
  },
  'spine.open_risks': {
    kind: 'indexed',
    find: (thread, id) => thread.spine.open_risks.find((item) => item.id === id) ?? null,
    replace: (thread, id, value) => ({
      ...thread,
      spine: { ...thread.spine, open_risks: replaceById(thread.spine.open_risks, id, value as Risk) }
    }),
    escape: (value) => escapeRisk(value as Risk)
  },
  'spine.key_decisions': {
    kind: 'indexed',
    find: (thread, id) => thread.spine.key_decisions.find((item) => item.id === id) ?? null,
    replace: (thread, id, value) => ({
      ...thread,
      spine: { ...thread.spine, key_decisions: replaceById(thread.spine.key_decisions, id, value as KeyDecision) }
    }),
    escape: (value) => escapeKeyDecision(value as KeyDecision)
  },
  'spine.out_of_scope': {
    kind: 'indexed',
    find: (thread, id) => thread.spine.out_of_scope.find((item) => item.id === id) ?? null,
    replace: (thread, id, value) => ({
      ...thread,
      spine: { ...thread.spine, out_of_scope: replaceById(thread.spine.out_of_scope, id, value as OutOfScope) }
    }),
    escape: (value) => escapeOutOfScope(value as OutOfScope)
  }
}

const escapeRegexLiteral = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const INDEXED_FIELD_PATHS: readonly string[] = (Object.keys(FIELD_HANDLING_TABLE) as (keyof typeof THREAD_RULES)[]).filter(
  (path) => FIELD_HANDLING_TABLE[path].kind === 'indexed'
)

export const INDEXED_FIELD_PATTERN = new RegExp(
  `^(${INDEXED_FIELD_PATHS.map(escapeRegexLiteral).join('|')})\\[([0-9A-HJKMNP-TV-Z]{26})\\]$`
)

const FIELD_HANDLING_KEYS = new Set<string>(Object.keys(FIELD_HANDLING_TABLE))

const handlingFor = (field: string): FieldHandling | undefined =>
  FIELD_HANDLING_KEYS.has(field) ? FIELD_HANDLING_TABLE[field as keyof typeof THREAD_RULES] : undefined

const parseIndexedField = (field: string): { path: string; id: string } | null => {
  const match = INDEXED_FIELD_PATTERN.exec(field)
  if (match === null) return null
  const path = match[1]
  const id = match[2]
  if (path === undefined || id === undefined) return null
  return { path, id }
}

type FieldLookup = { recognized: true; value: unknown } | { recognized: false }

const currentThreadFieldValue = (thread: Thread, field: string): FieldLookup => {
  const scalar = handlingFor(field)
  if (scalar !== undefined && scalar.kind === 'scalar') {
    return { recognized: true, value: scalar.read(thread) }
  }

  const indexed = parseIndexedField(field)
  if (indexed === null) return { recognized: false }
  const indexedHandling = handlingFor(indexed.path)
  if (indexedHandling === undefined || indexedHandling.kind !== 'indexed') return { recognized: false }
  return { recognized: true, value: indexedHandling.find(thread, indexed.id) }
}

const escapeChosenThreadValue = (field: string, value: unknown): unknown => {
  const scalar = handlingFor(field)
  if (scalar !== undefined && scalar.kind === 'scalar') {
    return scalar.escape(value)
  }

  const indexed = parseIndexedField(field)
  if (indexed === null) return value
  const indexedHandling = handlingFor(indexed.path)
  if (indexedHandling === undefined || indexedHandling.kind !== 'indexed') return value
  return indexedHandling.escape(value)
}

const escapeChosenDecision = (decision: Decision): Decision => ({
  ...decision,
  title: escapeStored(decision.title),
  context: escapeStored(decision.context),
  outcome: escapeStored(decision.outcome),
  options: decision.options.map((option) => escapeStored(option))
})

const applyThreadField = (thread: Thread, field: string, value: unknown): Thread | null => {
  const scalar = handlingFor(field)
  if (scalar !== undefined && scalar.kind === 'scalar') {
    return scalar.apply(thread, value)
  }

  const indexed = parseIndexedField(field)
  if (indexed === null) return null
  const indexedHandling = handlingFor(indexed.path)
  if (indexedHandling === undefined || indexedHandling.kind !== 'indexed') return null
  return indexedHandling.replace(thread, indexed.id, value)
}

type RemotePathIdentity =
  | { kind: 'thread' | 'decision'; record: string }
  | { kind: 'session'; threadId: string }
  | { kind: 'other'; relPath: string }

const REMOTE_THREAD_PATH_PATTERN = /^threads\/([^/]+)\.json$/
const REMOTE_DECISION_PATH_PATTERN = /^decisions\/([^/]+)\.json$/
const REMOTE_SESSION_PATH_PATTERN = /^sessions\/([^/]+)\//

const identifyRemotePath = (relPath: string): RemotePathIdentity => {
  const threadMatch = REMOTE_THREAD_PATH_PATTERN.exec(relPath)
  if (threadMatch !== null && threadMatch[1] !== undefined) {
    return { kind: 'thread', record: `thread:${threadMatch[1]}` }
  }
  const decisionMatch = REMOTE_DECISION_PATH_PATTERN.exec(relPath)
  if (decisionMatch !== null && decisionMatch[1] !== undefined) {
    return { kind: 'decision', record: `decision:${decisionMatch[1]}` }
  }
  const sessionMatch = REMOTE_SESSION_PATH_PATTERN.exec(relPath)
  if (sessionMatch !== null && sessionMatch[1] !== undefined) {
    return { kind: 'session', threadId: sessionMatch[1] }
  }
  return { kind: 'other', relPath }
}

const describeUncarriedPath = (identity: RemotePathIdentity): string => {
  if (identity.kind === 'session') {
    return `a session entry logged on thread ${identity.threadId}`
  }
  if (identity.kind === 'other') {
    return 'a ledger-tracked change outside threads, decisions and sessions'
  }
  return identity.record
}

type DivergenceCheck =
  | { ok: true; uncarried: string[] }
  | { ok: false; refusal: Refusal }

const findUncarriedRemoteDivergence = (
  rt: Runtime,
  projectRoot: string,
  localVal: string | null,
  remoteVal: string,
  coveredRecords: ReadonlySet<string>
): DivergenceCheck => {
  let baseVal = EMPTY_TREE_SHA
  if (localVal !== null) {
    const mergeBase = git(rt, projectRoot, ['merge-base', localVal, remoteVal])
    if (mergeBase.ok) {
      baseVal = mergeBase.stdout.trim()
    } else if (!/not a valid object name|fatal: no merge base/i.test(mergeBase.stderr)) {
      return { ok: false, refusal: divergenceUnverifiableRefusal(mergeBase.stderr.trim()) }
    }
  }

  const diff = git(rt, projectRoot, ['diff', '--name-only', baseVal, remoteVal])
  if (!diff.ok) {
    return { ok: false, refusal: divergenceUnverifiableRefusal(diff.stderr.trim()) }
  }

  const relPaths = diff.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const uncarried: string[] = []
  for (const relPath of relPaths) {
    const identity = identifyRemotePath(relPath)
    if (identity.kind === 'thread' || identity.kind === 'decision') {
      if (coveredRecords.has(identity.record)) continue
    }
    uncarried.push(describeUncarriedPath(identity))
  }

  return { ok: true, uncarried: [...new Set(uncarried)] }
}

export const resolveConflictTool: ToolSpec<ResolveConflictInput, ResolveConflictOutput> = {
  name: 'resolve_conflict',
  title: 'Resolve conflict',
  description:
    'Settles a sync that was refused because two people changed the same field to different values, by naming which side wins for each disagreement. Takes a list of {record, field, winner} where winner is either local or remote, and every disagreement the last sync reported must appear exactly once; a partial list is refused and names what is missing. The losing value is discarded, which is why the server never does this on its own.',
  input: ResolveConflictInputSchema,
  output: ResolveConflictOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }
    const store = opened.value

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const conflictsFilePath = path.join(layout.value.state, 'conflicts.json')
    const read = readConflicts(conflictsFilePath)
    if (!read.ok) return { ok: false, refusal: read.refusal }
    const reported = read.value

    const reportedMap = new Map(reported.map((c) => [keyOf(c.record, c.field), c] as const))

    const seen = new Set<string>()
    for (const resolution of input.resolutions) {
      const key = keyOf(resolution.record, resolution.field)
      if (seen.has(key)) {
        return { ok: false, refusal: duplicateResolutionRefusal(resolution.record, resolution.field) }
      }
      seen.add(key)
      if (!reportedMap.has(key)) {
        return { ok: false, refusal: unrecognisedResolutionRefusal(resolution.record, resolution.field) }
      }
    }

    const missing = reported.filter((c) => !seen.has(keyOf(c.record, c.field)))
    if (missing.length > 0) {
      return { ok: false, refusal: missingResolutionRefusal(missing.map((c) => `${c.record} ${c.field}`)) }
    }

    const threadUpdates = new Map<string, Thread>()
    const decisionUpdates = new Map<string, Decision>()

    for (const resolution of input.resolutions) {
      const conflictRecord = reportedMap.get(keyOf(resolution.record, resolution.field))
      if (conflictRecord === undefined) {
        throw new Error('resolve_conflict: a resolved key vanished from the reported conflict map')
      }
      const chosen = resolution.winner === 'local' ? conflictRecord.ours : conflictRecord.theirs

      const threadMatch = THREAD_RECORD_PATTERN.exec(resolution.record)
      if (threadMatch !== null) {
        const threadId = threadMatch[1]
        if (threadId === undefined) {
          return { ok: false, refusal: unclassifiableRecordRefusal(resolution.record) }
        }
        const current = threadUpdates.get(threadId) ?? loadThreadRaw(store, threadId)
        if (current === null) {
          return { ok: false, refusal: threadUnavailableRefusal(threadId) }
        }
        const lookup = currentThreadFieldValue(current, resolution.field)
        if (lookup.recognized && !isDeepStrictEqual(lookup.value, conflictRecord.ours)) {
          return { ok: false, refusal: staleRecordedValueRefusal(resolution.record, resolution.field) }
        }
        const escapedChosen = escapeChosenThreadValue(resolution.field, chosen)
        const next = applyThreadField(current, resolution.field, escapedChosen)
        if (next === null) {
          return { ok: false, refusal: unclassifiableFieldRefusal(resolution.record, resolution.field) }
        }
        threadUpdates.set(threadId, next)
        continue
      }

      const decisionMatch = DECISION_RECORD_PATTERN.exec(resolution.record)
      if (decisionMatch !== null) {
        const decisionId = decisionMatch[1]
        if (decisionId === undefined) {
          return { ok: false, refusal: unclassifiableRecordRefusal(resolution.record) }
        }
        if (resolution.field === 'decision') {
          const liveDecision = loadDecisionRaw(store, decisionId)
          if (!isDeepStrictEqual(liveDecision, conflictRecord.ours)) {
            return { ok: false, refusal: staleRecordedValueRefusal(resolution.record, resolution.field) }
          }
        }
        decisionUpdates.set(decisionId, escapeChosenDecision(chosen as Decision))
        continue
      }

      return { ok: false, refusal: unclassifiableRecordRefusal(resolution.record) }
    }

    const changes: RecordChange[] = []

    for (const thread of threadUpdates.values()) {
      const withTimestamp: Thread = { ...thread, updated_at: rt.now() }
      const validated = ThreadRecord.parse(withTimestamp)
      if (!validated.ok) {
        return { ok: false, refusal: invalidThreadAfterResolutionRefusal(validated.message) }
      }
      changes.push({ kind: 'thread', record: validated.value })
    }

    for (const decision of decisionUpdates.values()) {
      const validated = DecisionRecord.parse(decision)
      if (!validated.ok) {
        return { ok: false, refusal: invalidDecisionAfterResolutionRefusal(validated.message) }
      }
      changes.push({ kind: 'decision', record: validated.value })
    }

    const remoteRef = git(rt, layout.value.projectRoot, ['rev-parse', TRACKING_REF])
    if (!remoteRef.ok) {
      return { ok: false, refusal: noRemotePositionRefusal() }
    }
    const remoteVal = remoteRef.stdout.trim()

    const localRef = git(rt, layout.value.projectRoot, ['rev-parse', LEDGER_REF])
    const localVal = localRef.ok ? localRef.stdout.trim() : null

    const coveredRecords = new Set(reported.map((c) => c.record))
    const divergence = findUncarriedRemoteDivergence(rt, layout.value.projectRoot, localVal, remoteVal, coveredRecords)
    if (!divergence.ok) {
      return { ok: false, refusal: divergence.refusal }
    }
    if (divergence.uncarried.length > 0) {
      return { ok: false, refusal: unsafeRemoteDivergenceRefusal(divergence.uncarried) }
    }

    const commitResult = writeRecords(rt, layout.value, changes, `resolve ${changes.length} conflicting record(s)`, {
      extraParents: [remoteVal]
    })
    if (!commitResult.ok) {
      return { ok: false, refusal: commitFailureRefusal(commitResult.detail) }
    }

    const advance = advanceMaterialisedStampIfStillCurrent(rt, layout.value, commitResult.before, commitResult.after)
    if (!advance.advanced && advance.reason === 'stamp-mismatch') {
      rt.log({
        level: 'error',
        event: 'store.materialised-stamp-advance-skipped',
        ref: LEDGER_REF,
        before: commitResult.before,
        after: commitResult.after,
        observed: advance.observed
      })
    }
    clearConflictsFile(conflictsFilePath)

    return {
      ok: true,
      text: `resolved ${input.resolutions.length} disagreement(s) across ${changes.length} record(s).`,
      structured: {
        resolved: input.resolutions.map((r) => ({ record: r.record, field: r.field, winner: r.winner })),
        ref: commitResult.ref,
        commit: commitResult.after
      }
    }
  }
}
