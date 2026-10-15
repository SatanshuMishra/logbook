import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { StaleLineCase } from './cases.ts'
import type { Run, ThreadCommit } from './harness.ts'

type Harness = typeof import('./harness.ts')

type Outcome = {
  label: string
  problems: string[]
  document: string | null
  detail: string
}

const MODEL = 'opus'
const RUNS_PER_CASE = 2
const DETAIL_LIMIT = 300
const SETTLED_HEADING = '## Settled, do not reopen'
const HEADING_PREFIX = '## '
const STATUS_PREFIX = 'Status:'
const BLOCKED = 'blocked'

const outsideSettled = (text: string): string[] =>
  text.split('\n').reduce<{ inSettled: boolean; kept: string[] }>(
    (state, line) => {
      const trimmed = line.trim()
      if (trimmed === SETTLED_HEADING) return { inSettled: true, kept: state.kept }
      if (trimmed.startsWith(HEADING_PREFIX)) return { inSettled: false, kept: [...state.kept, line] }
      return state.inSettled ? state : { inSettled: false, kept: [...state.kept, line] }
    },
    { inSettled: false, kept: [] }
  ).kept

const markersOutsideSettled = (text: string, markers: readonly string[]): string[] => {
  const lowered = outsideSettled(text).join('\n').toLowerCase()
  return markers.filter((marker) => lowered.includes(marker.toLowerCase()))
}

const statusOf = (text: string): string | null => {
  const line = text.split('\n').find((entry) => entry.startsWith(STATUS_PREFIX))
  return line === undefined ? null : line.slice(STATUS_PREFIX.length).trim()
}

const documentProblems = (text: string, markers: readonly string[]): string[] => {
  const found = markersOutsideSettled(text, markers)
  const status = statusOf(text)
  return [
    ...found.map((marker) => `the stored document holds "${marker}" outside "Settled, do not reopen"`),
    ...(status === null
      ? ['the stored document has no Status line']
      : status.toLowerCase().startsWith(BLOCKED)
        ? [`the Status still starts "${BLOCKED}": ${status}`]
        : [])
  ]
}

const cut = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT)}...` : flat
}

const describeRun = (run: Run, updates: readonly ThreadCommit[]): string => {
  const tools = run.toolCalls.map((call) => call.name).join(', ')
  const hooks = run.hookResponses.filter((response) => response.text.includes('logbook:')).map((response) => cut(response.text))
  return [
    `update commits: ${updates.length === 0 ? 'none' : updates.map((commit) => commit.message.split('\n')[0] ?? '').join(' | ')}`,
    `tools: ${tools === '' ? 'none' : tools}`,
    `logbook hook responses: ${hooks.length === 0 ? 'none' : hooks.join(' | ')}`,
    `result: ${run.result === null ? 'none' : cut(run.result)}`
  ].join('; ')
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const runCase = async (harness: Harness, entry: StaleLineCase, attempt: number): Promise<Outcome> => {
  const label = `${entry.name} run ${attempt}`
  const repo = await harness.makeRepo()
  try {
    const sessionId = randomUUID()
    harness.storeThread(repo.dir, { slug: entry.thread, text: entry.document, holder: sessionId })
    const before = new Set(harness.threadCommits(repo.dir, entry.thread).map((commit) => commit.commit))
    const run = await harness.runClaude({
      cwd: repo.dir,
      model: MODEL,
      session: { id: sessionId, resume: false },
      prompt: entry.prompt
    })
    const versions = harness.threadCommits(repo.dir, entry.thread)
    const updates = versions.filter(
      (commit) => !before.has(commit.commit) && commit.message.startsWith(`update ${entry.thread}:`)
    )
    const stored = versions.at(-1)?.text ?? null
    const problems = [
      ...(updates.length === 0 ? [`refs/logbook/threads gained no "update ${entry.thread}:" commit during the run`] : []),
      ...(stored === null ? ['no stored document was found'] : documentProblems(stored, entry.markers))
    ]
    return { label, problems, document: stored, detail: describeRun(run, updates) }
  } catch (error) {
    return { label, problems: [`the run failed: ${messageOf(error)}`], document: null, detail: 'no run' }
  } finally {
    repo.cleanup()
  }
}

const report = (outcome: Outcome): string =>
  [
    `${outcome.label}: ${outcome.problems.length === 0 ? 'passed' : `failed: ${outcome.problems.join('; ')}`}`,
    outcome.detail
  ].join('; ')

const failureReport = (outcome: Outcome): string =>
  [
    report(outcome),
    outcome.document === null ? 'final document: none' : `final document:\n${outcome.document}`
  ].join('\n')

test('live.stale-line-of-the-other-option-is-gone', { timeout: 3_000_000 }, async () => {
  const harness = await import('./harness.ts')
  const { STALE_LINE_CASES } = await import('./cases.ts')
  assert.deepEqual(
    STALE_LINE_CASES.map((entry) => entry.name),
    ['schema migration choice', 'parser packaging choice', 'nightly job choice']
  )

  const plan = STALE_LINE_CASES.flatMap((entry) =>
    Array.from({ length: RUNS_PER_CASE }, (_unused, index) => ({ entry, attempt: index + 1 }))
  )
  const outcomes = await plan.reduce<Promise<Outcome[]>>(async (done, { entry, attempt }) => {
    const previous = await done
    const outcome = await runCase(harness, entry, attempt)
    console.log(outcome.problems.length === 0 ? report(outcome) : failureReport(outcome))
    return [...previous, outcome]
  }, Promise.resolve([]))

  assert.equal(outcomes.length, 6)
  const failed = outcomes.filter((outcome) => outcome.problems.length > 0).map(failureReport)
  assert.deepEqual(failed, [], `${failed.length} of 6 runs failed, all 6 must pass:\n${failed.join('\n\n')}`)
})
