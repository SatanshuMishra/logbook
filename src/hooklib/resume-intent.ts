const RESUME_INTENT_PATTERN =
  /\b(resume|resuming|pick up where|catch me up|where (?:did|were) we|last session|continue where we|carry on where we)\b/i

export const isResumeIntent = (prompt: unknown): boolean => typeof prompt === 'string' && RESUME_INTENT_PATTERN.test(prompt)
