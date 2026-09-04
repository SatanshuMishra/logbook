import path from 'node:path'
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { ListResourcesResult } from '@modelcontextprotocol/sdk/types.js'
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js'
import type { Runtime } from '../runtime/runtime.ts'
import type { Slot, Store, Thread } from '../store/records.ts'
import { layoutFor } from '../store/layout.ts'
import { readAllRecordFiles } from '../store/read-path.ts'
import { BindingRecord, type Binding } from '../schema/binding.ts'
import { readPointer } from '../domain/pointer.ts'
import { escapeStored } from '../render/escape.ts'
import type { DecisionIntegrity } from '../render/briefing.ts'
import { paginateRoster, renderRoster, selectRosterThreads, toRosterRow } from '../render/roster.ts'
import { openProjectStore, resolvePredecessor } from './tool-support.ts'
import { ULID_PATTERN, SLUG_PATTERN } from '../schema/ids.ts'
import {
  renderDecisionResource,
  renderSessionEntryResource,
  renderSessionsResource,
  renderThreadDetail,
  type BindingIntegrity
} from './resource-render.ts'
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
  {
    shape: 'logbook://thread/{id}',
    description: 'one thread record in full, every risk and criterion id shown, resolved by its id or its slug'
  },
  { shape: 'logbook://decision/{id}', description: 'one decision record, resolved by its id' },
  {
    shape: 'logbook://sessions/{thread_id}',
    description: 'every session-log entry id for one thread with the first line shown for the newest 50 entries, newest first'
  },
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

const requireUlid = (addressLabel: string, field: string, value: string): string => {
  if (ULID_PATTERN.test(value)) return value
  throw new McpError(
    ErrorCode.InvalidParams,
    `${escapeStored(addressLabel)}: '${escapeStored(field, 'single-quoted')}' must be a ULID matching ${escapeStored(ULID_PATTERN.source)}, got '${escapeStored(value, 'single-quoted')}'`
  )
}

const requireThreadIdentifier = (addressLabel: string, field: string, value: string): string => {
  if (ULID_PATTERN.test(value) || SLUG_PATTERN.test(value)) return value
  throw new McpError(
    ErrorCode.InvalidParams,
    `${escapeStored(addressLabel)}: '${escapeStored(field, 'single-quoted')}' must be a ULID matching ${escapeStored(ULID_PATTERN.source)} or a slug matching ${escapeStored(SLUG_PATTERN.source)}, got '${escapeStored(value, 'single-quoted')}'`
  )
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

const decisionIntegrityForThread = (rt: Runtime, store: Store, thread: Thread): DecisionIntegrity => {
  const ids = thread.spine.key_decisions.map((keyDecision) => keyDecision.decision_id)
  const probe = store.probeDecisions(ids)

  for (const decisionId of probe.dangling) {
    rt.log({ level: 'error', event: 'resource.thread-decision-dangling', decision_id: decisionId })
  }
  for (const decisionId of probe.quarantined) {
    rt.log({ level: 'error', event: 'resource.thread-decision-quarantined', decision_id: decisionId })
  }

  return probe
}

const readBindingsForThread = (rt: Runtime, threadId: string): BindingIntegrity => {
  const layout = layoutFor(rt, rt.cwd)
  if (!layout.ok) {
    rt.log({ level: 'error', event: 'resource.thread-bindings-unreadable', detail: layout.message })
    return { bound: [], unreadable: 0, unread: true }
  }
  let slots: Slot<Binding>[]
  try {
    slots = readAllRecordFiles<Binding>(path.join(layout.value.records, 'bindings'), BindingRecord)
  } catch (error) {
    rt.log({
      level: 'error',
      event: 'resource.thread-bindings-unreadable',
      detail: error instanceof Error ? error.message : String(error)
    })
    return { bound: [], unreadable: 0, unread: true }
  }
  const bound: Binding[] = []
  let unreadable = 0
  for (const slot of slots) {
    if (slot.quarantined) {
      unreadable += 1
      rt.log({ level: 'error', event: 'resource.thread-binding-quarantined', detail: slot.reason })
      continue
    }
    if (slot.record.thread_id === threadId) bound.push(slot.record)
  }
  return { bound, unreadable, unread: false }
}

const readThreadResourceBody = (rt: Runtime, id: string): string => {
  const validId = requireThreadIdentifier('logbook://thread', 'id', id)
  const store = openStoreForRead(rt, 'logbook://thread')
  const slot = resolveThreadSlot(store, validId)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://thread: no thread record matches id or slug '${escapeStored(validId)}'`
    )
  }
  if (slot.quarantined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://thread: the record for '${escapeStored(validId)}' failed to parse and is quarantined: ${escapeStored(slot.reason)}`
    )
  }

  const thread = slot.record
  const decisionIntegrity = decisionIntegrityForThread(rt, store, thread)

  const layout = layoutFor(rt, rt.cwd)
  const pointerRead = layout.ok ? readPointer(rt, layout.value) : { kind: 'absent' as const }
  const pointer = pointerRead.kind === 'pointer' ? pointerRead.value : null

  return renderThreadDetail(
    thread,
    decisionIntegrity,
    pointer,
    resolvePredecessor(rt, store, thread),
    readBindingsForThread(rt, thread.id)
  )
}

const readSessionsResourceBody = (rt: Runtime, threadId: string): string => {
  const validThreadId = requireUlid('logbook://sessions', 'thread_id', threadId)
  const store = openStoreForRead(rt, 'logbook://sessions')
  const slot = store.readThread(validThreadId)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://sessions: no thread record matches id '${escapeStored(validThreadId)}'`
    )
  }
  const entries = store.readSessionEntries(validThreadId)
  const loaded = entries.flatMap((entry) => (entry.quarantined ? [] : [entry.record]))
  const quarantined = entries.flatMap((entry) =>
    entry.quarantined ? [path.basename(entry.path, '.json')] : []
  )
  return renderSessionsResource({
    threadId: validThreadId,
    entries: [...loaded].reverse(),
    quarantined,
    threadQuarantinedReason: slot.quarantined ? slot.reason : null
  })
}

const listThreadResources = (rt: Runtime): ListResourcesResult => {
  const opened = openProjectStore(rt)
  if (!opened.ok) {
    rt.log({ level: 'error', event: 'resource.thread-list-unavailable', detail: opened.refusal.message })
    return { resources: [] }
  }
  const threads = opened.value.readThreads().flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
  return {
    resources: selectRosterThreads(threads).map((thread) => ({
      uri: `logbook://thread/${escapeStored(thread.id)}`,
      name: escapeStored(thread.slug),
      description: 'one thread record in full, resolved by its id or its slug',
      mimeType: 'text/markdown'
    }))
  }
}

const readDecisionResourceBody = (rt: Runtime, id: string): string => {
  const validId = requireUlid('logbook://decision', 'id', id)
  const store = openStoreForRead(rt, 'logbook://decision')
  const slot = store.readDecision(validId)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://decision: no decision record matches id '${escapeStored(validId)}'`
    )
  }
  if (slot.quarantined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://decision: the record for '${escapeStored(validId)}' failed to parse and is quarantined: ${escapeStored(slot.reason)}`
    )
  }
  return renderDecisionResource(slot.record)
}

const readSessionEntryResourceBody = (rt: Runtime, threadId: string, entryId: string): string => {
  const validThreadId = requireUlid('logbook://session', 'thread_id', threadId)
  const validEntryId = requireUlid('logbook://session', 'entry_id', entryId)
  const store = openStoreForRead(rt, 'logbook://session')
  const slot = store.readSessionEntry(validThreadId, validEntryId)
  if (slot === null) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://session: no session entry '${escapeStored(validEntryId)}' exists for thread '${escapeStored(validThreadId)}'`
    )
  }
  if (slot.quarantined) {
    throw new McpError(
      ErrorCode.InvalidParams,
      `logbook://session: the entry '${escapeStored(validEntryId)}' for thread '${escapeStored(validThreadId)}' failed to parse and is quarantined: ${escapeStored(slot.reason)}`
    )
  }
  return renderSessionEntryResource(slot.record)
}

const readRosterResourceBody = (rt: Runtime): string => {
  const store = openStoreForRead(rt, 'logbook://roster')
  const threads = store
    .readThreads()
    .flatMap((slot) => (slot.quarantined ? [] : [slot.record]))
  const selected = selectRosterThreads(threads)
  const rows = selected.map(toRosterRow)
  const paginated = paginateRoster(rows, null, Math.max(rows.length, 1))
  if (!paginated.ok) {
    throw new McpError(ErrorCode.InternalError, 'logbook://roster: the roster could not be paginated')
  }
  return renderRoster(paginated.page, threads.length - selected.length)
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
      description: 'Every non-terminal thread with its progress toward completion, same content as list_threads.',
      mimeType: 'text/markdown'
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: readRosterResourceBody(rt) }] })
  )

  server.registerResource(
    'thread',
    new ResourceTemplate('logbook://thread/{id}', {
      list: () => listThreadResources(rt),
      complete: { id: (value, context) => completeThreadIdentifiers(rt, context, value) }
    }),
    {
      title: 'Thread',
      description: 'One thread record in full, every risk and criterion id shown, resolved by its ULID id or its slug.',
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
    'sessions',
    new ResourceTemplate('logbook://sessions/{thread_id}', {
      list: undefined,
      complete: { thread_id: (value, context) => completeSessionThreadIds(rt, context, value) }
    }),
    {
      title: 'Session log',
      description:
        'Every session-log entry id for one thread with the first line shown for the newest 50 entries, newest first. Read one in full at logbook://session/{thread_id}/{entry_id}.',
      mimeType: 'text/markdown'
    },
    (uri, variables) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: 'text/markdown',
          text: readSessionsResourceBody(rt, variableAsString(variables, 'thread_id'))
        }
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
