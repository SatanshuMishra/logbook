#!/usr/bin/env node
import { runEntry } from './lib/hook-io.mjs';
import { handleStop } from './lib/stop.mjs';

await runEntry(handleStop);
