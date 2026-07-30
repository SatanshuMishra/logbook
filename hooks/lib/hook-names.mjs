export const STANDARD_HOOKS = Object.freeze([
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'post-rewrite',
  'pre-auto-gc',
  'push-to-checkout',
  'post-index-change',
  'sendemail-validate',
  'reference-transaction',
]);

export const CHAINABLE_HOOKS = Object.freeze([...STANDARD_HOOKS, 'commit-msg']);
