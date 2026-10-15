#!/usr/bin/env node
import { productionRuntime } from '../src/runtime/runtime.ts'
import { gitTimed } from '../src/store/git.ts'

const PUSH_ARGS = ['push', 'origin', 'refs/logbook/threads:refs/logbook/threads']

const parseTimeoutMs = (text: string | undefined): number | null => {
  if (text === undefined || !/^[1-9][0-9]*$/.test(text)) return null
  const value = Number(text)
  return Number.isSafeInteger(value) ? value : null
}

const rt = productionRuntime()
const repo = process.argv[2]
const timeoutMs = parseTimeoutMs(process.argv[3])

if (repo === undefined || repo === '' || timeoutMs === null) {
  process.exitCode = 1
} else {
  const run = await gitTimed(rt, repo, PUSH_ARGS, { timeoutMs })
  process.exitCode = run.code === 0 ? 0 : 1
}
