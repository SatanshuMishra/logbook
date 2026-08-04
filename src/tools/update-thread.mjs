import { isTerminal, assertSpineCaps } from '../model/index.mjs';
import {
  commitAndReindex,
  knownDecisionRefs,
  ToolError,
  unknownThread,
  terminalThread,
  unknownCriterion,
  liveIds,
} from './shared.mjs';
import {
  ULID_PATTERN,
  criteriaToggleItem,
  riskInputItem,
  decisionInputItem,
  replaceScopesInput,
} from './schemas.mjs';
import {
  normalizeRisks,
  normalizeDecisions,
  normalizeReplaceScopes,
  assertNoRestatedDecision,
  SCOPED_SPINE_FIELDS,
} from './spine-input.mjs';

function replaceScopedItems(stored, submitted, authoritative) {
  const existing = Array.isArray(stored) ? stored : [];
  if (!Array.isArray(submitted) && authoritative.length === 0) return existing;
  const incoming = Array.isArray(submitted) ? submitted : [];
  const replaced = new Set([...incoming.map((item) => item.scope), ...authoritative]);
  const carried = existing.filter(
    (item) => !(item && typeof item === 'object' && replaced.has(item.scope)),
  );
  return [...carried, ...incoming];
}

function assertNamesAScope(field, submitted, authoritative) {
  if (!Array.isArray(submitted) || submitted.length > 0 || authoritative.length > 0) return;
  throw new ToolError({
    code: 'empty_scope_replacement',
    field: `update_thread.spine.${field}`,
    expected: 'a non-empty array, or an empty one backed by replace_scopes',
    retryable: false,
    remedy: `an empty spine.${field} names no scope and so replaces nothing; name each scope to clear in replace_scopes.${field}, or omit the field`,
  });
}

async function patchSpine(driver, thread, spinePatch, replaceScopes) {
  for (const field of SCOPED_SPINE_FIELDS) {
    assertNamesAScope(field, spinePatch[field], replaceScopes[field]);
  }
  const submitted = { ...spinePatch };
  if (Array.isArray(spinePatch.open_risks)) {
    submitted.open_risks = normalizeRisks(
      spinePatch.open_risks,
      thread,
      'update_thread.spine.open_risks',
    );
  }
  if (Array.isArray(spinePatch.key_decisions)) {
    submitted.key_decisions = normalizeDecisions(
      spinePatch.key_decisions,
      thread,
      await knownDecisionRefs(driver),
      'update_thread.spine.key_decisions',
    );
  }
  const spine = {
    ...thread.spine,
    ...submitted,
    open_risks: replaceScopedItems(
      thread.spine.open_risks,
      submitted.open_risks,
      replaceScopes.open_risks,
    ),
    key_decisions: replaceScopedItems(
      thread.spine.key_decisions,
      submitted.key_decisions,
      replaceScopes.key_decisions,
    ),
  };
  if (Array.isArray(spinePatch.out_of_scope)) {
    assertNoRestatedDecision(
      spinePatch.out_of_scope,
      spine.key_decisions,
      'update_thread.spine.out_of_scope',
    );
  }
  assertSpineCaps(submitted);
  return spine;
}

function requireTogglable(thread, id) {
  const target = thread.completion_criteria.find((c) => c.id === id);
  if (!target) {
    throw new ToolError(unknownCriterion(thread, 'update_thread.completion_criteria[].id', id));
  }
  if ((target.struck_by ?? null) !== null) {
    throw new ToolError({
      code: 'struck_criterion',
      field: 'update_thread.completion_criteria[].id',
      expected: `one of ${liveIds(thread)}`,
      retryable: false,
      remedy: `criterion "${id}" was struck by decision ${target.struck_by} and is kept as history; toggle a live criterion instead`,
    });
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
    throw new ToolError(unknownThread('update_thread', 'thread_id', args.thread_id));
  }
  if (isTerminal(thread.status)) {
    throw new ToolError(terminalThread('update_thread', thread.status));
  }
  const completionCriteria = Array.isArray(args.completion_criteria)
    ? toggleCriteria(thread, args.completion_criteria)
    : thread.completion_criteria;
  const toggled = { ...thread, completion_criteria: completionCriteria };
  const replaceScopes = normalizeReplaceScopes(args.replace_scopes, 'update_thread');
  const spinePatch = args.spine && typeof args.spine === 'object' ? args.spine : null;
  const clearsAScope = SCOPED_SPINE_FIELDS.some((field) => replaceScopes[field].length > 0);
  const spine = spinePatch !== null || clearsAScope
    ? await patchSpine(driver, toggled, spinePatch ?? {}, replaceScopes)
    : thread.spine;
  const updated = { ...toggled, spine, updated_at: now() };
  await driver.writeThread(updated);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): update ${updated.slug}`);
  return { thread: updated, recovery_degraded };
}

export default {
  name: 'update_thread',
  description: 'Patch spine fields and toggle completion_criteria done by criterion id, refusing a criterion that a decision struck. Risks and decisions are scoped: an omitted scope defaults to the criterion current AFTER this call\'s own completion_criteria toggles, "thread" must be explicit, "legacy" is refused. A risks or decisions array replaces only the scopes it mentions and carries every scope it does not, so submitting the current step\'s items never deletes another step\'s. To retire a scope\'s remaining items, name that scope in replace_scopes.open_risks or replace_scopes.key_decisions: every named scope is replaced by whatever this call submits for it, down to nothing. An empty array that no replace_scopes entry backs is refused, since it would replace nothing. Caps are enforced on the fields this call submits; terminal-refused.',
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
      replace_scopes: replaceScopesInput,
      completion_criteria: { type: 'array', items: criteriaToggleItem },
    },
  },
  handler,
};
