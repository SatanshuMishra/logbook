import { takeDriftSnapshot } from '../drift/index.mjs';
import { ToolError } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

async function handler(ctx, args) {
  const { driver } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(`get_resume_brief: thread_id ${args.thread_id} does not reference an existing thread`);
  }
  const all = await driver.listThreads();
  const children = all
    .filter((t) => t.parent_id === thread.id)
    .map((t) => ({ id: t.id, slug: t.slug, title: t.title, status: t.status }));
  const drift = await takeDriftSnapshot(driver, thread.id);
  const brief = {
    thread_id: thread.id,
    slug: thread.slug,
    title: thread.title,
    status: thread.status,
    active_goal: thread.spine.active_goal,
    next_step: thread.spine.next_step,
    open_risks: thread.spine.open_risks,
    key_decisions: thread.spine.key_decisions,
    out_of_scope: thread.spine.out_of_scope,
    children,
    predecessor_id: thread.predecessor_id,
    drift,
  };
  return { brief };
}

export default {
  name: 'get_resume_brief',
  description: 'Return the spine-only resume brief for a thread plus resolved child summaries.',
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
