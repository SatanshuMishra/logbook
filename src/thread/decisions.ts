import { decisionsInForce, type Item } from '../doc/document.ts'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { git } from '../store/git.ts'
import type { RepoPaths } from './paths.ts'
import { readDocument, resolveThreadId, THREADS_REF, threadsTip } from './store.ts'

export type RecordedDecision = { id: string; title: string; outcome: string }

type DecisionCommit = { subject: string; outcome: string | null }

const RECORD_DECISION_TOOL = 'record_decision'
const OUTCOME_PREFIX = 'Outcome: '
const TITLE_SEPARATOR = ': '
const RECORD_SEPARATOR = '\u001e'
const FIELD_SEPARATOR = '\u0000'
const LOG_FORMAT = '--format=%x1e%s%x00%b'
const ID_THEN_TITLE = /^(D[1-9][0-9]*) (.+)$/

const documentMissing = (slug: string): Refusal => ({
  ok: false,
  field: 'thread_id',
  accepted: `the slug of a thread whose document is stored on ${THREADS_REF}`,
  example: 'fix-login',
  retryable: true,
  message: `the thread ${slug} has no document at the tip of ${THREADS_REF}, so its decisions could not be read`
})

const logFailed = (code: number, stderr: string): Refusal => ({
  ok: false,
  field: 'git',
  accepted: `a readable history of ${THREADS_REF}`,
  example: `git log ${THREADS_REF}`,
  retryable: true,
  message: `git log failed while reading the decisions of ${THREADS_REF} (exit ${code}): ${stderr.trim().split('\n')[0] ?? ''}`
})

const subjectPrefix = (slug: string): string => `${RECORD_DECISION_TOOL} ${slug}: `

const outcomeOf = (body: string): string | null => {
  const line = body.split('\n').find((candidate) => candidate.startsWith(OUTCOME_PREFIX))
  return line === undefined ? null : line.slice(OUTCOME_PREFIX.length)
}

const parseLog = (stdout: string): DecisionCommit[] =>
  stdout
    .split(RECORD_SEPARATOR)
    .filter((record) => record.length > 0)
    .flatMap((record) => {
      const split = record.indexOf(FIELD_SEPARATOR)
      if (split < 0) return []
      return [{ subject: record.slice(0, split), outcome: outcomeOf(record.slice(split + 1)) }]
    })

const decisionCommitsOldestFirst = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string,
  tip: string
): Ok<DecisionCommit[]> | Refusal => {
  const result = git(rt, paths.root, [
    'log',
    '--no-color',
    '--reverse',
    '--extended-regexp',
    `--grep=^${subjectPrefix(slug)}`,
    LOG_FORMAT,
    tip,
    '--',
    `${slug}.md`
  ])
  return result.ok ? { ok: true, value: parseLog(result.stdout) } : logFailed(result.code, result.stderr)
}

const splitLine = (item: Item): RecordedDecision => {
  const at = item.text.indexOf(TITLE_SEPARATOR)
  return at < 0
    ? { id: item.id, title: item.text, outcome: '' }
    : { id: item.id, title: item.text.slice(0, at), outcome: item.text.slice(at + TITLE_SEPARATOR.length) }
}

const fromCommit = (slug: string, commit: DecisionCommit): RecordedDecision[] => {
  const prefix = subjectPrefix(slug)
  if (commit.outcome === null || !commit.subject.startsWith(prefix)) return []
  const match = ID_THEN_TITLE.exec(commit.subject.slice(prefix.length))
  const id = match?.[1]
  const title = match?.[2]
  return id === undefined || title === undefined ? [] : [{ id, title, outcome: commit.outcome }]
}

const wroteLine = (decision: RecordedDecision, item: Item): boolean =>
  decision.id === item.id && `${decision.title}${TITLE_SEPARATOR}${decision.outcome}` === item.text

export const readRecordedDecisions = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string
): Ok<RecordedDecision[]> | Refusal => {
  const resolved = resolveThreadId(rt, paths, slug)
  if (!resolved.ok) return resolved
  const tip = threadsTip(rt, paths)
  if (tip === null) return documentMissing(resolved.value)
  const stored = readDocument(rt, paths, resolved.value, tip)
  if (stored === null) return documentMissing(resolved.value)
  const commits = decisionCommitsOldestFirst(rt, paths, resolved.value, tip)
  if (!commits.ok) return commits
  const recorded = commits.value.flatMap((commit) => fromCommit(resolved.value, commit))
  const linesNoRecordWrote = decisionsInForce(stored.text)
    .filter((item) => !recorded.some((decision) => wroteLine(decision, item)))
    .map(splitLine)
  return { ok: true, value: [...recorded, ...linesNoRecordWrote] }
}
