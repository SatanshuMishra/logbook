import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const pexec = promisify(execFile);

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: 'E2E',
  GIT_AUTHOR_EMAIL: 'e2e@test.invalid',
  GIT_COMMITTER_NAME: 'E2E',
  GIT_COMMITTER_EMAIL: 'e2e@test.invalid',
};

export async function tempDir(prefix = 'e2e-') {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanup(...dirs) {
  for (const d of dirs) {
    if (d) await rm(d, { recursive: true, force: true });
  }
}

export async function git(dir, args, extraEnv = {}) {
  const { stdout } = await pexec('git', args, {
    cwd: dir,
    env: { ...process.env, ...GIT_IDENTITY, ...extraEnv },
  });
  return stdout.trim();
}

export async function commitFile(dir, relPath, content, message) {
  const abs = join(dir, relPath);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content);
  await git(dir, ['add', '--', relPath]);
  await git(dir, ['commit', '--no-verify', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

export async function initGitRepo(prefix = 'e2e-git-') {
  const dir = await tempDir(prefix);
  await git(dir, ['init', '-q', '-b', 'main']);
  await git(dir, ['config', 'user.name', 'E2E']);
  await git(dir, ['config', 'user.email', 'e2e@test.invalid']);
  await commitFile(dir, 'README.md', '# e2e\n', 'chore: base');
  return dir;
}

export async function initGitRepoWithRemote(prefix = 'e2e-remote-') {
  const dir = await initGitRepo(prefix);
  const remote = await tempDir('e2e-bare-');
  await git(remote, ['init', '-q', '--bare', '-b', 'main']);
  await git(dir, ['remote', 'add', 'origin', remote]);
  await git(dir, ['push', '-q', '-u', 'origin', 'main']);
  await git(dir, ['remote', 'set-head', 'origin', 'main']);
  return { dir, remote };
}

export async function initNonGitDir(prefix = 'e2e-plain-') {
  return tempDir(prefix);
}
