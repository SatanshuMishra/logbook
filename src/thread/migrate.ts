import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  addItem,
  newDocument,
  oneLine,
  replaceSection,
  setStatus,
  strikeCriterion,
  tickCriterion,
  type EditResult
} from '../doc/render.ts'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { ULID_PATTERN } from '../schema/ids.ts'
import { describeError, withDetail } from '../store/detail.ts'
import { durableWrite } from '../store/durable-write.ts'
import { git, gitBuffer } from '../store/git.ts'
import { LEDGER_REF } from '../store/ref.ts'
import { checkSlug, convertedPath, type RepoPaths } from './paths.ts'
import { makeCommit, moveRef, threadsTip, writeTree } from './store.ts'

export const ARCHIVE_REF = 'refs/logbook/archive/ledger'

export type MigrationResult = { migrated: boolean; slugs: string[]; skipped: string[] }

type LedgerEntry = { path: string; object: string }

type Edit = (text: string) => EditResult

const MIGRATION_MESSAGE = 'migrate from the old ledger'
const ALIASES_FILE = 'aliases.json'
const DOCUMENT_SUFFIX = '.md'
const THREADS_FOLDER = 'threads'
const DECISIONS_FOLDER = 'decisions'
const THREAD_FILE_PATTERN = /^threads\/[^/]+\.json$/
const DECISION_FILE_PATTERN = /^decisions\/([^/]+)\.json$/
const FALLBACK_SLUG_PREFIX = 'thread-'
const WHERE_THINGS_STAND = 'Where things stand'
const CONVERTED_STANDING = 'Converted from the old ledger.'
const DONE_EVIDENCE = 'marked done in the old ledger'
const STRUCK_REASON = 'struck in the old ledger'
const ABANDONED_STATUS = 'abandoned: abandoned in the old ledger'
const MISSING_DECISION = 'decision record missing'
const OUT_OF_SCOPE_PREFIX = 'Out of scope: '
const NOT_MIGRATED: MigrationResult = { migrated: false, slugs: [], skipped: [] }

const anyList = z.array(z.unknown()).catch([])

const OldCriterion = z.object({
  id: z.string().nullable().catch(null),
  ordinal: z.number().nullable().catch(null),
  text: z.string(),
  done: z.boolean().catch(false),
  result: z.string().nullable().catch(null),
  struck_by: z.string().nullable().catch(null)
})

const OldRisk = z.object({
  text: z.string(),
  criterion_id: z.string().nullable().catch(null),
  retired: z.boolean().catch(false)
})

const OldKeyDecision = z.object({ decision_id: z.string(), title: z.string() })

const OldOutOfScope = z.object({ text: z.string() })

const OldArtifact = z.object({ label: z.string(), pointer: z.string(), retired: z.boolean().catch(false) })

const OldThread = z.object({
  id: z.string().regex(ULID_PATTERN),
  slug: z.string(),
  title: z.string(),
  created_at: z.string(),
  status: z.enum(['open', 'done', 'abandoned']),
  blocked_by: z.string().nullable(),
  completion_criteria: anyList,
  artifacts: anyList,
  spine: z.object({
    active_goal: z.string(),
    next_step: z.string(),
    landed: z.string(),
    open_risks: anyList,
    key_decisions: anyList,
    out_of_scope: anyList
  })
})

const OldDecision = z.object({ title: z.string(), outcome: z.string(), supersedes: z.array(z.string()).optional() })

type Thread = z.infer<typeof OldThread>

type Decision = z.infer<typeof OldDecision>

type Criterion = z.infer<typeof OldCriterion>

type Ledger = { threads: { file: string; thread: Thread }[]; skipped: string[]; decisions: Map<string, Decision> }

type Converted = { slug: string; file: string; thread: Thread }

type ConvertedDocument = { slug: string; text: string }

const ledgerFailure = (step: string, code: number, stderr: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: LEDGER_REF,
      accepted: 'an old ledger whose objects git can read',
      example: 'git fsck',
      retryable: false,
      message: `git ${step} failed while reading ${LEDGER_REF} for the one-time migration (exit ${code}); nothing was migrated`
    },
    stderr.trim()
  )

const refFailure = (ref: string, code: number, stderr: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: ref,
      accepted: 'a repository git update-ref can write',
      example: 'git fsck',
      retryable: true,
      message: `git update-ref failed for ${ref} during the one-time migration (exit ${code}); nothing was migrated`
    },
    stderr.trim()
  )

const treeFailure = (error: unknown): Refusal => ({
  ok: false,
  field: 'refs/logbook/threads',
  accepted: 'a repository whose object store git can write',
  example: 'git fsck',
  retryable: false,
  message: `the converted documents could not be written to the object store: ${describeError(error)}; nothing was migrated`
})

const resolveRef = (rt: Runtime, paths: RepoPaths, ref: string): string | null => {
  const result = git(rt, paths.root, ['rev-parse', '--verify', '--quiet', ref])
  return result.ok ? result.stdout.trim() : null
}

const parseTreeEntries = (stdout: string): LedgerEntry[] =>
  stdout
    .split('\0')
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const tab = record.indexOf('\t')
      if (tab < 0) return []
      const [, type, object] = record.slice(0, tab).split(' ')
      return type === 'blob' && object !== undefined ? [{ path: record.slice(tab + 1), object }] : []
    })

const listLedger = (rt: Runtime, paths: RepoPaths, tip: string): Ok<LedgerEntry[]> | Refusal => {
  const result = git(rt, paths.root, ['ls-tree', '-r', '-z', tip, '--', THREADS_FOLDER, DECISIONS_FOLDER])
  return result.ok
    ? { ok: true, value: parseTreeEntries(result.stdout) }
    : ledgerFailure('ls-tree', result.code, result.stderr)
}

const parseBatch = (stdout: Buffer): Map<string, string> => {
  const found: [string, string][] = []
  let offset = 0
  while (offset < stdout.length) {
    const headerEnd = stdout.indexOf(0x0a, offset)
    if (headerEnd < 0) break
    const [object, type, size] = stdout.subarray(offset, headerEnd).toString('utf8').split(' ')
    const start = headerEnd + 1
    if (object === undefined || type === undefined || size === undefined) {
      offset = start
      continue
    }
    const length = Number(size)
    if (!Number.isSafeInteger(length) || start + length > stdout.length) break
    if (type === 'blob') found.push([object, stdout.subarray(start, start + length).toString('utf8')])
    offset = start + length + 1
  }
  return new Map(found)
}

const readBlobs = (rt: Runtime, paths: RepoPaths, objects: readonly string[]): Ok<Map<string, string>> | Refusal => {
  if (objects.length === 0) return { ok: true, value: new Map() }
  const stdin = objects.map((object) => `${object}\n`).join('')
  const result = gitBuffer(rt, paths.root, ['cat-file', '--batch'], { stdin })
  if (!result.ok) return ledgerFailure('cat-file', result.overflow ? -1 : result.code, result.stderr)
  return { ok: true, value: parseBatch(result.stdout) }
}

const parseJson = (text: string): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch {
    return { ok: false }
  }
}

const parseWith = <T>(schema: z.ZodType<T>, text: string | undefined): T | null => {
  if (text === undefined) return null
  const json = parseJson(text)
  if (!json.ok) return null
  const parsed = schema.safeParse(json.value)
  return parsed.success ? parsed.data : null
}

const entriesOf = <T>(schema: z.ZodType<T>, entries: readonly unknown[]): T[] =>
  entries.flatMap((entry) => {
    const parsed = schema.safeParse(entry)
    return parsed.success ? [parsed.data] : []
  })

const readLedger = (rt: Runtime, paths: RepoPaths, tip: string): Ok<Ledger> | Refusal => {
  const listed = listLedger(rt, paths, tip)
  if (!listed.ok) return listed
  const threadEntries = listed.value.filter((entry) => THREAD_FILE_PATTERN.test(entry.path))
  const decisionEntries = listed.value.filter((entry) => DECISION_FILE_PATTERN.test(entry.path))
  const objects = [...new Set([...threadEntries, ...decisionEntries].map((entry) => entry.object))]
  const blobs = readBlobs(rt, paths, objects)
  if (!blobs.ok) return blobs
  const threads = threadEntries.map((entry) => ({
    file: entry.path,
    thread: parseWith(OldThread, blobs.value.get(entry.object))
  }))
  const decisions = decisionEntries.flatMap((entry): [string, Decision][] => {
    const id = DECISION_FILE_PATTERN.exec(entry.path)?.[1]
    const decision = parseWith(OldDecision, blobs.value.get(entry.object))
    return id === undefined || decision === null ? [] : [[id, decision]]
  })
  return {
    ok: true,
    value: {
      threads: threads.flatMap((entry) => (entry.thread === null ? [] : [{ file: entry.file, thread: entry.thread }])),
      skipped: threads.flatMap((entry) => (entry.thread === null ? [entry.file] : [])),
      decisions: new Map(decisions)
    }
  }
}

const supersededIds = (decisions: ReadonlyMap<string, Decision>): Set<string> =>
  new Set(
    [...decisions.entries()].flatMap(([id, decision]) => (decision.supersedes ?? []).filter((other) => other !== id))
  )

const byCreation = (left: { file: string; thread: Thread }, right: { file: string; thread: Thread }): number => {
  const keys: [string, string][] = [
    [left.thread.created_at, right.thread.created_at],
    [left.thread.id, right.thread.id],
    [left.file, right.file]
  ]
  const differing = keys.find(([a, b]) => a !== b)
  return differing === undefined ? 0 : differing[0] < differing[1] ? -1 : 1
}

const fallbackSlug = (thread: Thread): string => `${FALLBACK_SLUG_PREFIX}${thread.id.toLowerCase()}`

const suffixed = (base: string, n: number): string => (n === 1 ? base : `${base}-${n}`)

const freeSlug = (base: string, fallback: string, taken: ReadonlySet<string>): string => {
  for (let n = 1; ; n += 1) {
    const candidate = suffixed(base, n)
    if (checkSlug('slug', candidate) !== null) return freeSlug(fallback, fallback, taken)
    if (!taken.has(candidate)) return candidate
  }
}

const assignSlugs = (threads: readonly { file: string; thread: Thread }[]): Converted[] =>
  [...threads].sort(byCreation).reduce<{ converted: Converted[]; taken: ReadonlySet<string> }>(
    (state, entry) => {
      const fallback = fallbackSlug(entry.thread)
      const base = checkSlug('slug', entry.thread.slug) === null ? entry.thread.slug : fallback
      const slug = freeSlug(base, fallback, state.taken)
      return { converted: [...state.converted, { slug, ...entry }], taken: new Set([...state.taken, slug]) }
    },
    { converted: [], taken: new Set() }
  ).converted

const statusOf = (thread: Thread): string => {
  if (thread.status === 'done') return 'done'
  if (thread.status === 'abandoned') return ABANDONED_STATUS
  return thread.blocked_by !== null && oneLine(thread.blocked_by) !== '' ? `blocked: ${thread.blocked_by}` : 'active'
}

const rankOf = ({ ordinal }: Criterion): number => ordinal ?? Number.POSITIVE_INFINITY

const inOrdinalOrder = (criteria: readonly Criterion[]): Criterion[] =>
  criteria
    .map((criterion, index) => ({ criterion, index, rank: rankOf(criterion) }))
    .sort((left, right) =>
      left.rank === right.rank ? left.index - right.index : left.rank < right.rank ? -1 : 1
    )
    .map((entry) => entry.criterion)

const criterionNumbers = (criteria: readonly Criterion[]): Map<string, number> =>
  new Map(
    criteria
      .flatMap((criterion, index): [string, number][] => (criterion.id === null ? [] : [[criterion.id, index + 1]]))
      .reverse()
  )

const filled = (text: string | null): string | null => (text === null || oneLine(text) === '' ? null : text)

const criterionEdit = (criterion: Criterion, number: number): Edit[] => {
  const id = `c${number}`
  if (criterion.struck_by !== null) return [(text) => strikeCriterion(text, id, STRUCK_REASON)]
  if (criterion.done) return [(text) => tickCriterion(text, id, filled(criterion.result) ?? DONE_EVIDENCE)]
  return []
}

const decisionLine = (
  keyDecision: z.infer<typeof OldKeyDecision>,
  decisions: ReadonlyMap<string, Decision>
): string => {
  const decision = decisions.get(keyDecision.decision_id)
  return decision === undefined
    ? `${keyDecision.title}: ${MISSING_DECISION}`
    : `${decision.title}: ${decision.outcome}`
}

const applyEdits = (text: string, edits: readonly Edit[]): EditResult =>
  edits.reduce<EditResult>((current, edit) => (current.ok ? edit(current.text) : current), {
    ok: true,
    text,
    id: null,
    noteLine: null
  })

const convertThread = (
  entry: Converted,
  decisions: ReadonlyMap<string, Decision>,
  superseded: ReadonlySet<string>,
  now: string
): EditResult => {
  const { thread, slug } = entry
  const criteria = inOrdinalOrder(entriesOf(OldCriterion, thread.completion_criteria))
  const numbers = criterionNumbers(criteria)
  const artifacts = entriesOf(OldArtifact, thread.artifacts).filter((artifact) => !artifact.retired)
  const risks = entriesOf(OldRisk, thread.spine.open_risks).filter((risk) => !risk.retired)
  const keyDecisions = entriesOf(OldKeyDecision, thread.spine.key_decisions).filter(
    (keyDecision) => !superseded.has(keyDecision.decision_id)
  )
  const outOfScope = entriesOf(OldOutOfScope, thread.spine.out_of_scope)
  const initial = newDocument({
    slug,
    title: thread.title,
    goal: thread.spine.active_goal,
    nextStep: thread.spine.next_step,
    criteria: criteria.map((criterion) => criterion.text),
    details: [
      ...artifacts.map((artifact) => `${artifact.label}: ${artifact.pointer}`),
      `Old ledger record: thread ${thread.id} in ${ARCHIVE_REF}`
    ],
    now
  })
  const bearsOn = (criterionId: string | null): string => {
    const number = criterionId === null ? undefined : numbers.get(criterionId)
    return number === undefined ? '' : ` Bears on c${number}.`
  }
  return applyEdits(initial, [
    (text) => setStatus(text, statusOf(thread)),
    ...criteria.flatMap((criterion, index) => criterionEdit(criterion, index + 1)),
    (text) => replaceSection(text, WHERE_THINGS_STAND, [filled(thread.spine.landed) ?? CONVERTED_STANDING]),
    ...keyDecisions.map((keyDecision): Edit => (text) => addItem(text, 'D', decisionLine(keyDecision, decisions))),
    ...risks.map((risk): Edit => (text) => addItem(text, 'R', `${oneLine(risk.text)}${bearsOn(risk.criterion_id)}`)),
    ...outOfScope.map((item): Edit => (text) => addItem(text, 'S', `${OUT_OF_SCOPE_PREFIX}${item.text}`))
  ])
}

const aliasesText = (converted: readonly Converted[]): string => {
  const firsts = converted.filter(
    (entry, index) => converted.findIndex((other) => other.thread.id === entry.thread.id) === index
  )
  return `${JSON.stringify(Object.fromEntries(firsts.map((entry) => [entry.thread.id, entry.slug])), null, 2)}\n`
}

const buildTree = (
  rt: Runtime,
  paths: RepoPaths,
  documents: readonly ConvertedDocument[],
  aliases: string
): Ok<string> | Refusal => {
  const files = Object.fromEntries([
    ...documents.map((document): [string, string] => [`${document.slug}${DOCUMENT_SUFFIX}`, document.text]),
    [ALIASES_FILE, aliases]
  ])
  try {
    return { ok: true, value: writeTree(rt, paths, files) }
  } catch (error) {
    return treeFailure(error)
  }
}

const writeMark = (rt: Runtime, paths: RepoPaths, slug: string): void => {
  const target = convertedPath(paths, slug)
  if (!target.ok) return
  try {
    mkdirSync(path.dirname(target.value), { recursive: true })
    durableWrite(target.value, '', { log: rt.log })
  } catch (error) {
    rt.log({ level: 'warn', event: 'migrate.converted-mark-unwritten', slug, reason: describeError(error) })
  }
}

const convertAll = (
  rt: Runtime,
  ledger: Ledger,
  now: string
): { documents: ConvertedDocument[]; converted: Converted[]; skipped: string[] } => {
  const superseded = supersededIds(ledger.decisions)
  const results = assignSlugs(ledger.threads).map((entry) => ({
    entry,
    result: convertThread(entry, ledger.decisions, superseded, now)
  }))
  const failed = results.flatMap(({ entry, result }) =>
    result.ok ? [] : [{ entry, reason: `${result.id}: ${result.message}` }]
  )
  failed.forEach(({ entry, reason }) =>
    rt.log({ level: 'warn', event: 'migrate.thread-unconverted', file: entry.file, reason })
  )
  return {
    documents: results.flatMap(({ entry, result }) => (result.ok ? [{ slug: entry.slug, text: result.text }] : [])),
    converted: results.flatMap(({ entry, result }) => (result.ok ? [entry] : [])),
    skipped: [...ledger.skipped, ...failed.map(({ entry }) => entry.file)]
  }
}

export const migrateIfNeeded = (rt: Runtime, paths: RepoPaths): Ok<MigrationResult> | Refusal => {
  const ledgerTip = resolveRef(rt, paths, LEDGER_REF)
  if (ledgerTip === null || threadsTip(rt, paths) !== null) return { ok: true, value: NOT_MIGRATED }
  const ledger = readLedger(rt, paths, ledgerTip)
  if (!ledger.ok) return ledger
  const { documents, converted, skipped } = convertAll(rt, ledger.value, rt.now())
  const tree = buildTree(rt, paths, documents, aliasesText(converted))
  if (!tree.ok) return tree
  const commit = makeCommit(rt, paths, tree.value, [], MIGRATION_MESSAGE)
  if (!commit.ok) return commit
  const archived = git(rt, paths.root, ['update-ref', ARCHIVE_REF, ledgerTip])
  if (!archived.ok) return refFailure(ARCHIVE_REF, archived.code, archived.stderr)
  const moved = moveRef(rt, paths, commit.value, null)
  if (!moved.ok) {
    if (moved.cause === 'ref-moved') return { ok: true, value: NOT_MIGRATED }
    return moved
  }
  documents.forEach((document) => writeMark(rt, paths, document.slug))
  rt.log({ level: 'info', event: 'migrate.converted', threads: documents.length, skipped: skipped.length })
  return { ok: true, value: { migrated: true, slugs: documents.map((document) => document.slug), skipped } }
}
