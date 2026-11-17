#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { runSessionStart } from '../src/hook/session-start.ts'

await runHook('session-start', runSessionStart)
