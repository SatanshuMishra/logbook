#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { isResumeIntent } from '../src/hooklib/resume-intent.ts'
import { renderThreadListing } from '../src/cli/session-start.ts'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

await runHook('user-prompt-submit', (event) => {
  if (!isPlainObject(event) || !isResumeIntent(event.prompt)) {
    return { block: false, json: {} }
  }

  const rt = productionRuntime()
  const cwd = typeof event.cwd === 'string' && event.cwd.length > 0 ? event.cwd : rt.cwd
  const listing = renderThreadListing(rt, cwd)
  return {
    block: false,
    json: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: listing } }
  }
})
