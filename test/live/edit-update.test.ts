import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { rawGit } from '../support/git-fixture.ts'
import type { EditUpdateCase } from './cases.ts'
import type { Run, ThreadCommit, ToolCall, ToolResult } from './harness.ts'

type Harness = typeof import('./harness.ts')

type Outcome = {
  label: string
  accepted: boolean
  harms: string[]
  seconds: number | null
  detail: string
}

const MODEL = 'opus'
const RUNS_PER_CASE = 2
const DETAIL_LIMIT = 300
const EDIT_TOOLS: ReadonlySet<string> = new Set(['Edit', 'MultiEdit'])
const GIT_COMMIT = /\bgit\s+(?:-[cC]\s+\S+\s+)*commit\b/

const realOrResolved = (file: string): string => {
  try {
    return realpathSync(file)
  } catch {
    return resolve(file)
  }
}

const filePathOf = (call: ToolCall): string | null =>
  typeof call.input.file_path === 'string' && call.input.file_path !== '' ? call.input.file_path : null

const namesFile = (call: ToolCall, copy: string): boolean => {
  const file = filePathOf(call)
  return file !== null && realOrResolved(file) === realOrResolved(copy)
}

const resultOf = (run: Run, call: ToolCall): ToolResult | undefined =>
  run.toolResults.find((result) => result.toolUseId === call.id)

const acceptedEdits = (run: Run, copy: string, marker: string): ToolCall[] => {
  const edits = run.toolCalls.filter((call) => EDIT_TOOLS.has(call.name) && namesFile(call, copy))
  return edits.filter((call, index) => {
    const next = edits[index + 1]?.at ?? Number.POSITIVE_INFINITY
    return run.hookResponses.some((response) => response.text.includes(marker) && response.at >= call.at && response.at < next)
  })
}

const commitResults = (run: Run): ToolResult[] =>
  run.toolCalls
    .filter((call) => call.name === 'Bash' && typeof call.input.command === 'string' && GIT_COMMIT.test(call.input.command))
    .flatMap((call) => {
      const result = resultOf(run, call)
      return result === undefined || result.isError ? [] : [result]
    })

const secondsToAcceptedEdit = (run: Run, edits: readonly ToolCall[]): number | null => {
  const commits = commitResults(run)
  const first = commits[0]
  if (first === undefined) return null
  const edit = edits
    .flatMap((call) => {
      const result = resultOf(run, call)
      return result === undefined ? [] : [result]
    })
    .find((result) => result.at >= first.at)
  if (edit === undefined) return null
  const commit = commits.filter((result) => result.at <= edit.at).at(-1) ?? first
  return (edit.at - commit.at) / 1000
}

const replyTexts = (run: Run): string[] => [...run.texts.map((entry) => entry.text), ...(run.result === null ? [] : [run.result])]

const harmsOf = (harness: Harness, run: Run, copy: string, versions: readonly ThreadCommit[]): string[] => {
  const writes = run.toolCalls
    .filter((call) => call.name === 'Write' && namesFile(call, copy))
    .map((call) => `Write of the working copy (${call.id})`)
  const retyped = replyTexts(run).flatMap((reply, index) =>
    versions
      .filter((version) => harness.holdsThreeDocumentLines(reply, version.text))
      .map((version) => `reply ${index + 1} holds three consecutive lines of version ${version.commit.slice(0, 8)}`)
  )
  return [...writes, ...retyped]
}

const cut = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT)}...` : flat
}

const describeRun = (run: Run, updates: readonly ThreadCommit[], copy: string): string => {
  const tools = run.toolCalls.map((call) => (namesFile(call, copy) ? `${call.name}(working copy)` : call.name)).join(', ')
  const hooks = run.hookResponses.filter((response) => response.text.includes('logbook:')).map((response) => cut(response.text))
  return [
    `update commits: ${updates.length === 0 ? 'none' : updates.map((commit) => commit.message.split('\n')[0] ?? '').join(' | ')}`,
    `tools: ${tools === '' ? 'none' : tools}`,
    `logbook hook responses: ${hooks.length === 0 ? 'none' : hooks.join(' | ')}`,
    `result: ${run.result === null ? 'none' : cut(run.result)}`
  ].join('; ')
}

const seedFiles = (dir: string, entry: EditUpdateCase): void => {
  const names = Object.keys(entry.files)
  if (names.length === 0) return
  for (const name of names) writeFileSync(join(dir, name), entry.files[name] ?? '')
  for (const args of [['add', ...names], ['commit', '-m', `seed the files of the ${entry.name}`]]) {
    const result = rawGit(dir, args)
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed in ${dir}: ${result.stderr.trim()}`)
  }
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const runCase = async (harness: Harness, entry: EditUpdateCase, attempt: number): Promise<Outcome> => {
  const label = `${entry.name} run ${attempt}`
  const repo = await harness.makeRepo()
  try {
    seedFiles(repo.dir, entry)
    const sessionId = randomUUID()
    harness.openThread(repo.dir, {
      slug: entry.thread,
      title: entry.title,
      goal: entry.goal,
      nextStep: entry.nextStep,
      criteria: entry.criteria,
      holder: sessionId
    })
    const copy = harness.workingCopy(repo.dir, entry.thread)
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
    const marker = `logbook: accepted the update to ${entry.thread}`
    const accepted = updates.length > 0 && run.hookResponses.some((response) => response.text.includes(marker))
    return {
      label,
      accepted,
      harms: harmsOf(harness, run, copy, versions),
      seconds: accepted ? secondsToAcceptedEdit(run, acceptedEdits(run, copy, marker)) : null,
      detail: describeRun(run, updates, copy)
    }
  } catch (error) {
    return { label, accepted: false, harms: [], seconds: null, detail: `the run failed: ${messageOf(error)}` }
  } finally {
    repo.cleanup()
  }
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? 0)
    : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

const report = (outcome: Outcome): string =>
  [
    `${outcome.label}: ${outcome.accepted ? 'accepted' : 'not accepted'}`,
    outcome.harms.length === 0 ? 'no harm' : `harmful: ${outcome.harms.join('; ')}`,
    outcome.seconds === null
      ? 'no timing'
      : `${outcome.seconds.toFixed(1)} s from the git commit to the accepted edit`,
    outcome.detail
  ].join('; ')

test('live.edit-update-is-accepted-in-the-same-turn', { timeout: 3_000_000 }, async () => {
  const harness = await import('./harness.ts')
  const { EDIT_UPDATE_CASES } = await import('./cases.ts')
  assert.deepEqual(
    EDIT_UPDATE_CASES.map((entry) => entry.name),
    ['notes file task', 'sum module task', 'rename task']
  )

  const plan = EDIT_UPDATE_CASES.flatMap((entry) =>
    Array.from({ length: RUNS_PER_CASE }, (_unused, index) => ({ entry, attempt: index + 1 }))
  )
  const outcomes = await plan.reduce<Promise<Outcome[]>>(async (done, { entry, attempt }) => {
    const previous = await done
    const outcome = await runCase(harness, entry, attempt)
    console.log(report(outcome))
    return [...previous, outcome]
  }, Promise.resolve([]))

  const timings = outcomes.flatMap((outcome) => (outcome.seconds === null ? [] : [outcome.seconds]))
  console.log(
    timings.length === 0
      ? 'edit-update timing: no accepted run had an accepted edit after its git commit'
      : `edit-update timing over ${timings.length} accepted runs: median ${median(timings).toFixed(1)} s, slowest ${Math.max(...timings).toFixed(1)} s`
  )

  assert.equal(outcomes.length, 6)
  const harmful = outcomes.filter((outcome) => outcome.harms.length > 0).map(report)
  assert.deepEqual(harmful, [], `harmful runs:\n${harmful.join('\n')}`)
  const accepted = outcomes.filter((outcome) => outcome.accepted).length
  assert.ok(
    accepted >= 5,
    `${accepted} of 6 runs were accepted, at least 5 are needed:\n${outcomes.map(report).join('\n')}`
  )
})
