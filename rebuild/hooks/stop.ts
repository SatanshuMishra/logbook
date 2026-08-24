#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { stopGateVerdict } from '../src/hooklib/stop-gate.ts'

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

await runHook('stop', (event) => {
  if (typeof event !== 'object' || event === null) return { block: false, json: {} }
  const record = event as Record<string, unknown>
  if (!isNonEmptyString(record.session_id) || !isNonEmptyString(record.cwd)) return { block: false, json: {} }

  const rt = productionRuntime()
  const verdict = stopGateVerdict(rt, {
    session_id: record.session_id,
    cwd: record.cwd,
    transcript_path: record.transcript_path,
    stop_hook_active: record.stop_hook_active === true
  })

  if (verdict.kind === 'block') return { block: true, reason: verdict.reason }
  return { block: false, json: {} }
})
