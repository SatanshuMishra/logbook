import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import type { ContinueCase, ContinueMode, Question } from './cases.ts'
import type { Run } from './harness.ts'

type Harness = typeof import('./harness.ts')

type Answer = { label: string; question: Question; text: string; holds: boolean }

type SessionOutcome = { label: string; answers: Answer[]; leaks: string[]; failure: string | null }

type Asked = { runs: Run[]; failure: string | null }

const MODEL = 'opus'
const RUNS = 2
const MINIMUM_HOLDING = 22
const TOTAL_ANSWERS = 24

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

const assistantTexts = (run: Run): string[] => [
  ...run.texts.map((entry) => entry.text),
  ...(run.result === null ? [] : [run.result])
]

const answerText = (run: Run): string => {
  const texts = run.texts.map((entry) => entry.text)
  const result = run.result
  return result === null || texts.includes(result) ? texts.join('\n') : [...texts, result].join('\n')
}

const holdsRequired = (text: string, question: Question): boolean =>
  question.required.every((phrase) => text.toLowerCase().includes(phrase.toLowerCase()))

const ask = (
  harness: Harness,
  dir: string,
  prompts: readonly string[],
  session: { id: string; resumeFirst: boolean },
  label: string
): Promise<Asked> =>
  prompts.reduce<Promise<Asked>>(
    async (done, prompt, index) => {
      const state = await done
      if (state.failure !== null) return state
      return harness
        .runClaude({
          cwd: dir,
          model: MODEL,
          session: { id: session.id, resume: session.resumeFirst || index > 0 },
          prompt
        })
        .then(
          (run): Asked => ({ runs: [...state.runs, run], failure: null }),
          (error: unknown): Asked => ({ runs: state.runs, failure: `${label} failed at "${prompt}": ${messageOf(error)}` })
        )
    },
    Promise.resolve({ runs: [], failure: null })
  )

const questionSession = (mode: ContinueMode, sessionId: string, steps: readonly Run[]): string | null => {
  if (!mode.resumesNewSession) return sessionId
  const next = steps.at(-1)?.sessionId ?? null
  return next === null || next === sessionId ? null : next
}

const leaksOf = (harness: Harness, entry: ContinueCase, runs: readonly Run[], label: string): string[] =>
  runs.flatMap((run, runIndex) =>
    assistantTexts(run)
      .filter((text) => harness.holdsThreeDocumentLines(text, entry.document))
      .map((text) => `${label} turn ${runIndex + 1} holds three consecutive lines of the document:\n${text}`)
  )

const runMode = async (
  harness: Harness,
  entry: ContinueCase,
  mode: ContinueMode,
  attempt: number
): Promise<SessionOutcome> => {
  const label = `${mode.name} run ${attempt}`
  const repo = await harness.makeRepo()
  const graded = (asked: readonly Run[], failure: string | null): Answer[] =>
    entry.questions.map((question, index) => {
      const run = asked[index]
      const text = run === undefined ? `(not answered: ${failure ?? 'no answer'})` : answerText(run)
      return { label: `${label} question ${index + 1}`, question, text, holds: run !== undefined && holdsRequired(text, question) }
    })
  try {
    const sessionId = randomUUID()
    harness.storeThread(repo.dir, {
      slug: entry.thread,
      text: entry.document,
      holder: mode.takesHold ? sessionId : null
    })
    const steps = await ask(harness, repo.dir, mode.turns, { id: sessionId, resumeFirst: false }, label)
    const target = steps.failure === null ? questionSession(mode, sessionId, steps.runs) : null
    const stepFailure =
      steps.failure ?? (target === null ? `${label}: the last step reported no new session id to resume` : null)
    const questions =
      target === null
        ? { runs: [], failure: stepFailure }
        : await ask(
            harness,
            repo.dir,
            entry.questions.map((entryQuestion) => entryQuestion.question),
            { id: target, resumeFirst: true },
            label
          )
    const failure = stepFailure ?? questions.failure
    return {
      label,
      answers: graded(questions.runs, failure),
      leaks: leaksOf(harness, entry, [...steps.runs, ...questions.runs], label),
      failure
    }
  } catch (error) {
    const failure = `${label} failed: ${messageOf(error)}`
    return { label, answers: graded([], failure), leaks: [], failure }
  } finally {
    repo.cleanup()
  }
}

const gradeLine = (answer: Answer): string =>
  `${answer.label}: ${answer.holds ? 'holds' : 'misses'} ${answer.question.required.map((phrase) => JSON.stringify(phrase)).join(' and ')}`

const failingAnswer = (answer: Answer): string =>
  `${answer.label} asked ${JSON.stringify(answer.question.question)} and answered:\n${answer.text}`

const report = (outcome: SessionOutcome): string =>
  [
    `${outcome.label}: ${outcome.failure === null ? 'ran every turn' : outcome.failure}`,
    ...outcome.answers.map(gradeLine),
    ...outcome.answers.filter((answer) => !answer.holds).map(failingAnswer),
    ...outcome.leaks
  ].join('\n')

test('live.fresh-sessions-answer-from-the-document', { timeout: 5_400_000 }, async () => {
  const harness = await import('./harness.ts')
  const { CONTINUE_CASE } = await import('./cases.ts')
  assert.equal(CONTINUE_CASE.thread, 'release-v2')
  assert.equal(CONTINUE_CASE.questions.length, 4)
  assert.deepEqual(
    CONTINUE_CASE.modes.map((mode) => mode.name),
    ['fresh session through preflight', 'after compact', 'after clear']
  )

  const plan = Array.from({ length: RUNS }, (_unused, index) => index + 1).flatMap((attempt) =>
    CONTINUE_CASE.modes.map((mode) => ({ mode, attempt }))
  )
  const outcomes = await plan.reduce<Promise<SessionOutcome[]>>(async (done, { mode, attempt }) => {
    const previous = await done
    const outcome = await runMode(harness, CONTINUE_CASE, mode, attempt)
    console.log(report(outcome))
    return [...previous, outcome]
  }, Promise.resolve([]))

  assert.equal(outcomes.length, 6)
  const answers = outcomes.flatMap((outcome) => outcome.answers)
  assert.equal(answers.length, TOTAL_ANSWERS)
  const leaks = outcomes.flatMap((outcome) => outcome.leaks)
  assert.deepEqual(leaks, [], leaks.join('\n\n'))
  const holding = answers.filter((answer) => answer.holds).length
  assert.ok(
    holding >= MINIMUM_HOLDING,
    `${holding} of ${TOTAL_ANSWERS} answers hold their required phrases, at least ${MINIMUM_HOLDING} are needed:\n${answers
      .filter((answer) => !answer.holds)
      .map(failingAnswer)
      .join('\n\n')}`
  )
})
