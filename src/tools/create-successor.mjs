import { newThread, isTerminal } from '../model/index.mjs';
import { writeActiveThread } from '../util/active-thread.mjs';
import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN, criteriaCreateItem } from './schemas.mjs';

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const predecessor = await driver.readThread(args.predecessor_id);
  if (!predecessor) {
    throw new ToolError(`create_successor: predecessor_id ${args.predecessor_id} does not reference an existing thread`);
  }
  if (!isTerminal(predecessor.status)) {
    throw new ToolError(`create_successor: predecessor must be terminal (done|abandoned), found ${predecessor.status}`);
  }
  const thread = newThread({
    title: args.title,
    completion_criteria: args.completion_criteria,
    predecessor_id: predecessor.id,
    parent_id: predecessor.parent_id,
  }, { now });
  await driver.writeThread(thread);
  await writeActiveThread(ctx, thread.id);
  const { recovery_degraded } = await commitAndReindex(driver, `feat(ledger): successor of ${predecessor.slug}`);
  return { thread, recovery_degraded };
}

export default {
  name: 'create_successor',
  description: 'Open a successor thread to a terminal predecessor (inherits parent_id); enters active.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['predecessor_id', 'title', 'completion_criteria'],
    properties: {
      predecessor_id: { type: 'string', pattern: ULID_PATTERN },
      title: { type: 'string', minLength: 1 },
      completion_criteria: { type: 'array', minItems: 1, items: criteriaCreateItem },
    },
  },
  handler,
};
