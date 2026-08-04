import { resolveWriteScope } from '../model/index.mjs';
import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN, WRITABLE_SCOPE_PATTERN } from './schemas.mjs';
import { assertWritableScope } from './spine-input.mjs';

const BULLET_MARKER = /^[-*]\s+/;

function normalizeOptions(options) {
  if (Array.isArray(options)) return options;
  return options
    .split('\n')
    .map((line) => line.trim().replace(BULLET_MARKER, '').trim())
    .filter((line) => line.length > 0);
}

function renderDecision({ nnnn, title, context, options, outcome, threadId, date }) {
  const optionLines = options.map((o) => `- ${o}`).join('\n');
  return [
    '---',
    'Status: accepted',
    `Date: ${date}`,
    `Thread-Id: ${threadId}`,
    '---',
    '',
    `# ${nnnn}. ${title}`,
    '',
    '## Context',
    '',
    context,
    '',
    '## Options',
    '',
    optionLines,
    '',
    '## Outcome',
    '',
    outcome,
    '',
  ].join('\n');
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const options = normalizeOptions(args.options);
  if (options.length === 0) {
    throw new ToolError('record_decision: options must contain at least one option');
  }
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(`record_decision: thread_id ${args.thread_id} does not reference an existing thread`);
  }
  const scope = assertWritableScope(
    args.scope ?? resolveWriteScope(thread),
    'record_decision: scope',
  );
  const nnnn = await driver.nextDecisionNumber();
  const markdown = renderDecision({
    nnnn,
    title: args.title,
    context: args.context,
    options,
    outcome: args.outcome,
    threadId: args.thread_id,
    date: now(),
  });
  const path = await driver.writeDecision(nnnn, args.slug, markdown);
  const ref = `${nnnn}-${args.slug}`;
  const keyDecisions = thread.spine.key_decisions.some((d) => d.ref === ref)
    ? thread.spine.key_decisions
    : [...thread.spine.key_decisions, { ref, title: args.title, scope }];
  const updated = {
    ...thread,
    spine: { ...thread.spine, key_decisions: keyDecisions },
    updated_at: now(),
  };
  await driver.writeThread(updated);
  const { recovery_degraded } = await commitAndReindex(driver, `docs(ledger): decision ${ref}`);
  return { number: nnnn, path, recovery_degraded };
}

export default {
  name: 'record_decision',
  description: 'Record a numbered MADR decision (Thread-Id frontmatter) and link it into the thread spine under a scope that defaults to the current criterion.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'slug', 'title', 'context', 'options', 'outcome'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
      title: { type: 'string', minLength: 1 },
      context: { type: 'string' },
      options: {
        anyOf: [
          { type: 'array', items: { type: 'string' } },
          { type: 'string' },
        ],
      },
      outcome: { type: 'string' },
      scope: { type: 'string', pattern: WRITABLE_SCOPE_PATTERN },
    },
  },
  handler,
};
