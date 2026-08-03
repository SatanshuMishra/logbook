import { isTerminal, assertSpineCaps } from '../model/index.mjs';
import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN, criteriaToggleItem, riskInputItem, decisionInputItem } from './schemas.mjs';
import { normalizeRisks, normalizeDecisions, assertNoRestatedDecision } from './spine-input.mjs';

async function knownDecisionRefs(driver) {
  const decisions = await driver.listDecisions();
  return new Set(decisions.map((d) => `${d.nnnn}-${d.slug}`));
}

async function patchSpine(driver, thread, spinePatch) {
  const normalized = { ...spinePatch };
  if (Array.isArray(spinePatch.open_risks)) {
    normalized.open_risks = normalizeRisks(
      spinePatch.open_risks,
      thread,
      'update_thread: spine.open_risks',
    );
  }
  if (Array.isArray(spinePatch.key_decisions)) {
    normalized.key_decisions = normalizeDecisions(
      spinePatch.key_decisions,
      thread,
      await knownDecisionRefs(driver),
      'update_thread: spine.key_decisions',
    );
  }
  const spine = { ...thread.spine, ...normalized };
  if (Array.isArray(spinePatch.out_of_scope)) {
    assertNoRestatedDecision(
      spinePatch.out_of_scope,
      spine.key_decisions,
      'update_thread: spine.out_of_scope',
    );
  }
  assertSpineCaps(spine);
  return spine;
}

function toggleCriteria(thread, patches) {
  const known = new Set(thread.completion_criteria.map((c) => c.id));
  for (const patch of patches) {
    if (!known.has(patch.id)) {
      throw new ToolError(`update_thread: unknown completion_criteria id "${patch.id}"`);
    }
  }
  const byId = new Map(patches.map((p) => [p.id, p.done === true]));
  return thread.completion_criteria.map((c) => (
    byId.has(c.id) ? { ...c, done: byId.get(c.id) } : c
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
  const spine = args.spine && typeof args.spine === 'object'
    ? await patchSpine(driver, thread, args.spine)
    : thread.spine;
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
  description: 'Patch spine fields and toggle completion_criteria done by criterion id. Risks and decisions are scoped: an omitted scope defaults to the current criterion, "thread" must be explicit, "legacy" is refused. Caps-enforced; terminal-refused.',
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
          last_session: { type: 'string' },
          open_risks: { type: 'array', items: riskInputItem },
          key_decisions: { type: 'array', items: decisionInputItem },
          out_of_scope: { type: 'array', items: { type: 'string', minLength: 1 } },
        },
      },
      completion_criteria: { type: 'array', items: criteriaToggleItem },
    },
  },
  handler,
};
