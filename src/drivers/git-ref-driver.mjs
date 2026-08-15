import { rm, mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { LocalDriver } from './local-driver.mjs';
import { ACTIVE_THREAD_POINTER } from './storage-driver.mjs';
import { ActivePointerUnavailable } from '../util/active-thread.mjs';
import {
  hostScope,
  isolatedScope,
  networkScope,
  resolveGitDir,
  scopedExec,
} from '../util/git-scope.mjs';
import {
  EMPTY_TREE_SHA,
  MAX_SYNC_ATTEMPTS,
  DEFAULT_LEDGER_BRANCH,
  DEFAULT_REMOTE,
  assertBackend,
  assertCommitMessage,
  ledgerCommitEnv,
  ledgerRefName,
  mirrorRefName,
  fetchRefspecFor,
  mintLedgerRoot,
} from './git-ledger.mjs';

const SUBDIRS = ['threads', 'bindings', 'decisions', 'sessions', 'index'];
const POINTER_DIR = 'ledger';
const UNRESOLVED_GIT_DIR = 'the project git directory could not be resolved';
const GITATTRIBUTES = 'sessions/**/*.md merge=union\n';
const GITIGNORE = 'index/\n';
const SCAFFOLD_MESSAGE = 'chore: scaffold ledger';
const MERGE_MESSAGE = 'chore: merge ledger';

export const WORKTREE_LOCK_FILE = 'logbook-worktree.lock';
export const WORKTREE_LOCK_TIMEOUT_MS = 10_000;
const WORKTREE_LOCK_POLL_MS = 50;

async function worktreeLockIsStale(lockPath) {
  try {
    const info = await stat(lockPath);
    return Date.now() - info.mtimeMs >= WORKTREE_LOCK_TIMEOUT_MS;
  } catch {
    return true;
  }
}

async function takeWorktreeLock(lockPath, token) {
  const handle = await open(lockPath, 'wx');
  try {
    await handle.writeFile(token);
  } finally {
    await handle.close();
  }
}

async function acquireWorktreeLock(lockPath, token) {
  const deadline = Date.now() + WORKTREE_LOCK_TIMEOUT_MS;
  for (;;) {
    try {
      await takeWorktreeLock(lockPath, token);
      return true;
    } catch (error) {
      if (error?.code !== 'EEXIST') return false;
    }
    if (Date.now() >= deadline) return false;
    if (await worktreeLockIsStale(lockPath)) {
      await rm(lockPath, { force: true });
    }
    await delay(WORKTREE_LOCK_POLL_MS);
  }
}

async function releaseWorktreeLock(lockPath, token) {
  let held;
  try {
    held = await readFile(lockPath, 'utf8');
  } catch {
    return;
  }
  if (held !== token) return;
  await rm(lockPath, { force: true });
}

async function revParseOrNull(scope, ref) {
  const { code, stdout } = await scopedExec(scope, ['rev-parse', '--verify', '--quiet', ref], { check: false });
  return code === 0 ? stdout.trim() : null;
}

function isContention(stderr) {
  return /\b(rejected|stale info|fetch first|non-fast-forward)\b/i.test(stderr || '');
}

async function isAncestor(scope, ancestor, descendant) {
  if (!ancestor || !descendant) return false;
  const { code } = await scopedExec(scope, ['merge-base', '--is-ancestor', ancestor, descendant], { check: false });
  return code === 0;
}

async function cherryAllMerged(scope, base, tip) {
  const { code, stdout } = await scopedExec(scope, ['cherry', base, tip], { check: false });
  if (code !== 0) return false;
  const lines = stdout.trim() === '' ? [] : stdout.trim().split('\n');
  return lines.length > 0 && lines.every((line) => line.startsWith('-'));
}

async function aheadBehind(scope, branch, headSha) {
  const upstream = `refs/remotes/origin/${branch}`;
  if ((await revParseOrNull(scope, upstream)) === null || headSha === null) {
    return { ahead: 0, behind: 0 };
  }
  const { code, stdout } = await scopedExec(
    scope,
    ['rev-list', '--left-right', '--count', `${upstream}...${headSha}`],
    { check: false },
  );
  if (code !== 0) return { ahead: 0, behind: 0 };
  const [behind, ahead] = stdout.trim().split(/\s+/).map(Number);
  return { ahead: ahead || 0, behind: behind || 0 };
}

async function divergedFromUpstream(scope, branch, headSha) {
  const upstream = `refs/remotes/origin/${branch}`;
  const up = await revParseOrNull(scope, upstream);
  if (up === null || headSha === null) return false;
  const headAncestorOfUp = await isAncestor(scope, headSha, up);
  const upAncestorOfHead = await isAncestor(scope, up, headSha);
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

async function firstCommitOf(scope, ref, base) {
  if (base) {
    const range = await scopedExec(scope, ['rev-list', '--reverse', `${base}..${ref}`], { check: false });
    if (range.code === 0) {
      const first = range.stdout.trim().split('\n').filter(Boolean)[0];
      if (first) return first;
    }
  }
  const root = await scopedExec(scope, ['rev-list', '--max-parents=0', ref], { check: false });
  if (root.code !== 0) return null;
  const roots = root.stdout.trim().split('\n').filter(Boolean);
  return roots[roots.length - 1] || null;
}

async function threadIdTrailer(scope, commit) {
  const { code, stdout } = await scopedExec(
    scope,
    ['show', '-s', '--format=%(trailers:key=Thread-Id,valueonly)', commit],
    { check: false },
  );
  if (code !== 0) return null;
  const first = stdout.split('\n').map((s) => s.trim()).find((s) => s.length > 0);
  return first || null;
}

function remoteSlug(url) {
  if (typeof url !== 'string') return null;
  const trimmed = url.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  if (trimmed === '') return null;
  const afterScheme = trimmed.includes('://')
    ? trimmed.slice(trimmed.indexOf('://') + '://'.length)
    : trimmed;
  const afterHost = afterScheme.includes(':')
    ? afterScheme.slice(afterScheme.lastIndexOf(':') + 1)
    : afterScheme;
  const segments = afterHost.split('/').filter(Boolean);
  return segments.length >= 2 ? segments.slice(-2).join('/') : null;
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
  const scope = hostScope(repo);
  const sym = await scopedExec(scope, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], { check: false });
  if (sym.code === 0 && sym.stdout.trim() !== '') {
    return sym.stdout.trim().replace(/^refs\/remotes\//, '');
  }
  for (const candidate of ['refs/remotes/origin/main', 'refs/remotes/origin/master']) {
    if ((await revParseOrNull(scope, candidate)) !== null) {
      return candidate.replace(/^refs\/remotes\//, '');
    }
  }
  return null;
}

export class GitRefDriver extends LocalDriver {
  #repoGitDir = null;

  #repoCommonGitDir = null;

  #uncommittedWrite = false;

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

  async activeThreadPointerPath() {
    try {
      return join(await this.#resolvedRepoCommonGitDir(), POINTER_DIR, ACTIVE_THREAD_POINTER);
    } catch (error) {
      throw new ActivePointerUnavailable(UNRESOLVED_GIT_DIR, { cause: error });
    }
  }

  async #resolvedRepoGitDir() {
    if (this.#repoGitDir === null) {
      this.#repoGitDir = await resolveGitDir(this.repoDir);
    }
    return this.#repoGitDir;
  }

  async #repoScope() {
    return isolatedScope(this.repoDir, await this.#resolvedRepoGitDir());
  }

  async #remoteScope() {
    return networkScope(this.repoDir, await this.#resolvedRepoGitDir());
  }

  async #resolvedRepoCommonGitDir() {
    if (this.#repoCommonGitDir === null) {
      const { code, stdout } = await scopedExec(
        await this.#repoScope(),
        ['rev-parse', '--git-common-dir'],
        { check: false },
      );
      const common = code === 0 ? stdout.trim() : '';
      this.#repoCommonGitDir = common === ''
        ? await this.#resolvedRepoGitDir()
        : resolve(this.repoDir, common);
    }
    return this.#repoCommonGitDir;
  }

  async #worktreeGitDir() {
    try {
      return await resolveGitDir(this.worktreeDir);
    } catch (error) {
      if (this.#uncommittedWrite) throw error;
      try {
        await this.#ensureWorktree();
        return await resolveGitDir(this.worktreeDir);
      } catch {
        throw error;
      }
    }
  }

  async #worktreeScope() {
    return isolatedScope(this.worktreeDir, await this.#worktreeGitDir());
  }

  async #writeInWorktree(write) {
    if (!this.#uncommittedWrite) await this.#worktreeGitDir();
    const written = await write();
    this.#uncommittedWrite = true;
    return written;
  }

  async writeThread(thread) {
    return this.#writeInWorktree(() => super.writeThread(thread));
  }

  async writeBinding(binding) {
    return this.#writeInWorktree(() => super.writeBinding(binding));
  }

  async writeDecision(nnnn, slug, markdown) {
    return this.#writeInWorktree(() => super.writeDecision(nnnn, slug, markdown));
  }

  async appendSessionEvent(threadId, isoTs, actor, markdown) {
    return this.#writeInWorktree(() => super.appendSessionEvent(threadId, isoTs, actor, markdown));
  }

  async writeIndexFile(name, obj) {
    return this.#writeInWorktree(() => super.writeIndexFile(name, obj));
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
    const scope = await this.#repoScope();
    const existing = await revParseOrNull(scope, this.ledgerRef);
    if (existing !== null) return;
    const rootSha = await mintLedgerRoot(scope);
    await scopedExec(scope, ['update-ref', this.ledgerRef, rootSha]);
  }

  async #assertDeterministicRoot() {
    const scope = await this.#repoScope();
    const roots = await scopedExec(scope, ['rev-list', '--max-parents=0', this.ledgerRef], { check: false });
    if (roots.code !== 0) return;
    const rootSha = roots.stdout.trim().split('\n').filter(Boolean).pop();
    if (!rootSha) return;
    const tree = await scopedExec(scope, ['rev-parse', `${rootSha}^{tree}`], { check: false });
    if (tree.code === 0 && tree.stdout.trim() !== EMPTY_TREE_SHA) {
      throw new Error(
        `GitRefDriver: ${this.ledgerRef} root tree ${tree.stdout.trim()} is not the empty tree; refusing to adopt a non-ledger ref`,
      );
    }
  }

  async #ensureWorktree() {
    const lockPath = join(await this.#resolvedRepoCommonGitDir(), WORKTREE_LOCK_FILE);
    const token = `${process.pid}-${randomUUID()}`;
    const locked = await acquireWorktreeLock(lockPath, token);
    try {
      await this.#provisionWorktree();
    } finally {
      if (locked) await releaseWorktreeLock(lockPath, token);
    }
  }

  async #provisionWorktree() {
    const scope = await this.#repoScope();
    await rm(this.worktreeDir, { recursive: true, force: true });
    await scopedExec(scope, ['worktree', 'prune']);
    await scopedExec(scope, ['worktree', 'add', '--detach', this.worktreeDir, this.ledgerRef]);
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
    const scope = await this.#repoScope();
    const key = `remote.${this.remote}.fetch`;
    const { code, stdout } = await scopedExec(scope, ['config', '--get-all', key], { check: false });
    const existing = code === 0 ? stdout.split('\n').map((s) => s.trim()).filter(Boolean) : [];
    if (!existing.includes(this.fetchRefspec)) {
      await scopedExec(scope, ['config', '--add', key, this.fetchRefspec]);
    }
  }

  async #commitWorktree(message) {
    const worktree = await this.#worktreeScope();
    await scopedExec(worktree, ['add', '-A']);
    const staged = await scopedExec(worktree, ['diff', '--cached', '--quiet'], { check: false });
    if (staged.code === 0) {
      return { committed: false, sha: null, empty: true, degraded: false };
    }
    await scopedExec(worktree, ['commit', '--no-verify', '-m', message], { env: ledgerCommitEnv() });
    const { stdout } = await scopedExec(worktree, ['rev-parse', 'HEAD']);
    const sha = stdout.trim();
    await scopedExec(await this.#repoScope(), ['update-ref', this.ledgerRef, sha]);
    return { committed: true, sha, empty: false, degraded: false };
  }

  async commit(message) {
    assertCommitMessage('GitRefDriver.commit', message);
    try {
      return await this.#commitWorktree(message);
    } finally {
      this.#uncommittedWrite = false;
    }
  }

  async sync() {
    const remote = await this.#remoteScope();
    if (!(await this.#hasRemote(remote))) {
      return { synced: false, pushed: false, merged: false, remote: false, attempts: 0 };
    }
    const repo = await this.#repoScope();
    let attempts = 0;
    while (attempts < MAX_SYNC_ATTEMPTS) {
      attempts += 1;
      await scopedExec(remote, ['fetch', this.remote, this.fetchRefspec], { check: false });
      const localSha = await revParseOrNull(repo, this.ledgerRef);
      const remoteSha = await revParseOrNull(repo, this.mirrorRef);
      if (remoteSha === null) {
        if (await this.#pushCreate(remote, localSha)) {
          return { synced: true, pushed: true, merged: false, remote: true, attempts };
        }
        continue;
      }
      if (localSha === remoteSha) {
        return { synced: true, pushed: false, merged: false, remote: true, attempts };
      }
      if (await isAncestor(repo, remoteSha, localSha)) {
        if (await this.#pushLease(remote, localSha, remoteSha)) {
          return { synced: true, pushed: true, merged: false, remote: true, attempts };
        }
        continue;
      }
      if (await isAncestor(repo, localSha, remoteSha)) {
        await this.#fastForwardLocal(remoteSha);
        return { synced: true, pushed: false, merged: false, remote: true, attempts };
      }
      await this.#assertSharedRoot(repo, localSha, remoteSha);
      const mergeSha = await this.#mergeTheirs();
      if (await this.#pushLease(remote, mergeSha, remoteSha)) {
        return { synced: true, pushed: true, merged: true, remote: true, attempts };
      }
    }
    throw new Error(`sync: exceeded MAX_SYNC_ATTEMPTS (${MAX_SYNC_ATTEMPTS})`);
  }

  async #hasRemote(scope) {
    const { code, stdout } = await scopedExec(scope, ['remote'], { check: false });
    if (code !== 0) return false;
    return stdout.split('\n').map((s) => s.trim()).includes(this.remote);
  }

  async #pushCreate(scope, localSha) {
    const result = await scopedExec(
      scope,
      ['push', this.remote, `${localSha}:${this.ledgerRef}`],
      { check: false },
    );
    if (result.code === 0) return true;
    if (isContention(result.stderr)) return false;
    throw new Error(`sync: push rejected: ${result.stderr.trim()}`);
  }

  async #pushLease(scope, localSha, expectedRemoteSha) {
    const result = await scopedExec(
      scope,
      ['push', `--force-with-lease=${this.ledgerRef}:${expectedRemoteSha}`, this.remote, `${localSha}:${this.ledgerRef}`],
      { check: false },
    );
    if (result.code === 0) return true;
    if (isContention(result.stderr)) return false;
    throw new Error(`sync: push rejected: ${result.stderr.trim()}`);
  }

  async #fastForwardLocal(remoteSha) {
    await scopedExec(await this.#worktreeScope(), ['merge', '--ff-only', remoteSha], { env: ledgerCommitEnv() });
    await scopedExec(await this.#repoScope(), ['update-ref', this.ledgerRef, remoteSha]);
  }

  async #assertSharedRoot(scope, localSha, remoteSha) {
    const { code, stdout } = await scopedExec(scope, ['merge-base', localSha, remoteSha], { check: false });
    if (code !== 0 || stdout.trim() === '') {
      throw new Error('sync: refusing to merge unrelated ledger histories (divergent root)');
    }
  }

  async #mergeTheirs() {
    const worktree = await this.#worktreeScope();
    await scopedExec(
      worktree,
      ['merge', '--no-verify', '--no-edit', '-X', 'theirs', '-m', MERGE_MESSAGE, this.mirrorRef],
      { env: ledgerCommitEnv() },
    );
    const { stdout } = await scopedExec(worktree, ['rev-parse', 'HEAD']);
    const sha = stdout.trim();
    await scopedExec(await this.#repoScope(), ['update-ref', this.ledgerRef, sha]);
    return sha;
  }

  async observeBranch(binding) {
    assertBinding(binding);
    const branch = binding.branch;
    const firstCommit = binding.first_commit ?? null;
    const base = await resolveIntegrationBase(this.repoDir);
    const scope = hostScope(this.repoDir);
    const headSha = await revParseOrNull(scope, `refs/heads/${branch}`);
    if (headSha === null) {
      return this.#observeDeleted(scope, firstCommit, base);
    }
    return this.#observeLive(scope, branch, headSha, firstCommit, base);
  }

  async #observeLive(scope, branch, headSha, firstCommit, base) {
    const firstCommitPresent = firstCommit === null
      ? true
      : await isAncestor(scope, firstCommit, headSha);
    const merged = base !== null && (await isAncestor(scope, headSha, base));
    const squashMerged = !merged && base !== null && (await cherryAllMerged(scope, base, headSha));
    const { ahead, behind } = await aheadBehind(scope, branch, headSha);
    const diverged = await divergedFromUpstream(scope, branch, headSha);
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

  async #observeDeleted(scope, firstCommit, base) {
    let merged = false;
    let squashMerged = false;
    if (firstCommit !== null && base !== null) {
      merged = await isAncestor(scope, firstCommit, base);
      squashMerged = !merged && (await cherryAllMerged(scope, base, firstCommit));
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
    const scope = hostScope(this.repoDir);
    const ref = `refs/heads/${branch}`;
    const headSha = await revParseOrNull(scope, ref);
    if (headSha === null) {
      return { thread_id_trailer: null, first_commit: null };
    }
    const base = await resolveIntegrationBase(this.repoDir);
    const firstCommit = await firstCommitOf(scope, ref, base);
    const trailer = firstCommit ? await threadIdTrailer(scope, firstCommit) : null;
    return { thread_id_trailer: trailer, first_commit: firstCommit };
  }

  async listRepoBranches(repo) {
    assertRepo('listRepoBranches', repo);
    const { stdout } = await scopedExec(
      hostScope(this.repoDir),
      ['for-each-ref', '--format=%(refname:short)', 'refs/heads/'],
    );
    return stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async repoIdentity() {
    const { code, stdout } = await scopedExec(
      hostScope(this.repoDir),
      ['remote', 'get-url', this.remote],
      { check: false },
    );
    const slug = code === 0 ? remoteSlug(stdout) : null;
    const accepted = [slug, basename(this.repoDir), this.repoDir, resolve(this.repoDir)]
      .filter((label) => typeof label === 'string' && label.length > 0);
    return Object.freeze({
      canonical: accepted[0],
      accepted: Object.freeze([...new Set(accepted)]),
    });
  }
}
