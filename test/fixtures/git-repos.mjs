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

const TRAP_HOOKS = [
  'post-commit',
  'post-checkout',
  'post-merge',
  'pre-commit',
  'commit-msg',
  'pre-push',
  'reference-transaction',
];

function applyEnv(values) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

export async function withGitEnv(overrides, fn) {
  const saved = {};
  for (const key of Object.keys(overrides)) {
    saved[key] = process.env[key];
  }
  applyEnv(overrides);
  try {
    return await fn();
  } finally {
    applyEnv(saved);
  }
}

export async function hostileGitEnvironment(t) {
  const dir = await makeTempDir(t, 'git-driver-hostile-');
  const hooksDir = join(dir, 'hooks');
  const marker = join(dir, 'fired');
  await mkdir(hooksDir, { recursive: true });
  for (const hook of TRAP_HOOKS) {
    await writeFile(join(hooksDir, hook), `#!/bin/sh\necho ${hook} >> ${marker}\n`, { mode: 0o755 });
  }
  const serverHooks = join(dir, 'server-hooks');
  await mkdir(serverHooks, { recursive: true });
  const excludes = join(dir, 'excludes');
  await writeFile(excludes, '*.json\nsessions/\n');
  const globalConfig = join(dir, 'gitconfig-global');
  await writeFile(
    globalConfig,
    `[core]\n\thooksPath = ${hooksDir}\n\tfsmonitor = ${join(hooksDir, 'post-commit')}\n\texcludesFile = ${excludes}\n`,
  );
  const systemConfig = join(dir, 'gitconfig-system');
  await writeFile(systemConfig, `[core]\n\thooksPath = ${hooksDir}\n`);
  const gpgProgram = join(dir, 'gpg-refuses');
  await writeFile(gpgProgram, '#!/bin/sh\necho "gpg: signing failed: refused" >&2\nexit 1\n', { mode: 0o755 });
  const signingConfig = join(dir, 'gitconfig-signing');
  await writeFile(
    signingConfig,
    `[commit]\n\tgpgsign = true\n[tag]\n\tgpgsign = true\n[gpg]\n\tprogram = ${gpgProgram}\n`,
  );
  const emptyConfig = join(dir, 'gitconfig-empty');
  await writeFile(emptyConfig, '');
  const extHelper = join(dir, 'ext-helper');
  await writeFile(extHelper, `#!/bin/sh\necho ext-transport >> ${marker}\n`, { mode: 0o755 });
  return {
    dir,
    hooksDir,
    serverHooks,
    marker,
    excludes,
    globalConfig,
    systemConfig,
    signingConfig,
    gpgProgram,
    emptyConfig,
    extHelper,
  };
}

export function extTransportCountEnv(trap, remoteUrl) {
  return {
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: `url.ext::${trap.extHelper}.insteadOf`,
    GIT_CONFIG_VALUE_0: remoteUrl,
    GIT_CONFIG_KEY_1: 'protocol.ext.allow',
    GIT_CONFIG_VALUE_1: 'always',
  };
}

export function extTransportParametersEnv(trap, remoteUrl) {
  return {
    GIT_CONFIG_PARAMETERS:
      `'url.ext::${trap.extHelper}.insteadOf'='${remoteUrl}' 'protocol.ext.allow'='always'`,
  };
}

export function hostileConfigEnv(trap) {
  return {
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.hooksPath',
    GIT_CONFIG_VALUE_0: trap.hooksDir,
    GIT_CONFIG_PARAMETERS: `'core.hooksPath'='${trap.hooksDir}'`,
    GIT_CONFIG_GLOBAL: trap.globalConfig,
    GIT_CONFIG_SYSTEM: trap.systemConfig,
    GIT_TEMPLATE_DIR: trap.dir,
  };
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
