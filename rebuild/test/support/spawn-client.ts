import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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

export const CONTROLLED_ENV_KEYS = ['HOME', 'LOGNAME', 'PATH', 'SHELL', 'TERM', 'USER'] as const

const PLATFORM_INJECTED_ENV_KEYS: readonly string[] =
  process.platform === 'darwin' ? ['__CF_USER_TEXT_ENCODING'] : []

export const classifyChildEnvKey = (key: string): 'allowed' | 'forbidden' =>
  (CONTROLLED_ENV_KEYS as readonly string[]).includes(key) || PLATFORM_INJECTED_ENV_KEYS.includes(key)
    ? 'allowed'
    : 'forbidden'

const FIXED_IDENTITY_ENV: Record<string, string> = {
  LOGNAME: 'logbook-test',
  SHELL: '/bin/false',
  TERM: 'dumb',
  USER: 'logbook-test'
}

export const buildControlledEnv = (homeDir: string, overrides?: Record<string, string>): Record<string, string> => {
  const inheritedPath = process.env.PATH
  return {
    ...(inheritedPath === undefined ? {} : { PATH: inheritedPath }),
    ...FIXED_IDENTITY_ENV,
    HOME: homeDir,
    ...(overrides ?? {})
  }
}

const resolveEntry = (projectRoot: string, entry: string | undefined): string => {
  const resolved = entry ?? path.join(projectRoot, DEFAULT_ENTRY_RELATIVE)
  if (!existsSync(resolved)) {
    throw new Error(
      `spawnServer: built entry point not found at ${resolved}. Run \`npm run rebuild:build\` first.`
    )
  }
  return resolved
}

export const spawnTransport = (opts: {
  command: string
  args: string[]
  cwd: string
  env: Record<string, string>
}): { transport: StdioClientTransport; stderr: () => string } => {
  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args,
    env: opts.env,
    cwd: opts.cwd,
    stderr: 'pipe'
  })

  let stderrBuffer = ''
  const stderrStream = transport.stderr
  if (stderrStream !== null) {
    stderrStream.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString('utf8')
    })
  }

  return { transport, stderr: () => stderrBuffer }
}

export const spawnServer = async (opts: {
  projectRoot: string
  env?: Record<string, string>
  entry?: string
}): Promise<SpawnedServer> => {
  const entryPath = resolveEntry(opts.projectRoot, opts.entry)
  const homeDir = mkdtempSync(path.join(tmpdir(), 'logbook-spawn-home-'))

  try {
    const env = buildControlledEnv(homeDir, opts.env)
    const { transport, stderr } = spawnTransport({
      command: process.execPath,
      args: [entryPath],
      cwd: opts.projectRoot,
      env
    })

    const client = new Client({ name: 'logbook-spawn-harness', version: '0.0.0' }, { capabilities: {} })
    await client.connect(transport)

    return {
      client,
      close: async () => {
        await client.close()
        rmSync(homeDir, { recursive: true, force: true })
      },
      stderr,
      instructions: () => client.getInstructions()
    }
  } catch (error) {
    rmSync(homeDir, { recursive: true, force: true })
    throw error
  }
}
