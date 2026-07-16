import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalDriver } from './local-driver.mjs';
import { gitExec } from '../util/git-exec.mjs';
import {
  EMPTY_TREE_SHA,
  LEDGER_INIT_IDENTITY,
  DEFAULT_LEDGER_BRANCH,
  DEFAULT_REMOTE,
  assertBackend,
  ledgerRefName,
  mirrorRefName,
  fetchRefspecFor,
  mintLedgerRoot,
} from './git-ledger.mjs';

const SUBDIRS = ['threads', 'bindings', 'decisions', 'sessions', 'index'];
const GITATTRIBUTES = 'sessions/**/*.md merge=union\n';
const GITIGNORE = 'index/\n';
const SCAFFOLD_MESSAGE = 'chore: scaffold ledger';

function ledgerCommitEnv() {
  return {
    GIT_AUTHOR_NAME: LEDGER_INIT_IDENTITY.name,
    GIT_AUTHOR_EMAIL: LEDGER_INIT_IDENTITY.email,
    GIT_COMMITTER_NAME: LEDGER_INIT_IDENTITY.name,
    GIT_COMMITTER_EMAIL: LEDGER_INIT_IDENTITY.email,
  };
}

async function revParseOrNull(repo, ref) {
  const { code, stdout } = await gitExec(repo, ['rev-parse', '--verify', '--quiet', ref], { check: false });
  return code === 0 ? stdout.trim() : null;
}

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

  async init() {
    await this.#ensureLedgerRef();
    await this.#assertDeterministicRoot();
    await this.#ensureWorktree();
    await this.#ensureSubdirs();
    await this.#ensureScaffold();
    return this.root();
  }

  async #ensureLedgerRef() {
    const existing = await revParseOrNull(this.repoDir, this.ledgerRef);
    if (existing !== null) return;
    const rootSha = await mintLedgerRoot(this.repoDir);
    await gitExec(this.repoDir, ['update-ref', this.ledgerRef, rootSha]);
  }

  async #assertDeterministicRoot() {
    const roots = await gitExec(this.repoDir, ['rev-list', '--max-parents=0', this.ledgerRef], { check: false });
    if (roots.code !== 0) return;
    const rootSha = roots.stdout.trim().split('\n').filter(Boolean).pop();
    if (!rootSha) return;
    const tree = await gitExec(this.repoDir, ['rev-parse', `${rootSha}^{tree}`], { check: false });
    if (tree.code === 0 && tree.stdout.trim() !== EMPTY_TREE_SHA) {
      throw new Error(
        `GitRefDriver: ${this.ledgerRef} root tree ${tree.stdout.trim()} is not the empty tree; refusing to adopt a non-ledger ref`,
      );
    }
  }

  async #ensureWorktree() {
    await rm(this.worktreeDir, { recursive: true, force: true });
    await gitExec(this.repoDir, ['worktree', 'prune']);
    await gitExec(this.repoDir, ['worktree', 'add', '--detach', this.worktreeDir, this.ledgerRef]);
  }

  async #ensureSubdirs() {
    for (const sub of SUBDIRS) {
      await mkdir(join(this.worktreeDir, sub), { recursive: true });
    }
  }

  async #ensureScaffold() {
    await writeFile(join(this.worktreeDir, '.gitattributes'), GITATTRIBUTES);
    await writeFile(join(this.worktreeDir, '.gitignore'), GITIGNORE);
    await this.#commitWorktree(SCAFFOLD_MESSAGE);
  }

  async #commitWorktree(message) {
    await gitExec(this.worktreeDir, ['add', '-A']);
    const staged = await gitExec(this.worktreeDir, ['diff', '--cached', '--quiet'], { check: false });
    if (staged.code === 0) {
      return { committed: false, sha: null, empty: true };
    }
    await gitExec(this.worktreeDir, ['commit', '--no-verify', '-m', message], { env: ledgerCommitEnv() });
    const { stdout } = await gitExec(this.worktreeDir, ['rev-parse', 'HEAD']);
    const sha = stdout.trim();
    await gitExec(this.repoDir, ['update-ref', this.ledgerRef, sha]);
    return { committed: true, sha, empty: false };
  }

  async commit(message) {
    return this.#commitWorktree(message);
  }
}
