import { existsSync } from 'node:fs'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export type SpawnedServer = {
  client: Client
  close: () => Promise<void>
  stderr: () => string
  instructions: () => string | undefined
}

const DEFAULT_ENTRY_RELATIVE = 'rebuild/dist/bin/logbook-server.js'

const resolveEntry = (projectRoot: string, entry: string | undefined): string => {
  const resolved = entry ?? path.join(projectRoot, DEFAULT_ENTRY_RELATIVE)
  if (!existsSync(resolved)) {
    throw new Error(
      `spawnServer: built entry point not found at ${resolved}. Run \`npm run rebuild:build\` first.`
    )
  }
  return resolved
}

const baseSpawnEnv = (): Record<string, string> => {
  const inheritedPath = process.env.PATH
  return inheritedPath === undefined ? {} : { PATH: inheritedPath }
}

export const spawnServer = async (opts: {
  projectRoot: string
  env?: Record<string, string>
  entry?: string
}): Promise<SpawnedServer> => {
  const entryPath = resolveEntry(opts.projectRoot, opts.entry)
  const env = { ...baseSpawnEnv(), ...(opts.env ?? {}) }

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entryPath],
    env,
    cwd: opts.projectRoot,
    stderr: 'pipe'
  })

  let stderrBuffer = ''
  const stderrStream = transport.stderr
  if (stderrStream !== null) {
    stderrStream.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8')
    })
  }

  const client = new Client({ name: 'logbook-spawn-harness', version: '0.0.0' }, { capabilities: {} })
  await client.connect(transport)

  return {
    client,
    close: async () => {
      await client.close()
    },
    stderr: () => stderrBuffer,
    instructions: () => client.getInstructions()
  }
}
