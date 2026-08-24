import { escapeStored } from '../render/escape.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'

export const renderDecisionResource = (decision: Decision): string =>
  [
    `Decision: ${escapeStored(decision.title)}`,
    `Thread: ${decision.thread_id}`,
    `Context: ${escapeStored(decision.context)}`,
    'Options:',
    ...decision.options.map((option) => `- ${escapeStored(option)}`),
    `Outcome: ${escapeStored(decision.outcome)}`,
    `Commit: ${decision.commit ?? 'unknown'}`,
    `Supersedes: ${decision.supersedes.length === 0 ? 'none' : decision.supersedes.join(', ')}`,
    `Recorded: ${decision.created_at}`
  ].join('\n')

export const renderSessionEntryResource = (entry: SessionEntry): string =>
  [
    `Session entry: ${entry.id}`,
    `Thread: ${entry.thread_id}`,
    `Actor: ${escapeStored(entry.actor)}`,
    `Recorded: ${entry.created_at}`,
    '',
    escapeStored(entry.body)
  ].join('\n')
