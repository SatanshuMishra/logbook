import { scopedExec } from '../util/git-scope.mjs';

export const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
export const LEDGER_ROOT_MESSAGE = 'chore: initialize continuity ledger';
export const LEDGER_INIT_IDENTITY = Object.freeze({
  name: 'Continuity Ledger',
  email: 'ledger@continuity.invalid',
  date: '2020-01-01T00:00:00Z',
});
export const LEDGER_BACKENDS = Object.freeze(['orphan-branch', 'custom-ref']);
export const DEFAULT_LEDGER_BRANCH = '_ledger';
export const DEFAULT_REMOTE = 'origin';
export const MAX_SYNC_ATTEMPTS = 5;

export function ledgerCommitEnv() {
  return {
    GIT_AUTHOR_NAME: LEDGER_INIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: LEDGER_INIT_IDENTITY.email,
    GIT_AUTHOR_DATE: undefined,
    GIT_COMMITTER_NAME: LEDGER_INIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: LEDGER_INIT_IDENTITY.email,
    GIT_COMMITTER_DATE: undefined,
  };
}

export function assertCommitMessage(fn, message) {
  if (typeof message !== 'string' || message.length === 0) {
    throw new Error(`${fn}: message must be a non-empty string`);
  }
  return message;
}

export function assertBackend(backend) {
  if (!LEDGER_BACKENDS.includes(backend)) {
    throw new Error(`unknown ledger backend: ${backend}`);
  }
  return backend;
}

function requireBranch(fn, branch) {
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error(`${fn}: branch must be a non-empty string`);
  }
}

export function ledgerRefName(backend, branch = DEFAULT_LEDGER_BRANCH) {
  assertBackend(backend);
  requireBranch('ledgerRefName', branch);
  return backend === 'custom-ref' ? `refs/ledger/${branch}` : `refs/heads/${branch}`;
}

export function mirrorRefName(backend, branch = DEFAULT_LEDGER_BRANCH, remote = DEFAULT_REMOTE) {
  assertBackend(backend);
  requireBranch('mirrorRefName', branch);
  return backend === 'custom-ref'
    ? `refs/ledger-remote/${branch}`
    : `refs/remotes/${remote}/${branch}`;
}

export function fetchRefspecFor(backend, branch = DEFAULT_LEDGER_BRANCH, remote = DEFAULT_REMOTE) {
  assertBackend(backend);
  requireBranch('fetchRefspecFor', branch);
  return backend === 'custom-ref'
    ? '+refs/ledger/*:refs/ledger-remote/*'
    : `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`;
}

export async function mintLedgerRoot(scope) {
  const env = {
    GIT_AUTHOR_NAME: LEDGER_INIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: LEDGER_INIT_IDENTITY.email,
    GIT_AUTHOR_DATE: LEDGER_INIT_IDENTITY.date,
    GIT_COMMITTER_NAME: LEDGER_INIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: LEDGER_INIT_IDENTITY.email,
    GIT_COMMITTER_DATE: LEDGER_INIT_IDENTITY.date,
  };
  const { stdout } = await scopedExec(
    scope,
    ['commit-tree', EMPTY_TREE_SHA, '-m', LEDGER_ROOT_MESSAGE],
    { env },
  );
  return stdout.trim();
}
