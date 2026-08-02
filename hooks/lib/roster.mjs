const EMPTY = 'Logbook: no resumable threads.';

export function formatRoster(roster) {
  if (!Array.isArray(roster) || roster.length === 0) {
    return EMPTY;
  }
  const lines = roster.map((thread) => {
    const status = thread.status ?? '?';
    const slug = thread.slug ?? '(no slug)';
    const title = thread.title ?? '';
    const nextStep = thread.next_step ? ` -- next: ${thread.next_step}` : '';
    const id = thread.id ?? '(no id)';
    return `- [${status}] ${slug}: ${title}${nextStep} (id ${id})`;
  });
  return `Logbook resumable threads (${roster.length}):\n${lines.join('\n')}`;
}
