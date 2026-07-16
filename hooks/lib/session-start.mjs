import { join } from 'node:path';
import { installCommitMsgHook, managedHooksDir } from './installer.mjs';
import { isGitWorkTree } from './git.mjs';
import { formatRoster } from './roster.mjs';

async function selfHeal(ctx) {
  const { env, projectDir, pluginRoot } = ctx;
  const dataRoot = env.CLAUDE_PLUGIN_DATA;
  if (!dataRoot || !pluginRoot) {
    return;
  }
  const managedDir = managedHooksDir(dataRoot, projectDir);
  const sourceHook = join(pluginRoot, 'hooks', 'commit-msg');
  const disableTrailer = env.LEDGER_DISABLE_TRAILER === 'true';
  await installCommitMsgHook({ repoDir: projectDir, managedDir, sourceHook, disableTrailer });
}

export async function handleSessionStart(ctx) {
  if (await isGitWorkTree(ctx.projectDir)) {
    try {
      await selfHeal(ctx);
    } catch {
      void 0;
    }
  }
  await ctx.invokeCli(['sync']);
  await ctx.invokeCli(['reconcile']);
  const roster = await ctx.invokeCliJson(['roster']);
  return { json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: formatRoster(roster) } } };
}

export { selfHeal };
