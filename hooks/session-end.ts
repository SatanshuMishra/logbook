#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { parseSessionEndEvent, runSessionEnd } from '../src/cli/session-end.ts'

await runHook('session-end', (event) => {
  const parsed = parseSessionEndEvent(event)
  if (parsed === null) return { block: false, json: {} }

  const rt = productionRuntime()
  const reply = runSessionEnd(rt, parsed)
  if (reply.message === null) return { block: false, json: {} }
  return { block: false, json: { systemMessage: reply.message } }
})
