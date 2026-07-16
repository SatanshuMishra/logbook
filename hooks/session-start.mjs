#!/usr/bin/env node
import { runEntry } from './lib/hook-io.mjs';
import { handleSessionStart } from './lib/session-start.mjs';

await runEntry(handleSessionStart);
