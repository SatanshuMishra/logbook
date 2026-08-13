import { canTransition } from '../model/index.mjs';
import { releaseActiveThreadOrWarn } from '../util/active-thread.mjs';
import {
  commitAndReindex,
  withWarnings,
  ToolError,
  unknownThread,
  illegalTransition,
  readPointerOrWarn,
  NO_POINTER,
} from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

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
  const pointer = await readPointerOrWarn(ctx);
  await driver.writeThread(updated);
  const release = pointer.value === updated.id
    ? await releaseActiveThreadOrWarn(ctx, updated.id)
    : NO_POINTER;
  await driver.appendSessionEvent(updated.id, nowIso, 'ledger', `Archived (${thread.status} -> abandoned): ${args.reason}`);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): archive ${updated.slug}`);
  return withWarnings({ thread: updated, recovery_degraded }, [pointer.warning, release.warning]);
}

export default {
  name: 'archive_thread',
  description: 'Archive a thread via the FSM (abandoned); refuses a blocked thread; releases the active-thread pointer whenever it still names the thread being archived at release time, whatever that thread\'s status was. That release is best-effort: a failed release, a pointer another session moved on to a different thread meanwhile, and a pointer this call could not read all leave the thread abandoned and surface in warnings[] rather than blocking the archive. A pointer naming a different thread is never touched. A pointer this call could not read, and a release that failed, each leave the pointer naming a thread this tool has closed.',
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
