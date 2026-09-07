#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { subagentStopGateVerdict } from '../src/hooklib/subagent-stop-gate.ts'

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0

await runHook('subagent-stop', (event) => {
  if (typeof event !== 'object' || event === null) return { block: false, json: {} }
  const record = event as Record<string, unknown>
  if (!isNonEmptyString(record.session_id) || !isNonEmptyString(record.cwd)) return { block: false, json: {} }

  const rt = productionRuntime()
  const verdict = subagentStopGateVerdict(rt, {
    session_id: record.session_id,
    cwd: record.cwd,
    agent_id: typeof record.agent_id === 'string' && record.agent_id.length > 0 ? record.agent_id : null
  })

  if (verdict.kind === 'block') return { block: true, reason: verdict.reason }
  return { block: false, json: {} }
})
