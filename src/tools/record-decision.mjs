import { commitAndReindex, ToolError } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

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
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(`record_decision: thread_id ${args.thread_id} does not reference an existing thread`);
  }
  const nnnn = await driver.nextDecisionNumber();
  const markdown = renderDecision({
    nnnn,
    title: args.title,
    context: args.context,
    options: args.options,
    outcome: args.outcome,
    threadId: args.thread_id,
    date: now(),
  });
  const path = await driver.writeDecision(nnnn, args.slug, markdown);
  const ref = `${nnnn}-${args.slug}`;
  const keyDecisions = thread.spine.key_decisions.includes(ref)
    ? thread.spine.key_decisions
    : [...thread.spine.key_decisions, ref];
  const updated = {
    ...thread,
    spine: { ...thread.spine, key_decisions: keyDecisions },
    updated_at: now(),
  };
  await driver.writeThread(updated);
  await commitAndReindex(driver, `docs(ledger): decision ${ref}`);
  return { number: nnnn, path };
}

export default {
  name: 'record_decision',
  description: 'Record a numbered MADR decision (Thread-Id frontmatter) and link it into the thread spine.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'slug', 'title', 'context', 'options', 'outcome'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      slug: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]*$' },
      title: { type: 'string', minLength: 1 },
      context: { type: 'string' },
      options: { type: 'array', items: { type: 'string' } },
      outcome: { type: 'string' },
    },
  },
  handler,
};
