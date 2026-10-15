import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Runtime } from '../runtime/runtime.ts'
import { INSTRUCTIONS } from './instructions.ts'
import { ALL_TOOLS, registerTool } from './register.ts'

const SERVER_NAME = 'logbook'
const PACKAGE_JSON_SEARCH_DEPTH = 10

const readServerVersion = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < PACKAGE_JSON_SEARCH_DEPTH; depth += 1) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'))
      const version =
        typeof parsed === 'object' && parsed !== null && 'version' in parsed
          ? (parsed as { version: unknown }).version
          : undefined
      if (typeof version !== 'string') {
        throw new Error(`main: package.json at ${candidate} has no string "version" field`)
      }
      return version
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('main: could not locate package.json by walking up from the module directory')
}

const SERVER_VERSION = readServerVersion()

export const main = async (rt: Runtime): Promise<void> => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: INSTRUCTIONS,
      capabilities: {
        tools: { listChanged: true }
      }
    }
  )
  for (const tool of ALL_TOOLS) {
    registerTool(server, rt, tool)
  }
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
