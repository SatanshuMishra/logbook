import { existsSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { buildControlledEnv, spawnTransport } from './spawn-client.ts'

export type MethodTally = ReadonlyMap<string, number>

export type CountingServer = {
  client: Client
  close: () => Promise<void>
  stderr: () => string
  instructions: () => string | undefined
  tally: () => MethodTally
  countOf: (method: string) => number
}

const DEFAULT_ENTRY_RELATIVE = 'rebuild/dist/bin/logbook-server.js'

const resolveEntry = (projectRoot: string, entry: string | undefined): string => {
  const resolved = entry ?? path.join(projectRoot, DEFAULT_ENTRY_RELATIVE)
  if (!existsSync(resolved)) {
    throw new Error(
      `spawnCountingServer: built entry point not found at ${resolved}. Run \`npm run rebuild:build\` first.`
    )
  }
  return resolved
}

const isOutgoingRequest = (message: unknown): message is { method: string } =>
  typeof message === 'object' &&
  message !== null &&
  'method' in message &&
  typeof (message as { method?: unknown }).method === 'string'

const wrapWithCallCounting = (
  transport: StdioClientTransport,
  counts: Map<string, number>
): StdioClientTransport =>
  new Proxy(transport, {
    get(target, prop, receiver) {
      if (prop === 'send') {
        return async (...args: Parameters<StdioClientTransport['send']>) => {
          const [message] = args
          if (isOutgoingRequest(message)) {
            counts.set(message.method, (counts.get(message.method) ?? 0) + 1)
          }
          return target.send(...args)
        }
      }
      const value = Reflect.get(target, prop, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })

export const spawnCountingServer = async (opts: {
  projectRoot: string
  env?: Record<string, string>
  entry?: string
}): Promise<CountingServer> => {
  const entryPath = resolveEntry(opts.projectRoot, opts.entry)
  const homeDir = mkdtempSync(path.join(tmpdir(), 'logbook-counting-home-'))

  try {
    const env = buildControlledEnv(homeDir, opts.env)
    const { transport, stderr } = spawnTransport({
      command: process.execPath,
      args: [entryPath],
      cwd: opts.projectRoot,
      env
    })

    const counts = new Map<string, number>()
    const countingTransport = wrapWithCallCounting(transport, counts)

    const client = new Client({ name: 'logbook-counting-harness', version: '0.0.0' }, { capabilities: {} })
    await client.connect(countingTransport)

    return {
      client,
      close: async () => {
        await client.close()
        rmSync(homeDir, { recursive: true, force: true })
      },
      stderr,
      instructions: () => client.getInstructions(),
      tally: () => new Map(counts),
      countOf: (method: string) => counts.get(method) ?? 0
    }
  } catch (error) {
    rmSync(homeDir, { recursive: true, force: true })
    throw error
  }
}
