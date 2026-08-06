import { canTransition } from '../model/index.mjs';
import { readActiveThreadOrWarn, clearActiveThreadOrWarn } from '../util/active-thread.mjs';
import { commitAndReindex, withWarnings, ToolError, unknownThread, illegalTransition } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

const NO_POINTER = Object.freeze({ value: null, warning: null });

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('archive_thread', 'thread_id', args.thread_id));
  }
  if (!canTransition(thread.status, 'abandoned')) {
    throw new ToolError(illegalTransition('archive_thread', 'thread_id', thread.status, 'abandoned', 'thread'));
  }
  const nowIso = now();
  const updated = {
    ...thread,
    status: 'abandoned',
    abandoned_reason: args.reason,
    updated_at: nowIso,
  };
  const pointer = thread.status === 'active' ? await readActiveThreadOrWarn(ctx) : NO_POINTER;
  await driver.writeThread(updated);
  const release = pointer.value === updated.id ? await clearActiveThreadOrWarn(ctx) : NO_POINTER;
  await driver.appendSessionEvent(updated.id, nowIso, 'ledger', `Archived (${thread.status} -> abandoned): ${args.reason}`);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): archive ${updated.slug}`);
  return withWarnings({ thread: updated, recovery_degraded }, [pointer.warning, release.warning]);
}

export default {
  name: 'archive_thread',
  description: 'Archive a thread via the FSM (abandoned); refuses a blocked thread; clears the active pointer, which is best-effort: a failure to clear it leaves the thread abandoned and surfaces in warnings[].',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'reason'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      reason: { type: 'string', minLength: 1 },
    },
  },
  handler,
};
