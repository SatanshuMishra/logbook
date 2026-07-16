import { LocalDriver } from './local-driver.mjs';
import {
  DEFAULT_LEDGER_BRANCH,
  DEFAULT_REMOTE,
  assertBackend,
  ledgerRefName,
  mirrorRefName,
  fetchRefspecFor,
} from './git-ledger.mjs';

export class GitRefDriver extends LocalDriver {
  constructor({
    repoDir,
    worktreeDir,
    backend = 'orphan-branch',
    branch = DEFAULT_LEDGER_BRANCH,
    remote = DEFAULT_REMOTE,
  } = {}) {
    super(worktreeDir);
    if (typeof repoDir !== 'string' || repoDir.length === 0) {
      throw new Error('GitRefDriver: repoDir must be a non-empty string');
    }
    assertBackend(backend);
    this.repoDir = repoDir;
    this.worktreeDir = worktreeDir;
    this.backend = backend;
    this.branch = branch;
    this.remote = remote;
    this.ledgerRef = ledgerRefName(backend, branch);
    this.mirrorRef = mirrorRefName(backend, branch, remote);
    this.fetchRefspec = fetchRefspecFor(backend, branch, remote);
  }

  isGit() {
    return true;
  }
}
