import { rebuildIndex } from '../index/rebuild-index.mjs';
import { emptyInput } from './schemas.mjs';

async function handler(ctx) {
  const counts = await rebuildIndex(ctx.driver);
  return { counts };
}

export default {
  name: 'rebuild_index',
  description: 'Rebuild the derived index (by-slug/by-branch/children/resumable) and return the counts.',
  inputSchema: emptyInput,
  handler,
};
