const EMPTY = 'Logbook: no resumable threads.';
const NEXT_STEP_MAX_CHARS = 120;
const ELLIPSIS = '...';

function truncate(text, maxChars) {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - ELLIPSIS.length)}${ELLIPSIS}`;
}

function progressFragment(thread) {
  const done = thread.done;
  const total = thread.total;
  if (!Number.isInteger(done) || !Number.isInteger(total)) return '';
  if (done < 0 || total < 0) return '';
  return ` (${done} of ${total})`;
}

function nextStepFragment(thread) {
  if (typeof thread.next_step !== 'string' || thread.next_step.length === 0) return '';
  return ` -- next: ${truncate(thread.next_step, NEXT_STEP_MAX_CHARS)}`;
}

export function formatRoster(roster) {
  if (!Array.isArray(roster) || roster.length === 0) {
    return EMPTY;
  }
  const lines = roster.map((entry) => {
    const thread = entry && typeof entry === 'object' ? entry : {};
    const status = thread.status ?? '?';
    const slug = thread.slug ?? '(no slug)';
    const title = thread.title ?? '';
    const id = thread.id ?? '(no id)';
    return `- [${status}] ${slug}${progressFragment(thread)}: ${title}${nextStepFragment(thread)} (id ${id})`;
  });
  return `Logbook resumable threads (${roster.length}):\n${lines.join('\n')}`;
}
