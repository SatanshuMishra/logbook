import { isTerminal, liveCriteria, currentCriterion, nextCriterionId } from '../model/index.mjs';
import {
  commitAndReindex,
  knownDecisionRefs,
  ToolError,
  unknownThread,
  terminalThread,
  unknownCriterion,
  liveIds,
} from './shared.mjs';
import { ULID_PATTERN, criteriaAmendOperation, CRITERIA_AMEND_OPS } from './schemas.mjs';

const DETOUR_KIND = 'detour';
function requireDecision(refs, ref, field) {
  if (!refs.has(ref)) {
    throw new ToolError({
      code: 'unknown_decision',
      field: `${field}.decision_ref`,
      expected: 'a ref naming a decision file this ledger holds',
      example: '0007-adopt-the-ledger',
      retryable: false,
      remedy: `no decision file matches "${ref}"; call record_decision first, then re-send with the ref it returns`,
    });
  }
}

function requireAmendable(thread, id, field) {
  const target = thread.completion_criteria.find((c) => c.id === id);
  if (!target) {
    throw new ToolError(unknownCriterion(thread, `${field}.id`, id));
  }
  if ((target.struck_by ?? null) !== null) {
    throw new ToolError({
      code: 'struck_criterion',
      field: `${field}.id`,
      expected: `one of ${liveIds(thread)}`,
      retryable: false,
      remedy: `criterion "${id}" was struck by decision ${target.struck_by} and is kept as history; amend a live criterion instead`,
    });
  }
  return target;
}

function replaceCriterion(thread, id, next) {
  return {
    ...thread,
    completion_criteria: thread.completion_criteria.map((c) => (c.id === id ? next : c)),
  };
}

function insertPosition(thread, operation, field) {
  const criteria = thread.completion_criteria;
  if (typeof operation.before === 'string') {
    const at = criteria.findIndex((c) => c.id === operation.before);
    if (at === -1) {
      throw new ToolError(unknownCriterion(thread, `${field}.before`, operation.before));
    }
    return at;
  }
  if (operation.kind !== DETOUR_KIND) return criteria.length;
  const current = currentCriterion(thread);
  return current === null ? criteria.length : criteria.findIndex((c) => c.id === current.id);
}

function applyInsert(thread, operation, { field }) {
  if (operation.kind === DETOUR_KIND) {
    const open = liveCriteria(thread).find((c) => c.kind === DETOUR_KIND && c.done !== true);
    if (open) {
      throw new ToolError({
        code: 'open_detour',
        field: `${field}.kind`,
        expected: 'a detour only while no other detour is open',
        retryable: true,
        remedy: `criterion "${open.id}" is an open detour and detours do not nest; close it, or open a child thread for work that needs its own criteria`,
      });
    }
  }
  const criteria = thread.completion_criteria;
  const at = insertPosition(thread, operation, field);
  const entry = {
    id: nextCriterionId(criteria),
    text: operation.text,
    done: false,
    kind: operation.kind,
    struck_by: null,
  };
  return {
    ...thread,
    completion_criteria: [...criteria.slice(0, at), entry, ...criteria.slice(at)],
  };
}

function applyRewrite(thread, operation, { refs, field }) {
  requireDecision(refs, operation.decision_ref, field);
  const target = requireAmendable(thread, operation.id, field);
  return replaceCriterion(thread, target.id, { ...target, text: operation.text });
}

function applyStrike(thread, operation, { refs, field }) {
  requireDecision(refs, operation.decision_ref, field);
  const target = requireAmendable(thread, operation.id, field);
  return replaceCriterion(thread, target.id, { ...target, struck_by: operation.decision_ref });
}

const OPERATIONS = {
  insert: applyInsert,
  rewrite: applyRewrite,
  strike: applyStrike,
};

function applyOperation(thread, operation, refs, index) {
  const field = `amend_criteria.operations[${index}]`;
  const apply = OPERATIONS[operation.op];
  if (!apply) {
    throw new ToolError({
      code: 'invalid_enum',
      field: `${field}.op`,
      expected: `one of ${CRITERIA_AMEND_OPS.map((op) => JSON.stringify(op)).join(', ')}`,
      example: CRITERIA_AMEND_OPS[0],
      retryable: false,
      remedy: `op was ${JSON.stringify(operation.op)}; re-send with one of the accepted values`,
    });
  }
  return apply(thread, operation, { refs, field });
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('amend_criteria', 'thread_id', args.thread_id));
  }
  if (isTerminal(thread.status)) {
    throw new ToolError(terminalThread('amend_criteria', thread.status));
  }
  const refs = await knownDecisionRefs(driver);
  const amended = args.operations.reduce(
    (acc, operation, index) => applyOperation(acc, operation, refs, index),
    thread,
  );
  const updated = { ...amended, updated_at: now() };
  await driver.writeThread(updated);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): amend criteria ${updated.slug}`);
  return { thread: updated, recovery_degraded };
}

export default {
  name: 'amend_criteria',
  description: 'Amend a thread\'s completion criteria: insert a planned criterion or a detour, rewrite one, or strike one. Operations apply in order and atomically, so a later failure discards the whole call. A detour with no explicit "before" lands immediately ahead of the current criterion and is refused while another detour is open. Rewrite and strike require a decision_ref that resolves to an existing decision file; a struck criterion is retained, never deleted. Terminal-refused.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'operations'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      operations: { type: 'array', minItems: 1, items: criteriaAmendOperation },
    },
  },
  handler,
};
