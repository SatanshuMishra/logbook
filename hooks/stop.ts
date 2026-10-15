#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { stop } from '../src/hook/stop.ts'

await runHook('stop', stop)
