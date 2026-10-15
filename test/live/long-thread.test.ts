import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { LongSequenceCase } from './cases.ts'
import type { Run, ThreadCommit } from './harness.ts'

type Harness = typeof import('./harness.ts')

type Grader = typeof import('./long-thread-grade.ts')

type Turn = { turn: number; run: Run }

type Progress = { turns: Turn[]; failure: string | null; firstTurn: string | null }

type Outcome = {
  label: string
  reasons: string[]
  lengths: string[]
  turns: string[]
  document: string | null
}

const MODEL = 'opus'
const RUNS = 2
const MINIMUM_UPDATES = 8
const DETAIL_LIMIT = 300
const NEXT_STEP_HEADING = 'Next step'
const REMOVED_PATTERN = /^Removed: ([cDRS][1-9][0-9]*)(?![0-9])/

const gradeDocument = (body: string): string =>
  [
    '# unit-convert: Unit converter',
    'Status: active',
    '',
    '## Where things stand',
    ...(body === '' ? [] : ['', body, '']),
    '## Next step',
    '',
    'Add the next function.',
    ''
  ].join('\n')

test('live.long-thread-grade-refuses-a-first-turn-not-started', async () => {
  const { gradeSection } = await import('./long-thread-grade.ts')
  const grade = gradeSection({ firstTurn: gradeDocument('Not started.'), final: gradeDocument('b'.repeat(20)) })
  assert.equal(grade.ok, false)
  assert.ok(grade.reasons.includes('Where things stand at the end of the first turn is empty or Not started.'))
})

test('live.long-thread-grade-refuses-an-empty-first-turn-section', async () => {
  const { gradeSection } = await import('./long-thread-grade.ts')
  const firstTurn = gradeDocument('')
  assert.ok(firstTurn.includes('## Where things stand\n## Next step\n'))
  const grade = gradeSection({ firstTurn, final: gradeDocument('b'.repeat(20)) })
  assert.equal(grade.ok, false)
  assert.ok(grade.reasons.includes('Where things stand at the end of the first turn is empty or Not started.'))
})

test('live.long-thread-grade-allows-twice-the-first-turn-section', async () => {
  const { gradeSection } = await import('./long-thread-grade.ts')
  const grade = gradeSection({ firstTurn: gradeDocument('a'.repeat(40)), final: gradeDocument('b'.repeat(80)) })
  assert.equal(grade.ok, true)
  assert.deepEqual(grade.reasons, [])
  assert.equal(grade.firstTurnLength, 40)
  assert.equal(grade.finalLength, 80)
})

test('live.long-thread-grade-refuses-more-than-twice', async () => {
  const { gradeSection } = await import('./long-thread-grade.ts')
  const grade = gradeSection({ firstTurn: gradeDocument('a'.repeat(40)), final: gradeDocument('b'.repeat(81)) })
  assert.equal(grade.ok, false)
  assert.ok(
    grade.reasons.includes('the final Where things stand is 81 characters, more than twice the 40 of the first turn')
  )
})

test('live.long-thread-grade-refuses-a-final-section-not-started', async () => {
  const { gradeSection } = await import('./long-thread-grade.ts')
  const grade = gradeSection({ firstTurn: gradeDocument('a'.repeat(40)), final: gradeDocument('Not started.') })
  assert.equal(grade.ok, false)
  assert.ok(grade.reasons.includes('the final Where things stand is empty or Not started.'))
})

test('live.long-thread-grade-refuses-an-empty-final-section', async () => {
  const { gradeSection } = await import('./long-thread-grade.ts')
  const final = gradeDocument('')
  assert.ok(final.includes('## Where things stand\n## Next step\n'))
  const grade = gradeSection({ firstTurn: gradeDocument('a'.repeat(40)), final })
  assert.equal(grade.ok, false)
  assert.equal(grade.finalLength, 0)
  assert.ok(grade.reasons.includes('the final Where things stand is empty or Not started.'))
})

const firstLine = (message: string): string => message.split('\n')[0] ?? ''

const cut = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > DETAIL_LIMIT ? `${flat.slice(0, DETAIL_LIMIT)}...` : flat
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const lengthLine = (grader: Grader, version: ThreadCommit): string =>
  `${version.commit.slice(0, 8)} ${firstLine(version.message)}: document ${version.text.length} characters, Where things stand ${grader.whereThingsStand(version.text).length} characters`

const describeTurn = (turn: Turn): string => {
  const tools = turn.run.toolCalls.map((call) => call.name).join(', ')
  const hooks = turn.run.hookResponses
    .filter((response) => response.text.includes('logbook:'))
    .map((response) => cut(response.text))
  return [
    `turn ${turn.turn}`,
    `session ${turn.run.sessionId ?? 'none'}`,
    `tools: ${tools === '' ? 'none' : tools}`,
    `logbook hook responses: ${hooks.length === 0 ? 'none' : hooks.join(' | ')}`,
    `result: ${turn.run.result === null ? 'none' : cut(turn.run.result)}`
  ].join('; ')
}

const reasonsOf = async (
  entry: LongSequenceCase,
  versions: readonly ThreadCommit[],
  firstTurn: string | null
): Promise<string[]> => {
  const { parseDocument } = await import('../../src/doc/document.ts')
  const { gradeSection } = await import('./long-thread-grade.ts')
  const updates = versions.filter((version) => version.message.startsWith(`update ${entry.thread}:`))
  const countReasons =
    updates.length < MINIMUM_UPDATES
      ? [`${updates.length} commits start "update ${entry.thread}:" on refs/logbook/threads, at least ${MINIMUM_UPDATES} are needed`]
      : []
  const final = versions.at(-1)?.text ?? null
  if (firstTurn === null || final === null) {
    return [...countReasons, 'there is no stored version of the thread to grade']
  }
  const finalParsed = parseDocument(final)
  const finalIds = new Set(finalParsed.items.map((item) => item.id))
  const removed = new Set(
    versions.flatMap((version) =>
      version.message.split('\n').flatMap((line) => {
        const match = REMOVED_PATTERN.exec(line.trim())
        return match?.[1] === undefined ? [] : [match[1]]
      })
    )
  )
  const departed = [
    ...new Set(versions.flatMap((version) => parseDocument(version.text).items.map((item) => item.id)))
  ].filter((id) => !finalIds.has(id))
  const nextStep = finalParsed.sections
    .filter((section) => section.name === NEXT_STEP_HEADING)
    .map((section) => section.body.join('\n'))
    .join('\n')
    .trim()
  return [
    ...countReasons,
    ...gradeSection({ firstTurn, final }).reasons,
    ...parseDocument(firstTurn)
      .items.filter((item) => item.letter === 'c' && !finalIds.has(item.id))
      .map((item) => `criterion ${item.id} of the version stored when the first turn ends is missing from the final document`),
    ...(nextStep === '' ? ['the final Next step is empty'] : []),
    ...departed
      .filter((id) => !removed.has(id))
      .map((id) => `${id} left the document but no commit message on refs/logbook/threads has a "Removed: ${id}" line`)
  ]
}

const newestText = (harness: Harness, dir: string, slug: string): string | null =>
  harness.threadCommits(dir, slug).at(-1)?.text ?? null

const runTurns = (
  harness: Harness,
  entry: LongSequenceCase,
  dir: string,
  sessionId: string
): Promise<Progress> =>
  entry.turns.reduce<Promise<Progress>>(
    async (done, prompt, index) => {
      const state = await done
      if (state.failure !== null) return state
      const attempt = await harness
        .runClaude({ cwd: dir, model: MODEL, session: { id: sessionId, resume: index > 0 }, prompt })
        .then(
          (run) => ({ run, failure: null }),
          (error: unknown) => ({ run: null, failure: `the run failed at turn ${index + 1}: ${messageOf(error)}` })
        )
      const firstTurn = index === 0 ? newestText(harness, dir, entry.thread) : state.firstTurn
      return {
        turns: attempt.run === null ? state.turns : [...state.turns, { turn: index + 1, run: attempt.run }],
        failure: attempt.failure,
        firstTurn
      }
    },
    Promise.resolve({ turns: [], failure: null, firstTurn: null })
  )

const runSequence = async (harness: Harness, grader: Grader, entry: LongSequenceCase, attempt: number): Promise<Outcome> => {
  const label = `${entry.name} run ${attempt}`
  const repo = await harness.makeRepo()
  try {
    const sessionId = randomUUID()
    harness.openThread(repo.dir, {
      slug: entry.thread,
      title: entry.title,
      goal: entry.goal,
      nextStep: entry.nextStep,
      criteria: entry.criteria,
      holder: sessionId
    })
    const progress = await runTurns(harness, entry, repo.dir, sessionId)
    const versions = harness.threadCommits(repo.dir, entry.thread)
    return {
      label,
      reasons: [
        ...(progress.failure === null ? [] : [progress.failure]),
        ...(await reasonsOf(entry, versions, progress.firstTurn))
      ],
      lengths: versions.map((version) => lengthLine(grader, version)),
      turns: progress.turns.map(describeTurn),
      document: versions.at(-1)?.text ?? null
    }
  } catch (error) {
    return { label, reasons: [`the run failed: ${messageOf(error)}`], lengths: [], turns: [], document: null }
  } finally {
    repo.cleanup()
  }
}

const report = (outcome: Outcome): string =>
  [
    `${outcome.label}: ${outcome.reasons.length === 0 ? 'passed' : `failed: ${outcome.reasons.join('; ')}`}`,
    'lengths per commit on refs/logbook/threads:',
    ...outcome.lengths.map((line) => `  ${line}`),
    ...outcome.turns.map((line) => `  ${line}`)
  ].join('\n')

const failureReport = (outcome: Outcome): string =>
  [report(outcome), outcome.document === null ? 'final document: none' : `final document:\n${outcome.document}`].join('\n')

test('live.long-thread-stays-within-twice-the-first-version', { timeout: 5_400_000 }, async () => {
  const harness = await import('./harness.ts')
  const grader = await import('./long-thread-grade.ts')
  const { LONG_SEQUENCE_CASE } = await import('./cases.ts')
  assert.equal(LONG_SEQUENCE_CASE.name, 'eight-turn converter build')
  assert.equal(LONG_SEQUENCE_CASE.thread, 'unit-convert')
  assert.equal(LONG_SEQUENCE_CASE.turns.length, 8)

  const outcomes = await Array.from({ length: RUNS }, (_unused, index) => index + 1).reduce<Promise<Outcome[]>>(
    async (done, attempt) => {
      const previous = await done
      const outcome = await runSequence(harness, grader, LONG_SEQUENCE_CASE, attempt)
      console.log(outcome.reasons.length === 0 ? report(outcome) : failureReport(outcome))
      return [...previous, outcome]
    },
    Promise.resolve([])
  )

  assert.equal(outcomes.length, 2)
  const failed = outcomes.filter((outcome) => outcome.reasons.length > 0).map(failureReport)
  assert.deepEqual(failed, [], `${failed.length} of 2 runs failed, both must pass:\n${failed.join('\n\n')}`)
})
