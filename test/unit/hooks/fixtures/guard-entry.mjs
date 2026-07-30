#!/usr/bin/env node
import { Readable } from 'node:stream';
import { runGuardEntry } from '../../../../hooks/lib/hook-io.mjs';

const ASK = {
  hookSpecificOutput: {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'handler verdict',
  },
};

const HANDLERS = {
  throw: () => {
    throw new Error('classification boom');
  },
  reject: async () => {
    throw new Error('async classification boom');
  },
  silent: () => ({}),
  nullish: () => null,
  decision: () => ({ json: ASK }),
  echo: (ctx) => ({ json: { seen: ctx.input.tool_name, projectDir: ctx.projectDir } }),
};

const [mode, source] = process.argv.slice(2);

if (!Object.hasOwn(HANDLERS, mode)) {
  process.exit(0);
}

const failingStream = () => Readable.from((async function* generate() {
  throw new Error('stream boom');
})());

await runGuardEntry(HANDLERS[mode], {
  stream: source === 'stream-error' ? failingStream() : process.stdin,
  env: { CLAUDE_PROJECT_DIR: '/from/env' },
});
