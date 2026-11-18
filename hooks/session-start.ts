#!/usr/bin/env node
import { enableCompileCache } from 'node:module'

enableCompileCache()

const { runHook } = await import('./lib/io.ts')
const { runSessionStart } = await import('../src/hook/session-start.ts')

await runHook('session-start', runSessionStart)
