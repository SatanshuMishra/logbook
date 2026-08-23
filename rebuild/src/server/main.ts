import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Runtime } from '../runtime/runtime.ts'
import { INSTRUCTIONS } from './instructions.ts'

const SERVER_NAME = 'logbook'
const SERVER_VERSION = '0.2.8'

type ToolListingInitializer = { setToolRequestHandlers: () => void }

const activateEmptyToolListing = (server: McpServer): void => {
  ;(server as unknown as ToolListingInitializer).setToolRequestHandlers()
}

export const main = async (_rt: Runtime): Promise<void> => {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: INSTRUCTIONS,
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true },
        prompts: {},
        completions: {}
      }
    }
  )
  activateEmptyToolListing(server)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
