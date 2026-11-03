import { mkdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { itemChanges } from '../doc/changes.ts'
import { checkVersion, formatViolation, removedIds, type Violation } from '../doc/check.ts'
import {
  NOTE_HEADING,
  commitMessage,
  highestIds,
  normaliseDocument,
  parseDocument,
  stripHeaderLines,
  type NextIds
} from '../doc/document.ts'
import { recordEvent } from '../metrics/record.ts'
import type { Runtime, Writer } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { durableWrite } from '../store/durable-write.ts'
import { git, startBackgroundPush } from '../store/git.ts'
import { foldHold, readHold } from './holds.ts'
import { sweepMarkers } from './inflight.ts'
import { workingCopyPath, type RepoPaths } from './paths.ts'
import { commitDocuments, readDocument, type StoredDocument, type ThreadMoved } from './store.ts'

type ChildProcess = ReturnType<typeof startBackgroundPush>

export type ReconcileResult =
  | { kind: 'materialised' }
  | { kind: 'unchanged' }
  | { kind: 'accepted'; commit: string; removed: string[]; push: ChildProcess | null }
  | { kind: 'refused'; violations: Violation[] }

export type ToolChange = (
  text: string
) =>
  | { ok: true; text: string; summary: string; details: string[]; noteLines: string[] }
  | { ok: false; refusal: Refusal }

export type ToolChangeInput = { tool: string; change: ToolChange; beforeCas?: () => void }

export type ToolChangeResult = { commit: string; text: string; removed: string[]; push: ChildProcess | null }

export const PUSH_TIMEOUT_MS = 15000

type Accepted = { commit: string; text: string; removed: string[] }

type Settled =
  | { kind: 'materialised' }
  | { kind: 'unchanged' }
  | { kind: 'refused'; violations: Violation[] }
  | ({ kind: 'accepted' } & Accepted)

type Version = { text: string; message: string; via: string; beforeCas: (() => void) | undefined }

const unknownThread = (slug: string): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: 'the slug of a thread with a stored document',
  example: 'fix-login',
  retryable: true,
  message: `no thread is named ${JSON.stringify(slug)}; call list_threads to see each thread's slug`
})

const notAFile = (file: string): Refusal => ({
  ok: false,
  field: 'working_copy',
  accepted: 'a readable file at the working copy path, or nothing there',
  example: file,
  retryable: true,
  message: `the working copy ${file} is not a readable file, so nothing was committed; move whatever is at that path aside so logbook can write the document there again`
})

export const violationsRefusal = (file: string, violations: Violation[]): Refusal => ({
  ok: false,
  field: 'document',
  accepted: "a document that passes logbook's checks",
  example: '- [x] c1 The page loads evidence: the login test passed',
  retryable: true,
  message: [
    `the document ${file} does not pass logbook's checks, so nothing was committed; fix these:`,
    ...violations.map(formatViolation)
  ].join('\n')
})

const isThreadMoved = <T>(result: Ok<T> | Refusal | ThreadMoved): result is ThreadMoved =>
  !result.ok && 'cause' in result && result.cause === 'thread-moved'

const untilSettled = <T>(attempt: () => Ok<T> | Refusal | ThreadMoved): Ok<T> | Refusal => {
  for (;;) {
    const result = attempt()
    if (!isThreadMoved(result)) return result
  }
}

const readWorkingCopy = (file: string): Ok<string | null> | Refusal => {
  try {
    if (!statSync(file).isFile()) return notAFile(file)
    return { ok: true, value: readFileSync(file, 'utf8') }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? { ok: true, value: null } : notAFile(file)
  }
}

const writeWorkingCopy = (rt: Runtime, file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  durableWrite(file, text, { log: rt.log })
}

const previousNextIds = (text: string): NextIds => parseDocument(text).nextIds ?? highestIds(text)

const settleHold = (rt: Runtime, paths: RepoPaths, slug: string, acceptedAt: string): void => {
  const hold = readHold(paths, slug)
  if (hold === null) return
  if (hold.holder !== null) sweepMarkers(paths, slug, hold.holder)
  foldHold(rt, paths, slug, acceptedAt)
}

const commitVersion = (
  rt: Runtime,
  paths: RepoPaths,
  stored: StoredDocument,
  version: Version,
  acceptedAt: string
): Ok<Accepted> | Refusal | ThreadMoved => {
  const normalised = normaliseDocument(version.text, { acceptedAt, previousNextIds: previousNextIds(stored.text) })
  const committed = commitDocuments(rt, paths, {
    changes: [{ slug: stored.slug, text: normalised, expectedBlob: stored.blob }],
    message: version.message,
    ...(version.beforeCas === undefined ? {} : { beforeCas: version.beforeCas })
  })
  if (!committed.ok) return committed
  recordEvent(rt, paths, stored.slug, 'doc.commit', { via: version.via, ...itemChanges(stored.text, normalised) })
  return {
    ok: true,
    value: { commit: committed.value.commit, text: normalised, removed: removedIds(stored.text, normalised) }
  }
}

const followSessionCommit = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  file: string,
  acceptedAt: string,
  text: string
): void => {
  writeWorkingCopy(rt, file, text)
  settleHold(rt, paths, slug, acceptedAt)
}

const commitSessionVersion = (
  rt: Runtime,
  paths: RepoPaths,
  stored: StoredDocument,
  file: string,
  version: Version
): Ok<Accepted> | Refusal | ThreadMoved => {
  const acceptedAt = rt.now()
  const committed = commitVersion(rt, paths, stored, version, acceptedAt)
  if (committed.ok) followSessionCommit(rt, paths, stored.slug, file, acceptedAt, committed.value.text)
  return committed
}

const settleOnce = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  beforeCas: (() => void) | undefined
): Ok<Settled> | Refusal | ThreadMoved => {
  const stored = readDocument(rt, paths, slug)
  if (stored === null) return unknownThread(slug)
  const file = workingCopyPath(paths, slug)
  if (!file.ok) return file
  const copy = readWorkingCopy(file.value)
  if (!copy.ok) return copy
  if (copy.value === null) {
    writeWorkingCopy(rt, file.value, stored.text)
    return { ok: true, value: { kind: 'materialised' } }
  }
  if (stripHeaderLines(copy.value) === stripHeaderLines(stored.text)) return { ok: true, value: { kind: 'unchanged' } }
  const violations = checkVersion(stored.text, copy.value, slug)
  if (violations.length > 0) return { ok: true, value: { kind: 'refused', violations } }
  const accepted = commitSessionVersion(rt, paths, stored, file.value, {
    text: copy.value,
    message: commitMessage(slug, stored.text, copy.value),
    via: 'edit',
    beforeCas
  })
  return accepted.ok ? { ok: true, value: { kind: 'accepted', ...accepted.value } } : accepted
}

const settleWorkingCopy = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  beforeCas: (() => void) | undefined
): Ok<Settled> | Refusal => untilSettled(() => settleOnce(rt, paths, slug, beforeCas))

export const startPush = (rt: Runtime, paths: RepoPaths): ChildProcess | null => {
  const origin = git(rt, paths.root, ['config', '--get', 'remote.origin.url'])
  return origin.ok && origin.stdout.trim() !== '' ? startBackgroundPush(rt, paths.root, PUSH_TIMEOUT_MS) : null
}

export const reconcileThread = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  opts: { beforeCas?: () => void } = {}
): ReconcileResult | Refusal => {
  const settled = settleWorkingCopy(rt, paths, slug, opts.beforeCas)
  if (!settled.ok) return settled
  const result = settled.value
  if (result.kind !== 'accepted') return result
  return { kind: 'accepted', commit: result.commit, removed: result.removed, push: startPush(rt, paths) }
}

const withUpdateNote = (text: string, noteLines: readonly string[]): string =>
  `${text.replace(/\n+$/, '')}\n\n## ${NOTE_HEADING}\n\n${noteLines.join('\n')}\n`

const toolMessage = (tool: string, slug: string, summary: string, bodyLines: readonly string[]): string =>
  bodyLines.length === 0 ? `${tool} ${slug}: ${summary}` : [`${tool} ${slug}: ${summary}`, '', ...bodyLines].join('\n')

const toolVersion = (
  stored: StoredDocument,
  file: string,
  input: ToolChangeInput
): Ok<Version> | Refusal => {
  const changed = input.change(stored.text)
  if (!changed.ok) return changed.refusal
  const noted = withUpdateNote(changed.text, [changed.summary, ...changed.noteLines])
  const violations = checkVersion(stored.text, noted, stored.slug)
  if (violations.length > 0) return violationsRefusal(file, violations)
  return {
    ok: true,
    value: {
      text: noted,
      message: toolMessage(input.tool, stored.slug, changed.summary, [...changed.details, ...changed.noteLines]),
      via: input.tool,
      beforeCas: input.beforeCas
    }
  }
}

const applySessionOnce = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  input: ToolChangeInput
): Ok<Accepted> | Refusal | ThreadMoved => {
  const pending = settleWorkingCopy(rt, paths, slug, undefined)
  if (!pending.ok) return pending
  const file = workingCopyPath(paths, slug)
  if (!file.ok) return file
  if (pending.value.kind === 'refused') return violationsRefusal(file.value, pending.value.violations)
  const stored = readDocument(rt, paths, slug)
  if (stored === null) return unknownThread(slug)
  const version = toolVersion(stored, file.value, input)
  if (!version.ok) return version
  return commitSessionVersion(rt, paths, stored, file.value, version.value)
}

const applyCommandOnce = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  input: ToolChangeInput
): Ok<Accepted> | Refusal | ThreadMoved => {
  const file = workingCopyPath(paths, slug)
  if (!file.ok) return file
  const stored = readDocument(rt, paths, slug)
  if (stored === null) return unknownThread(slug)
  const version = toolVersion(stored, file.value, input)
  if (!version.ok) return version
  return commitVersion(rt, paths, stored, version.value, rt.now())
}

type ApplyOnce = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  input: ToolChangeInput
) => Ok<Accepted> | Refusal | ThreadMoved

const unknownWriter = (kind: unknown): Refusal => ({
  ok: false,
  field: 'writer',
  accepted: "a writer whose kind is 'session' or 'command'",
  example: 'command',
  retryable: false,
  message: `the writer kind ${JSON.stringify(kind)} is not one logbook knows, so nothing was committed`
})

const applyOnceFor = (writer: Writer): Ok<ApplyOnce> | Refusal => {
  switch (writer.kind) {
    case 'session':
      return { ok: true, value: applySessionOnce }
    case 'command':
      return { ok: true, value: applyCommandOnce }
    default:
      return unknownWriter((writer as { kind: unknown }).kind)
  }
}

export const applyToolChange = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  input: ToolChangeInput
): Ok<ToolChangeResult> | Refusal => {
  const applyOnce = applyOnceFor(rt.writer)
  if (!applyOnce.ok) return applyOnce
  const applied = untilSettled(() => applyOnce.value(rt, paths, slug, input))
  return applied.ok ? { ok: true, value: { ...applied.value, push: startPush(rt, paths) } } : applied
}
