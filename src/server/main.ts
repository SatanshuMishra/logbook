import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Runtime } from '../runtime/runtime.ts'
import { pluginVersion } from '../runtime/version.ts'
import { INSTRUCTIONS } from './instructions.ts'
import { ALL_TOOLS, registerTool } from './register.ts'

const SERVER_NAME = 'logbook'

const SERVER_VERSION = pluginVersion()

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
