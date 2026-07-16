#!/usr/bin/env node
import { runEntry } from './lib/hook-io.mjs';
import { handleUserPromptSubmit } from './lib/user-prompt-submit.mjs';

await runEntry(handleUserPromptSubmit);
