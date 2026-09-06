import { lstatSync, readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { describeError, errnoCode } from './detail.ts'
import { isDurableWriteTempPath } from './durable-write.ts'

export type MaterialiseFailureCause =
  | 'symlinked-records-directory'
  | 'materialisation'
  | 'name-round-trip'
  | 'stale-record-unremovable'

export type MaterialiseOutcome = { ok: true } | { ok: false; cause: MaterialiseFailureCause; detail: string }

type RecordsTreeListing =
  | { ok: true; files: readonly string[]; directories: readonly string[] }
  | { ok: false; detail: string }

const listRecordsTree = (root: string): RecordsTreeListing => {
  const files: string[] = []
  const directories: string[] = []

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relPath = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        directories.push(relPath)
        walk(path.join(dir, entry.name), relPath)
        continue
      }
      files.push(relPath)
    }
  }

  try {
    walk(root, '')
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') return { ok: true, files: [], directories: [] }
    return { ok: false, detail: `the records directory ${root} could not be listed: ${describeError(error)}` }
  }

  return { ok: true, files, directories }
}

const TOLERATED_DIRECTORY_REMOVAL_CODES = new Set(['ENOENT', 'ENOTEMPTY', 'EEXIST'])

const removeEmptiedDirectories = (rt: Runtime, root: string, directories: readonly string[]): void => {
  const deepestFirst = [...directories].sort((left, right) => (left < right ? 1 : left > right ? -1 : 0))
  for (const relPath of deepestFirst) {
    const target = path.join(root, relPath)
    try {
      rmdirSync(target)
    } catch (error) {
      const code = errnoCode(error)
      if (TOLERATED_DIRECTORY_REMOVAL_CODES.has(code)) continue
      rt.log({
        level: 'error',
        event: 'store.materialise-prune-directory-retained',
        directory: target,
        detail: describeError(error)
      })
    }
  }
}

export const refuseSymlinkedRecordsDirectory = (records: string): MaterialiseOutcome => {
  let symbolic: boolean
  try {
    symbolic = lstatSync(records).isSymbolicLink()
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT') return { ok: true }
    return {
      ok: false,
      cause: 'materialisation',
      detail: `the records directory ${records} could not be inspected before materialisation (${code}): ${describeError(error)}`
    }
  }

  if (!symbolic) return { ok: true }

  return {
    ok: false,
    cause: 'symlinked-records-directory',
    detail: `${records} is a symbolic link, so materialising in place would write into and delete from a tree the store does not own; replace the link with a real directory before opening the store again`
  }
}

const logPrunedRecords = (rt: Runtime, records: string, ref: string, removed: readonly string[]): void => {
  if (removed.length === 0) return
  rt.log({
    level: 'warn',
    event: 'store.materialise-prune-removed',
    records,
    ref,
    removed_count: removed.length,
    removed: [...removed]
  })
}

export const pruneRecordsAbsentFromRef = (
  rt: Runtime,
  records: string,
  ref: string,
  keepPaths: readonly string[],
  readObservedRef: () => string | null
): MaterialiseOutcome => {
  const listing = listRecordsTree(records)
  if (!listing.ok) return { ok: false, cause: 'materialisation', detail: listing.detail }

  const observed = readObservedRef()
  if (observed !== ref) {
    rt.log({
      level: 'warn',
      event: 'store.materialise-prune-skipped',
      ref,
      observed,
      detail:
        'the ledger ref moved while the records tree was being listed; nothing was removed and the next open will materialise again'
    })
    return { ok: true }
  }

  const keep = new Set(keepPaths)
  const removed: string[] = []
  for (const relPath of listing.files) {
    if (keep.has(relPath)) continue
    if (isDurableWriteTempPath(relPath)) continue
    const target = path.join(records, relPath)
    try {
      unlinkSync(target)
    } catch (error) {
      const code = errnoCode(error)
      if (code === 'ENOENT') continue
      logPrunedRecords(rt, records, ref, removed)
      return {
        ok: false,
        cause: 'stale-record-unremovable',
        detail: `${target} is absent from ${ref} and could not be removed from the records tree (${code}): ${describeError(error)}`
      }
    }
    removed.push(relPath)
  }

  logPrunedRecords(rt, records, ref, removed)

  removeEmptiedDirectories(rt, records, listing.directories)

  return { ok: true }
}

export const verifyMaterialisedNamesRoundTrip = (
  records: string,
  ref: string,
  relPaths: readonly string[]
): MaterialiseOutcome => {
  const listing = listRecordsTree(records)
  if (!listing.ok) return { ok: false, cause: 'materialisation', detail: listing.detail }

  const onDisk = new Set(listing.files)
  const missing = relPaths.find((relPath) => !onDisk.has(relPath))
  if (missing === undefined) return { ok: true }

  return {
    ok: false,
    cause: 'name-round-trip',
    detail: `${ref} carries ${missing}, but after materialising it no directory entry under ${records} has that exact name; the filesystem folded that name onto a neighbouring one, so what sits under the folded name is a different record's bytes that still parse as a structurally valid record and would be served in place of ${missing}`
  }
}
