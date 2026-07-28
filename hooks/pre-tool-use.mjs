#!/usr/bin/env node
import { runGuardEntry } from './lib/hook-io.mjs';
import { handlePreToolUse } from './lib/pre-tool-use.mjs';

await runGuardEntry(handlePreToolUse);
