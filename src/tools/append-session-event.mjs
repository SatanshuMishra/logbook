import { ToolError, isRecoveryDegraded, unknownThread } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('append_session_event', 'thread_id', args.thread_id));
  }
  const path = await driver.appendSessionEvent(args.thread_id, now(), args.actor, args.body);
  const result = await driver.commit(`chore(ledger): session event for ${thread.slug}`);
  return { path, recovery_degraded: isRecoveryDegraded(result) };
}

export default {
  name: 'append_session_event',
  description: 'Append an immutable session-log entry for a thread; commits directly without a reindex.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'actor', 'body'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      actor: { type: 'string', minLength: 1 },
      body: { type: 'string', minLength: 1 },
    },
  },
  handler,
};
