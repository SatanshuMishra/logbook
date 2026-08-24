#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { isCommitShapedCommand, noteProjectCommit } from '../src/hooklib/commit-note.ts'

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

await runHook('post-tool-use', (event) => {
  if (typeof event !== 'object' || event === null) return { block: false, json: {} }
  const record = event as Record<string, unknown>
  const toolInput = typeof record.tool_input === 'object' && record.tool_input !== null ? record.tool_input : null
  const command = toolInput === null ? undefined : (toolInput as Record<string, unknown>).command

  if (!isCommitShapedCommand(record.tool_name, command)) return { block: false, json: {} }
  if (!isNonEmptyString(record.cwd) || !isNonEmptyString(record.session_id)) return { block: false, json: {} }

  const rt = productionRuntime()
  noteProjectCommit(rt, record.cwd, record.session_id)
  return { block: false, json: {} }
})
