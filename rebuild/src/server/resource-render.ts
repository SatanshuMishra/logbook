import { escapeStored } from '../render/escape.ts'
import type { Decision } from '../schema/decision.ts'
import type { SessionEntry } from '../schema/session.ts'

const renderCommitLine = (commit: string | null): string =>
  typeof commit !== 'string' ? 'Commit: unknown' : 'Commit: ' + escapeStored(commit)

const renderSupersedesLine = (supersedes: readonly string[]): string =>
  supersedes.length === 0
    ? 'Supersedes: none'
    : ['Supersedes:', supersedes.map((id) => escapeStored(id)).join(', ')].join(' ')

export const renderDecisionResource = (decision: Decision): string =>
  [
    `Decision: ${escapeStored(decision.title)}`,
    `Thread: ${escapeStored(decision.thread_id)}`,
    `Context: ${escapeStored(decision.context)}`,
    'Options:',
    ...decision.options.map((option) => `- ${escapeStored(option)}`),
    `Outcome: ${escapeStored(decision.outcome)}`,
    renderCommitLine(decision.commit),
    renderSupersedesLine(decision.supersedes),
    `Recorded: ${escapeStored(decision.created_at)}`
  ].join('\n')

export const renderSessionEntryResource = (entry: SessionEntry): string =>
  [
    `Session entry: ${escapeStored(entry.id)}`,
    `Thread: ${escapeStored(entry.thread_id)}`,
    `Actor: ${escapeStored(entry.actor)}`,
    `Recorded: ${escapeStored(entry.created_at)}`,
    '',
    escapeStored(entry.body)
  ].join('\n')
