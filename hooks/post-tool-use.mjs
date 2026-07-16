#!/usr/bin/env node
import { runEntry } from './lib/hook-io.mjs';
import { handlePostToolUse } from './lib/post-tool-use.mjs';

await runEntry(handlePostToolUse);
