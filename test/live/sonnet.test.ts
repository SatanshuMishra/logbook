import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { rawGit } from '../support/git-fixture.ts'
import type { EditUpdateCase } from './cases.ts'
import type { Run, ThreadCommit, ToolCall } from './harness.ts'

type Harness = typeof import('./harness.ts')

type Outcome = {
  label: string
  accepted: boolean
  harms: string[]
  detail: string
}

const MODEL = 'sonnet'
const RUNS_PER_CASE = 2
const DETAIL_LIMIT = 300

const realOrResolved = (file: string): string => {
  try {
    return realpathSync(file)
  } catch {
    return resolve(file)
  }
}

const namesFile = (call: ToolCall, copy: string): boolean => {
  const file = call.input.file_path
  return typeof file === 'string' && file !== '' && realOrResolved(file) === realOrResolved(copy)
}

const assistantTexts = (run: Run): string[] => [
  ...run.texts.map((entry) => entry.text),
  ...(run.result === null ? [] : [run.result])
]

const harmsOf = (harness: Harness, run: Run, copy: string, versions: readonly ThreadCommit[]): string[] => {
  const writes = run.toolCalls
    .filter((call) => call.name === 'Write' && namesFile(call, copy))
    .map((call) => `Write of the working copy (${call.id})`)
  const retyped = assistantTexts(run).flatMap((text, index) =>
    versions
      .filter((version) => harness.holdsThreeDocumentLines(text, version.text))
      .map((version) => `assistant text ${index + 1} holds three consecutive lines of version ${version.commit.slice(0, 8)}`)
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
    return {
      label,
      accepted: updates.length > 0 && run.hookResponses.some((response) => response.text.includes(marker)),
      harms: harmsOf(harness, run, copy, versions),
      detail: describeRun(run, updates, copy)
    }
  } catch (error) {
    return { label, accepted: false, harms: [], detail: `the run failed: ${messageOf(error)}` }
  } finally {
    repo.cleanup()
  }
}

const report = (outcome: Outcome): string =>
  [
    `${outcome.label}: ${outcome.accepted ? 'accepted' : 'not accepted'}`,
    outcome.harms.length === 0 ? 'no harm' : `harmful: ${outcome.harms.join('; ')}`,
    outcome.detail
  ].join('; ')

test('live.sonnet-update-is-accepted-in-the-same-turn', { timeout: 3_000_000 }, async () => {
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

  assert.equal(outcomes.length, 6)
  const harmful = outcomes.filter((outcome) => outcome.harms.length > 0).map(report)
  assert.deepEqual(harmful, [], `harmful runs:\n${harmful.join('\n')}`)
  const accepted = outcomes.filter((outcome) => outcome.accepted).length
  assert.ok(
    accepted >= 5,
    `${accepted} of 6 runs were accepted, at least 5 are needed:\n${outcomes.map(report).join('\n')}`
  )
})
