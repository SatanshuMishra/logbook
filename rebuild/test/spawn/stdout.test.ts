import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { buildControlledEnv, spawnTransport } from '../support/spawn-client.ts'

const PROJECT_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const RUNTIME_DIST_PATH = fileURLToPath(new URL('../../dist/src/runtime/runtime.js', import.meta.url))
const MAIN_DIST_PATH = fileURLToPath(new URL('../../dist/src/server/main.js', import.meta.url))

const STRAY_BYTE = 'X'
const CONNECT_BACKSTOP_MS = 5000

const buildWrapperSource = (writeStrayByte: boolean): string => `
import { productionRuntime } from ${JSON.stringify(RUNTIME_DIST_PATH)}
import { main } from ${JSON.stringify(MAIN_DIST_PATH)}

${writeStrayByte ? `process.stdout.write('${STRAY_BYTE}')` : ''}

const rt = productionRuntime()
await main(rt)
`

const writeWrapper = (dir: string, writeStrayByte: boolean): string => {
  const wrapperPath = join(dir, 'wrapper.ts')
  writeFileSync(wrapperPath, buildWrapperSource(writeStrayByte), 'utf8')
  return wrapperPath
}

test('server.stray-stdout-breaks-transport', async () => {
  const entryDir = mkdtempSync(join(tmpdir(), 'logbook-stray-stdout-'))
  const homeDir = mkdtempSync(join(tmpdir(), 'logbook-stray-stdout-home-'))
  try {
    const wrapperPath = writeWrapper(entryDir, true)
    const { transport } = spawnTransport({
      command: process.execPath,
      args: [wrapperPath],
      cwd: PROJECT_ROOT,
      env: buildControlledEnv(homeDir)
    })
    const client = new Client({ name: 'logbook-stray-stdout-harness', version: '0.0.0' }, { capabilities: {} })

    const transportError = new Promise<Error>((resolve) => {
      transport.onerror = (error) => resolve(error)
    })

    let backstopTimer: ReturnType<typeof setTimeout> | undefined
    const backstop = new Promise<'timeout'>((resolve) => {
      backstopTimer = setTimeout(() => resolve('timeout'), CONNECT_BACKSTOP_MS)
    })

    const connectAttempt = client.connect(transport).catch((error: unknown) => error)

    try {
      const outcome = await Promise.race([transportError, backstop])
      assert.notEqual(outcome, 'timeout', 'expected the transport error channel to fire before the backstop timeout')

      const parseError = outcome as Error
      assert.match(parseError.message, /is not valid JSON/)
      assert.match(parseError.message, /Unexpected token/)
    } finally {
      clearTimeout(backstopTimer)
      void connectAttempt
      await client.close().catch(() => {})
    }
  } finally {
    rmSync(entryDir, { recursive: true, force: true })
    rmSync(homeDir, { recursive: true, force: true })
  }
})
