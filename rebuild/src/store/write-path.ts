import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
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
  | { kind: 'raw'; relPath: string; content: string }

export type CommitResult =
  | { ok: true; ref: string; before: string | null; after: string }
  | { ok: false; reason: 'ref-moved' | 'io'; detail: string }

export type WriteRecordsOps = {
  git: typeof git
  beforeCas: () => void
  extraParents?: string[]
}

const MAX_ATTEMPTS = 5

export const writeIndexScratchDir = (layout: StoreLayout): string => path.join(layout.root, 'write-index')

const relativePathFor = (change: RecordChange): string => {
  if (change.kind === 'thread') return path.join('threads', `${change.record.id}.json`)
  if (change.kind === 'decision') return path.join('decisions', `${change.record.id}.json`)
  if (change.kind === 'raw') return change.relPath
  return path.join('sessions', change.record.thread_id, `${change.record.id}.json`)
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

type Backup = { target: string; existed: boolean; content: string }

const captureBackup = (target: string): Backup => {
  try {
    return { target, existed: true, content: readFileSync(target, 'utf8') }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { target, existed: false, content: '' }
    }
    throw error
  }
}

const restoreBackup = (rt: Runtime, backup: Backup): void => {
  if (backup.existed) {
    mkdirSync(path.dirname(backup.target), { recursive: true })
    durableWrite(backup.target, backup.content, { log: rt.log })
    return
  }
  try {
    unlinkSync(backup.target)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
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

  const backups = targets.map(({ target }) => captureBackup(target))
  const rollback = (): void => {
    for (const backup of backups) {
      restoreBackup(rt, backup)
    }
  }

  const readCurrentRef = (): string | null => {
    const result = runGit(rt, layout.projectRoot, ['rev-parse', LEDGER_REF])
    return result.ok ? result.stdout.trim() : null
  }

  let oldRef = readCurrentRef()
  let attempt = 0

  while (attempt < MAX_ATTEMPTS) {
    attempt += 1

    for (const { change, target } of targets) {
      mkdirSync(path.dirname(target), { recursive: true })
      durableWrite(target, contentFor(change), { log: rt.log })
    }

    const treeResult = buildTree(rt, layout, runGit, oldRef, targets)
    if (!treeResult.ok) {
      rollback()
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
      rollback()
      return { ok: false, reason: 'io', detail: `commit-tree: ${commitResult.stderr}` }
    }
    const newCommit = commitResult.stdout.trim()

    if (ops.beforeCas && attempt === 1) {
      ops.beforeCas()
    }

    const cas = casUpdateRef(rt, layout.projectRoot, LEDGER_REF, newCommit, oldRef)
    if (cas.ok) {
      return { ok: true, ref: LEDGER_REF, before: oldRef, after: newCommit }
    }

    if (cas.cause === 'ref-moved') {
      oldRef = readCurrentRef()
      continue
    }

    rollback()
    return { ok: false, reason: 'io', detail: cas.message }
  }

  rollback()
  return { ok: false, reason: 'ref-moved', detail: `${LEDGER_REF} moved ${MAX_ATTEMPTS} times; giving up` }
}
