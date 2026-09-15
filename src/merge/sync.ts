import type { Runtime } from '../runtime/runtime.ts'
import { git } from '../store/git.ts'
import type { StoreLayout } from '../store/layout.ts'
import { syncWorkingCopy, type SyncWorkingCopyOutcome } from '../store/read-path.ts'
import { LEDGER_REF, casUpdateRef } from '../store/ref.ts'
import type { Store } from '../store/records.ts'
import { writeRecords } from '../store/write-path.ts'
import type { ConflictPath, ConflictReportEntry, ConflictState } from './conflict.ts'
import { clearConflictState, writeConflictState } from './conflict-state.ts'
import { differingJsonPaths } from './json-differences.ts'
import { checkGitVersion, mergeTree, recordsNotTakenWhole } from './merge-tree.ts'

export type SyncAction = 'noop' | 'pushed' | 'pushed-unverified' | 'fast-forwarded' | 'merged'

export type RejectedOutcome = { ok: false; reason: 'rejected'; cause: 'remote-rejected' | 'contention' | 'local'; detail: string }

export type SyncOutcome =
  | { ok: true; action: SyncAction; ref: string; local_sha: string | null; remote_sha: string | null }
  | { ok: false; reason: 'conflict'; state: ConflictState; entries: ConflictReportEntry[] }
  | { ok: false; reason: 'git-too-old'; found: string }
  | { ok: false; reason: 'offline'; detail: string }
  | RejectedOutcome

export type SyncOps = { beforeCas?: () => void }

const REMOTE_NAME = 'origin'
export const TRACKING_REF = 'refs/logbook/sync/origin-ledger'
const MAX_SYNC_ATTEMPTS = 5
const LEASE_REJECTION_PATTERN = /stale info|non-fast-forward/

type AttemptOutcome =
  | { kind: 'return'; outcome: SyncOutcome }
  | { kind: 'retry' }

type FailedSyncWorkingCopy = Extract<SyncWorkingCopyOutcome, { ok: false }>

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

const materialisationRejection = (where: string, outcome: FailedSyncWorkingCopy): AttemptOutcome => ({
  kind: 'return',
  outcome: {
    ok: false,
    reason: 'rejected',
    cause: 'local',
    detail: `${where}: the records tree could not be materialised from ${LEDGER_REF} (${outcome.cause}): ${outcome.detail}`
  }
})

const localRejection = (detail: string): AttemptOutcome => ({
  kind: 'return',
  outcome: { ok: false, reason: 'rejected', cause: 'local', detail }
})

const fastForward = (rt: Runtime, layout: StoreLayout, localVal: string | null, remoteVal: string): AttemptOutcome => {
  const cas = casUpdateRef(rt, layout.projectRoot, LEDGER_REF, remoteVal, localVal)
  if (cas.ok) {
    const materialised = syncWorkingCopy(rt, layout)
    if (!materialised.ok) {
      return materialisationRejection(`the ledger ref was fast-forwarded to ${remoteVal}`, materialised)
    }
    return {
      kind: 'return',
      outcome: { ok: true, action: 'fast-forwarded', ref: LEDGER_REF, local_sha: remoteVal, remote_sha: remoteVal }
    }
  }
  if (cas.cause === 'ref-moved') return { kind: 'retry' }
  return localRejection(cas.message)
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
  return { kind: 'return', outcome: { ok: false, reason: 'rejected', cause: 'remote-rejected', detail: result.stderr.trim() } }
}

type ParsedVersion = { ok: true; value: unknown } | { ok: false }

const parsedVersion = (rt: Runtime, repo: string, blob: string | null): ParsedVersion => {
  if (blob === null) return { ok: true, value: undefined }
  const read = git(rt, repo, ['cat-file', 'blob', blob])
  if (!read.ok) return { ok: false }
  try {
    return { ok: true, value: JSON.parse(read.stdout) }
  } catch {
    return { ok: false }
  }
}

const changesBetween = (before: ParsedVersion, after: ParsedVersion): string[] | null =>
  before.ok && after.ok ? differingJsonPaths(before.value, after.value) : null

const reportEntry = (rt: Runtime, repo: string, conflicted: ConflictPath): ConflictReportEntry => {
  const local = parsedVersion(rt, repo, conflicted.local_blob)
  const remote = parsedVersion(rt, repo, conflicted.remote_blob)
  if (conflicted.base_blob === null) {
    const between = changesBetween(local, remote)
    return { ...conflicted, local_changes: between, remote_changes: between }
  }
  const base = parsedVersion(rt, repo, conflicted.base_blob)
  return { ...conflicted, local_changes: changesBetween(base, local), remote_changes: changesBetween(base, remote) }
}

const byPath = (a: ConflictPath, b: ConflictPath): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

const performMerge = (rt: Runtime, layout: StoreLayout, localVal: string, remoteVal: string, ops: SyncOps): AttemptOutcome => {
  const repo = layout.projectRoot

  const version = checkGitVersion(rt, repo)
  if (!version.ok) {
    return { kind: 'return', outcome: { ok: false, reason: 'git-too-old', found: version.found } }
  }

  const merged = mergeTree(rt, repo, localVal, remoteVal)
  if (!merged.ok) return localRejection(`git could not merge ${localVal} with ${remoteVal}: ${merged.detail}`)

  const notWhole = recordsNotTakenWhole(rt, repo, localVal, remoteVal, merged.tree, new Set(merged.conflicted.map((entry) => entry.path)))
  if (!notWhole.ok) return localRejection(notWhole.detail)

  const conflicted = [...merged.conflicted, ...notWhole.paths].sort(byPath)
  if (conflicted.length > 0) {
    const state: ConflictState = { local_commit: localVal, remote_commit: remoteVal, paths: conflicted }
    const written = writeConflictState(layout, state)
    if (!written.ok) return localRejection(`could not persist conflicts: ${written.detail}`)
    return {
      kind: 'return',
      outcome: { ok: false, reason: 'conflict', state, entries: conflicted.map((entry) => reportEntry(rt, repo, entry)) }
    }
  }

  const commitResult = writeRecords(rt, layout, [], `merge ${localVal.slice(0, 12)} with ${remoteVal.slice(0, 12)}`, {
    startFrom: { tree: merged.tree, parent: localVal },
    extraParents: [remoteVal],
    ...(ops.beforeCas !== undefined ? { beforeCas: ops.beforeCas } : {})
  })
  if (!commitResult.ok) {
    if (commitResult.reason === 'ref-moved') return { kind: 'retry' }
    return localRejection(commitResult.detail)
  }

  const materialised = syncWorkingCopy(rt, layout)
  if (!materialised.ok) {
    return materialisationRejection('the merge commit was written to the local ledger ref', materialised)
  }

  const pushResult = git(rt, repo, ['push', `--force-with-lease=${LEDGER_REF}:${remoteVal}`, REMOTE_NAME, `${LEDGER_REF}:${LEDGER_REF}`])
  if (!pushResult.ok) {
    if (isLeaseRejection(pushResult.stderr)) return { kind: 'retry' }
    return {
      kind: 'return',
      outcome: { ok: false, reason: 'rejected', cause: 'remote-rejected', detail: pushResult.stderr.trim() }
    }
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
}

const runAttempt = (rt: Runtime, layout: StoreLayout, ops: SyncOps): AttemptOutcome => {
  const repo = layout.projectRoot

  const materialised = syncWorkingCopy(rt, layout)
  if (!materialised.ok) {
    return materialisationRejection('sync read the local ledger before contacting origin', materialised)
  }

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

  return performMerge(rt, layout, localVal, remoteVal, ops)
}

export const sync = (rt: Runtime, _store: Store, layout: StoreLayout, ops: SyncOps = {}): SyncOutcome => {
  for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS; attempt += 1) {
    const outcome = runAttempt(rt, layout, ops)
    if (outcome.kind === 'return') {
      if (outcome.outcome.ok === true) {
        clearConflictState(layout)
      }
      return outcome.outcome
    }
  }
  return {
    ok: false,
    reason: 'rejected',
    cause: 'contention',
    detail: `${LEDGER_REF} kept moving; giving up after ${MAX_SYNC_ATTEMPTS} attempts`
  }
}
