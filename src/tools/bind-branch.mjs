import { newBinding } from '../model/index.mjs';
import { writeActiveThread } from '../util/active-thread.mjs';
import { commitAndReindex, ToolError, unknownThread } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('bind_branch', 'thread_id', args.thread_id));
  }
  const binding = newBinding(args, { now, tool: 'bind_branch' });
  await driver.writeBinding(binding);
  await writeActiveThread(ctx, thread.id);
  const { recovery_degraded } = await commitAndReindex(driver, `feat(ledger): bind ${args.branch} to ${thread.slug}`);
  return { binding, recovery_degraded };
}

export default {
  name: 'bind_branch',
  description: 'Bind an existing thread to a repo/branch and write the active-thread pointer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'repo', 'branch'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      repo: { type: 'string', minLength: 1 },
      branch: { type: 'string', minLength: 1 },
      first_commit: { type: ['string', 'null'] },
      trailer_present: { type: 'boolean' },
    },
  },
  handler,
};
