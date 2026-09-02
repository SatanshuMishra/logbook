import { randomUUID } from 'node:crypto'
import { mkdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Binding } from '../schema/binding.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'
import type { Thread } from '../schema/thread.ts'
import { durableWrite } from './durable-write.ts'
import { git, readIdentity, type GitResult } from './git.ts'
import type { StoreLayout } from './layout.ts'
import { LEDGER_REF, casUpdateRef } from './ref.ts'

export type RecordChange =
  | { kind: 'thread'; record: Thread }
  | { kind: 'decision'; record: Decision }
  | { kind: 'session'; record: SessionEntry }
  | { kind: 'binding'; record: Binding }
  | { kind: 'raw'; relPath: string; content: string }

export type CommitResult =
  | { ok: true; ref: string; before: string | null; after: string }
  | { ok: false; reason: 'ref-moved' | 'io' | 'invalid'; detail: string }

export type WriteRecordsOps = {
  git: typeof git
  beforeCas: () => void
  extraParents?: string[]
}

const MAX_ATTEMPTS = 5

export const writeIndexScratchDir = (layout: StoreLayout): string => path.join(layout.root, 'write-index')

const relativePathFor = (change: RecordChange): string => {
  switch (change.kind) {
    case 'thread':
      return path.join('threads', `${change.record.id}.json`)
    case 'decision':
      return path.join('decisions', `${change.record.id}.json`)
    case 'binding':
      return path.join('bindings', `${change.record.id}.json`)
    case 'session':
      return path.join('sessions', change.record.thread_id, `${change.record.id}.json`)
    case 'raw':
      return change.relPath
    default: {
      const exhaustive: never = change
      const observedKind = String((change as { kind: unknown }).kind)
      void exhaustive
      throw new Error(`relativePathFor received a record change of an unrecognised kind: ${observedKind}.`)
    }
  }
}

const contentFor = (change: RecordChange): string => (change.kind === 'raw' ? change.content : JSON.stringify(change.record))

const freshIndexPath = (scratchDir: string): string => path.join(scratchDir, `logbook-write-index-${randomUUID()}`)

const removeSharedIndex = (indexFile: string): void => {
  try {
    unlinkSync(indexFile)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

const withSharedIndex = <T>(scratchDir: string, fn: (indexFile: string) => T): T => {
  mkdirSync(scratchDir, { recursive: true })
  const indexFile = freshIndexPath(scratchDir)
  try {
    return fn(indexFile)
  } finally {
    removeSharedIndex(indexFile)
  }
}

type TreeResult = { ok: true; tree: string } | { ok: false; detail: string }

type Target = { change: RecordChange; relPath: string; target: string }

const buildTree = (
  rt: Runtime,
  layout: StoreLayout,
  runGit: typeof git,
  oldRef: string | null,
  targets: Target[]
): TreeResult =>
  withSharedIndex(writeIndexScratchDir(layout), (indexFile) => {
    if (oldRef !== null) {
      const readTree = runGit(rt, layout.projectRoot, ['read-tree', oldRef], { indexFile })
      if (!readTree.ok) {
        return { ok: false, detail: `read-tree: ${readTree.stderr}` }
      }
    }

    const blobs: { relPath: string; blobId: string }[] = []
    for (const { change, relPath } of targets) {
      const hashResult = runGit(rt, layout.projectRoot, ['hash-object', '-w', '--stdin'], {
        stdin: contentFor(change)
      })
      if (!hashResult.ok) {
        return { ok: false, detail: `hash-object: ${hashResult.stderr}` }
      }
      blobs.push({ relPath, blobId: hashResult.stdout.trim() })
    }

    for (const { relPath, blobId } of blobs) {
      const addEntry = runGit(
        rt,
        layout.projectRoot,
        ['update-index', '--add', '--cacheinfo', `100644,${blobId},${relPath}`],
        { indexFile }
      )
      if (!addEntry.ok) {
        return { ok: false, detail: `update-index: ${addEntry.stderr}` }
      }
    }

    const writeTree = runGit(rt, layout.projectRoot, ['write-tree'], { indexFile })
    if (!writeTree.ok) {
      return { ok: false, detail: `write-tree: ${writeTree.stderr}` }
    }
    return { ok: true, tree: writeTree.stdout.trim() }
  })

const blobAt = (
  rt: Runtime,
  layout: StoreLayout,
  runGit: typeof git,
  ref: string | null,
  relPath: string
): string | null => {
  if (ref === null) return null
  const result = runGit(rt, layout.projectRoot, ['rev-parse', `${ref}:${relPath}`])
  return result.ok ? result.stdout.trim() : null
}

export const writeRecords = (
  rt: Runtime,
  layout: StoreLayout,
  changes: RecordChange[],
  message: string,
  ops: Partial<WriteRecordsOps> = {}
): CommitResult => {
  const runGit = ops.git ?? git
  const identity = readIdentity(rt, layout.projectRoot)
  if (!identity.ok) {
    return { ok: false, reason: 'io', detail: identity.message }
  }

  const targets = changes.map((change) => ({
    change,
    relPath: relativePathFor(change),
    target: path.join(layout.records, relativePathFor(change))
  }))

  const readCurrentRef = (): string | null => {
    const result = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
    return result.ok ? result.stdout.trim() : null
  }

  const writeTargetsToDisk = (): { ok: true } | { ok: false; detail: string } => {
    try {
      for (const { change, target } of targets) {
        mkdirSync(path.dirname(target), { recursive: true })
        durableWrite(target, contentFor(change), { log: rt.log })
      }
      return { ok: true }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { ok: false, detail }
    }
  }

  let oldRef = readCurrentRef()
  let attempt = 0

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1

    const treeResult = buildTree(rt, layout, runGit, oldRef, targets)
    if (!treeResult.ok) {
      return { ok: false, reason: 'io', detail: treeResult.detail }
    }
    const tree = treeResult.tree

    const parentRefs: string[] = [...(oldRef !== null ? [oldRef] : []), ...(ops.extraParents ?? [])]
    const commitArgs: string[] =
      parentRefs.length === 0
        ? ['commit-tree', tree, '-m', message]
        : ['commit-tree', tree, ...parentRefs.flatMap((parent) => ['-p', parent]), '-m', message]
    const commitResult: GitResult = runGit(rt, layout.projectRoot, commitArgs, { identity: identity.value })
    if (!commitResult.ok) {
      return { ok: false, reason: 'io', detail: `commit-tree: ${commitResult.stderr}` }
    }
    const newCommit = commitResult.stdout.trim()

    if (ops.beforeCas && attempt === 1) {
      ops.beforeCas()
    }

    const cas = casUpdateRef(rt, layout.projectRoot, LEDGER_REF, newCommit, oldRef)
    if (cas.ok) {
      const diskWrite = writeTargetsToDisk()
      if (!diskWrite.ok) {
        rt.log({
          level: 'error',
          event: 'store.post-cas-durable-write-failed',
          ref: LEDGER_REF,
          after: newCommit,
          detail: diskWrite.detail
        })
        return {
          ok: false,
          reason: 'io',
          detail: `${LEDGER_REF} advanced to ${newCommit} but the on-disk record copy could not be durably written: ${diskWrite.detail}; the store is now behind the ledger ref and will repair itself on the next read`
        }
      }
      return { ok: true, ref: LEDGER_REF, before: oldRef, after: newCommit }
    }

    if (cas.cause === 'ref-moved') {
      const wonRef = readCurrentRef()
      const changedUnderneath = targets.filter(
        ({ relPath }) =>
          blobAt(rt, layout, runGit, oldRef, relPath) !== blobAt(rt, layout, runGit, wonRef, relPath)
      )
      if (changedUnderneath.length > 0) {
        rt.log({
          level: 'error',
          event: 'store.cas-retry-refused',
          ref: LEDGER_REF,
          contested_records: changedUnderneath.length
        })
        return {
          ok: false,
          reason: 'ref-moved',
          detail: `${LEDGER_REF} moved and ${changedUnderneath.length} of the record(s) being written changed in the winning commit; the write was refused rather than overwriting them`
        }
      }
      oldRef = wonRef
      continue
    }

    return { ok: false, reason: 'io', detail: cas.message }
  }

  return { ok: false, reason: 'ref-moved', detail: `${LEDGER_REF} moved ${MAX_ATTEMPTS} times; giving up` }
}
