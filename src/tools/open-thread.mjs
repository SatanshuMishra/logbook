import { newThread } from '../model/index.mjs';
import { writeActiveThreadOrWarn } from '../util/active-thread.mjs';
import { commitAndReindex, withWarnings, ToolError, unknownThread } from './shared.mjs';
import { ULID_PATTERN, criteriaCreateItem, externalRefInputItem } from './schemas.mjs';

async function requireThread(driver, field, id) {
  const existing = await driver.readThread(id);
  if (!existing) {
    throw new ToolError(unknownThread('open_thread', field, id));
  }
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  if (args.parent_id != null) await requireThread(driver, 'parent_id', args.parent_id);
  if (args.predecessor_id != null) await requireThread(driver, 'predecessor_id', args.predecessor_id);
  const thread = newThread(args, { now, tool: 'open_thread' });
  await driver.writeThread(thread);
  const pointer = await writeActiveThreadOrWarn(ctx, thread.id);
  const { recovery_degraded } = await commitAndReindex(driver, `feat(ledger): open thread ${thread.slug}`);
  return withWarnings({ thread, recovery_degraded }, [pointer.warning]);
}

export default {
  name: 'open_thread',
  description: 'Create a new thread with at least one completion criterion (enters active) and write the active-thread pointer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'completion_criteria'],
    properties: {
      title: { type: 'string', minLength: 1 },
      slug: { type: 'string', minLength: 1 },
      parent_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
      predecessor_id: { type: ['string', 'null'], pattern: ULID_PATTERN },
      completion_criteria: { type: 'array', minItems: 1, items: criteriaCreateItem },
      vcs_ref: { type: ['string', 'null'] },
      external_refs: { type: 'array', items: externalRefInputItem },
    },
  },
  handler,
};
