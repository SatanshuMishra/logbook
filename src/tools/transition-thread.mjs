import { canTransition, checkDefinitionOfDone } from '../model/index.mjs';
import { writeActiveThread, readActiveThread, clearActiveThread } from '../util/active-thread.mjs';
import { commitAndReindex, ToolError, unknownThread, illegalTransition } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function companionRequired(field, status) {
  return {
    code: 'missing_parameter',
    field: `transition_thread.${field}`,
    expected: `a non-blank string whenever to_status is ${status}`,
    retryable: false,
    remedy: `${field} is required to enter ${status}; re-emit the call with it filled in`,
  };
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('transition_thread', 'thread_id', args.thread_id));
  }
  const to = args.to_status;
  if (!canTransition(thread.status, to)) {
    throw new ToolError(illegalTransition('transition_thread', 'to_status', thread.status, to));
  }
  if (to === 'blocked' && !nonEmpty(args.blocked_by)) {
    throw new ToolError(companionRequired('blocked_by', 'blocked'));
  }
  if (to === 'abandoned' && !nonEmpty(args.abandoned_reason)) {
    throw new ToolError(companionRequired('abandoned_reason', 'abandoned'));
  }
  const nowIso = now();
  const candidate = {
    ...thread,
    status: to,
    blocked_by: to === 'blocked' ? args.blocked_by : null,
    abandoned_reason: to === 'abandoned' ? args.abandoned_reason : null,
    closure_statement: to === 'done' ? (args.closure_statement ?? null) : thread.closure_statement,
    updated_at: nowIso,
  };
  if (to === 'done') {
    const dod = checkDefinitionOfDone(candidate);
    if (!dod.ok) {
      throw new ToolError({
        code: 'dod_unmet',
        field: 'transition_thread.to_status',
        expected: dod.reason,
        retryable: true,
        remedy: 'the definition of done is not met yet; satisfy it with update_thread, then re-send this call unchanged',
      });
    }
  }
  await driver.writeThread(candidate);
  if (to === 'active') {
    await writeActiveThread(ctx, candidate.id);
  } else if (thread.status === 'active' && (await readActiveThread(ctx)) === candidate.id) {
    await clearActiveThread(ctx);
  }
  await driver.appendSessionEvent(candidate.id, nowIso, 'ledger', `Transition ${thread.status} -> ${to}`);
  const { recovery_degraded } = await commitAndReindex(driver, `chore(ledger): transition ${candidate.slug} ${thread.status} -> ${to}`);
  return { thread: candidate, recovery_degraded };
}

export default {
  name: 'transition_thread',
  description: 'Move a thread through the lifecycle FSM (DoD-gated for done); manage the active-thread pointer.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'to_status'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      to_status: { type: 'string', enum: ['active', 'paused', 'blocked', 'done', 'abandoned'] },
      closure_statement: { type: 'string' },
      blocked_by: { type: 'string' },
      abandoned_reason: { type: 'string' },
    },
  },
  handler,
};
