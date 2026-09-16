import { z } from 'zod'
import type { ToolSpec } from '../register.ts'
import type { Declared, Refusal } from '../../schema/declare.ts'
import type { Runtime } from '../../runtime/runtime.ts'
import { ThreadRecord } from '../../schema/thread.ts'
import { DecisionRecord } from '../../schema/decision.ts'
import { SessionRecord } from '../../schema/session.ts'
import { BindingRecord } from '../../schema/binding.ts'
import { escapeStoredRecord } from '../../schema/escape-record.ts'
import { ULID_PATTERN } from '../../schema/ids.ts'
import { layoutFor, type StoreLayout } from '../../store/layout.ts'
import { git } from '../../store/git.ts'
import { syncWorkingCopy } from '../../store/read-path.ts'
import { writeRecords, type RecordChange } from '../../store/write-path.ts'
import { LEDGER_REF } from '../../store/ref.ts'
import { describeError, withDetail } from '../../store/detail.ts'
import type { ConflictPath, ConflictState } from '../../merge/conflict.ts'
import { clearConflictState, readConflictState } from '../../merge/conflict-state.ts'
import { mergeTree, recordsNotTakenWhole } from '../../merge/merge-tree.ts'
import { escapeStored } from '../../render/escape.ts'
import { openProjectStore } from '../tool-support.ts'

const RESOLUTIONS_MAX_ELEMENTS = 200
const RESOLUTION_PATH_MAX = 4096
const RESOLUTION_PATH_PATTERN = /^[^/\0\r\n][^\0\r\n]*$/

const ULID_FRAGMENT = ULID_PATTERN.source.replace(/^\^/, '').replace(/\$$/, '')
const THREAD_PATH = new RegExp(`^threads/(${ULID_FRAGMENT})\\.json$`)
const DECISION_PATH = new RegExp(`^decisions/(${ULID_FRAGMENT})\\.json$`)
const BINDING_PATH = new RegExp(`^bindings/(${ULID_FRAGMENT})\\.json$`)
const SESSION_PATH = new RegExp(`^sessions/(${ULID_FRAGMENT})/(${ULID_FRAGMENT})\\.json$`)

const ResolutionSchema = z
  .strictObject({
    path: z
      .string()
      .min(1)
      .max(RESOLUTION_PATH_MAX)
      .regex(RESOLUTION_PATH_PATTERN)
      .describe('a conflicted file exactly as sync_ledger reported it, for example threads/<id>.json'),
    record: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('the whole record as it should now read, for a file under threads/, decisions/, sessions/ or bindings/'),
    content: z.string().optional().describe('the whole file as it should now read, for any other conflicted file')
  })
  .describe('one conflicted file as it should now read')

const ResolveConflictInputSchema = z.strictObject({
  resolutions: z
    .array(ResolutionSchema)
    .min(1)
    .max(RESOLUTIONS_MAX_ELEMENTS)
    .describe('one entry per file sync_ledger reported as conflicted; every file it reported must appear here exactly once')
})

const ResolveConflictOutputSchema = z.object({
  resolved: z.array(z.string()).describe('every conflicted file this call stored, in the order supplied'),
  ref: z.string().describe('the ledger ref the resolution was committed to'),
  commit: z
    .string()
    .describe("the new commit recorded on the ledger, whose parents are this machine's ledger and the shared ledger the conflict was found against")
})

type ResolveConflictInput = z.infer<typeof ResolveConflictInputSchema>
type ResolveConflictOutput = z.infer<typeof ResolveConflictOutputSchema>
type Resolution = ResolveConflictInput['resolutions'][number]

const listPaths = (paths: readonly string[]): string => paths.map((entry) => `<${escapeStored(entry, 'angle-wrapped')}>`).join(', ')

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
      accepted: 'conflicts recorded by a prior sync_ledger call that can still be read',
      example: 'call sync_ledger again',
      retryable: true,
      message: 'the recorded conflicts could not be read; call sync_ledger again to record them afresh.'
    },
    detail
  )

export const duplicateResolutionRefusal = (first: number, repeat: number): Refusal => ({
  ok: false,
  field: `resolutions.${repeat}.path`,
  accepted: 'each conflicted file named at most once',
  example: 'remove the repeated entry',
  retryable: true,
  message: `resolutions.${repeat}.path names the same file as resolutions.${first}.path; name each conflicted file once.`
})

export const unrecognisedResolutionRefusal = (index: number, reported: readonly string[]): Refusal => ({
  ok: false,
  field: `resolutions.${index}.path`,
  accepted: 'only files the last sync_ledger call reported as conflicted',
  example: 'call sync_ledger to see what it currently reports',
  retryable: true,
  message: `resolutions.${index}.path names a file the last sync_ledger call did not report as conflicted; it reported: ${listPaths(reported)}.`
})

export const missingResolutionRefusal = (missing: readonly string[]): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'an entry for every file the last sync_ledger call reported as conflicted',
  example: 'add an entry for each missing file',
  retryable: true,
  message: `resolutions is missing an entry for: ${listPaths(missing)}.`
})

export const payloadMismatchRefusal = (index: number, expected: 'record' | 'content'): Refusal => ({
  ok: false,
  field: `resolutions.${index}.${expected}`,
  accepted:
    expected === 'record'
      ? 'a whole record, and no content, for a file under threads/, decisions/, sessions/ or bindings/ named by its id'
      : 'the whole file as text, and no record, for any other conflicted file',
  example: expected === 'record' ? '{"path": "threads/<id>.json", "record": {"id": "<id>"}}' : '{"path": "<file>", "content": "<text>"}',
  retryable: true,
  message:
    expected === 'record'
      ? `resolutions.${index} names a record file, so send the whole record as record and leave content out.`
      : `resolutions.${index} names a file that is not a record, so send the whole file as content and leave record out.`
})

export const invalidRecordRefusal = (index: number, refusal: Refusal): Refusal => ({
  ...refusal,
  field: `resolutions.${index}.record.${refusal.field}`,
  message: `resolutions.${index}.record.${refusal.message}`
})

export const recordAddressMismatchRefusal = (index: number, field: string, fromPath: string): Refusal => ({
  ok: false,
  field: `resolutions.${index}.record.${field}`,
  accepted: `the ${field} named by the record's path`,
  example: fromPath,
  retryable: true,
  message: `resolutions.${index}.record.${field} must be ${fromPath}, the ${field} in its path; a record is stored at the address its ids give it.`
})

export const staleConflictRefusal = (): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'conflicted files unchanged on this machine since sync_ledger reported them',
  example: 'call sync_ledger again',
  retryable: true,
  message:
    'a conflicted file changed on this machine since sync_ledger reported it, or the conflict no longer stands, so nothing was written; call sync_ledger again and review what it reports.'
})

export const noRemotePositionRefusal = (): Refusal => ({
  ok: false,
  field: 'resolutions',
  accepted: 'a project still holding the shared ledger commit the last sync_ledger call found the conflict against',
  example: 'call sync_ledger again first',
  retryable: true,
  message: 'the shared ledger commit the conflict was found against is no longer on this machine; call sync_ledger again first.'
})

export const commitFailureRefusal = (detail: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: 'resolutions',
      accepted: 'a ledger that is not concurrently moving and remains writable',
      example: 'retry the call',
      retryable: true,
      message: 'the ledger commit for these resolutions did not complete; nothing was written, retry the call.'
    },
    detail
  )

type RecordAddress =
  | { kind: 'thread'; id: string }
  | { kind: 'decision'; id: string }
  | { kind: 'binding'; id: string }
  | { kind: 'session'; threadId: string; id: string }

const recordAddressOf = (filePath: string): RecordAddress | null => {
  const thread = THREAD_PATH.exec(filePath)
  if (thread !== null) return { kind: 'thread', id: thread[1] as string }
  const decision = DECISION_PATH.exec(filePath)
  if (decision !== null) return { kind: 'decision', id: decision[1] as string }
  const binding = BINDING_PATH.exec(filePath)
  if (binding !== null) return { kind: 'binding', id: binding[1] as string }
  const session = SESSION_PATH.exec(filePath)
  if (session !== null) return { kind: 'session', threadId: session[1] as string, id: session[2] as string }
  return null
}

type Attempt<T> = { ok: true; value: T } | { ok: false; refusal: Refusal }

const storedShape = <T>(index: number, declared: Declared<T>, record: unknown): Attempt<T> => {
  const given = declared.parse(record)
  if (!given.ok) return { ok: false, refusal: invalidRecordRefusal(index, given) }
  const stored = declared.parse(escapeStoredRecord(declared, given.value))
  return stored.ok ? { ok: true, value: stored.value } : { ok: false, refusal: invalidRecordRefusal(index, stored) }
}

const addressed = <T extends { id: string }>(
  index: number,
  shaped: Attempt<T>,
  expected: Readonly<Record<string, string>>,
  toChange: (record: T) => RecordChange
): Attempt<RecordChange> => {
  if (!shaped.ok) return shaped
  const record = shaped.value as T & Record<string, unknown>
  const mismatched = Object.entries(expected).find(([field, value]) => record[field] !== value)
  if (mismatched !== undefined) {
    return { ok: false, refusal: recordAddressMismatchRefusal(index, mismatched[0], mismatched[1]) }
  }
  return { ok: true, value: toChange(shaped.value) }
}

const changeFor = (index: number, resolution: Resolution): Attempt<RecordChange> => {
  const address = recordAddressOf(resolution.path)
  if (address === null) {
    if (resolution.content === undefined || resolution.record !== undefined) {
      return { ok: false, refusal: payloadMismatchRefusal(index, 'content') }
    }
    return { ok: true, value: { kind: 'raw', relPath: resolution.path, content: resolution.content } }
  }
  if (resolution.record === undefined || resolution.content !== undefined) {
    return { ok: false, refusal: payloadMismatchRefusal(index, 'record') }
  }
  switch (address.kind) {
    case 'thread':
      return addressed(index, storedShape(index, ThreadRecord, resolution.record), { id: address.id }, (record) => ({ kind: 'thread', record }))
    case 'decision':
      return addressed(index, storedShape(index, DecisionRecord, resolution.record), { id: address.id }, (record) => ({ kind: 'decision', record }))
    case 'binding':
      return addressed(index, storedShape(index, BindingRecord, resolution.record), { id: address.id }, (record) => ({ kind: 'binding', record }))
    case 'session':
      return addressed(
        index,
        storedShape(index, SessionRecord, resolution.record),
        { thread_id: address.threadId, id: address.id },
        (record) => ({ kind: 'session', record })
      )
    default: {
      const exhaustive: never = address
      throw new Error(`resolve_conflict: a record address of an unrecognised kind reached changeFor: ${JSON.stringify(exhaustive)}`)
    }
  }
}

const unmatchedResolution = (resolutions: readonly Resolution[], reported: readonly string[]): Refusal | null => {
  const reportedPaths = new Set(reported)
  const firstIndexByPath = new Map<string, number>()
  for (const [index, resolution] of resolutions.entries()) {
    const first = firstIndexByPath.get(resolution.path)
    if (first !== undefined) return duplicateResolutionRefusal(first, index)
    if (!reportedPaths.has(resolution.path)) return unrecognisedResolutionRefusal(index, reported)
    firstIndexByPath.set(resolution.path, index)
  }
  const missing = reported.filter((entry) => !firstIndexByPath.has(entry))
  return missing.length > 0 ? missingResolutionRefusal(missing) : null
}

const readRef = (rt: Runtime, repo: string, ref: string): string | null => {
  const read = git(rt, repo, ['rev-parse', '--verify', '--quiet', ref])
  return read.ok ? read.stdout.trim() : null
}

const byPath = (a: ConflictPath, b: ConflictPath): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

const stillTheSameConflict = (saved: readonly ConflictPath[], current: readonly ConflictPath[]): boolean => {
  const localBlobBySavedPath = new Map(saved.map((entry) => [entry.path, entry.local_blob] as const))
  return (
    saved.length === current.length &&
    current.every((entry) => localBlobBySavedPath.has(entry.path) && localBlobBySavedPath.get(entry.path) === entry.local_blob)
  )
}

const resolutionCommitAfterFailure = (rt: Runtime, layout: StoreLayout, local: string, remote: string): string | null => {
  const current = readRef(rt, layout.projectRoot, LEDGER_REF)
  if (current === null || current === local) return null
  const parents = [readRef(rt, layout.projectRoot, `${current}^1`), readRef(rt, layout.projectRoot, `${current}^2`)]
  return parents[0] === local && parents[1] === remote ? current : null
}

type MergedOnto = { tree: string; local: string }

const remergeUnchanged = (rt: Runtime, layout: StoreLayout, state: ConflictState): Attempt<MergedOnto> => {
  const repo = layout.projectRoot
  if (readRef(rt, repo, `${state.remote_commit}^{commit}`) === null) {
    return { ok: false, refusal: noRemotePositionRefusal() }
  }
  const local = readRef(rt, repo, LEDGER_REF)
  if (local === null) return { ok: false, refusal: staleConflictRefusal() }

  const merged = mergeTree(rt, repo, local, state.remote_commit)
  if (!merged.ok) return { ok: false, refusal: commitFailureRefusal(`git could not merge ${local} with ${state.remote_commit}: ${merged.detail}`) }
  const notWhole = recordsNotTakenWhole(rt, repo, local, state.remote_commit, merged.tree, new Set(merged.conflicted.map((entry) => entry.path)))
  if (!notWhole.ok) return { ok: false, refusal: commitFailureRefusal(notWhole.detail) }

  const current = [...merged.conflicted, ...notWhole.paths].sort(byPath)
  if (!stillTheSameConflict(state.paths, current)) return { ok: false, refusal: staleConflictRefusal() }
  return { ok: true, value: { tree: merged.tree, local } }
}

export const resolveConflictTool: ToolSpec<ResolveConflictInput, ResolveConflictOutput> = {
  name: 'resolve_conflict',
  title: 'Resolve conflict',
  description:
    "Settles a sync that was refused because this machine and the shared ledger changed the same files, by storing each file as it should now read once both versions have been reviewed. Takes resolutions, a list of {path, record} carrying the whole record for a file under threads, decisions, sessions or bindings, or {path, content} carrying the whole text of any other file; every file the last sync reported must appear exactly once, and a partial list is refused naming what is missing. A record is refused only when it does not fit its stored shape, and nothing about its content is judged. Everything that merged cleanly is kept. It commits on this machine and does not push, so run sync_ledger afterwards.",
  input: ResolveConflictInputSchema,
  output: ResolveConflictOutputSchema,
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  handler: async (rt, _ctx, input) => {
    const opened = openProjectStore(rt)
    if (!opened.ok) return { ok: false, refusal: opened.refusal }

    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) return { ok: false, refusal: layout }

    const saved = readConflictState(layout.value)
    if (saved.kind === 'absent') return { ok: false, refusal: noConflictsRefusal() }
    if (saved.kind === 'unreadable') return { ok: false, refusal: conflictsUnreadableRefusal(saved.detail) }
    const state = saved.state

    const unmatched = unmatchedResolution(
      input.resolutions,
      state.paths.map((entry) => entry.path)
    )
    if (unmatched !== null) return { ok: false, refusal: unmatched }

    const changes: RecordChange[] = []
    for (const [index, resolution] of input.resolutions.entries()) {
      const change = changeFor(index, resolution)
      if (!change.ok) return { ok: false, refusal: change.refusal }
      changes.push(change.value)
    }

    const onto = remergeUnchanged(rt, layout.value, state)
    if (!onto.ok) return { ok: false, refusal: onto.refusal }

    const committed = writeRecords(rt, layout.value, changes, `resolve ${changes.length} conflicted file(s)`, {
      startFrom: { tree: onto.value.tree, parent: onto.value.local },
      extraParents: [state.remote_commit]
    })
    const landed = committed.ok
      ? committed.after
      : resolutionCommitAfterFailure(rt, layout.value, onto.value.local, state.remote_commit)
    if (landed === null) {
      if (committed.ok) throw new Error('resolve_conflict: a successful commit carried no commit id')
      return { ok: false, refusal: commitFailureRefusal(committed.detail) }
    }

    const materialised = syncWorkingCopy(rt, layout.value)
    if (!materialised.ok) {
      rt.log({
        level: 'error',
        event: 'resolve.materialise-after-commit-failed',
        ref: LEDGER_REF,
        after: landed,
        cause: materialised.cause
      })
    }
    try {
      clearConflictState(layout.value)
    } catch (error) {
      rt.log({
        level: 'error',
        event: 'resolve.conflict-state-not-cleared',
        ref: LEDGER_REF,
        after: landed,
        detail: describeError(error)
      })
    }

    const resolved = input.resolutions.map((resolution) => resolution.path)
    return {
      ok: true,
      text: `stored ${resolved.length} conflicted file(s) as reviewed in ledger commit ${landed}; run sync_ledger to share the resolution.`,
      structured: { resolved, ref: LEDGER_REF, commit: landed }
    }
  }
}
