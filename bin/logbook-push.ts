#!/usr/bin/env node
import { productionRuntime } from '../src/runtime/runtime.ts'
import { gitDetached } from '../src/store/git.ts'

const PUSH_ARGS = ['push', 'origin', 'refs/logbook/threads:refs/logbook/threads']

const rt = productionRuntime()
const repo = process.argv[2]

if (repo === undefined || repo === '') {
  process.exitCode = 1
} else {
  const run = await gitDetached(rt, repo, PUSH_ARGS)
  process.exitCode = run.code === 0 ? 0 : 1
}
