import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { ULID_PATTERN } from '../schema/ids.ts'
import { withDetail } from '../store/detail.ts'
import { git, gitBuffer, readIdentity, type Identity } from '../store/git.ts'
import { casUpdateRef, type CasFailure } from '../store/ref.ts'
import { THREAD_SLUG_PATTERN, checkSlug, type RepoPaths } from './paths.ts'

export const THREADS_REF = 'refs/logbook/threads'

export type StoredDocument = { slug: string; text: string; blob: string }

export type CommitChange = { slug: string; text: string; expectedBlob: string | null }

export type ThreadMoved = { ok: false; cause: 'thread-moved'; slug: string }

export type CommitInput = {
  changes: CommitChange[]
  message: string
  aliases?: Record<string, string>
  beforeCas?: () => void
}

type TreeEntry = { mode: string; type: string; object: string; name: string }

const ALIASES_FILE = 'aliases.json'
const DOCUMENT_SUFFIX = '.md'
const BLOB_MODE = '100644'
const MAX_RETRIES = 10
const SAFE_REVISION = /^[^\s:-][^\s:]*$/

const documentName = (slug: string): string => `${slug}${DOCUMENT_SUFFIX}`

const gitFailure = (step: string, code: number, stderr: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: THREADS_REF,
      accepted: 'a repository whose object store git can read and write',
      example: 'git fsck',
      retryable: false,
      message: `git ${step} failed while committing to ${THREADS_REF} (exit ${code}); nothing was committed`
    },
    stderr.trim()
  )

const keptMoving = (): Refusal => ({
  ok: false,
  field: THREADS_REF,
  accepted: `a ${THREADS_REF} that stays still between reading its tip and moving it`,
  example: 'call the tool again',
  retryable: true,
  message: `${THREADS_REF} kept moving: another commit landed first on each of ${MAX_RETRIES + 1} attempts, so nothing was committed`
})

const unknownThread = (threadId: string): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'the slug of a thread, or an old thread id listed in aliases.json',
  example: 'fix-login',
  retryable: true,
  message: `no thread is named ${JSON.stringify(threadId)}; call list_threads to see each thread's slug`
})

export const threadsTip = (rt: Runtime, paths: RepoPaths): string | null => {
  const result = git(rt, paths.root, ['rev-parse', '--verify', '--quiet', THREADS_REF])
  return result.ok ? result.stdout.trim() : null
}

const tipOrCurrent = (rt: Runtime, paths: RepoPaths, tip: string | null | undefined): string | null =>
  tip === undefined ? threadsTip(rt, paths) : tip

const readBlob = (rt: Runtime, paths: RepoPaths, tip: string, name: string): { blob: string; text: string } | null => {
  if (!SAFE_REVISION.test(tip)) return null
  const result = gitBuffer(rt, paths.root, ['cat-file', '--batch'], { stdin: `${tip}:${name}\n` })
  if (!result.ok) return null
  const headerEnd = result.stdout.indexOf(0x0a)
  if (headerEnd < 0) return null
  const [object, type, size, ...rest] = result.stdout.subarray(0, headerEnd).toString('utf8').split(' ')
  if (object === undefined || type !== 'blob' || size === undefined || rest.length > 0) return null
  const length = Number(size)
  const start = headerEnd + 1
  if (!Number.isSafeInteger(length) || start + length > result.stdout.length) return null
  return { blob: object, text: result.stdout.subarray(start, start + length).toString('utf8') }
}

const parseTree = (stdout: string): TreeEntry[] =>
  stdout
    .split('\0')
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const tab = record.indexOf('\t')
      if (tab < 0) return []
      const [mode, type, object] = record.slice(0, tab).split(' ')
      return mode === undefined || type === undefined || object === undefined
        ? []
        : [{ mode, type, object, name: record.slice(tab + 1) }]
    })

const listTree = (rt: Runtime, paths: RepoPaths, tip: string): Ok<TreeEntry[]> | Refusal => {
  if (!SAFE_REVISION.test(tip)) return gitFailure('ls-tree', -1, `${JSON.stringify(tip)} is not a revision`)
  const result = git(rt, paths.root, ['ls-tree', '-z', tip])
  return result.ok ? { ok: true, value: parseTree(result.stdout) } : gitFailure('ls-tree', result.code, result.stderr)
}

const blobNamed = (entries: TreeEntry[], name: string): string | null =>
  entries.find((entry) => entry.name === name && entry.type === 'blob')?.object ?? null

export const readDocument = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  tip?: string | null
): StoredDocument | null => {
  if (!THREAD_SLUG_PATTERN.test(slug)) return null
  const at = tipOrCurrent(rt, paths, tip)
  if (at === null) return null
  const found = readBlob(rt, paths, at, documentName(slug))
  return found === null ? null : { slug, text: found.text, blob: found.blob }
}

export const listSlugs = (rt: Runtime, paths: RepoPaths, tip?: string | null): string[] => {
  const at = tipOrCurrent(rt, paths, tip)
  if (at === null) return []
  const entries = listTree(rt, paths, at)
  if (!entries.ok) return []
  return entries.value
    .filter((entry) => entry.type === 'blob' && entry.name.endsWith(DOCUMENT_SUFFIX))
    .map((entry) => entry.name.slice(0, -DOCUMENT_SUFFIX.length))
    .filter((slug) => THREAD_SLUG_PATTERN.test(slug))
}

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isAliasEntry = (entry: [string, unknown]): entry is [string, string] =>
  ULID_PATTERN.test(entry[0]) && typeof entry[1] === 'string' && THREAD_SLUG_PATTERN.test(entry[1])

const parseAliases = (text: string): Record<string, string> => {
  const parsed = parseJson(text)
  if (!parsed.ok || !isPlainObject(parsed.value)) return {}
  return Object.fromEntries(Object.entries(parsed.value).filter(isAliasEntry))
}

export const readAliases = (rt: Runtime, paths: RepoPaths, tip?: string | null): Record<string, string> => {
  const at = tipOrCurrent(rt, paths, tip)
  if (at === null) return {}
  const found = readBlob(rt, paths, at, ALIASES_FILE)
  return found === null ? {} : parseAliases(found.text)
}

export const resolveThreadId = (rt: Runtime, paths: RepoPaths, threadId: string): Ok<string> | Refusal => {
  const tip = threadsTip(rt, paths)
  if (tip === null) return unknownThread(threadId)
  if (readDocument(rt, paths, threadId, tip) !== null) return { ok: true, value: threadId }
  if (!ULID_PATTERN.test(threadId)) return unknownThread(threadId)
  const aliases = readAliases(rt, paths, tip)
  const slug = Object.hasOwn(aliases, threadId) ? aliases[threadId] : undefined
  return slug === undefined ? unknownThread(threadId) : { ok: true, value: slug }
}

const hashBlob = (rt: Runtime, paths: RepoPaths, text: string): Ok<string> | Refusal => {
  const result = git(rt, paths.root, ['hash-object', '-w', '--stdin'], { stdin: text })
  return result.ok ? { ok: true, value: result.stdout.trim() } : gitFailure('hash-object', result.code, result.stderr)
}

const mktree = (rt: Runtime, paths: RepoPaths, entries: TreeEntry[]): Ok<string> | Refusal => {
  const input = entries.map((entry) => `${entry.mode} ${entry.type} ${entry.object}\t${entry.name}\0`).join('')
  const result = git(rt, paths.root, ['mktree', '-z'], { stdin: input })
  return result.ok ? { ok: true, value: result.stdout.trim() } : gitFailure('mktree', result.code, result.stderr)
}

const blobEntry = (name: string, object: string): TreeEntry => ({ mode: BLOB_MODE, type: 'blob', object, name })

const hashFiles = (rt: Runtime, paths: RepoPaths, files: [string, string][]): Ok<TreeEntry[]> | Refusal =>
  files.reduce<Ok<TreeEntry[]> | Refusal>(
    (hashed, [name, text]) => {
      if (!hashed.ok) return hashed
      const blob = hashBlob(rt, paths, text)
      return blob.ok ? { ok: true, value: [...hashed.value, blobEntry(name, blob.value)] } : blob
    },
    { ok: true, value: [] }
  )

export const writeTree = (rt: Runtime, paths: RepoPaths, files: Record<string, string>): string => {
  const entries = hashFiles(rt, paths, Object.entries(files))
  if (!entries.ok) throw new Error(entries.message)
  const tree = mktree(rt, paths, entries.value)
  if (!tree.ok) throw new Error(tree.message)
  return tree.value
}

const commitMessageInput = (message: string): string =>
  message.length === 0 || message.endsWith('\n') ? message : `${message}\n`

const commitTree = (
  rt: Runtime,
  paths: RepoPaths,
  identity: Identity,
  tree: string,
  parents: string[],
  message: string
): Ok<string> | Refusal => {
  const args = ['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent])]
  const result = git(rt, paths.root, args, { identity, stdin: commitMessageInput(message) })
  return result.ok ? { ok: true, value: result.stdout.trim() } : gitFailure('commit-tree', result.code, result.stderr)
}

export const makeCommit = (
  rt: Runtime,
  paths: RepoPaths,
  tree: string,
  parents: string[],
  message: string
): Ok<string> | Refusal => {
  const identity = readIdentity(rt, paths.root)
  return identity.ok ? commitTree(rt, paths, identity.value, tree, parents, message) : identity
}

export const moveRef = (rt: Runtime, paths: RepoPaths, next: string, expected: string | null): Ok<void> | CasFailure =>
  casUpdateRef(rt, paths.root, THREADS_REF, next, expected)

const aliasesFile = (aliases: Record<string, string> | undefined): [string, string][] =>
  aliases === undefined ? [] : [[ALIASES_FILE, `${JSON.stringify(aliases, null, 2)}\n`]]

const changedFiles = (input: CommitInput): [string, string][] => [
  ...input.changes.map((change): [string, string] => [documentName(change.slug), change.text]),
  ...aliasesFile(input.aliases)
]

const withEntries = (base: TreeEntry[], replacements: TreeEntry[]): TreeEntry[] => {
  const replaced = new Set(replacements.map((entry) => entry.name))
  return [...base.filter((entry) => !replaced.has(entry.name)), ...replacements]
}

export const commitDocuments = (
  rt: Runtime,
  paths: RepoPaths,
  input: CommitInput
): Ok<{ commit: string }> | Refusal | ThreadMoved => {
  const badSlug = input.changes
    .map((change) => checkSlug('slug', change.slug))
    .find((refusal): refusal is Refusal => refusal !== null)
  if (badSlug !== undefined) return badSlug
  const identity = readIdentity(rt, paths.root)
  if (!identity.ok) return identity
  const replacements = hashFiles(rt, paths, changedFiles(input))
  if (!replacements.ok) return replacements
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const tip = threadsTip(rt, paths)
    const base: Ok<TreeEntry[]> | Refusal = tip === null ? { ok: true, value: [] } : listTree(rt, paths, tip)
    if (!base.ok) return base
    const moved = input.changes.find((change) => blobNamed(base.value, documentName(change.slug)) !== change.expectedBlob)
    if (moved !== undefined) return { ok: false, cause: 'thread-moved', slug: moved.slug }
    const tree = mktree(rt, paths, withEntries(base.value, replacements.value))
    if (!tree.ok) return tree
    const commit = commitTree(rt, paths, identity.value, tree.value, tip === null ? [] : [tip], input.message)
    if (!commit.ok) return commit
    input.beforeCas?.()
    const cas = moveRef(rt, paths, commit.value, tip)
    if (cas.ok) return { ok: true, value: { commit: commit.value } }
    if (cas.cause !== 'ref-moved') return cas
  }
  return keptMoving()
}
