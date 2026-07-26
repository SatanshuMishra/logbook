import { stat } from 'node:fs/promises';
import { headSha } from './git.mjs';

const DEFAULT_FRACTION = 0.7;
const DEFAULT_BUDGET = 1_200_000;
const COMMITISH = /\bgit\s+(commit|merge|rebase|cherry-pick|revert|pull|am)\b/;
const NUDGE_TEXT =
  'Session-continuity: this session is approaching the compaction threshold. Consider running the ledgerize skill now to refresh the spine and hand off the active thread before context is compacted.';

export function computeNudgeThreshold(env = process.env) {
  let fraction = Number(env.LEDGER_NUDGE_FRACTION);
  if (!(fraction > 0 && fraction < 1)) {
    fraction = DEFAULT_FRACTION;
  }
  let budget = Number(env.LEDGER_NUDGE_BYTES);
  if (!(budget > 0)) {
    budget = DEFAULT_BUDGET;
  }
  return budget * fraction;
}

export function isCommitish(input) {
  if (!input || input.tool_name !== 'Bash') {
    return false;
  }
  const command = input.tool_input ? input.tool_input.command : undefined;
  return typeof command === 'string' && COMMITISH.test(command);
}

async function transcriptSize(path) {
  if (typeof path !== 'string' || path.length === 0) {
    return 0;
  }
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

export async function handlePostToolUse(ctx) {
  if (isCommitish(ctx.input)) {
    const sha = await headSha(ctx.projectDir);
    if (sha) {
      await ctx.invokeCli(['record-sha', sha]);
    }
  }
  const size = await transcriptSize(ctx.input.transcript_path);
  if (size >= computeNudgeThreshold(ctx.env)) {
    return { json: { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: NUDGE_TEXT } } };
  }
  return {};
}
