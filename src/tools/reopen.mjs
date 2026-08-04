import { isTerminal, canTransition } from '../model/index.mjs';
import { writeActiveThread } from '../util/active-thread.mjs';
import { commitAndReindex, ToolError, unknownThread, terminalThread, illegalTransition } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('reopen', 'thread_id', args.thread_id));
  }
  if (isTerminal(thread.status)) {
    throw new ToolError(terminalThread('reopen', thread.status));
  }
  if (thread.status === 'active') {
    throw new ToolError({
      code: 'already_active',
      field: 'reopen.thread_id',
      expected: 'a thread whose status is paused or blocked',
      retryable: false,
      remedy: 'this thread is already active; no reopen is needed, so continue without re-sending',
    });
  }
  if (!canTransition(thread.status, 'active')) {
    throw new ToolError(illegalTransition('reopen', 'thread_id', thread.status, 'active', 'thread'));
  }
  const nowIso = now();
  const updated = {
    ...thread,
    status: 'active',
    blocked_by: null,
    updated_at: nowIso,
  };
  await driver.writeThread(updated);
  await writeActiveThread(ctx, updated.id);
  await driver.appendSessionEvent(updated.id, nowIso, 'ledger', `Reopened ${thread.status} -> active`);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): reopen ${updated.slug}`);
  return { thread: updated, recovery_degraded };
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
