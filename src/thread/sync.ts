import { stripHeaderLines } from '../doc/document.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { git, gitDetached, gitRun } from '../store/git.ts'
import { failureOf, headerOf, threeWay, withHeader, type Step } from './merge.ts'
import type { RepoPaths } from './paths.ts'
import {
  THREADS_REF,
  listSlugs,
  makeCommit,
  moveRef,
  readAliases,
  readDocument,
  threadsTip,
  writeTree
} from './store.ts'
import { readBaseText, readWorkingCopy, writeWorkingCopy } from './working-copy.ts'

export type SyncResult = { fetched: boolean; merged: boolean; conflicts: string[]; pushed: boolean; error: string | null }

type Chosen = { text: string | null; conflicted: boolean }

type Brought = { merged: boolean; conflicts: string[]; push: boolean }

type TreeMerge = { files: Record<string, string>; conflicts: string[] }

type StoredChange = { slug: string; old: string | null; next: string; nextBlob: string }

const REMOTE_THREADS_REF = 'refs/logbook/remotes/origin/threads'
const FETCH_ARGS = [
  'fetch',
  '--no-tags',
  '--no-write-fetch-head',
  '--no-auto-maintenance',
  'origin',
  `+${THREADS_REF}:${REMOTE_THREADS_REF}`
]
const FETCH_MISSING_ARGS = [
  'fetch',
  '--no-filter',
  '--no-tags',
  '--no-write-fetch-head',
  '--no-auto-maintenance',
  'origin',
  '--stdin'
]
const PUSH_ARGS = ['push', 'origin', `${THREADS_REF}:${THREADS_REF}`]
const MISSING_REMOTE_REF = /couldn't find remote ref/
const MISSING_OBJECT_PREFIX = '?'
const ALIASES_FILE = 'aliases.json'
const DOCUMENT_SUFFIX = '.md'
const STORED_LABELS = ['local', 'base', 'origin'] as const
const COPY_LABELS = ['working copy', 'stored before sync', 'stored after sync'] as const
const MERGE_MESSAGE = 'sync: merge the threads of origin'

const result = (fields: Partial<SyncResult>): SyncResult => ({
  fetched: false,
  merged: false,
  conflicts: [],
  pushed: false,
  error: null,
  ...fields
})

const hasOrigin = (rt: Runtime, paths: RepoPaths): boolean => {
  const origin = git(rt, paths.root, ['config', '--get', 'remote.origin.url'])
  return origin.ok && origin.stdout.trim() !== ''
}

const remoteTip = (rt: Runtime, paths: RepoPaths): string | null => {
  const found = git(rt, paths.root, ['rev-parse', '--verify', '--quiet', REMOTE_THREADS_REF])
  return found.ok ? found.stdout.trim() : null
}

const fetchThreads = async (rt: Runtime, paths: RepoPaths): Promise<Step<string | null>> => {
  const run = await gitDetached(rt, paths.root, FETCH_ARGS)
  if (run.code === 0) return { ok: true, value: remoteTip(rt, paths) }
  if (MISSING_REMOTE_REF.test(run.stderr)) return { ok: true, value: null }
  return { ok: false, error: failureOf('fetch from origin', run) }
}

export const missingObjects = (rt: Runtime, paths: RepoPaths, tips: readonly string[]): Step<string[]> => {
  if (tips.length === 0) return { ok: true, value: [] }
  const run = gitRun(rt, paths.root, ['rev-list', '--objects', '--missing=print', ...tips])
  if (run.code !== 0) return { ok: false, error: failureOf('rev-list', run) }
  return {
    ok: true,
    value: run.stdout
      .split('\n')
      .filter((line) => line.startsWith(MISSING_OBJECT_PREFIX))
      .map((line) => line.slice(MISSING_OBJECT_PREFIX.length))
  }
}

const fetchMissing = async (rt: Runtime, paths: RepoPaths, tips: readonly string[]): Promise<Step<void>> => {
  const missing = missingObjects(rt, paths, tips)
  if (!missing.ok) return missing
  if (missing.value.length === 0) return { ok: true, value: undefined }
  const stdin = missing.value.map((id) => `${id}\n`).join('')
  const run = await gitDetached(rt, paths.root, FETCH_MISSING_ARGS, { stdin })
  return run.code === 0
    ? { ok: true, value: undefined }
    : { ok: false, error: failureOf('fetch missing objects from origin', run) }
}

const isAncestor = (rt: Runtime, paths: RepoPaths, older: string, newer: string): Step<boolean> => {
  const run = gitRun(rt, paths.root, ['merge-base', '--is-ancestor', older, newer])
  if (run.code === 0) return { ok: true, value: true }
  if (run.code === 1) return { ok: true, value: false }
  return { ok: false, error: failureOf('merge-base', run) }
}

const mergeBaseOf = (rt: Runtime, paths: RepoPaths, local: string, remote: string): Step<string | null> => {
  const run = gitRun(rt, paths.root, ['merge-base', local, remote])
  if (run.code === 0) return { ok: true, value: run.stdout.trim() }
  if (run.code === 1) return { ok: true, value: null }
  return { ok: false, error: failureOf('merge-base', run) }
}

const kept = (text: string | null): Step<Chosen> => ({ ok: true, value: { text, conflicted: false } })

const mergeWithBase = (
  rt: Runtime,
  paths: RepoPaths,
  ours: string | null,
  theirs: string | null,
  base: string | null
): Step<Chosen> => {
  if (ours === theirs || theirs === base) return kept(ours)
  if (ours === base) return kept(theirs)
  if (ours === null || theirs === null) return kept(ours ?? theirs)
  const header = headerOf(base ?? '')
  return threeWay(rt, paths, STORED_LABELS, { ours, theirs, base: withHeader(base ?? '', header) }, header)
}

const mergeUnrelated = (rt: Runtime, paths: RepoPaths, ours: string | null, theirs: string | null): Step<Chosen> => {
  if (ours === null || theirs === null) return kept(ours ?? theirs)
  if (stripHeaderLines(ours) === stripHeaderLines(theirs)) return kept(ours)
  return threeWay(rt, paths, STORED_LABELS, { ours, theirs, base: '' }, headerOf(ours))
}

const textAt = (rt: Runtime, paths: RepoPaths, slug: string, tip: string): string | null =>
  readDocument(rt, paths, slug, tip)?.text ?? null

const mergedAliases = (rt: Runtime, paths: RepoPaths, local: string, remote: string): [string, string][] => {
  const aliases = { ...readAliases(rt, paths, remote), ...readAliases(rt, paths, local) }
  return Object.keys(aliases).length === 0 ? [] : [[ALIASES_FILE, `${JSON.stringify(aliases, null, 2)}\n`]]
}

const mergeTrees = (
  rt: Runtime,
  paths: RepoPaths,
  local: string,
  remote: string,
  base: string | null
): Step<TreeMerge> => {
  const slugs = [...new Set([...listSlugs(rt, paths, local), ...listSlugs(rt, paths, remote)])].sort()
  const documents = slugs.reduce<Step<{ files: [string, string][]; conflicts: string[] }>>(
    (merged, slug) => {
      if (!merged.ok) return merged
      const ours = textAt(rt, paths, slug, local)
      const theirs = textAt(rt, paths, slug, remote)
      const chosen =
        base === null
          ? mergeUnrelated(rt, paths, ours, theirs)
          : mergeWithBase(rt, paths, ours, theirs, textAt(rt, paths, slug, base))
      if (!chosen.ok) return chosen
      return {
        ok: true,
        value: {
          files:
            chosen.value.text === null
              ? merged.value.files
              : [...merged.value.files, [`${slug}${DOCUMENT_SUFFIX}`, chosen.value.text]],
          conflicts: chosen.value.conflicted ? [...merged.value.conflicts, slug] : merged.value.conflicts
        }
      }
    },
    { ok: true, value: { files: [], conflicts: [] } }
  )
  if (!documents.ok) return documents
  return {
    ok: true,
    value: {
      files: Object.fromEntries([...documents.value.files, ...mergedAliases(rt, paths, local, remote)]),
      conflicts: documents.value.conflicts
    }
  }
}

const treeOf = (rt: Runtime, paths: RepoPaths, files: Record<string, string>): Step<string> => {
  try {
    return { ok: true, value: writeTree(rt, paths, files) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

const mergeMessage = (conflicts: readonly string[]): string =>
  conflicts.length === 0
    ? MERGE_MESSAGE
    : [MERGE_MESSAGE, '', ...conflicts.map((slug) => `Conflict: ${slug}`)].join('\n')

const commitMerge = (
  rt: Runtime,
  paths: RepoPaths,
  parents: [string, string],
  merge: TreeMerge
): Step<string> => {
  const tree = treeOf(rt, paths, merge.files)
  if (!tree.ok) return tree
  const commit = makeCommit(rt, paths, tree.value, parents, mergeMessage(merge.conflicts))
  return commit.ok ? commit : { ok: false, error: commit.message }
}

const moveTo = (rt: Runtime, paths: RepoPaths, next: string, expected: string | null): Step<void> => {
  const moved = moveRef(rt, paths, next, expected)
  return moved.ok ? moved : { ok: false, error: moved.message }
}

const storedChanges = (rt: Runtime, paths: RepoPaths, before: string | null, after: string): StoredChange[] =>
  listSlugs(rt, paths, after).flatMap((slug) => {
    const next = readDocument(rt, paths, slug, after)
    const old = before === null ? null : textAt(rt, paths, slug, before)
    return next === null || next.text === old ? [] : [{ slug, old, next: next.text, nextBlob: next.blob }]
  })

const copyBaseText = (rt: Runtime, paths: RepoPaths, base: string | null): string | null =>
  base === null ? null : readBaseText(rt, paths, base)

const writeCopy = (rt: Runtime, paths: RepoPaths, change: StoredChange, text: string): void => {
  const written = writeWorkingCopy(rt, paths, change.slug, text, change.nextBlob)
  if (!written.ok) rt.log({ level: 'warn', event: 'sync.working-copy-unwritten', slug: change.slug, reason: written.message })
}

const refreshCopy = (rt: Runtime, paths: RepoPaths, change: StoredChange): boolean => {
  const copy = readWorkingCopy(paths, change.slug)
  if (!copy.ok || copy.value.text === null) return false
  const base = copyBaseText(rt, paths, copy.value.base) ?? change.old
  if (stripHeaderLines(copy.value.text) === stripHeaderLines(base ?? '')) {
    writeCopy(rt, paths, change, change.next)
    return false
  }
  const header = headerOf(base ?? change.next)
  const merged = threeWay(
    rt,
    paths,
    COPY_LABELS,
    { ours: copy.value.text, theirs: change.next, base: base === null ? '' : withHeader(base, header) },
    header
  )
  if (!merged.ok) {
    rt.log({ level: 'warn', event: 'sync.working-copy-unmerged', slug: change.slug, reason: merged.error })
    return false
  }
  writeCopy(rt, paths, change, merged.value.text)
  return merged.value.conflicted
}

const refreshCopies = (rt: Runtime, paths: RepoPaths, before: string | null, after: string): string[] =>
  storedChanges(rt, paths, before, after).flatMap((change) => (refreshCopy(rt, paths, change) ? [change.slug] : []))

const advance = (rt: Runtime, paths: RepoPaths, local: string | null, remote: string): Step<Brought> => {
  const moved = moveTo(rt, paths, remote, local)
  if (!moved.ok) return moved
  return { ok: true, value: { merged: true, conflicts: refreshCopies(rt, paths, local, remote), push: false } }
}

const mergeDiverged = (rt: Runtime, paths: RepoPaths, local: string, remote: string): Step<Brought> => {
  const base = mergeBaseOf(rt, paths, local, remote)
  if (!base.ok) return base
  const merge = mergeTrees(rt, paths, local, remote, base.value)
  if (!merge.ok) return merge
  const commit = commitMerge(rt, paths, [local, remote], merge.value)
  if (!commit.ok) return commit
  const moved = moveTo(rt, paths, commit.value, local)
  if (!moved.ok) return moved
  const copyConflicts = refreshCopies(rt, paths, local, commit.value)
  const conflicts = [...new Set([...merge.value.conflicts, ...copyConflicts])].sort()
  return { ok: true, value: { merged: true, conflicts, push: true } }
}

const bringIn = (rt: Runtime, paths: RepoPaths, local: string | null, remote: string | null): Step<Brought> => {
  if (remote === null || local === remote) {
    return { ok: true, value: { merged: false, conflicts: [], push: remote === null && local !== null } }
  }
  if (local === null) return advance(rt, paths, null, remote)
  const behind = isAncestor(rt, paths, local, remote)
  if (!behind.ok) return behind
  if (behind.value) return advance(rt, paths, local, remote)
  const ahead = isAncestor(rt, paths, remote, local)
  if (!ahead.ok) return ahead
  if (ahead.value) return { ok: true, value: { merged: false, conflicts: [], push: true } }
  return mergeDiverged(rt, paths, local, remote)
}

export const syncThreads = async (rt: Runtime, paths: RepoPaths): Promise<SyncResult> => {
  if (!hasOrigin(rt, paths)) return result({ error: 'no-origin' })
  const fetched = await fetchThreads(rt, paths)
  if (!fetched.ok) return result({ error: fetched.error })
  const local = threadsTip(rt, paths)
  const tips = [local, fetched.value].filter((tip): tip is string => tip !== null)
  const completed = await fetchMissing(rt, paths, tips)
  if (!completed.ok) return result({ fetched: true, error: completed.error })
  const brought = bringIn(rt, paths, local, fetched.value)
  if (!brought.ok) return result({ fetched: true, error: brought.error })
  const settled = { fetched: true, merged: brought.value.merged, conflicts: brought.value.conflicts }
  if (!brought.value.push) return result(settled)
  const pushed = await gitDetached(rt, paths.root, PUSH_ARGS)
  return pushed.code === 0
    ? result({ ...settled, pushed: true })
    : result({ ...settled, error: failureOf('push to origin', pushed) })
}
