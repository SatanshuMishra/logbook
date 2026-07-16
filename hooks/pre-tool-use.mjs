#!/usr/bin/env node
import { runEntry } from './lib/hook-io.mjs';
import { handlePreToolUse } from './lib/pre-tool-use.mjs';

await runEntry(handlePreToolUse);
