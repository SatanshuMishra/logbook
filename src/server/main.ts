import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Runtime } from '../runtime/runtime.ts'
import { actingSession, heldBy, recordProcess } from '../thread/holds.ts'
import { findRepository, startDirectory } from '../thread/paths.ts'
import { pluginVersion } from '../runtime/version.ts'
import { INSTRUCTIONS } from './instructions.ts'
import { ALL_TOOLS, registerTool } from './register.ts'

const SERVER_NAME = 'logbook'

const SERVER_VERSION = pluginVersion()

const recordServerProcess = (rt: Runtime): void => {
  try {
    const found = findRepository(rt, startDirectory(rt, rt.cwd ?? ''))
    if (!found.ok) return
    const slug = heldBy(found.value, actingSession(found.value, rt.sessionId))
    if (slug !== null) recordProcess(rt, found.value, slug, rt.parentProcess)
  } catch (error) {
    rt.log({
      level: 'warn',
      event: 'server.record-process-failed',
      reason: error instanceof Error ? error.message : String(error)
    })
  }
}

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
  recordServerProcess(rt)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
