#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { sessionStart } from '../src/hook/session-start.ts'

await runHook('session-start', sessionStart)
