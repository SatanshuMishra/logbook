export async function gitFirstCommitDate(git, repoDir, relPath) {
  let out;
  try {
    out = await git(['log', '--reverse', '--format=%aI', '--', relPath], { cwd: repoDir });
  } catch {
    return null;
  }
  if (typeof out !== 'string') {
    throw new TypeError('gitFirstCommitDate: injected git resolver must yield a stdout string');
  }
  const first = out.split('\n').find((line) => line.trim() !== '');
  return first ? first.trim() : null;
}

export function earliestSessionDate(sessions) {
  const dates = (sessions ?? []).map((s) => s.date).filter(Boolean).sort();
  return dates.length ? `${dates[0]}T00:00:00Z` : null;
}

export function earliestDecisionDate(decisions) {
  const dates = (decisions ?? []).map((d) => d.date).filter(Boolean).sort();
  return dates.length ? `${dates[0]}T00:00:00Z` : null;
}

function normalizeUpdated(updated) {
  if (!updated) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(updated)) {
    return updated;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
    return `${updated}T00:00:00Z`;
  }
  return null;
}

export async function deriveCreatedAt({ gitDate, sessions, decisions, updated }) {
  if (gitDate) {
    return { created_at: gitDate, rung: 1 };
  }
  const s = earliestSessionDate(sessions);
  if (s) {
    return { created_at: s, rung: 2 };
  }
  const d = earliestDecisionDate(decisions);
  if (d) {
    return { created_at: d, rung: 3 };
  }
  const u = normalizeUpdated(updated);
  if (u) {
    return { created_at: u, rung: 4 };
  }
  throw new Error('created_at derivation exhausted all four rungs; store cannot supply a timestamp');
}
