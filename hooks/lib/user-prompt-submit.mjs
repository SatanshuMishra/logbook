import { formatRoster } from './roster.mjs';

const RESUME_INTENT = /\b(resume|resuming|pick up where|catch me up|where (?:did|were) we|last session|continue where we|carry on where we)\b/i;

export function isResumeIntent(prompt) {
  return typeof prompt === 'string' && RESUME_INTENT.test(prompt);
}

export async function handleUserPromptSubmit(ctx) {
  const prompt = ctx.input && typeof ctx.input.prompt === 'string' ? ctx.input.prompt : '';
  if (!isResumeIntent(prompt)) {
    return {};
  }
  const roster = await ctx.invokeCliJson(['roster']);
  if (!Array.isArray(roster) || roster.length === 0) {
    return {};
  }
  return { json: { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: formatRoster(roster) } } };
}
