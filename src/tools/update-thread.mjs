import { isTerminal, assertSpineCaps } from '../model/index.mjs';
import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

function patchSpine(thread, spinePatch) {
  const spine = { ...thread.spine, ...spinePatch, status: thread.status };
  assertSpineCaps(spine);
  return spine;
}

function toggleCriteria(thread, patches) {
  const known = new Set(thread.completion_criteria.map((c) => c.text));
  for (const patch of patches) {
    if (!known.has(patch.text)) {
      throw new ToolError(`update_thread: unknown completion_criteria text "${patch.text}"`);
    }
  }
  const byText = new Map(patches.map((p) => [p.text, p.done === true]));
  return thread.completion_criteria.map((c) => (
    byText.has(c.text) ? { text: c.text, done: byText.get(c.text) } : c
  ));
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(`update_thread: thread_id ${args.thread_id} does not reference an existing thread`);
  }
  if (isTerminal(thread.status)) {
    throw new ToolError(`update_thread: cannot mutate a terminal (${thread.status}) thread`);
  }
  const spine = args.spine && typeof args.spine === 'object' ? patchSpine(thread, args.spine) : thread.spine;
  const completionCriteria = Array.isArray(args.completion_criteria)
    ? toggleCriteria(thread, args.completion_criteria)
    : thread.completion_criteria;
  const updated = { ...thread, spine, completion_criteria: completionCriteria, updated_at: now() };
  await driver.writeThread(updated);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): update ${updated.slug}`);
  return { thread: updated, recovery_degraded };
}

export default {
  name: 'update_thread',
  description: 'Patch spine fields and toggle completion_criteria done (status unchanged; caps-enforced; terminal-refused).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      spine: {
        type: 'object',
        additionalProperties: false,
        properties: {
          active_goal: { type: 'string' },
          next_step: { type: 'string' },
          open_risks: { type: 'array', items: { type: 'string' } },
          key_decisions: { type: 'array', items: { type: 'string' } },
          out_of_scope: { type: 'array', items: { type: 'string' } },
        },
      },
      completion_criteria: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'done'],
          properties: {
            text: { type: 'string', minLength: 1 },
            done: { type: 'boolean' },
          },
        },
      },
    },
  },
  handler,
};
