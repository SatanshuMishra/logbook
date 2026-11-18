#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { permissionDecision } from '../src/hook/permission.ts'

const PERMISSION_TOOLS: ReadonlySet<string> = new Set(['Read', 'Edit'])

const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

await runHook('pre-tool-use', ({ event, rt }) => {
  const tool = text(event.tool_name)
  if (tool === null || !PERMISSION_TOOLS.has(tool)) return {}
  const toolInput = isRecord(event.tool_input) ? event.tool_input : {}
  return permissionDecision(rt, { tool_name: tool, tool_input: toolInput })
})
