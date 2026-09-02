import { readdirSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { layoutFor } from '../store/layout.ts'
import { readAllRecordFiles } from '../store/read-path.ts'
import { DecisionRecord } from '../schema/decision.ts'
import { ULID_PATTERN } from '../schema/ids.ts'
import { openProjectStore } from './tool-support.ts'

export type CompletionContext = { arguments?: Record<string, string> }

const byCaseInsensitivePrefix = (candidates: readonly string[], value: string): string[] => {
  const needle = value.toLowerCase()
  return candidates.filter((candidate) => candidate.toLowerCase().startsWith(needle))
}

const logCompletionFailure = (rt: Runtime, source: string, detail: string): void => {
  rt.log({ level: 'error', event: 'completion.failed', source, detail })
}

export const completeThreadIdentifiers = (
  rt: Runtime,
  _context: CompletionContext | undefined,
  value: string
): string[] => {
  try {
    const opened = openProjectStore(rt)
    if (!opened.ok) {
      logCompletionFailure(rt, 'thread-identifiers', opened.refusal.message)
      return []
    }
    const identifiers = opened.value
      .readThreads()
      .flatMap((slot) => (slot.quarantined ? [] : [slot.record.id, slot.record.slug]))
    return byCaseInsensitivePrefix(identifiers, value)
  } catch (error) {
    logCompletionFailure(rt, 'thread-identifiers', error instanceof Error ? error.message : String(error))
    return []
  }
}

export const completeDecisionIds = (
  rt: Runtime,
  _context: CompletionContext | undefined,
  value: string
): string[] => {
  try {
    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) {
      logCompletionFailure(rt, 'decision-ids', layout.message)
      return []
    }
    const slots = readAllRecordFiles(path.join(layout.value.records, 'decisions'), DecisionRecord)
    const ids = slots.flatMap((slot) => (slot.quarantined ? [] : [slot.record.id]))
    return byCaseInsensitivePrefix(ids, value)
  } catch (error) {
    logCompletionFailure(rt, 'decision-ids', error instanceof Error ? error.message : String(error))
    return []
  }
}

export const completeSessionThreadIds = (
  rt: Runtime,
  _context: CompletionContext | undefined,
  value: string
): string[] => {
  try {
    const layout = layoutFor(rt, rt.cwd)
    if (!layout.ok) {
      logCompletionFailure(rt, 'session-thread-ids', layout.message)
      return []
    }
    let names: string[]
    try {
      names = readdirSync(path.join(layout.value.records, 'sessions'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        names = []
      } else {
        throw error
      }
    }
    return byCaseInsensitivePrefix(names, value)
  } catch (error) {
    logCompletionFailure(rt, 'session-thread-ids', error instanceof Error ? error.message : String(error))
    return []
  }
}

export const completeSessionEntryIds = (
  rt: Runtime,
  context: CompletionContext | undefined,
  value: string
): string[] => {
  try {
    const threadId = context?.arguments?.thread_id
    if (threadId === undefined || threadId.length === 0) return []
    if (!ULID_PATTERN.test(threadId)) return []
    const opened = openProjectStore(rt)
    if (!opened.ok) {
      logCompletionFailure(rt, 'session-entry-ids', opened.refusal.message)
      return []
    }
    const ids = opened.value
      .readSessionEntries(threadId)
      .flatMap((slot) => (slot.quarantined ? [] : [slot.record.id]))
    return byCaseInsensitivePrefix(ids, value)
  } catch (error) {
    logCompletionFailure(rt, 'session-entry-ids', error instanceof Error ? error.message : String(error))
    return []
  }
}
