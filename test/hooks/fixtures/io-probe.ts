#!/usr/bin/env node
import { runHook } from '../../../hooks/lib/io.ts'

const contextFor = (event: Record<string, unknown>, root: string): string => {
  if (event.echo === 'root') return root
  return 'x'.repeat(typeof event.size === 'number' ? event.size : 1)
}

await runHook('io-probe', ({ event, paths }) => {
  if (typeof event.throw === 'string') throw new Error(event.throw)
  return {
    hookSpecificOutput: { hookEventName: 'Probe', additionalContext: contextFor(event, paths.root) },
    probe: 'ran'
  }
})
