import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { DecisionRecord, type Decision } from '../schema/decision.ts'
import { SessionRecord, type SessionEntry } from '../schema/session.ts'
import { ThreadRecord, type Thread } from '../schema/thread.ts'
import { git } from '../store/git.ts'
import type { StoreLayout } from '../store/layout.ts'
import { readAllRecordFiles, syncWorkingCopy } from '../store/read-path.ts'
import { LEDGER_REF, casUpdateRef } from '../store/ref.ts'
import type { Store } from '../store/records.ts'
import { writeRecords, type RecordChange } from '../store/write-path.ts'
import { mergeDecision, mergeSession, mergeThread } from './field-merge.ts'
import type { Conflict } from './conflict.ts'

export type SyncOutcome =
  | { ok: true; action: 'noop' | 'pushed' | 'fast-forwarded' | 'merged'; ref: string }
  | { ok: false; reason: 'conflict'; conflicts: Conflict[] }
  | { ok: false; reason: 'offline' | 'rejected'; detail: string }

export type SyncOps = { git?: typeof git; beforeCas?: () => void }

const REMOTE_NAME = 'origin'
const TRACKING_REF = 'refs/logbook/sync/origin-ledger'
const MAX_SYNC_ATTEMPTS = 5

type RecordSet = { threads: Map<string, Thread>; decisions: Map<string, Decision>; sessionsByThread: Map<string, SessionEntry[]> }

type AttemptOutcome =
  | { kind: 'return'; outcome: SyncOutcome }
  | { kind: 'retry' }

const readRef = (rt: Runtime, runGit: typeof git, repo: string, ref: string): string | null => {
  const result = runGit(rt, repo, ['rev-parse', ref])
  return result.ok ? result.stdout.trim() : null
}

const isAncestor = (rt: Runtime, runGit: typeof git, repo: string, ancestor: string, descendant: string): boolean =>
  runGit(rt, repo, ['merge-base', '--is-ancestor', ancestor, descendant]).ok

const safeDirNames = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
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

const readScratchRecordSet = (root: string): RecordSet => {
  const threads = new Map<string, Thread>()
  for (const slot of readAllRecordFiles<Thread>(path.join(root, 'threads'), ThreadRecord)) {
    if (!slot.quarantined) threads.set(slot.record.id, slot.record)
  }
  const decisions = new Map<string, Decision>()
  for (const slot of readAllRecordFiles<Decision>(path.join(root, 'decisions'), DecisionRecord)) {
    if (!slot.quarantined) decisions.set(slot.record.id, slot.record)
  }
  const sessionsByThread = new Map<string, SessionEntry[]>()
  for (const threadId of safeDirNames(path.join(root, 'sessions'))) {
    const entries: SessionEntry[] = []
    for (const slot of readAllRecordFiles<SessionEntry>(path.join(root, 'sessions', threadId), SessionRecord)) {
      if (!slot.quarantined) entries.push(slot.record)
    }
    sessionsByThread.set(threadId, entries)
  }
  return { threads, decisions, sessionsByThread }
}

const parseLsTreeLine = (line: string): { blobId: string; relPath: string } | null => {
  const tabIndex = line.indexOf('\t')
  if (tabIndex === -1) return null
  const meta = line.slice(0, tabIndex).split(' ')
  const blobId = meta[2]
  if (blobId === undefined) return null
  return { blobId, relPath: line.slice(tabIndex + 1) }
}

const materialiseRefToScratch = (rt: Runtime, layout: StoreLayout, ref: string): string | null => {
  const listing = git(rt, layout.projectRoot, ['ls-tree', '-r', '--full-tree', ref])
  if (!listing.ok) return null

  const scratch = mkdtempSync(path.join(tmpdir(), 'logbook-sync-scratch-'))
  const lines = listing.stdout.split('\n').filter((line) => line.length > 0)
  for (const line of lines) {
    const parsed = parseLsTreeLine(line)
    if (parsed === null) continue
    const content = git(rt, layout.projectRoot, ['cat-file', '-p', parsed.blobId])
    if (!content.ok) continue
    const target = path.join(scratch, parsed.relPath)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, content.stdout, 'utf8')
  }
  return scratch
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

const writeConflicts = (layout: StoreLayout, conflicts: Conflict[]): void => {
  writeFileSync(path.join(layout.state, 'conflicts.json'), JSON.stringify(conflicts), 'utf8')
}

const fastForward = (rt: Runtime, layout: StoreLayout, localVal: string | null, remoteVal: string): AttemptOutcome => {
  const cas = casUpdateRef(rt, layout.projectRoot, LEDGER_REF, remoteVal, localVal)
  if (cas.ok) {
    syncWorkingCopy(rt, layout)
    return { kind: 'return', outcome: { ok: true, action: 'fast-forwarded', ref: LEDGER_REF } }
  }
  if (cas.cause === 'ref-moved') return { kind: 'retry' }
  return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: cas.message } }
}

const pushPlain = (rt: Runtime, layout: StoreLayout): AttemptOutcome => {
  const result = git(rt, layout.projectRoot, ['push', REMOTE_NAME, `${LEDGER_REF}:${LEDGER_REF}`])
  if (result.ok) return { kind: 'return', outcome: { ok: true, action: 'pushed', ref: LEDGER_REF } }
  return { kind: 'retry' }
}

const performMerge = (
  rt: Runtime,
  store: Store,
  layout: StoreLayout,
  localVal: string,
  remoteVal: string,
  ops: Partial<SyncOps>
): AttemptOutcome => {
  const theirsScratch = materialiseRefToScratch(rt, layout, remoteVal)
  if (theirsScratch === null) {
    return { kind: 'return', outcome: { ok: false, reason: 'rejected', detail: `could not read ${remoteVal} for merge` } }
  }
  try {
    const mergeBaseResult = git(rt, layout.projectRoot, ['merge-base', localVal, remoteVal])
    const baseVal = mergeBaseResult.ok ? mergeBaseResult.stdout.trim() : null
    const baseScratch = baseVal !== null ? materialiseRefToScratch(rt, layout, baseVal) : null
    try {
      const ours = readOursRecordSet(store, layout)
      const theirs = readScratchRecordSet(theirsScratch)
      const base = baseScratch !== null ? readScratchRecordSet(baseScratch) : null

      const { changes, conflicts } = computeMerge(ours, theirs, base)
      if (conflicts.length > 0) {
        writeConflicts(layout, conflicts)
        return { kind: 'return', outcome: { ok: false, reason: 'conflict', conflicts } }
      }

      const message = `merge ${localVal.slice(0, 12)} with ${remoteVal.slice(0, 12)}`
      const writeOps = {
        git: ops.git ?? git,
        ...(ops.beforeCas !== undefined ? { beforeCas: ops.beforeCas } : {})
      }
      const commitResult = writeRecords(rt, layout, changes, message, writeOps)
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
      if (!pushResult.ok) return { kind: 'retry' }

      return { kind: 'return', outcome: { ok: true, action: 'merged', ref: LEDGER_REF } }
    } finally {
      if (baseScratch !== null) rmSync(baseScratch, { recursive: true, force: true })
    }
  } finally {
    rmSync(theirsScratch, { recursive: true, force: true })
  }
}

const runAttempt = (rt: Runtime, store: Store, layout: StoreLayout, ops: Partial<SyncOps>): AttemptOutcome => {
  const runGit = ops.git ?? git
  const repo = layout.projectRoot

  syncWorkingCopy(rt, layout)

  const lsRemote = runGit(rt, repo, ['ls-remote', REMOTE_NAME, LEDGER_REF])
  if (!lsRemote.ok) {
    return {
      kind: 'return',
      outcome: { ok: false, reason: 'offline', detail: `remote '${REMOTE_NAME}' is not reachable: ${lsRemote.stderr.trim()}` }
    }
  }

  let remoteVal: string | null = null
  if (lsRemote.stdout.trim().length > 0) {
    const fetchResult = runGit(rt, repo, ['fetch', REMOTE_NAME, `+${LEDGER_REF}:${TRACKING_REF}`])
    if (!fetchResult.ok) {
      return {
        kind: 'return',
        outcome: { ok: false, reason: 'offline', detail: `fetch from remote '${REMOTE_NAME}' failed: ${fetchResult.stderr.trim()}` }
      }
    }
    remoteVal = readRef(rt, runGit, repo, TRACKING_REF)
  }

  const localVal = readRef(rt, runGit, repo, LEDGER_REF)

  if (localVal === remoteVal) {
    return { kind: 'return', outcome: { ok: true, action: 'noop', ref: LEDGER_REF } }
  }

  if (remoteVal === null) {
    return pushPlain(rt, layout)
  }

  if (localVal === null) {
    return fastForward(rt, layout, localVal, remoteVal)
  }

  if (isAncestor(rt, runGit, repo, remoteVal, localVal)) {
    return pushPlain(rt, layout)
  }

  if (isAncestor(rt, runGit, repo, localVal, remoteVal)) {
    return fastForward(rt, layout, localVal, remoteVal)
  }

  return performMerge(rt, store, layout, localVal, remoteVal, ops)
}

export const sync = (rt: Runtime, store: Store, layout: StoreLayout, ops: Partial<SyncOps> = {}): SyncOutcome => {
  for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
    const outcome = runAttempt(rt, store, layout, ops)
    if (outcome.kind === 'return') return outcome.outcome
  }
  return { ok: false, reason: 'rejected', detail: `${LEDGER_REF} kept moving; giving up after ${MAX_SYNC_ATTEMPTS} attempts` }
}
