import { renderBriefing } from '../render/briefing.mjs';
import { BRIEFING_INDEX } from '../index/index-files.mjs';
import { takeDriftSnapshot } from '../drift/index.mjs';
import { ToolError, unknownThread } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

function byId(a, b) {
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('get_resume_brief', 'thread_id', args.thread_id));
  }
  const all = await driver.listThreads();
  const children = all
    .filter((t) => t.parent_id === thread.id)
    .sort(byId)
    .map((t) => ({ slug: t.slug, status: t.status }));
  const predecessorRecord = thread.predecessor_id
    ? all.find((t) => t.id === thread.predecessor_id) ?? null
    : null;
  const predecessor = predecessorRecord ? { slug: predecessorRecord.slug } : null;
  const drift = await takeDriftSnapshot(driver, thread.id);
  const briefing = renderBriefing({ thread, drift, children, predecessor });
  await driver.writeIndexFile(BRIEFING_INDEX, {
    thread_id: thread.id,
    rendered: briefing,
    rendered_at: now(),
  });
  return { thread_id: thread.id, briefing };
}

export default {
  name: 'get_resume_brief',
  description: 'Render the preflight briefing for a thread as markdown, filtered to the current criterion, and pledge it for the verbatim gate. The rendered string is the only payload.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
    },
  },
  handler,
};
