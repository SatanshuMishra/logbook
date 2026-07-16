import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { gitExec } from '../../src/util/git-exec.mjs';
import { GitRefDriver } from '../../src/drivers/git-ref-driver.mjs';

export async function makeTempDir(t, prefix = 'git-driver-') {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function initGitRepo(t) {
  const dir = await makeTempDir(t);
  await gitExec(dir, ['init', '-q', '-b', 'main']);
  await gitExec(dir, ['config', 'user.name', 'Test User']);
  await gitExec(dir, ['config', 'user.email', 'test@example.com']);
  return dir;
}

export async function initBareRemote(t) {
  const dir = await makeTempDir(t, 'git-driver-remote-');
  await gitExec(dir, ['init', '-q', '--bare', '-b', 'main']);
  return dir;
}

export async function commitFile(repo, relPath, contents, message) {
  const abs = join(repo, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, contents);
  await gitExec(repo, ['add', relPath]);
  await gitExec(repo, ['commit', '-q', '--no-verify', '-m', message]);
  const { stdout } = await gitExec(repo, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

export async function initGitRepoWithRemote(t) {
  const repo = await initGitRepo(t);
  const remote = await initBareRemote(t);
  await gitExec(repo, ['remote', 'add', 'origin', remote]);
  await commitFile(repo, 'README.md', '# repo\n', 'chore: seed');
  await gitExec(repo, ['push', '-q', 'origin', 'main']);
  await gitExec(repo, ['remote', 'set-head', 'origin', 'main']);
  await gitExec(repo, ['fetch', '-q', 'origin']);
  return { repo, remote };
}

export async function makeGitDriver(t, repo, overrides = {}) {
  const worktreeParent = await makeTempDir(t, 'git-driver-wt-');
  return new GitRefDriver({
    repoDir: repo,
    worktreeDir: join(worktreeParent, 'ledger-worktree'),
    backend: 'orphan-branch',
    branch: '_ledger',
    remote: 'origin',
    ...overrides,
  });
}
