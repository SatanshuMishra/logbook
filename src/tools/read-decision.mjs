import { ToolError } from './shared.mjs';

async function handler(ctx, args) {
  const { driver } = ctx;
  const listed = await driver.listDecisions();
  const entry = listed.find((d) => d && d.nnnn === args.nnnn) ?? null;
  if (entry === null) {
    throw new ToolError(`read_decision: no decision numbered ${args.nnnn} exists in this ledger`);
  }
  const markdown = await driver.readDecision(args.nnnn);
  if (typeof markdown !== 'string') {
    throw new ToolError(`read_decision: decision ${args.nnnn} is indexed but its file could not be read`);
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
      nnnn: { type: 'string', pattern: '^[0-9]{4,}$' },
    },
  },
  handler,
};
