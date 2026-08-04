import { isTerminal, assertSpineCaps } from '../model/index.mjs';
import { commitAndReindex, knownDecisionRefs, ToolError } from './shared.mjs';
import { ULID_PATTERN, criteriaToggleItem, riskInputItem, decisionInputItem } from './schemas.mjs';
import { normalizeRisks, normalizeDecisions, assertNoRestatedDecision } from './spine-input.mjs';

function replaceSubmittedScopes(stored, submitted) {
  const existing = Array.isArray(stored) ? stored : [];
  if (!Array.isArray(submitted)) return existing;
  const replaced = new Set(submitted.map((item) => item.scope));
  const carried = existing.filter(
    (item) => !(item && typeof item === 'object' && replaced.has(item.scope)),
  );
  return [...carried, ...submitted];
}

async function patchSpine(driver, thread, spinePatch) {
  const submitted = { ...spinePatch };
  if (Array.isArray(spinePatch.open_risks)) {
    submitted.open_risks = normalizeRisks(
      spinePatch.open_risks,
      thread,
      'update_thread: spine.open_risks',
    );
  }
  if (Array.isArray(spinePatch.key_decisions)) {
    submitted.key_decisions = normalizeDecisions(
      spinePatch.key_decisions,
      thread,
      await knownDecisionRefs(driver),
      'update_thread: spine.key_decisions',
    );
  }
  const spine = {
    ...thread.spine,
    ...submitted,
    open_risks: replaceSubmittedScopes(thread.spine.open_risks, submitted.open_risks),
    key_decisions: replaceSubmittedScopes(thread.spine.key_decisions, submitted.key_decisions),
  };
  if (Array.isArray(spinePatch.out_of_scope)) {
    assertNoRestatedDecision(
      spinePatch.out_of_scope,
      spine.key_decisions,
      'update_thread: spine.out_of_scope',
    );
  }
  assertSpineCaps(submitted);
  return spine;
}

function requireTogglable(thread, id) {
  const target = thread.completion_criteria.find((c) => c.id === id);
  if (!target) {
    throw new ToolError(`update_thread: unknown completion_criteria id "${id}"`);
  }
  if ((target.struck_by ?? null) !== null) {
    throw new ToolError(
      `update_thread: criterion "${id}" was struck by decision ${target.struck_by} and is retained as history, not toggled`,
    );
  }
}

function toggleCriteria(thread, patches) {
  for (const patch of patches) {
    requireTogglable(thread, patch.id);
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
  const completionCriteria = Array.isArray(args.completion_criteria)
    ? toggleCriteria(thread, args.completion_criteria)
    : thread.completion_criteria;
  const toggled = { ...thread, completion_criteria: completionCriteria };
  const spine = args.spine && typeof args.spine === 'object'
    ? await patchSpine(driver, toggled, args.spine)
    : thread.spine;
  const updated = { ...toggled, spine, updated_at: now() };
  await driver.writeThread(updated);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): update ${updated.slug}`);
  return { thread: updated, recovery_degraded };
}

export default {
  name: 'update_thread',
  description: 'Patch spine fields and toggle completion_criteria done by criterion id, refusing a criterion that a decision struck. Risks and decisions are scoped: an omitted scope defaults to the criterion current AFTER this call\'s own completion_criteria toggles, "thread" must be explicit, "legacy" is refused. A risks or decisions array replaces only the scopes it mentions and carries every scope it does not, so submitting the current step\'s items never deletes another step\'s. Caps are enforced on the fields this call submits; terminal-refused.',
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
