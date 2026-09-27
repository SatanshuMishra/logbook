#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { guardDecision } from '../src/hooklib/guard.ts'
import { fileRecordsContext } from '../src/hooklib/file-records.ts'

await runHook('pre-tool-use', (event) => {
  const rt = productionRuntime()
  const verdict = guardDecision(rt, event)

  if (verdict.kind === 'deny') return { block: true, reason: verdict.reason }

  const context = fileRecordsContext(rt, event)
  if (verdict.kind === 'silent' && context === null) return { block: false, json: {} }

  return {
    block: false,
    json: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        ...(verdict.kind === 'silent'
          ? {}
          : { permissionDecision: verdict.kind, permissionDecisionReason: verdict.reason }),
        ...(context === null ? {} : { additionalContext: context })
      }
    }
  }
})
