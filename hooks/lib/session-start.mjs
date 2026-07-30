import { join } from 'node:path';
import {
  installCommitMsgHook,
  managedHooksDir,
  CORRUPT_PRIOR_HOOKS_PATH_KEY,
  DECLINED_PRIOR_HOOKS_PATH_KEY,
  PRIOR_HOOKS_PATH_CAPTURE,
  PRIOR_HOOKS_PATH_HEAL,
  PRIOR_HOOKS_PATH_KEY,
} from './installer.mjs';
import { isGitWorkTree } from './git.mjs';
import { formatRoster } from './roster.mjs';

const REPORT_REASON_MAX = 200;

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
  const scope = result.corruptPriorHooksPathScope ?? 'local';
  if (result.priorHooksPathHeal === PRIOR_HOOKS_PATH_HEAL.failed) {
    return `continuity: ${PRIOR_HOOKS_PATH_KEY} is corrupt in ${scope} scope and could not be rewritten;`
      + ` the prior hook chain stays disabled - run: git config --get ${PRIOR_HOOKS_PATH_KEY}`;
  }
  if (result.priorHooksPathHeal === PRIOR_HOOKS_PATH_HEAL.unrecoverable) {
    return `continuity: ${PRIOR_HOOKS_PATH_KEY} was corrupt in ${scope} scope and the original value could not`
      + ` be recovered - run: git config --get ${CORRUPT_PRIOR_HOOKS_PATH_KEY}`;
  }
  if (result.priorHooksPathHeal === PRIOR_HOOKS_PATH_HEAL.unrecovered) {
    return `continuity: ${PRIOR_HOOKS_PATH_KEY} is still empty after an unrecovered corruption in ${scope} scope;`
      + ` set it to your hooks dir, or clear the record with:`
      + ` git config --local --unset-all ${CORRUPT_PRIOR_HOOKS_PATH_KEY}`;
  }
  return null;
}

function captureReportLine(result) {
  if (result.priorHooksPathCapture !== PRIOR_HOOKS_PATH_CAPTURE.declined) {
    return null;
  }
  return `continuity: core.hooksPath already pointed at a continuity-managed hooks dir, so it was not captured`
    + ` as the prior hook chain - run: git config --get ${DECLINED_PRIOR_HOOKS_PATH_KEY}`;
}

function reasonSource(error) {
  const stderr = String(error?.stderr ?? '').trim();
  return stderr.length > 0 ? stderr : String(error?.message ?? error ?? 'unknown error');
}

function sanitizeReason(error) {
  return reasonSource(error)
    .split('\n')[0]
    .replace(/[^\x20-\x7E]/g, '')
    .slice(0, REPORT_REASON_MAX);
}

function installFailureLine(error) {
  return `continuity: the managed hooks install did not complete, so the prior hook chain may be unmanaged`
    + ` - ${sanitizeReason(error)}`;
}

function writeReport(lines) {
  for (const line of lines) {
    if (line !== null) {
      process.stderr.write(`${line}\n`);
    }
  }
}

function reportInstall(result) {
  if (result === null || typeof result !== 'object') {
    return;
  }
  writeReport([healReportLine(result), captureReportLine(result)]);
}

async function runSelfHeal(ctx) {
  try {
    reportInstall(await selfHeal(ctx));
  } catch (error) {
    writeReport([installFailureLine(error)]);
  }
}

export async function handleSessionStart(ctx) {
  if (await isGitWorkTree(ctx.projectDir)) {
    await runSelfHeal(ctx);
  }
  await ctx.invokeCli(['sync']);
  await ctx.invokeCli(['reconcile']);
  const roster = await ctx.invokeCliJson(['roster']);
  return { json: { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: formatRoster(roster) } } };
}

export { selfHeal };
