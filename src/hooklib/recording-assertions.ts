import type { Thread } from '../store/records.ts'

export type ThreadObservation = {
  keyDecisionsEmpty: boolean
  noUnstruckCriterion: boolean
  noArtifact: boolean
}

export const observationFromThread = (thread: Thread): ThreadObservation => ({
  keyDecisionsEmpty: thread.spine.key_decisions.length === 0,
  noUnstruckCriterion: thread.completion_criteria.every((criterion) => criterion.struck_by !== null),
  noArtifact: (thread.artifacts ?? []).every((artifact) => artifact.retired)
})

const R7_TEXT = 'Every selection between options is recorded by whoever selected. No subagent saw the alternatives.'
const R8_TEXT = "The thread's definition of done reflects what is now known."
const R9_TEXT =
  'The recorded next action is one someone could begin without re-deriving anything, naming the file and the ' +
  'place in it for an action that involves one.'
const R10_TEXT = 'Everything a subagent returned but could not record itself is on the record.'

const withPrefixWhen = (silentOn: boolean, substring: string, text: string): string =>
  silentOn ? `The record holds nothing for this: ${substring}. ${text}` : text

const assertionLines = (observation: ThreadObservation | null): string[] => [
  withPrefixWhen(observation !== null && observation.keyDecisionsEmpty, 'no decision is linked to this thread', R7_TEXT),
  withPrefixWhen(
    observation !== null && observation.noUnstruckCriterion,
    'no un-struck criterion is on this thread',
    R8_TEXT
  ),
  R9_TEXT,
  withPrefixWhen(observation !== null && observation.noArtifact, 'no artifact is named on this thread', R10_TEXT)
]

const RECORDING_ACTION_TEXT =
  "Record what was established with record_decision, note progress with update_thread, or end this session's " +
  'work on the thread with park_thread.'

const CLOSING_TEXT =
  'This verdict reports only that the record is silent, and it makes no claim about what the answer should be. ' +
  'It makes no claim that what is recorded is complete.'

const assertionsBody = (threadId: string, observation: ThreadObservation | null): string =>
  `A fresh session picking up ${threadId} would need each of the following to hold.\n\n` +
  assertionLines(observation)
    .map((line) => `- ${line}`)
    .join('\n') +
  `\n\n${RECORDING_ACTION_TEXT} ${CLOSING_TEXT}`

export const untouchedAssertionsReason = (threadId: string, observation: ThreadObservation | null): string =>
  `Logbook: nothing has reached this project's ledger since the thread ${threadId} was resumed. ` +
  assertionsBody(threadId, observation)

export const mismatchAssertionsReason = (threadId: string, observation: ThreadObservation | null): string =>
  `Logbook: records have reached this project's ledger, but none of them is filed under thread ${threadId}. ` +
  assertionsBody(threadId, observation)
