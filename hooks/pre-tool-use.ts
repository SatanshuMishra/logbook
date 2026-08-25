#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { guardDecision } from '../src/hooklib/guard.ts'

await runHook('pre-tool-use', (event) => {
  const rt = productionRuntime()
  const verdict = guardDecision(rt, event)

  if (verdict.kind === 'silent') return { block: false, json: {} }
  if (verdict.kind === 'deny') return { block: true, reason: verdict.reason }

  return {
    block: false,
    json: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: verdict.kind,
        permissionDecisionReason: verdict.reason
      }
    }
  }
})
