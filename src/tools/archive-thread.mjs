import { canTransition } from '../model/index.mjs';
import { releaseActiveThreadOrWarn } from '../util/active-thread.mjs';
import {
  commitAndReindex,
  withWarnings,
  ToolError,
  unknownThread,
  illegalTransition,
  readPointerOrRefuse,
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
  const pointer = await readPointerOrRefuse(ctx, 'archive_thread');
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
  description: 'Archive a thread via the FSM (abandoned); refuses a blocked thread; refuses before anything is stored when an active-thread pointer cannot be read and an ordinary tool call could still overwrite it, and reports it in warnings[] instead when no tool call could, since a pointer no tool can read or replace arms nothing; releases that pointer whenever it still names the thread being archived at release time, whatever that thread\'s status was, and that release is best-effort: a failed release, or a pointer another session moved on to a different thread meanwhile, leaves the thread abandoned and surfaces in warnings[]. A pointer naming a different thread is never touched.',
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
