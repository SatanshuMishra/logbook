import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnServer, type SpawnedServer } from '../../support/spawn-client.ts'

const LOGBOOK_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ENTRY = join(LOGBOOK_ROOT, 'bin', 'logbook-server.ts')
const REGISTER_PATH = join(LOGBOOK_ROOT, 'test', 'registers', 'public-interface.json')

const NINE_TOOLS = [
  'open_thread',
  'resume_thread',
  'record_decision',
  'update_thread',
  'park_thread',
  'close_thread',
  'list_threads',
  'search_ledger',
  'sync_ledger'
]

const METHOD_NOT_FOUND = -32601

type RegisterTool = { input: Record<string, string>; output: string[] }
type Register = { series: string; tools: Record<string, RegisterTool> }

const withServer = async (fn: (spawned: SpawnedServer) => Promise<void>): Promise<void> => {
  const dir = mkdtempSync(join(tmpdir(), 'logbook-surface-'))
  try {
    const spawned = await spawnServer({ projectRoot: dir, entry: ENTRY })
    try {
      await fn(spawned)
    } finally {
      await spawned.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const sorted = (names: Iterable<string>): string[] => [...names].sort()

const readRegister = (): Register => JSON.parse(readFileSync(REGISTER_PATH, 'utf8')) as Register

const methodNotFound = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code: unknown }).code === METHOD_NOT_FOUND

test('surface.publishes-the-nine-tools', async () => {
  await import('../../../src/server/main.ts')
  await withServer(async (spawned) => {
    const listed = await spawned.client.listTools()

    assert.deepEqual(sorted(listed.tools.map((tool) => tool.name)), sorted(NINE_TOOLS))
  })
})

test('surface.publishes-no-resources-or-prompts', async () => {
  await import('../../../src/server/main.ts')
  await withServer(async (spawned) => {
    assert.equal(spawned.client.getServerCapabilities()?.resources, undefined)
    assert.equal(spawned.client.getServerCapabilities()?.prompts, undefined)
    await assert.rejects(spawned.client.listResources(), methodNotFound, 'resources/list must fail with method not found')
    await assert.rejects(spawned.client.listPrompts(), methodNotFound, 'prompts/list must fail with method not found')
  })
})

test('surface.instructions-describe-the-state-document', async () => {
  await import('../../../src/server/main.ts')
  await withServer(async (spawned) => {
    const instructions = spawned.instructions()

    assert.ok(instructions !== undefined, 'the initialize reply must carry server instructions')
    for (const phrase of ['state document', 'Edit tool', 'do not print', ...NINE_TOOLS]) {
      assert.ok(instructions.includes(phrase), `the server instructions must hold "${phrase}", got:\n${instructions}`)
    }
  })
})

test('surface.register-matches-the-tools', async () => {
  await import('../../../src/server/main.ts')
  const register = readRegister()

  assert.equal(register.series, '0.16')
  await withServer(async (spawned) => {
    const listed = await spawned.client.listTools()
    const published = Object.fromEntries(
      listed.tools.map((tool) => [tool.name, sorted(Object.keys(tool.inputSchema.properties ?? {}))])
    )
    const pinned = Object.fromEntries(
      Object.entries(register.tools).map(([name, contract]) => [name, sorted(Object.keys(contract.input))])
    )

    assert.deepEqual(sorted(Object.keys(pinned)), sorted(NINE_TOOLS))
    assert.deepEqual(pinned, published)
  })
})
