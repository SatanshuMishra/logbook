import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { DecisionRecord, type Decision } from '../schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../schema/session.ts'
import { ThreadRecord, type Thread } from '../schema/thread.ts'
import { git } from '../store/git.ts'
import type { StoreLayout } from '../store/layout.ts'
import { materialiseTreeInto } from '../store/materialise-tree.ts'
import { countedMaterialiseGit, countedMaterialiseGitBuffer, readAllRecordFiles, syncWorkingCopy } from '../store/read-path.ts'
import { LEDGER_REF, casUpdateRef } from '../store/ref.ts'
import type { Store } from '../store/records.ts'
import { writeRecords, type RecordChange } from '../store/write-path.ts'
import { mergeDecision, mergeSession, mergeThread } from './field-merge.ts'
import type { Conflict } from './conflict.ts'

export type SyncAction = 'noop' | 'pushed' | 'pushed-unverified' | 'fast-forwarded' | 'merged'

export type SyncOutcome =
  | { ok: true; action: SyncAction; ref: string; local_sha: string | null; remote_sha: string | null }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'offline' | 'rejected'; detail: string }

export type SyncOps = { beforeCas?: () => void }

const REMOTE_NAME = 'origin'
export const TRACKING_REF = 'refs/logbook/sync/origin-ledger'
const MAX_SYNC_ATTEMPTS = 5
const LEASE_REJECTION_PATTERN = /stale info|non-fast-forward/

type RecordSet = { threads: Map<string, Thread>; decisions: Map<string, Decision>; sessionsByThread: Map<string, SessionEntry[]> }

type PassthroughFile = { relPath: string; content: string }

type ScratchRecordSet = RecordSet & { passthrough: PassthroughFile[] }

type AttemptOutcome =
  | { kind: 'return'; outcome: SyncOutcome }
  | { kind: 'retry' }

const readRef = (rt: Runtime, repo: string, ref: string): string | null => {
  const result = git(rt, repo, ['rev-parse', ref])
  return result.ok ? result.stdout.trim() : null
}

const readRemoteLedgerSha = (rt: Runtime, repo: string): string | null => {
  const result = git(rt, repo, ['ls-remote', REMOTE_NAME, LEDGER_REF])
  if (!result.ok) return null
  const line = result.stdout.split('\n').find((entry) => entry.trim().length > 0)
  if (line === undefined) return null
  const sha = line.split('\t')[0]
  if (sha === undefined) return null
  const trimmed = sha.trim()
  return trimmed.length === 0 ? null : trimmed
}

type PushReceipt = { local_sha: string | null; remote_sha: string | null; verified: boolean }

const readBackAfterPush = (rt: Runtime, layout: StoreLayout): PushReceipt => {
  const remoteSha = readRemoteLedgerSha(rt, layout.projectRoot)
  if (remoteSha === null) return { local_sha: null, remote_sha: null, verified: false }
  const localSha = readRef(rt, layout.projectRoot, LEDGER_REF)
  if (localSha === null) return { local_sha: null, remote_sha: null, verified: false }
  return { local_sha: localSha, remote_sha: remoteSha, verified: localSha === remoteSha }
}

const isAncestor = (rt: Runtime, repo: string, ancestor: string, descendant: string): boolean =>
  git(rt, repo, ['merge-base', '--is-ancestor', ancestor, descendant]).ok

const isLeaseRejection = (stderr: string): boolean => LEASE_REJECTION_PATTERN.test(stderr)

const safeDirNames = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
}

const readOursRecordSet = (store: Store, layout: StoreLayout): RecordSet => {
  const threads = new Map<string, Thread>()
  for (const slot of store.readThreads()) {
    if (!slot.quarantined) threads.set(slot.record.id, slot.record)
  }
  const decisions = new Map<string, Decision>()
  for (const slot of readAllRecordFiles<Decision>(path.join(layout.records, 'decisions'), DecisionRecord)) {
    if (!slot.quarantined) decisions.set(slot.record.id, slot.record)
  }
  const sessionsByThread = new Map<string, SessionEntry[]>()
  for (const threadId of safeDirNames(path.join(layout.records, 'sessions'))) {
    const entries: SessionEntry[] = []
    for (const slot of store.readSessionEntries(threadId)) {
      if (!slot.quarantined) entries.push(slot.record)
    }
    sessionsByThread.set(threadId, entries)
  }
  return { threads, decisions, sessionsByThread }
}

const readScratchRecordSet = (root: string): ScratchRecordSet => {
  const passthrough: PassthroughFile[] = []
  const captureQuarantined = (absolutePath: string): void => {
    passthrough.push({ relPath: path.relative(root, absolutePath), content: readFileSync(absolutePath, 'utf8') })
  }

  const threads = new Map<string, Thread>()
  for (const slot of readAllRecordFiles<Thread>(path.join(root, 'threads'), ThreadRecord)) {
    if (slot.quarantined) {
      captureQuarantined(slot.path)
    } else {
      threads.set(slot.record.id, slot.record)
    }
  }
  const decisions = new Map<string, Decision>()
  for (const slot of readAllRecordFiles<Decision>(path.join(root, 'decisions'), DecisionRecord)) {
    if (slot.quarantined) {
      captureQuarantined(slot.path)
    } else {
      decisions.set(slot.record.id, slot.record)
    }
  }
  const sessionsByThread = new Map<string, SessionEntry[]>()
  for (const threadId of safeDirNames(path.join(root, 'sessions'))) {
    const entries: SessionEntry[] = []
    for (const slot of readAllRecordFiles<SessionEntry>(path.join(root, 'sessions', threadId), SessionRecord)) {
      if (slot.quarantined) {
        captureQuarantined(slot.path)
      } else {
        entries.push(slot.record)
      }
    }
    sessionsByThread.set(threadId, entries)
  }
  return { threads, decisions, sessionsByThread, passthrough }
}

type MaterialiseResult = { ok: true; scratch: string } | { ok: false; detail: string }

const materialiseRefToScratch = (rt: Runtime, layout: StoreLayout, ref: string): MaterialiseResult => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'logbook-sync-scratch-'))
  const materialised = materialiseTreeInto(rt, layout.projectRoot, ref, scratch, {
    runGit: countedMaterialiseGit,
    runGitBuffer: countedMaterialiseGitBuffer
  })
  if (!materialised.ok) {
    rmSync(scratch, { recursive: true, force: true })
    return { ok: false, detail: materialised.detail }
  }
  return { ok: true, scratch }
}

const computeMerge = (
  ours: RecordSet,
  theirs: RecordSet,
  base: RecordSet | null
): { changes: RecordChange[]; conflicts: Conflict[] } => {
  const conflicts: Conflict[] = []
  const changes: RecordChange[] = []

  const threadIds = new Set([...ours.threads.keys(), ...theirs.threads.keys()])
  for (const id of threadIds) {
    const oursThread = ours.threads.get(id)
    const theirsThread = theirs.threads.get(id)
    if (oursThread !== undefined && theirsThread !== undefined) {
      const baseThread = base?.threads.get(id) ?? null
      const result = mergeThread(baseThread, oursThread, theirsThread)
      if (result.ok) {
        changes.push({ kind: 'thread', record: result.merged })
      } else {
        conflicts.push(...result.conflicts)
      }
    } else {
      changes.push({ kind: 'thread', record: (oursThread ?? theirsThread) as Thread })
    }
  }

  const decisionIds = new Set([...ours.decisions.keys(), ...theirs.decisions.keys()])
  for (const id of decisionIds) {
    const oursDecision = ours.decisions.get(id)
    const theirsDecision = theirs.decisions.get(id)
    if (oursDecision !== undefined && theirsDecision !== undefined) {
      const result = mergeDecision(oursDecision, theirsDecision)
      if (result.ok) {
        changes.push({ kind: 'decision', record: result.merged })
      } else {
        conflicts.push(...result.conflicts)
      }
    } else {
      changes.push({ kind: 'decision', record: (oursDecision ?? theirsDecision) as Decision })
    }
  }

  const sessionThreadIds = new Set([...ours.sessionsByThread.keys(), ...theirs.sessionsByThread.keys()])
  for (const threadId of sessionThreadIds) {
    const oursEntries = ours.sessionsByThread.get(threadId) ?? []
    const theirsEntries = theirs.sessionsByThread.get(threadId) ?? []
    const result = mergeSession(oursEntries, theirsEntries)
    if (result.ok) {
      for (const entry of result.merged) {
        changes.push({ kind: 'session', record: entry })
      }
    } else {
      conflicts.push(...result.conflicts)
    }
  }

  return { changes, conflicts }
}

const conflictsPath = (layout: StoreLayout): string => path.join(layout.state, 'conflicts.json')

type ConflictWriteResult = { ok: true } | { ok: false; detail: string }

const writeConflicts = (layout: StoreLayout, conflicts: Conflict[]): ConflictWriteResult => {
  try {
    mkdirSync(layout.state, { recursive: true })
    writeFileSync(conflictsPath(layout), JSON.stringify(conflicts), 'utf8')
    return { ok: true }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

const clearConflicts = (layout: StoreLayout): void => {
  try {
    unlinkSync(conflictsPath(layout))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

const fastForward = (rt: Runtime, layout: StoreLayout, localVal: string | null, remoteVal: string): AttemptOutcome => {
  const cas = casUpdateRef(rt, layout.projectRoot, LEDGER_REF, remoteVal, localVal)
  if (cas.ok) {
    syncWorkingCopy(rt, layout)
    return {
      kind: 'return',
      outcome: { ok: true, action: 'fast-forwarded', ref: LEDGER_REF, local_sha: remoteVal, remote_sha: remoteVal }
    }
  }
  if (cas.cause === 'ref-moved') return { kind: 'retry' }
  return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: cas.message } }
}

const pushPlain = (rt: Runtime, layout: StoreLayout): AttemptOutcome => {
  const result = git(rt, layout.projectRoot, ['push', REMOTE_NAME, `${LEDGER_REF}:${LEDGER_REF}`])
  if (result.ok) {
    const receipt = readBackAfterPush(rt, layout)
    return {
      kind: 'return',
      outcome: {
        ok: true,
        action: receipt.verified ? 'pushed' : 'pushed-unverified',
        ref: LEDGER_REF,
        local_sha: receipt.local_sha,
        remote_sha: receipt.remote_sha
      }
    }
  }
  if (isLeaseRejection(result.stderr)) return { kind: 'retry' }
  return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: result.stderr.trim() } }
}

const performMerge = (
  rt: Runtime,
  store: Store,
  layout: StoreLayout,
  localVal: string,
  remoteVal: string,
  ops: Partial<SyncOps>
): AttemptOutcome => {
  const theirsResult = materialiseRefToScratch(rt, layout, remoteVal)
  if (!theirsResult.ok) {
    return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: theirsResult.detail } }
  }
  const theirsScratch = theirsResult.scratch
  try {
    const mergeBaseResult = git(rt, layout.projectRoot, ['merge-base', localVal, remoteVal])
    const baseVal = mergeBaseResult.ok ? mergeBaseResult.stdout.trim() : null
    let baseScratch: string | null = null
    if (baseVal !== null) {
      const baseResult = materialiseRefToScratch(rt, layout, baseVal)
      if (!baseResult.ok) {
        return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: baseResult.detail } }
      }
      baseScratch = baseResult.scratch
    }
    try {
      const ours = readOursRecordSet(store, layout)
      const theirs = readScratchRecordSet(theirsScratch)
      const base = baseScratch !== null ? readScratchRecordSet(baseScratch) : null

      if (theirs.passthrough.length > 0) {
        const named = theirs.passthrough.map((file) => file.relPath).join(', ')
        return {
          kind: 'return',
          outcome: {
            ok: false,
            reason: 'rejected',
            detail: `the shared ledger carries ${theirs.passthrough.length} record file(s) this version cannot parse: ${named}; nothing was merged and nothing was pushed, so both copies are unchanged`
          }
        }
      }

      const { changes: mergedChanges, conflicts } = computeMerge(ours, theirs, base)
      if (conflicts.length > 0) {
        const written = writeConflicts(layout, conflicts)
        if (!written.ok) {
          return {
            kind: 'return',
            outcome: { ok: false, reason: 'rejected', detail: `could not persist conflicts: ${written.detail}` }
          }
        }
        return { kind: 'return', outcome: { ok: false, reason: 'conflict', conflicts } }
      }

      const message = `merge ${localVal.slice(0, 12)} with ${remoteVal.slice(0, 12)}`
      const writeOps = {
        extraParents: [remoteVal],
        ...(ops.beforeCas !== undefined ? { beforeCas: ops.beforeCas } : {})
      }
      const commitResult = writeRecords(rt, layout, mergedChanges, message, writeOps)
      if (!commitResult.ok) {
        if (commitResult.reason === 'ref-moved') return { kind: 'retry' }
        return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: commitResult.detail } }
      }

      syncWorkingCopy(rt, layout)

      const pushResult = git(rt, layout.projectRoot, [
        'push',
        `--force-with-lease=${LEDGER_REF}:${remoteVal}`,
        REMOTE_NAME,
        `${LEDGER_REF}:${LEDGER_REF}`
      ])
      if (!pushResult.ok) {
        if (isLeaseRejection(pushResult.stderr)) return { kind: 'retry' }
        return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: pushResult.stderr.trim() } }
      }

      const mergeReceipt = readBackAfterPush(rt, layout)
      return {
        kind: 'return',
        outcome: {
          ok: true,
          action: mergeReceipt.verified ? 'merged' : 'pushed-unverified',
          ref: LEDGER_REF,
          local_sha: mergeReceipt.local_sha,
          remote_sha: mergeReceipt.remote_sha
        }
      }
    } finally {
      if (baseScratch !== null) rmSync(baseScratch, { recursive: true, force: true })
    }
  } finally {
    rmSync(theirsScratch, { recursive: true, force: true })
  }
}

const runAttempt = (rt: Runtime, store: Store, layout: StoreLayout, ops: Partial<SyncOps>): AttemptOutcome => {
  const repo = layout.projectRoot

  syncWorkingCopy(rt, layout)

  const lsRemote = git(rt, repo, ['ls-remote', REMOTE_NAME, LEDGER_REF])
  if (!lsRemote.ok) {
    return {
      kind: 'return',
      outcome: { ok: false, reason: 'offline', detail: `remote '${REMOTE_NAME}' is not reachable: ${lsRemote.stderr.trim()}` }
    }
  }

  let remoteVal: string | null = null
  if (lsRemote.stdout.trim().length > 0) {
    const fetchResult = git(rt, repo, ['fetch', REMOTE_NAME, `+${LEDGER_REF}:${TRACKING_REF}`])
    if (!fetchResult.ok) {
      return {
        kind: 'return',
        outcome: { ok: false, reason: 'offline', detail: `fetch from remote '${REMOTE_NAME}' failed: ${fetchResult.stderr.trim()}` }
      }
    }
    remoteVal = readRef(rt, repo, TRACKING_REF)
  }

  const localVal = readRef(rt, repo, LEDGER_REF)

  if (localVal === remoteVal) {
    return {
      kind: 'return',
      outcome: { ok: true, action: 'noop', ref: LEDGER_REF, local_sha: localVal, remote_sha: remoteVal }
    }
  }

  if (remoteVal === null) {
    return pushPlain(rt, layout)
  }

  if (localVal === null) {
    return fastForward(rt, layout, localVal, remoteVal)
  }

  if (isAncestor(rt, repo, remoteVal, localVal)) {
    return pushPlain(rt, layout)
  }

  if (isAncestor(rt, repo, localVal, remoteVal)) {
    return fastForward(rt, layout, localVal, remoteVal)
  }

  return performMerge(rt, store, layout, localVal, remoteVal, ops)
}

export const sync = (rt: Runtime, store: Store, layout: StoreLayout, ops: Partial<SyncOps> = {}): SyncOutcome => {
  for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
    const outcome = runAttempt(rt, store, layout, ops)
    if (outcome.kind === 'return') {
      if (!(outcome.outcome.ok === false && outcome.outcome.reason === 'conflict')) {
        clearConflicts(layout)
      }
      return outcome.outcome
    }
  }
  const timeoutOutcome: SyncOutcome = {
    ok: false,
    reason: 'rejected',
    detail: `${LEDGER_REF} kept moving; giving up after ${MAX_SYNC_ATTEMPTS} attempts`
  }
  clearConflicts(layout)
  return timeoutOutcome
}
