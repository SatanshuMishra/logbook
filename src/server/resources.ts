import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import type { Runtime } from '../runtime/runtime.ts'
import type { Decision } from '../schema/decision.ts'
import type { Slot, Store, Thread } from '../store/records.ts'
import { layoutFor } from '../store/layout.ts'
import { readPointer } from '../domain/pointer.ts'
import { escapeStored } from '../render/escape.ts'
import { renderBriefing } from '../render/briefing.ts'
import { paginateRoster, renderRoster, selectRosterThreads, toRosterRow } from '../render/roster.ts'
import { openProjectStore, resolvePredecessor } from './tool-support.ts'
import { renderDecisionResource, renderSessionEntryResource } from './resource-render.ts'
import {
  completeDecisionIds,
  completeSessionEntryIds,
  completeSessionThreadIds,
  completeThreadIdentifiers
} from './completions.ts'

type Address = { shape: string; description: string }

const ADDRESSES: readonly Address[] = [
  { shape: 'logbook://index', description: 'lists every address this server publishes, one per line, this line included' },
  { shape: 'logbook://roster', description: 'the resumable roster, the same content list_threads returns' },
  { shape: 'logbook://thread/{id}', description: 'one thread record, rendered, resolved by its id or its slug' },
  { shape: 'logbook://decision/{id}', description: 'one decision record, resolved by its id' },
  {
    shape: 'logbook://session/{thread_id}/{entry_id}',
    description: 'one session-log entry, resolved by its thread id and its own id'
  }
]

export const ADDRESS_SHAPES: readonly string[] = ADDRESSES.map((address) => address.shape)

const renderIndexBody = (): string => ADDRESSES.map((address) => `${address.shape} - ${address.description}`).join('\n')

const variableAsString = (variables: Variables, key: string): string => {
  const value = variables[key]
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value[0] ?? ''
  return ''
}

const openStoreForRead = (rt: Runtime, addressLabel: string): Store => {
  const opened = openProjectStore(rt)
  if (!opened.ok) {
    throw new McpError(
      ErrorCode.InternalError,
      [escapeStored(addressLabel), ': the store could not be opened: ', escapeStored(opened.refusal.message)].join('')
    )
  }
  return opened.value
}

const resolveThreadSlot = (store: Store, id: string): Slot<Thread> | null => {
  const byId = store.readThread(id)
  if (byId !== null) return byId
  const bySlug = store.readThreads().find((slot) => !slot.quarantined && slot.record.slug === id)
  return bySlug ?? null
}

const decisionsForThread = (rt: Runtime, store: Store, thread: Thread): Decision[] => {
  const outcomes = thread.spine.key_decisions.map((keyDecision) => ({
    decisionId: keyDecision.decision_id,
    slot: store.readDecision(keyDecision.decision_id)
  }))

  for (const outcome of outcomes) {
    if (outcome.slot === null) {
      rt.log({ level: 'error', event: 'resource.thread-decision-dangling', decision_id: outcome.decisionId })
    } else if (outcome.slot.quarantined) {
      rt.log({ level: 'error', event: 'resource.thread-decision-quarantined', decision_id: outcome.decisionId })
    }
  }

  return outcomes
    .filter(
      (outcome): outcome is { decisionId: string; slot: { quarantined: false; record: Decision } } =>
        outcome.slot !== null && !outcome.slot.quarantined
    )
    .map((outcome) => outcome.slot.record)
}

const readThreadResourceBody = (rt: Runtime, id: string): string => {
  const store = openStoreForRead(rt, 'logbook://thread')
  const slot = resolveThreadSlot(store, id)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://thread: no thread record matches id or slug '${escapeStored(id)}'`
    )
  }
  if (slot.quarantined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://thread: the record for '${escapeStored(id)}' failed to parse and is quarantined: ${escapeStored(slot.reason)}`
    )
  }

  const thread = slot.record
  const decisions = decisionsForThread(rt, store, thread)

  const layout = layoutFor(rt, rt.cwd)
  const pointerRead = layout.ok ? readPointer(rt, layout.value) : { kind: 'absent' as const }
  const pointer = pointerRead.kind === 'pointer' ? pointerRead.value : null

  return renderBriefing(thread, decisions, pointer, resolvePredecessor(rt, store, thread))
}

const readDecisionResourceBody = (rt: Runtime, id: string): string => {
  const store = openStoreForRead(rt, 'logbook://decision')
  const slot = store.readDecision(id)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://decision: no decision record matches id '${escapeStored(id)}'`
    )
  }
  if (slot.quarantined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://decision: the record for '${escapeStored(id)}' failed to parse and is quarantined: ${escapeStored(slot.reason)}`
    )
  }
  return renderDecisionResource(slot.record)
}

const readSessionEntryResourceBody = (rt: Runtime, threadId: string, entryId: string): string => {
  const store = openStoreForRead(rt, 'logbook://session')
  const slot = store.readSessionEntry(threadId, entryId)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://session: no session entry '${escapeStored(entryId)}' exists for thread '${escapeStored(threadId)}'`
    )
  }
  if (slot.quarantined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://session: the entry '${escapeStored(entryId)}' for thread '${escapeStored(threadId)}' failed to parse and is quarantined: ${escapeStored(slot.reason)}`
    )
  }
  return renderSessionEntryResource(slot.record)
}

const readRosterResourceBody = (rt: Runtime): string => {
  const store = openStoreForRead(rt, 'logbook://roster')
  const threads = store
    .readThreads()
    .flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
  const rows = selectRosterThreads(threads).map(toRosterRow)
  const paginated = paginateRoster(rows, null, Math.max(rows.length, 1))
  if (!paginated.ok) {
    throw new McpError(ErrorCode.InternalError, 'logbook://roster: the roster could not be paginated')
  }
  return renderRoster(paginated.page)
}

export const registerResources = (server: McpServer, rt: Runtime): void => {
  server.registerResource(
    'index',
    'logbook://index',
    {
      title: 'Logbook address index',
      description: 'Every readable logbook:// address this server publishes, one per line.',
      mimeType: 'text/markdown'
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: renderIndexBody() }] })
  )

  server.registerResource(
    'roster',
    'logbook://roster',
    {
      title: 'Resumable roster',
      description: 'Every non-terminal thread with its state, progress and next step, same content as list_threads.',
      mimeType: 'text/markdown'
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readRosterResourceBody(rt) }] })
  )

  server.registerResource(
    'thread',
    new ResourceTemplate('logbook://thread/{id}', {
      list: undefined,
      complete: { id: (value, context) => completeThreadIdentifiers(rt, context, value) }
    }),
    {
      title: 'Thread',
      description: 'One thread record, rendered, resolved by its ULID id or its slug.',
      mimeType: 'text/markdown'
    },
    (uri, variables) => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: readThreadResourceBody(rt, variableAsString(variables, 'id')) }
      ]
    })
  )

  server.registerResource(
    'decision',
    new ResourceTemplate('logbook://decision/{id}', {
      list: undefined,
      complete: { id: (value, context) => completeDecisionIds(rt, context, value) }
    }),
    {
      title: 'Decision',
      description: 'One decision record, resolved by its ULID id.',
      mimeType: 'text/markdown'
    },
    (uri, variables) => ({
      contents: [
        { uri: uri.href, mimeType: 'text/markdown', text: readDecisionResourceBody(rt, variableAsString(variables, 'id')) }
      ]
    })
  )

  server.registerResource(
    'session',
    new ResourceTemplate('logbook://session/{thread_id}/{entry_id}', {
      list: undefined,
      complete: {
        thread_id: (value, context) => completeSessionThreadIds(rt, context, value),
        entry_id: (value, context) => completeSessionEntryIds(rt, context, value)
      }
    }),
    {
      title: 'Session entry',
      description: 'One session-log entry, resolved by its thread id and its own id.',
      mimeType: 'text/markdown'
    },
    (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: readSessionEntryResourceBody(rt, variableAsString(variables, 'thread_id'), variableAsString(variables, 'entry_id'))
        }
      ]
    })
  )
}
