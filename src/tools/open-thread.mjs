import { newThread } from '../model/index.mjs';
import { writeActiveThread } from '../util/active-thread.mjs';
import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN, criteriaCreateItem, externalRefInputItem } from './schemas.mjs';

async function requireThread(driver, field, id) {
  const existing = await driver.readThread(id);
  if (!existing) {
    throw new ToolError(`open_thread: ${field} ${id} does not reference an existing thread`);
  }
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  if (args.parent_id != null) await requireThread(driver, 'parent_id', args.parent_id);
  if (args.predecessor_id != null) await requireThread(driver, 'predecessor_id', args.predecessor_id);
  const thread = newThread(args, { now });
  await driver.writeThread(thread);
  await writeActiveThread(ctx, thread.id);
  const { recovery_degraded } = await commitAndReindex(driver, `feat(ledger): open thread ${thread.slug}`);
  return { thread, recovery_degraded };
}

export default {
  name: 'open_thread',
  description: 'Create a new thread (enters active) and write the active-thread pointer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title'],
    properties: {
      title: { type: 'string', minLength: 1 },
      slug: { type: 'string', minLength: 1 },
      parent_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
      predecessor_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
      completion_criteria: { type: 'array', items: criteriaCreateItem },
      vcs_ref: { type: ['string', 'null'] },
      external_refs: { type: 'array', items: externalRefInputItem },
    },
  },
  handler,
};
