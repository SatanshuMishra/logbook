import { ToolError } from './shared.mjs';
import { DECISION_NUMBER_PATTERN } from '../schema/patterns.mjs';

async function handler(ctx, args) {
  const { driver } = ctx;
  const listed = await driver.listDecisions();
  const entry = listed.find((d) => d && d.nnnn === args.nnnn) ?? null;
  if (entry === null) {
    throw new ToolError({
      code: 'unknown_decision',
      field: 'read_decision.nnnn',
      expected: 'a decision number this ledger holds',
      example: '0007',
      retryable: false,
      remedy: `no decision numbered ${JSON.stringify(String(args.nnnn))} exists here; re-send with a number a briefing or record_decision returned`,
    });
  }
  const markdown = await driver.readDecision(args.nnnn);
  if (typeof markdown !== 'string') {
    throw new ToolError({
      code: 'unreadable_decision',
      field: 'read_decision.nnnn',
      expected: 'a decision whose file is readable',
      retryable: true,
      remedy: `decision ${args.nnnn} is indexed but its file could not be read; the index and the store disagree, so rebuild_index and re-send`,
    });
  }
  return { nnnn: entry.nnnn, slug: entry.slug, markdown };
}

export default {
  name: 'read_decision',
  description: 'Read one numbered decision record by its four-digit number, so a briefing reference can be resolved on demand.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['nnnn'],
    properties: {
      nnnn: { type: 'string', pattern: DECISION_NUMBER_PATTERN },
    },
  },
  handler,
};
