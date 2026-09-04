import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import type { SpawnedServer } from '../support/spawn-client.ts'
import {
  readResourceText,
  readThreadResourceText,
  seedStore,
  withFixture
} from '../support/resources-fixture.ts'

const BACKSLASH_OFFENDER = '..\\PLANTED'

const assertBackslashRefused = async (
  spawned: SpawnedServer,
  uri: string,
  refusalPrefix: string
): Promise<void> => {
  const outcome = await spawned.client
    .readResource({ uri })
    .then((read) => ({ kind: 'resolved' as const, contentCount: read.contents.length }))
    .catch((error: unknown) => ({ kind: 'refused' as const, error }))

  assert.ok(
    outcome.kind === 'refused',
    `expected ${uri} to be refused, got a listing body carrying ${outcome.kind === 'resolved' ? outcome.contentCount : 0} content items`
  )
  const { error } = outcome
  assert.ok(error instanceof McpError, `expected the refusal to be an McpError, got ${String(error)}`)
  assert.equal(
    error.code,
    ErrorCode.InvalidParams,
    `expected the refusal to carry ErrorCode.InvalidParams, got ${error.code}`
  )
  assert.ok(
    error.message.includes(refusalPrefix),
    `expected the refusal message to contain '${refusalPrefix}', got '${error.message}'`
  )
}

const THREAD_ID_SHAPE_REFUSAL = "logbook://thread: 'id' must be a ULID matching"

test('resources.thread-refuses-an-id-containing-a-backslash', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    await assertBackslashRefused(
      fx.spawned,
      `logbook://thread/${BACKSLASH_OFFENDER}`,
      THREAD_ID_SHAPE_REFUSAL
    )

    const byUlid = await readThreadResourceText(fx.spawned, ids.threadId)
    assert.ok(
      byUlid.includes(`Id: ${ids.threadId}`),
      'expected a real ULID to still resolve after the backslash id is refused'
    )

    const bySlug = await fx.spawned.client.readResource({ uri: 'logbook://thread/resources-fixture-thread' })
    assert.ok(bySlug.contents.length > 0, 'expected a real slug to still resolve after the backslash id is refused')
  })
})

const SESSIONS_ID_SHAPE_REFUSAL = "logbook://sessions: 'thread_id' must be a ULID matching"

test('resources.sessions-refuses-a-thread-id-containing-a-backslash', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    await assertBackslashRefused(
      fx.spawned,
      `logbook://sessions/${BACKSLASH_OFFENDER}`,
      SESSIONS_ID_SHAPE_REFUSAL
    )

    const listing = await readResourceText(fx.spawned, `logbook://sessions/${ids.sessionThreadId}`)
    assert.ok(
      listing.includes(ids.sessionEntryId),
      'expected a real ULID thread_id to still resolve after the backslash thread_id is refused'
    )
  })
})

const DECISION_ID_SHAPE_REFUSAL = "logbook://decision: 'id' must be a ULID matching"

test('resources.decision-refuses-an-id-containing-a-backslash', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    await assertBackslashRefused(
      fx.spawned,
      `logbook://decision/${BACKSLASH_OFFENDER}`,
      DECISION_ID_SHAPE_REFUSAL
    )

    const decisionText = await readResourceText(fx.spawned, `logbook://decision/${ids.decisionId}`)
    assert.ok(
      decisionText.length > 0,
      'expected a real ULID decision id to still resolve after the backslash id is refused'
    )
  })
})

const SESSION_THREAD_ID_SHAPE_REFUSAL = "logbook://session: 'thread_id' must be a ULID matching"

test('resources.session-refuses-a-thread-id-containing-a-backslash', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    await assertBackslashRefused(
      fx.spawned,
      `logbook://session/${BACKSLASH_OFFENDER}/${ids.sessionEntryId}`,
      SESSION_THREAD_ID_SHAPE_REFUSAL
    )

    const entryText = await readResourceText(
      fx.spawned,
      `logbook://session/${ids.sessionThreadId}/${ids.sessionEntryId}`
    )
    assert.ok(
      entryText.length > 0,
      'expected a real ULID thread_id to still resolve after the backslash thread_id is refused'
    )
  })
})

const SESSION_ENTRY_ID_SHAPE_REFUSAL = "logbook://session: 'entry_id' must be a ULID matching"

test('resources.session-refuses-an-entry-id-containing-a-backslash', async () => {
  await withFixture(async (fx) => {
    const ids = await seedStore(fx.spawned)

    await assertBackslashRefused(
      fx.spawned,
      `logbook://session/${ids.sessionThreadId}/${BACKSLASH_OFFENDER}`,
      SESSION_ENTRY_ID_SHAPE_REFUSAL
    )

    const entryText = await readResourceText(
      fx.spawned,
      `logbook://session/${ids.sessionThreadId}/${ids.sessionEntryId}`
    )
    assert.ok(
      entryText.length > 0,
      'expected a real ULID entry_id to still resolve after the backslash entry_id is refused'
    )
  })
})

const SHAPE_REFUSED_VALUE = 'NOT-A-VALID-IDENTIFIER'

const refusedResourceMessage = async (spawned: SpawnedServer, uri: string): Promise<string> => {
  const outcome = await spawned.client
    .readResource({ uri })
    .then((read) => ({ kind: 'resolved' as const, contentCount: read.contents.length }))
    .catch((error: unknown) => ({ kind: 'refused' as const, error }))

  assert.ok(
    outcome.kind === 'refused',
    `expected ${uri} to be refused, got a body carrying ${outcome.kind === 'resolved' ? outcome.contentCount : 0} content items`
  )
  const { error } = outcome
  assert.ok(error instanceof McpError, `expected the refusal to be an McpError, got ${String(error)}`)
  assert.equal(
    error.code,
    ErrorCode.InvalidParams,
    `expected the refusal to carry ErrorCode.InvalidParams, got ${error.code}`
  )
  return error.message
}

const lastQuotedValueOf = (message: string): string => {
  const quoted = message.match(/'[^']*'/g) ?? []
  const last = quoted[quoted.length - 1]
  assert.ok(
    last !== undefined,
    `a shape refusal must quote the value it rejected, or there is nothing for a hostile value to forge, but the message read: ${message}`
  )
  return last as string
}

const assertQuoteCannotForgeTheRejectedValue = async (
  spawned: SpawnedServer,
  uriFor: (value: string) => string
): Promise<void> => {
  const legitimateMessage = await refusedResourceMessage(spawned, uriFor(SHAPE_REFUSED_VALUE))
  const legitimateQuoted = lastQuotedValueOf(legitimateMessage)
  assert.equal(
    legitimateQuoted,
    `'${SHAPE_REFUSED_VALUE}'`,
    `the quoted value must be the one the caller sent, or this test is reading the wrong span of ${legitimateMessage}`
  )

  const forgedMessage = await refusedResourceMessage(
    spawned,
    uriFor(`${SHAPE_REFUSED_VALUE}'-and-the-address-resolved`)
  )
  assert.equal(
    forgedMessage.includes(legitimateQuoted),
    false,
    `an address value carrying a single quote must not render a quoted value byte-identical to ${legitimateQuoted}, or the quotes stop telling the reader where the caller's value ends and the rest of it reads as the server's own words, but the message read: ${forgedMessage}`
  )
}

test('resources.thread-a-single-quote-inside-the-id-cannot-forge-a-legitimate-quoted-value', async () => {
  await withFixture(async (fx) => {
    await assertQuoteCannotForgeTheRejectedValue(fx.spawned, (value) => `logbook://thread/${value}`)
  })
})

test('resources.decision-a-single-quote-inside-the-id-cannot-forge-a-legitimate-quoted-value', async () => {
  await withFixture(async (fx) => {
    await assertQuoteCannotForgeTheRejectedValue(fx.spawned, (value) => `logbook://decision/${value}`)
  })
})
