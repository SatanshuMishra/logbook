import { canTransition } from '../model/index.mjs';
import { readActiveThread, clearActiveThread } from '../util/active-thread.mjs';
import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(`archive_thread: thread_id ${args.thread_id} does not reference an existing thread`);
  }
  if (!canTransition(thread.status, 'abandoned')) {
    throw new ToolError(
      `archive_thread: illegal transition ${thread.status} -> abandoned (a blocked thread must first go blocked -> paused)`,
    );
  }
  const nowIso = now();
  const updated = {
    ...thread,
    status: 'abandoned',
    abandoned_reason: args.reason,
    spine: { ...thread.spine, status: 'abandoned' },
    updated_at: nowIso,
  };
  await driver.writeThread(updated);
  if (thread.status === 'active' && (await readActiveThread(ctx)) === updated.id) {
    await clearActiveThread(ctx);
  }
  await driver.appendSessionEvent(updated.id, nowIso, 'ledger', `Archived (${thread.status} -> abandoned): ${args.reason}`);
  await commitAndReindex(driver, `chore(ledger): archive ${updated.slug}`);
  return { thread: updated };
}

export default {
  name: 'archive_thread',
  description: 'Archive a thread via the FSM (abandoned); refuses a blocked thread; clears the active pointer.',
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
