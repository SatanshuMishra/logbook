import { decisionsInForce, type Item } from '../doc/document.ts'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { git } from '../store/git.ts'
import type { RepoPaths } from './paths.ts'
import { readDocument, resolveThreadId, THREADS_REF, threadsTip } from './store.ts'

export type DecisionInForce = { id: string; title: string; outcome: string }

type DecisionCommit = { subject: string; outcome: string | null }

const RECORD_DECISION_TOOL = 'record_decision'
const OUTCOME_PREFIX = 'Outcome: '
const TITLE_SEPARATOR = ': '
const RECORD_SEPARATOR = '\u001e'
const FIELD_SEPARATOR = '\u0000'
const LOG_FORMAT = '--format=%x1e%s%x00%b'

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

const decisionCommits = (rt: Runtime, paths: RepoPaths, slug: string, tip: string): Ok<DecisionCommit[]> | Refusal => {
  const result = git(rt, paths.root, [
    'log',
    '--no-color',
    '--extended-regexp',
    `--grep=^${subjectPrefix(slug)}`,
    LOG_FORMAT,
    tip,
    '--',
    `${slug}.md`
  ])
  return result.ok ? { ok: true, value: parseLog(result.stdout) } : logFailed(result.code, result.stderr)
}

const splitLine = (item: Item): DecisionInForce => {
  const at = item.text.indexOf(TITLE_SEPARATOR)
  return at < 0
    ? { id: item.id, title: item.text, outcome: '' }
    : { id: item.id, title: item.text.slice(0, at), outcome: item.text.slice(at + TITLE_SEPARATOR.length) }
}

const fromCommit = (slug: string, item: Item, commit: DecisionCommit): DecisionInForce | null => {
  const head = `${subjectPrefix(slug)}${item.id} `
  if (commit.outcome === null || !commit.subject.startsWith(head)) return null
  const title = commit.subject.slice(head.length)
  return `${title}${TITLE_SEPARATOR}${commit.outcome}` === item.text ? { id: item.id, title, outcome: commit.outcome } : null
}

const describe = (slug: string, item: Item, commits: readonly DecisionCommit[]): DecisionInForce =>
  commits.reduce<DecisionInForce | null>((found, commit) => found ?? fromCommit(slug, item, commit), null) ??
  splitLine(item)

export const readDecisionsInForce = (
  rt: Runtime,
  paths: RepoPaths,
  slug: string
): Ok<DecisionInForce[]> | Refusal => {
  const resolved = resolveThreadId(rt, paths, slug)
  if (!resolved.ok) return resolved
  const tip = threadsTip(rt, paths)
  if (tip === null) return documentMissing(resolved.value)
  const stored = readDocument(rt, paths, resolved.value, tip)
  if (stored === null) return documentMissing(resolved.value)
  const items = decisionsInForce(stored.text)
  if (items.length === 0) return { ok: true, value: [] }
  const commits = decisionCommits(rt, paths, resolved.value, tip)
  if (!commits.ok) return commits
  return { ok: true, value: items.map((item) => describe(resolved.value, item, commits.value)) }
}
