#!/usr/bin/env node
import { runEntry } from './lib/hook-io.mjs';
import { handlePreCompact } from './lib/pre-compact.mjs';

await runEntry(handlePreCompact);
