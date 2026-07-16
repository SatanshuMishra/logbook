import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';

export async function tempDir(prefix) {
  return mkdtemp(join(tmpdir(), prefix));
}

export function cleanupDirs(t, ...dirs) {
  t.after(() => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));
}

export function useEnv(t, overrides) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  t.after(() => {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });
}

export async function initGitRepo(dir) {
  await gitExec(dir, ['init', '-q']);
  await gitExec(dir, ['config', 'user.email', 'test@continuity.invalid']);
  await gitExec(dir, ['config', 'user.name', 'Test Runner']);
  await gitExec(dir, ['config', 'commit.gpgsign', 'false']);
  await writeFile(join(dir, 'README.md'), '# fixture\n');
  await gitExec(dir, ['add', '.']);
  await gitExec(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}
