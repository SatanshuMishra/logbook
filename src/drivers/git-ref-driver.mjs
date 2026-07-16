import { rm, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LocalDriver } from './local-driver.mjs';
import { gitExec } from '../util/git-exec.mjs';
import {
  EMPTY_TREE_SHA,
  LEDGER_INIT_IDENTITY,
  MAX_SYNC_ATTEMPTS,
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

function isContention(stderr) {
  return /\b(rejected|stale info|fetch first|non-fast-forward)\b/i.test(stderr || '');
}

async function isAncestor(repo, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  const { code } = await gitExec(repo, ['merge-base', '--is-ancestor', ancestor, descendant], { check: false });
  return code === 0;
}

async function cherryAllMerged(repo, base, tip) {
  const { code, stdout } = await gitExec(repo, ['cherry', base, tip], { check: false });
  if (code !== 0) return false;
  const lines = stdout.trim() === '' ? [] : stdout.trim().split('\n');
  return lines.length > 0 && lines.every((line) => line.startsWith('-'));
}

async function aheadBehind(repo, branch, headSha) {
  const upstream = `refs/remotes/origin/${branch}`;
  if ((await revParseOrNull(repo, upstream)) === null || headSha === null) {
    return { ahead: 0, behind: 0 };
  }
  const { code, stdout } = await gitExec(
    repo,
    ['rev-list', '--left-right', '--count', `${upstream}...${headSha}`],
    { check: false },
  );
  if (code !== 0) return { ahead: 0, behind: 0 };
  const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

async function divergedFromUpstream(repo, branch, headSha) {
  const upstream = `refs/remotes/origin/${branch}`;
  const up = await revParseOrNull(repo, upstream);
  if (up === null || headSha === null) return false;
  const headAncestorOfUp = await isAncestor(repo, headSha, up);
  const upAncestorOfHead = await isAncestor(repo, up, headSha);
  return !headAncestorOfUp && !upAncestorOfHead;
}

function assertBinding(binding) {
  if (!binding || typeof binding !== 'object') {
    throw new Error('observeBranch: binding must be an object');
  }
  if (typeof binding.repo !== 'string' || binding.repo.length === 0) {
    throw new Error('observeBranch: binding.repo must be a non-empty string');
  }
  if (typeof binding.branch !== 'string' || binding.branch.length === 0) {
    throw new Error('observeBranch: binding.branch must be a non-empty string');
  }
  const fc = binding.first_commit;
  if (fc !== null && fc !== undefined && typeof fc !== 'string') {
    throw new Error('observeBranch: binding.first_commit must be a string or null');
  }
}

async function firstCommitOf(repo, ref, base) {
  if (base) {
    const range = await gitExec(repo, ['rev-list', '--reverse', `${base}..${ref}`], { check: false });
    if (range.code === 0) {
      const first = range.stdout.trim().split('\n').filter(Boolean)[0];
      if (first) return first;
    }
  }
  const root = await gitExec(repo, ['rev-list', '--max-parents=0', ref], { check: false });
  if (root.code !== 0) return null;
  const roots = root.stdout.trim().split('\n').filter(Boolean);
  return roots[roots.length - 1] || null;
}

async function threadIdTrailer(repo, commit) {
  const { code, stdout } = await gitExec(
    repo,
    ['show', '-s', '--format=%(trailers:key=Thread-Id,valueonly)', commit],
    { check: false },
  );
  if (code !== 0) return null;
  const first = stdout.split('\n').map((s) => s.trim()).find((s) => s.length > 0);
  return first || null;
}

function assertRepo(fn, repo) {
  if (typeof repo !== 'string' || repo.length === 0) {
    throw new Error(`${fn}: repo must be a non-empty string`);
  }
}

function assertRepoBranch(fn, repo, branch) {
  assertRepo(fn, repo);
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new Error(`${fn}: branch must be a non-empty string`);
  }
}

export async function resolveIntegrationBase(repo) {
  const override = process.env.LEDGER_BASE_REF;
  if (typeof override === 'string' && override.trim() !== '') {
    return override.trim();
  }
  const sym = await gitExec(repo, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { check: false });
  if (sym.code === 0 && sym.stdout.trim() !== '') {
    return sym.stdout.trim().replace(/^refs\/remotes\//, '');
  }
  for (const candidate of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
    if ((await revParseOrNull(repo, candidate)) !== null) {
      return candidate.replace(/^refs\/remotes\//, '');
    }
  }
  return null;
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
    if (this.backend === 'custom-ref') {
      await this.#ensureFetchRefspec();
    }
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

  async #ensureFetchRefspec() {
    const key = `remote.${this.remote}.fetch`;
    const { code, stdout } = await gitExec(this.repoDir, ['config', '--get-all', key], { check: false });
    const existing = code === 0 ? stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    if (!existing.includes(this.fetchRefspec)) {
      await gitExec(this.repoDir, ['config', '--add', key, this.fetchRefspec]);
    }
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

  async sync() {
    if (!(await this.#hasRemote())) {
      return { synced: false, pushed: false, merged: false, remote: false, attempts: 0 };
    }
    let attempts = 0;
    while (attempts < MAX_SYNC_ATTEMPTS) {
      attempts += 1;
      await gitExec(this.repoDir, ['fetch', this.remote, this.fetchRefspec], { check: false });
      const localSha = await revParseOrNull(this.repoDir, this.ledgerRef);
      const remoteSha = await revParseOrNull(this.repoDir, this.mirrorRef);
      if (remoteSha === null) {
        if (await this.#pushCreate(localSha)) {
          return { synced: true, pushed: true, merged: false, remote: true, attempts };
        }
        continue;
      }
      if (localSha === remoteSha) {
        return { synced: true, pushed: false, merged: false, remote: true, attempts };
      }
      if (await isAncestor(this.repoDir, remoteSha, localSha)) {
        if (await this.#pushLease(localSha, remoteSha)) {
          return { synced: true, pushed: true, merged: false, remote: true, attempts };
        }
        continue;
      }
      if (await isAncestor(this.repoDir, localSha, remoteSha)) {
        await this.#fastForwardLocal(remoteSha);
        return { synced: true, pushed: false, merged: false, remote: true, attempts };
      }
      await this.#assertSharedRoot(localSha, remoteSha);
      const mergeSha = await this.#mergeTheirs();
      if (await this.#pushLease(mergeSha, remoteSha)) {
        return { synced: true, pushed: true, merged: true, remote: true, attempts };
      }
    }
    throw new Error(`sync: exceeded MAX_SYNC_ATTEMPTS (${MAX_SYNC_ATTEMPTS})`);
  }

  async #hasRemote() {
    const { code, stdout } = await gitExec(this.repoDir, ['remote'], { check: false });
    if (code !== 0) return false;
    return stdout.split('\n').map((s) => s.trim()).includes(this.remote);
  }

  async #pushCreate(localSha) {
    const result = await gitExec(
      this.repoDir,
      ['push', this.remote, `${localSha}:${this.ledgerRef}`],
      { check: false },
    );
    if (result.code === 0) return true;
    if (isContention(result.stderr)) return false;
    throw new Error(`sync: push rejected: ${result.stderr.trim()}`);
  }

  async #pushLease(localSha, expectedRemoteSha) {
    const result = await gitExec(
      this.repoDir,
      ['push', `--force-with-lease=${this.ledgerRef}:${expectedRemoteSha}`, this.remote, `${localSha}:${this.ledgerRef}`],
      { check: false },
    );
    if (result.code === 0) return true;
    if (isContention(result.stderr)) return false;
    throw new Error(`sync: push rejected: ${result.stderr.trim()}`);
  }

  async #fastForwardLocal(remoteSha) {
    await gitExec(this.worktreeDir, ['merge', '--ff-only', remoteSha], { env: ledgerCommitEnv() });
    await gitExec(this.repoDir, ['update-ref', this.ledgerRef, remoteSha]);
  }

  async #assertSharedRoot() {
    throw new Error('GitRefDriver: #assertSharedRoot not implemented yet (Task 10)');
  }

  async #mergeTheirs() {
    throw new Error('GitRefDriver: #mergeTheirs not implemented yet (Task 10)');
  }

  async observeBranch(binding) {
    assertBinding(binding);
    const repo = binding.repo;
    const branch = binding.branch;
    const firstCommit = binding.first_commit ?? null;
    const base = await resolveIntegrationBase(repo);
    const headSha = await revParseOrNull(repo, `refs/heads/${branch}`);
    if (headSha === null) {
      return this.#observeDeleted(repo, firstCommit, base);
    }
    return this.#observeLive(repo, branch, headSha, firstCommit, base);
  }

  async #observeLive(repo, branch, headSha, firstCommit, base) {
    const firstCommitPresent = firstCommit === null
      ? true
      : await isAncestor(repo, firstCommit, headSha);
    const merged = base !== null && (await isAncestor(repo, headSha, base));
    const squashMerged = !merged && base !== null && (await cherryAllMerged(repo, base, headSha));
    const { ahead, behind } = await aheadBehind(repo, branch, headSha);
    const diverged = await divergedFromUpstream(repo, branch, headSha);
    return {
      branch_exists: true,
      head_sha: headSha,
      first_commit_present: firstCommitPresent,
      merged,
      squash_merged: squashMerged,
      ahead,
      behind,
      force_push_detected: false,
      diverged_from_upstream: diverged,
      key_files_deleted: [],
      key_files_modified: [],
    };
  }

  async #observeDeleted(repo, firstCommit, base) {
    let merged = false;
    let squashMerged = false;
    if (firstCommit !== null && base !== null) {
      merged = await isAncestor(repo, firstCommit, base);
      squashMerged = !merged && (await cherryAllMerged(repo, base, firstCommit));
    }
    return {
      branch_exists: false,
      head_sha: null,
      first_commit_present: true,
      merged,
      squash_merged: squashMerged,
      ahead: 0,
      behind: 0,
      force_push_detected: false,
      diverged_from_upstream: false,
      key_files_deleted: [],
      key_files_modified: [],
    };
  }

  async observeNewBranch(repo, branch) {
    assertRepoBranch('observeNewBranch', repo, branch);
    const ref = `refs/heads/${branch}`;
    const headSha = await revParseOrNull(repo, ref);
    if (headSha === null) {
      return { thread_id_trailer: null, first_commit: null };
    }
    const base = await resolveIntegrationBase(repo);
    const firstCommit = await firstCommitOf(repo, ref, base);
    const trailer = firstCommit ? await threadIdTrailer(repo, firstCommit) : null;
    return { thread_id_trailer: trailer, first_commit: firstCommit };
  }

  async listRepoBranches(repo) {
    assertRepo('listRepoBranches', repo);
    const { stdout } = await gitExec(repo, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']);
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  }
}
