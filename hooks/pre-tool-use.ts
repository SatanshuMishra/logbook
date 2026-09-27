#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { guardDecision } from '../src/hooklib/guard.ts'

const FILE_TOOL_NAME = /^(?:Read|Write|Edit|MultiEdit|NotebookEdit)$/

const isFileToolEvent = (event: unknown): boolean =>
  typeof event === 'object' &&
  event !== null &&
  FILE_TOOL_NAME.test(String((event as Record<string, unknown>).tool_name))

await runHook('pre-tool-use', async (event) => {
  const rt = productionRuntime()
  const verdict = guardDecision(rt, event)

  if (verdict.kind === 'deny') return { block: true, reason: verdict.reason }

  const context = isFileToolEvent(event)
    ? (await import('../src/hooklib/file-records.ts')).fileRecordsContext(rt, event)
    : null
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
