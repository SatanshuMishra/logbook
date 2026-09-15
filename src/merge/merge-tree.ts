import type { Runtime } from '../runtime/runtime.ts'
import { gitRun } from '../store/git.ts'
import type { ConflictPath } from './conflict.ts'

export const GIT_MERGE_TREE_FLOOR = '2.38.0'

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const ABSENT_OBJECT_ID = /^0+$/
const GIT_VERSION = /git version (\d+)\.(\d+)\.(\d+)/
const CONFLICT_ENTRY = /^\d{6} ([0-9a-f]{40,64}) ([123])\t([\s\S]+)$/
const TREE_ENTRY = /^\d{6} \w+ ([0-9a-f]{40,64})\t([\s\S]+)$/
const DIFF_TREE_META = /^:\d{6} \d{6} ([0-9a-f]{40,64}) ([0-9a-f]{40,64}) [A-Z]\d*$/
const RECORD_DIRECTORIES: ReadonlySet<string> = new Set(['threads', 'decisions', 'sessions', 'bindings'])

type Failure = { ok: false; detail: string }

export type GitVersionCheck = { ok: true } | { ok: false; found: string }

const numericVersion = (version: string): number[] => version.split('.').map(Number)

const isOlder = (found: readonly number[], floor: readonly number[]): boolean => {
  for (let index = 0; index < floor.length; index += 1) {
    const difference = (found[index] ?? 0) - (floor[index] ?? 0)
    if (difference !== 0) return difference < 0
  }
  return false
}

export const checkGitVersion = (rt: Runtime, repo: string): GitVersionCheck => {
  const run = gitRun(rt, repo, ['version'])
  const match = run.code === 0 ? GIT_VERSION.exec(run.stdout) : null
  if (match === null) return { ok: true }
  const found = `${match[1]}.${match[2]}.${match[3]}`
  return isOlder(numericVersion(found), numericVersion(GIT_MERGE_TREE_FLOOR)) ? { ok: false, found } : { ok: true }
}

const nulSeparated = (stdout: string): string[] => stdout.split('\0').filter((token) => token.length > 0)

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

export type MergeTreeOutcome = { ok: true; tree: string; conflicted: ConflictPath[] } | Failure

export const mergeTree = (rt: Runtime, repo: string, local: string, remote: string): MergeTreeOutcome => {
  const run = gitRun(rt, repo, ['merge-tree', '--write-tree', '--allow-unrelated-histories', '-z', '--no-messages', local, remote])
  const [tree, ...entries] = nulSeparated(run.stdout)
  const printedATree = tree !== undefined && OBJECT_ID.test(tree)
  const failure: Failure = { ok: false, detail: run.stderr.trim() || `git merge-tree exited ${run.code} without a merged tree` }
  if (!printedATree) return failure
  if (run.code === 0 && entries.length === 0) return { ok: true, tree, conflicted: [] }
  if (run.code !== 1 || entries.length === 0) return failure

  const byConflictedPath = new Map<string, ConflictPath>()
  for (const entry of entries) {
    const match = CONFLICT_ENTRY.exec(entry)
    if (match === null) return { ok: false, detail: `git merge-tree printed a conflict entry this version cannot read: ${entry}` }
    const [, blob, stage, filePath] = match as unknown as [string, string, string, string]
    const current = byConflictedPath.get(filePath) ?? { path: filePath, base_blob: null, local_blob: null, remote_blob: null }
    const withStage =
      stage === '1' ? { ...current, base_blob: blob } : stage === '2' ? { ...current, local_blob: blob } : { ...current, remote_blob: blob }
    byConflictedPath.set(filePath, withStage)
  }
  return { ok: true, tree, conflicted: [...byConflictedPath.values()].sort(byPath) }
}

type Listing = { ok: true; blobs: Map<string, string> } | Failure

const listBlobs = (rt: Runtime, repo: string, treeish: string): Listing => {
  const run = gitRun(rt, repo, ['ls-tree', '-r', '-z', treeish])
  if (run.code !== 0) return { ok: false, detail: `git ls-tree could not list ${treeish}: ${run.stderr.trim()}` }
  const blobs = new Map<string, string>()
  for (const entry of nulSeparated(run.stdout)) {
    const match = TREE_ENTRY.exec(entry)
    if (match === null) return { ok: false, detail: `git ls-tree printed an entry this version cannot read: ${entry}` }
    blobs.set(match[2] as string, match[1] as string)
  }
  return { ok: true, blobs }
}

type MergeBase = { ok: true; commit: string | null } | Failure

const mergeBaseOf = (rt: Runtime, repo: string, local: string, remote: string): MergeBase => {
  const run = gitRun(rt, repo, ['merge-base', local, remote])
  if (run.code === 0) return { ok: true, commit: run.stdout.trim() }
  if (run.code === 1 && run.stderr.trim() === '') return { ok: true, commit: null }
  return { ok: false, detail: `git merge-base could not compare ${local} with ${remote}: ${run.stderr.trim()}` }
}

const isRecordPath = (filePath: string): boolean => RECORD_DIRECTORIES.has(filePath.split('/')[0] ?? '')

const presentOrNull = (blob: string): string | null => (ABSENT_OBJECT_ID.test(blob) ? null : blob)

export type NotTakenWhole = { ok: true; paths: ConflictPath[] } | Failure

export const recordsNotTakenWhole = (
  rt: Runtime,
  repo: string,
  local: string,
  remote: string,
  mergedTree: string,
  alreadyConflicted: ReadonlySet<string>
): NotTakenWhole => {
  const diff = gitRun(rt, repo, ['diff-tree', '-r', '-z', '--no-renames', local, mergedTree])
  if (diff.code !== 0) return { ok: false, detail: `git diff-tree could not compare ${local} with the merged tree: ${diff.stderr.trim()}` }
  const tokens = nulSeparated(diff.stdout)

  const changed: { path: string; localBlob: string | null; mergedBlob: string | null }[] = []
  for (let index = 0; index < tokens.length; index += 2) {
    const match = DIFF_TREE_META.exec(tokens[index] ?? '')
    const filePath = tokens[index + 1]
    if (match === null || filePath === undefined) {
      return { ok: false, detail: `git diff-tree printed a change this version cannot read: ${tokens[index] ?? ''}` }
    }
    if (alreadyConflicted.has(filePath) || !isRecordPath(filePath)) continue
    changed.push({ path: filePath, localBlob: presentOrNull(match[1] as string), mergedBlob: presentOrNull(match[2] as string) })
  }
  if (changed.length === 0) return { ok: true, paths: [] }

  const remoteListing = listBlobs(rt, repo, remote)
  if (!remoteListing.ok) return remoteListing
  const synthesised = changed.filter((entry) => entry.mergedBlob !== (remoteListing.blobs.get(entry.path) ?? null))
  if (synthesised.length === 0) return { ok: true, paths: [] }

  const base = mergeBaseOf(rt, repo, local, remote)
  if (!base.ok) return base
  const baseListing: Listing = base.commit === null ? { ok: true, blobs: new Map() } : listBlobs(rt, repo, base.commit)
  if (!baseListing.ok) return baseListing

  return {
    ok: true,
    paths: synthesised
      .map((entry) => ({
        path: entry.path,
        base_blob: baseListing.blobs.get(entry.path) ?? null,
        local_blob: entry.localBlob,
        remote_blob: remoteListing.blobs.get(entry.path) ?? null
      }))
      .sort(byPath)
  }
}
