export const THREAD_STATUSES = Object.freeze([
  'active',
  'paused',
  'blocked',
  'done',
  'abandoned',
]);

export const TERMINAL_STATUSES = Object.freeze(['done', 'abandoned']);

export const ALLOWED_TRANSITIONS = Object.freeze({
  active: Object.freeze(['paused', 'blocked', 'done', 'abandoned']),
  paused: Object.freeze(['active', 'done', 'abandoned']),
  blocked: Object.freeze(['active', 'paused']),
  done: Object.freeze([]),
  abandoned: Object.freeze([]),
});

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from, to) {
  const targets = ALLOWED_TRANSITIONS[from];
  return Array.isArray(targets) && targets.includes(to);
}
