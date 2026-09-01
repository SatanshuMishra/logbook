#!/usr/bin/env node
import { runHook } from './lib/io.ts'

await runHook('post-tool-use', () => ({ block: false, json: {} }))
