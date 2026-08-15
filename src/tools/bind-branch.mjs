import { newBinding } from '../model/index.mjs';
import { writeActiveThreadOrWarn } from '../util/active-thread.mjs';
import { commitAndReindex, withWarnings, ToolError, foreignRepo, unknownThread } from './shared.mjs';
import { ULID_PATTERN } from './schemas.mjs';

async function assertObservableRepo(driver, repo) {
  if (!driver.isGit()) return;
  const identity = await driver.repoIdentity();
  if (identity.accepted.includes(repo)) return;
  throw new ToolError(foreignRepo('bind_branch', 'repo', repo, identity.canonical));
}

async function handler(ctx, args) {
  const { driver, now } = ctx;
  const thread = await driver.readThread(args.thread_id);
  if (!thread) {
    throw new ToolError(unknownThread('bind_branch', 'thread_id', args.thread_id));
  }
  const binding = newBinding(args, { now, tool: 'bind_branch' });
  await assertObservableRepo(driver, binding.repo);
  await driver.writeBinding(binding);
  const pointer = await writeActiveThreadOrWarn(ctx, thread.id);
  const { recovery_degraded } = await commitAndReindex(driver, `feat(ledger): bind ${args.branch} to ${thread.slug}`);
  return withWarnings({ binding, recovery_degraded }, [pointer.warning]);
}

export default {
  name: 'bind_branch',
  description: 'Bind an existing thread to a repo/branch and write the active-thread pointer, which is best-effort: a failure to write it leaves the binding stored and surfaces in warnings[]. On a git ledger, repo labels the one repository this ledger observes - its origin owner/name, its directory name or its path - and any other repository is refused.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['thread_id', 'repo', 'branch'],
    properties: {
      thread_id: { type: 'string', pattern: ULID_PATTERN },
      repo: { type: 'string', minLength: 1 },
      branch: { type: 'string', minLength: 1 },
      first_commit: { type: ['string', 'null'] },
      trailer_present: { type: 'boolean' },
    },
  },
  handler,
};
