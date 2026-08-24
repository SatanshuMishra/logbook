#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { parseSessionStartEvent, runSessionStart } from '../src/cli/session-start.ts'

await runHook('session-start', (event) => {
  const parsed = parseSessionStartEvent(event)
  if (parsed === null) return { block: false, json: {} }

  const rt = productionRuntime()
  const reply = runSessionStart(rt, parsed)
  return {
    block: false,
    json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: reply.additionalContext } }
  }
})
