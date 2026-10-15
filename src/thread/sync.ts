import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { formatNextIds, highestIds, parseDocument, stripHeaderLines, type NextIds } from '../doc/document.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { durableWrite } from '../store/durable-write.ts'
import { git, gitRun, gitTimed, type GitRun } from '../store/git.ts'
import { workingCopyPath, type RepoPaths } from './paths.ts'
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

export type SyncResult = { fetched: boolean; merged: boolean; conflicts: string[]; pushed: boolean; error: string | null }

export const FETCH_TIMEOUT_MS = 15000

type Step<T> = { ok: true; value: T } | { ok: false; error: string }

type Header = { updated: string | null; nextIds: NextIds | null }

type Merged = { text: string; conflicted: boolean }

type Chosen = { text: string | null; conflicted: boolean }

type Brought = { merged: boolean; conflicts: string[]; push: boolean }

type TreeMerge = { files: Record<string, string>; conflicts: string[] }

type StoredChange = { slug: string; old: string | null; next: string }

const REMOTE_THREADS_REF = 'refs/logbook/remotes/origin/threads'
const FETCH_ARGS = [
  'fetch',
  '--no-tags',
  '--no-write-fetch-head',
  '--no-auto-maintenance',
  'origin',
  `+${THREADS_REF}:${REMOTE_THREADS_REF}`
]
const PUSH_ARGS = ['push', 'origin', `${THREADS_REF}:${THREADS_REF}`]
const MISSING_REMOTE_REF = /couldn't find remote ref/
const ALIASES_FILE = 'aliases.json'
const DOCUMENT_SUFFIX = '.md'
const UPDATED_PREFIX = 'Updated: '
const STORED_LABELS = ['local', 'base', 'origin'] as const
const COPY_LABELS = ['working copy', 'stored before sync', 'stored after sync'] as const
const MERGE_MESSAGE = 'sync: merge the threads of origin'
const HIGHEST_CONFLICT_EXIT = 127

const result = (fields: Partial<SyncResult>): SyncResult => ({
  fetched: false,
  merged: false,
  conflicts: [],
  pushed: false,
  error: null,
  ...fields
})

const failureOf = (step: string, run: GitRun): string => {
  const detail = run.stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join(' ')
  return `${step} failed: ${detail === '' ? `git exited with code ${run.code}` : detail}`
}

const hasOrigin = (rt: Runtime, paths: RepoPaths): boolean => {
  const origin = git(rt, paths.root, ['config', '--get', 'remote.origin.url'])
  return origin.ok && origin.stdout.trim() !== ''
}

const remoteTip = (rt: Runtime, paths: RepoPaths): string | null => {
  const found = git(rt, paths.root, ['rev-parse', '--verify', '--quiet', REMOTE_THREADS_REF])
  return found.ok ? found.stdout.trim() : null
}

const fetchThreads = async (rt: Runtime, paths: RepoPaths, timeoutMs: number): Promise<Step<string | null>> => {
  const run = await gitTimed(rt, paths.root, FETCH_ARGS, { timeoutMs })
  if (run.code === 0) return { ok: true, value: remoteTip(rt, paths) }
  if (MISSING_REMOTE_REF.test(run.stderr)) return { ok: true, value: null }
  return { ok: false, error: failureOf('fetch from origin', run) }
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

const headerOf = (text: string): Header => {
  const parsed = parseDocument(text)
  return { updated: parsed.updated, nextIds: parsed.nextIds }
}

const headerLines = (header: Header): string[] => [
  ...(header.updated === null ? [] : [`${UPDATED_PREFIX}${header.updated}`]),
  ...(header.nextIds === null ? [] : [formatNextIds(header.nextIds)])
]

const headerEnd = (lines: readonly string[]): number => {
  const parsed = parseDocument(lines.join('\n'))
  const firstHeading = parsed.sections[0]?.line ?? parsed.noteLine ?? lines.length + 1
  return lines
    .slice(0, firstHeading - 1)
    .reduce((end, line, index) => (line.trim() === '' ? end : index + 1), 0)
}

const withHeader = (text: string, header: Header): string => {
  const lines = stripHeaderLines(text).split('\n')
  const at = headerEnd(lines)
  return [...lines.slice(0, at), ...headerLines(header), ...lines.slice(at)].join('\n')
}

const idsOf = (text: string): NextIds => parseDocument(text).nextIds ?? highestIds(text)

const larger = (left: NextIds, right: NextIds): NextIds => ({
  c: Math.max(left.c, right.c),
  D: Math.max(left.D, right.D),
  R: Math.max(left.R, right.R),
  S: Math.max(left.S, right.S)
})

const mergeFile = (
  rt: Runtime,
  paths: RepoPaths,
  labels: readonly string[],
  versions: readonly [string, string, string]
): Step<Merged> => {
  mkdirSync(paths.logbookDir, { recursive: true })
  const dir = mkdtempSync(path.join(paths.logbookDir, 'sync-'))
  try {
    const files = versions.map((text, index) => {
      const file = path.join(dir, `version-${index}`)
      durableWrite(file, text, { log: rt.log })
      return file
    })
    const run = gitRun(rt, paths.root, ['merge-file', '-p', ...labels.flatMap((label) => ['-L', label]), ...files])
    if (run.code === 0) return { ok: true, value: { text: run.stdout, conflicted: false } }
    if (run.code > 0 && run.code <= HIGHEST_CONFLICT_EXIT) return { ok: true, value: { text: run.stdout, conflicted: true } }
    return { ok: false, error: failureOf('merge-file', run) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const kept = (text: string | null): Step<Chosen> => ({ ok: true, value: { text, conflicted: false } })

const threeWay = (
  rt: Runtime,
  paths: RepoPaths,
  sides: { ours: string; theirs: string; base: string },
  header: Header
): Step<Chosen> => {
  const merged = mergeFile(rt, paths, STORED_LABELS, [
    withHeader(sides.ours, header),
    sides.base,
    withHeader(sides.theirs, header)
  ])
  if (!merged.ok) return merged
  const settled = withHeader(merged.value.text, {
    updated: rt.now(),
    nextIds: larger(idsOf(sides.ours), idsOf(sides.theirs))
  })
  return { ok: true, value: { text: settled, conflicted: merged.value.conflicted } }
}

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
  return threeWay(rt, paths, { ours, theirs, base: withHeader(base ?? '', header) }, header)
}

const mergeUnrelated = (rt: Runtime, paths: RepoPaths, ours: string | null, theirs: string | null): Step<Chosen> => {
  if (ours === null || theirs === null) return kept(ours ?? theirs)
  if (stripHeaderLines(ours) === stripHeaderLines(theirs)) return kept(ours)
  return threeWay(rt, paths, { ours, theirs, base: '' }, headerOf(ours))
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

const readCopy = (file: string): string | null => {
  try {
    return statSync(file).isFile() ? readFileSync(file, 'utf8') : null
  } catch {
    return null
  }
}

const writeCopy = (rt: Runtime, file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  durableWrite(file, text, { log: rt.log })
}

const storedChanges = (rt: Runtime, paths: RepoPaths, before: string | null, after: string): StoredChange[] =>
  listSlugs(rt, paths, after).flatMap((slug) => {
    const next = textAt(rt, paths, slug, after)
    const old = before === null ? null : textAt(rt, paths, slug, before)
    return next === null || next === old ? [] : [{ slug, old, next }]
  })

const refreshCopy = (rt: Runtime, paths: RepoPaths, change: StoredChange): boolean => {
  const file = workingCopyPath(paths, change.slug)
  if (!file.ok) return false
  const copy = readCopy(file.value)
  if (copy === null) return false
  if (stripHeaderLines(copy) === stripHeaderLines(change.old ?? '')) {
    writeCopy(rt, file.value, change.next)
    return false
  }
  const header = headerOf(change.old ?? change.next)
  const merged = mergeFile(rt, paths, COPY_LABELS, [
    withHeader(copy, header),
    change.old === null ? '' : withHeader(change.old, header),
    withHeader(change.next, headerOf(change.next))
  ])
  if (!merged.ok) {
    rt.log({ level: 'warn', event: 'sync.working-copy-unmerged', slug: change.slug, reason: merged.error })
    return false
  }
  writeCopy(rt, file.value, merged.value.text)
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

export const syncThreads = async (
  rt: Runtime,
  paths: RepoPaths,
  opts: { timeoutMs?: number } = {}
): Promise<SyncResult> => {
  if (!hasOrigin(rt, paths)) return result({ error: 'no-origin' })
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS
  const fetched = await fetchThreads(rt, paths, timeoutMs)
  if (!fetched.ok) return result({ error: fetched.error })
  const brought = bringIn(rt, paths, threadsTip(rt, paths), fetched.value)
  if (!brought.ok) return result({ fetched: true, error: brought.error })
  const settled = { fetched: true, merged: brought.value.merged, conflicts: brought.value.conflicts }
  if (!brought.value.push) return result(settled)
  const pushed = await gitTimed(rt, paths.root, PUSH_ARGS, { timeoutMs })
  return pushed.code === 0
    ? result({ ...settled, pushed: true })
    : result({ ...settled, error: failureOf('push to origin', pushed) })
}
