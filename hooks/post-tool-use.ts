#!/usr/bin/env node
import { runHook } from './lib/io.ts'
import { postToolUse } from '../src/hook/post-tool-use.ts'

await runHook('post-tool-use', postToolUse)
