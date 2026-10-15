import { parseDocument, type ParsedDocument, type StatusKind } from '../doc/document.ts'
import { firstSentence, rosterLine } from '../doc/render.ts'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { withDetail } from '../store/detail.ts'
import { git } from '../store/git.ts'
import { workingCopyPath, type RepoPaths } from './paths.ts'
import { THREADS_REF, listSlugs, readDocument, threadsTip } from './store.ts'

export type RosterThread = { slug: string; title: string; status: string; nextStep: string; path: string; line: string }

export type Roster = { threads: RosterThread[]; closedCount: number; text: string }

export type SearchMatch = { commit: string; date: string; subject: string; file: string; lines: string[] }

export const ROSTER_CEILING = 9500

type Listed = { thread: RosterThread; closed: boolean; time: number }

type HistoryCommit = { commit: string; date: string; subject: string }

const ARCHIVE_REF = 'refs/logbook/archive/ledger'
const DOCUMENT_SUFFIX = '.md'
const UNREADABLE = 'unreadable'
const NEXT_STEP_SECTION = 'Next step'
const CLOSED_KINDS: readonly StatusKind[] = ['done', 'abandoned']
const CONFLICT_OPEN = '<<<<<<<'
const CONFLICT_CLOSE = '>>>>>>>'
const COMMIT_MARK = '\0'
const CONTINUE_LINE = 'To continue a thread, call resume_thread with its slug.'
const HISTORY_LINE_PATTERN = /^([0-9a-f]{40,64})\t([^\t]*)\t(.*)$/

const closedLine = (count: number): string => `${count} closed threads: call list_threads with include_closed true.`

const moreLine = (count: number): string => `(${count} more threads: call list_threads)`

const readableText = (value: string | null): string => (value === null || value.trim() === '' ? UNREADABLE : value)

const insideConflict = (parsed: ParsedDocument, line: number): boolean => {
  const opened = parsed.conflictLines
    .filter((conflict) => conflict.line < line && conflict.text.startsWith(CONFLICT_OPEN))
    .at(-1)
  if (opened === undefined) return false
  const closed = parsed.conflictLines.find(
    (conflict) => conflict.line > opened.line && conflict.text.startsWith(CONFLICT_CLOSE)
  )
  return closed === undefined || closed.line > line
}

const readableStatus = (parsed: ParsedDocument): { raw: string; closed: boolean } | null => {
  const status = parsed.status
  if (status === null || status.kind === null || parsed.statusLine === null) return null
  if (insideConflict(parsed, parsed.statusLine)) return null
  return { raw: status.raw, closed: CLOSED_KINDS.includes(status.kind) }
}

const nextStepOf = (parsed: ParsedDocument): string =>
  firstSentence(parsed.sections.find((section) => section.name === NEXT_STEP_SECTION)?.body.join('\n') ?? '')

const lineFor = (slug: string, text: string, parsed: ParsedDocument, status: string, nextStep: string): string =>
  status !== UNREADABLE && parsed.slug === slug ? rosterLine(text) : `${slug} - ${status} - Next: ${nextStep}`

const parseChangeTimes = (stdout: string): Map<string, number> =>
  new Map(
    stdout
      .split(COMMIT_MARK)
      .flatMap((block) => {
        const [header = '', ...names] = block.split('\n')
        const time = Number(header.trim())
        if (header.trim() === '' || !Number.isSafeInteger(time)) return []
        return names.filter((name) => name.length > 0).map((name): [string, number] => [name, time])
      })
      .sort(([, left], [, right]) => left - right)
  )

const changeTimes = (rt: Runtime, paths: RepoPaths, tip: string): Map<string, number> => {
  const result = git(rt, paths.root, [
    'log',
    '--format=%x00%ct',
    '--name-only',
    '--no-renames',
    '--root',
    '-c',
    tip,
    '--'
  ])
  return result.ok ? parseChangeTimes(result.stdout) : new Map()
}

const listed = (rt: Runtime, paths: RepoPaths, tip: string, times: Map<string, number>, slug: string): Listed[] => {
  const stored = readDocument(rt, paths, slug, tip)
  const where = workingCopyPath(paths, slug)
  if (stored === null || !where.ok) return []
  const parsed = parseDocument(stored.text)
  const status = readableStatus(parsed)
  const raw = status === null ? UNREADABLE : status.raw
  const nextStep = nextStepOf(parsed)
  return [
    {
      thread: {
        slug,
        title: readableText(parsed.title),
        status: raw,
        nextStep,
        path: where.value,
        line: lineFor(slug, stored.text, parsed, raw, nextStep)
      },
      closed: status !== null && status.closed,
      time: times.get(`${slug}${DOCUMENT_SUFFIX}`) ?? -Infinity
    }
  ]
}

const compareSlugs = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0)

const newestFirst = (entries: readonly Listed[]): RosterThread[] =>
  [...entries]
    .sort((left, right) => right.time - left.time || compareSlugs(left.thread.slug, right.thread.slug))
    .map((entry) => entry.thread)

export const listRoster = (rt: Runtime, paths: RepoPaths, opts: { includeClosed: boolean }): Roster => {
  const tip = threadsTip(rt, paths)
  if (tip === null) return { threads: [], closedCount: 0, text: '' }
  const times = changeTimes(rt, paths, tip)
  const entries = listSlugs(rt, paths, tip).flatMap((slug) => listed(rt, paths, tip, times, slug))
  const open = newestFirst(entries.filter((entry) => !entry.closed))
  const closed = newestFirst(entries.filter((entry) => entry.closed))
  const threads = opts.includeClosed ? [...open, ...closed] : open
  const counted = closed.length > 0 && !opts.includeClosed ? [closedLine(closed.length)] : []
  return {
    threads,
    closedCount: closed.length,
    text: [...threads.map((thread) => thread.line), ...counted].join('\n')
  }
}

const joinedLength = (lines: readonly string[]): number =>
  lines.reduce((total, line) => total + line.length, 0) + Math.max(lines.length - 1, 0)

const keptCount = (lines: readonly string[], tail: (dropped: number) => string[]): number => {
  if (joinedLength([...lines, ...tail(0)]) <= ROSTER_CEILING) return lines.length
  return lines.reduce(
    (fit, line) => {
      if (!fit.open) return fit
      const kept = fit.kept + 1
      const length = fit.length + line.length + 1
      return length + joinedLength(tail(lines.length - kept)) <= ROSTER_CEILING
        ? { kept, length, open: true }
        : { ...fit, open: false }
    },
    { kept: 0, length: 0, open: true }
  ).kept
}

export const sessionStartRoster = (rt: Runtime, paths: RepoPaths): string | null => {
  const roster = listRoster(rt, paths, { includeClosed: false })
  if (roster.threads.length === 0 && roster.closedCount === 0) return null
  const lines = roster.threads.map((thread) => thread.line)
  const tail = (dropped: number): string[] => [
    ...(dropped > 0 ? [moreLine(dropped)] : []),
    ...(roster.closedCount > 0 ? [closedLine(roster.closedCount)] : []),
    CONTINUE_LINE
  ]
  const kept = keptCount(lines, tail)
  return [...lines.slice(0, kept), ...tail(lines.length - kept)].join('\n')
}

const badText = (message: string): Refusal => ({
  ok: false,
  field: 'text',
  accepted: 'a text holding at least one character other than white space, and no NUL character',
  example: 'retry rule',
  retryable: true,
  message
})

const checkText = (text: string): Refusal | null => {
  if (text.trim() === '') return badText('text is empty or only white space, so there is nothing to search for')
  return text.includes('\0') ? badText('text holds a NUL character, which git cannot take as an argument') : null
}

const searchFailure = (step: string, code: number, stderr: string): Refusal =>
  withDetail(
    {
      ok: false,
      field: THREADS_REF,
      accepted: 'a repository whose object store git can read',
      example: 'git fsck',
      retryable: false,
      message: `git ${step} failed while searching the history of ${THREADS_REF} (exit ${code}); nothing was searched`
    },
    stderr.trim()
  )

const refExists = (rt: Runtime, paths: RepoPaths, ref: string): boolean =>
  git(rt, paths.root, ['rev-parse', '--verify', '--quiet', ref]).ok

const parseHistory = (stdout: string): HistoryCommit[] =>
  stdout.split('\n').flatMap((line) => {
    const match = HISTORY_LINE_PATTERN.exec(line)
    return match === null ? [] : [{ commit: match[1] ?? '', date: match[2] ?? '', subject: match[3] ?? '' }]
  })

const changedFiles = (rt: Runtime, paths: RepoPaths, commit: string): Ok<string[]> | Refusal => {
  const result = git(rt, paths.root, ['diff-tree', '-z', '--root', '--no-commit-id', '--name-only', '-r', commit])
  return result.ok
    ? { ok: true, value: result.stdout.split('\0').filter((name) => name.length > 0) }
    : searchFailure('diff-tree', result.code, result.stderr)
}

const linesHolding = (rt: Runtime, paths: RepoPaths, revision: string, needle: string): string[] => {
  const result = git(rt, paths.root, ['show', revision])
  if (!result.ok) return []
  return result.stdout.split('\n').filter((line) => line.toLowerCase().includes(needle))
}

const matchesIn = (
  rt: Runtime,
  paths: RepoPaths,
  found: HistoryCommit,
  needle: string
): Ok<SearchMatch[]> | Refusal => {
  const files = changedFiles(rt, paths, found.commit)
  if (!files.ok) return files
  return {
    ok: true,
    value: files.value.flatMap((file) => {
      const own = linesHolding(rt, paths, `${found.commit}:${file}`, needle)
      const lines = own.length > 0 ? own : linesHolding(rt, paths, `${found.commit}^:${file}`, needle)
      return lines.length === 0 ? [] : [{ ...found, file, lines }]
    })
  }
}

export const searchHistory = (rt: Runtime, paths: RepoPaths, text: string): Ok<SearchMatch[]> | Refusal => {
  const refused = checkText(text)
  if (refused !== null) return refused
  const refs = [THREADS_REF, ARCHIVE_REF].filter((ref) => refExists(rt, paths, ref))
  if (refs.length === 0) return { ok: true, value: [] }
  const log = git(rt, paths.root, ['log', '-i', `-S${text}`, '--format=%H%x09%cI%x09%s', ...refs, '--'])
  if (!log.ok) return searchFailure('log', log.code, log.stderr)
  const needle = text.toLowerCase()
  const perCommit = parseHistory(log.stdout).map((found) => matchesIn(rt, paths, found, needle))
  const failed = perCommit.find((result): result is Refusal => !result.ok)
  return failed ?? { ok: true, value: perCommit.flatMap((result) => (result.ok ? result.value : [])) }
}
