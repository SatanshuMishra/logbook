import { isTerminal, canTransition } from '../model/index.mjs';
import { writeActiveThread } from '../util/active-thread.mjs';
import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(`reopen: thread_id ${args.thread_id} does not reference an existing thread`);
  }
  if (isTerminal(thread.status)) {
    throw new ToolError(`reopen: cannot reopen a terminal (${thread.status}) thread; use create_successor`);
  }
  if (thread.status === 'active') {
    throw new ToolError('reopen: thread is already active');
  }
  if (!canTransition(thread.status, 'active')) {
    throw new ToolError(`reopen: illegal transition ${thread.status} -> active`);
  }
  const nowIso = now();
  const updated = {
    ...thread,
    status: 'active',
    blocked_by: null,
    spine: { ...thread.spine, status: 'active' },
    updated_at: nowIso,
  };
  await driver.writeThread(updated);
  await writeActiveThread(ctx, updated.id);
  await driver.appendSessionEvent(updated.id, nowIso, 'ledger', `Reopened ${thread.status} -> active`);
  await commitAndReindex(driver, `chore(ledger): reopen ${updated.slug}`);
  return { thread: updated };
}

export default {
  name: 'reopen',
  description: 'Return a paused/blocked thread to active (refuses terminal and already-active); writes the pointer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
    },
  },
  handler,
};
