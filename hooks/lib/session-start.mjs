import { join } from 'node:path';
import {
  installCommitMsgHook,
  managedHooksDir,
  CORRUPT_PRIOR_HOOKS_PATH_KEY,
  PRIOR_HOOKS_PATH_HEAL,
  PRIOR_HOOKS_PATH_KEY,
} from './installer.mjs';
import { isGitWorkTree } from './git.mjs';
import { formatRoster } from './roster.mjs';

async function selfHeal(ctx) {
  const { env, projectDir, pluginRoot } = ctx;
  const dataRoot = env.CLAUDE_PLUGIN_DATA;
  if (!dataRoot || !pluginRoot) {
    return null;
  }
  const managedDir = managedHooksDir(dataRoot, projectDir);
  const sourceHook = join(pluginRoot, 'hooks', 'commit-msg');
  const disableTrailer = env.LEDGER_DISABLE_TRAILER === 'true';
  return installCommitMsgHook({ repoDir: projectDir, managedDir, sourceHook, disableTrailer });
}

function healReportLine(result) {
  if (result === null || typeof result !== 'object') {
    return null;
  }
  const scope = result.corruptPriorHooksPathScope ?? 'local';
  if (result.priorHooksPathHeal === PRIOR_HOOKS_PATH_HEAL.failed) {
    return `continuity: ${PRIOR_HOOKS_PATH_KEY} is corrupt in ${scope} scope and could not be rewritten;`
      + ` the prior hook chain stays disabled - run: git config --get ${PRIOR_HOOKS_PATH_KEY}`;
  }
  if (result.priorHooksPathHeal === PRIOR_HOOKS_PATH_HEAL.unrecoverable) {
    return `continuity: ${PRIOR_HOOKS_PATH_KEY} was corrupt in ${scope} scope and the original value could not`
      + ` be recovered - run: git config --get ${CORRUPT_PRIOR_HOOKS_PATH_KEY}`;
  }
  return null;
}

function reportHeal(result) {
  const line = healReportLine(result);
  if (line !== null) {
    process.stderr.write(`${line}\n`);
  }
}

export async function handleSessionStart(ctx) {
  if (await isGitWorkTree(ctx.projectDir)) {
    try {
      reportHeal(await selfHeal(ctx));
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
