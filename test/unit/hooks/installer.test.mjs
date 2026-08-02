import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gitExec } from '../../../src/util/git-exec.mjs';
import {
  STANDARD_HOOKS,
  managedHooksDir,
  parseHooksPathSupport,
  supportsHooksPath,
  installCommitMsgHook,
  uninstallCommitMsgHook,
} from '../../../hooks/lib/installer.mjs';
import { withGitEnv, hostileGitEnvironment, hostileConfigEnv } from '../../fixtures/git-repos.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '../../..');
const SOURCE_HOOK = join(REPO_ROOT, 'hooks', 'commit-msg');

async function initRepo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'installer-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await gitExec(dir, ['init', '-q']);
  return dir;
}

function localRead(repo, key) {
  return gitExec(repo, ['config', '--local', '--get', key], { check: false });
}

async function config(repo, key) {
  const { code, stdout } = await localRead(repo, key);
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
}

async function isExecutable(p) {
  await access(p, constants.X_OK);
  return true;
}

test('STANDARD_HOOKS lists exactly the 17 names, is frozen, and excludes commit-msg', () => {
  assert.equal(STANDARD_HOOKS.length, 17);
  assert.equal(STANDARD_HOOKS.includes('commit-msg'), false);
  assert.ok(Object.isFrozen(STANDARD_HOOKS));
  for (const n of ['pre-commit', 'pre-push', 'prepare-commit-msg', 'reference-transaction']) {
    assert.ok(STANDARD_HOOKS.includes(n), `missing ${n}`);
  }
});

test('parseHooksPathSupport gates on git >= 2.9', () => {
  assert.equal(parseHooksPathSupport('git version 2.9.0'), true);
  assert.equal(parseHooksPathSupport('git version 2.8.5'), false);
  assert.equal(parseHooksPathSupport('git version 2.55.0'), true);
  assert.equal(parseHooksPathSupport('git version 3.0.0'), true);
  assert.equal(parseHooksPathSupport('git version 1.9.5'), false);
  assert.equal(parseHooksPathSupport('git version 2.39.3 (Apple Git-146)'), true);
  assert.equal(parseHooksPathSupport('git version unknown'), false);
});

test('supportsHooksPath returns true against the real git binary', async (t) => {
  const repo = await initRepo(t);
  assert.equal(await supportsHooksPath(repo), true);
});

test('managedHooksDir keys the githooks dir by project-key under the data root', () => {
  assert.equal(
    managedHooksDir('/data', '/Users/x/proj.name'),
    join('/data', '-Users-x-proj-name', 'githooks'),
  );
});

test('installCommitMsgHook fresh install repoints hooksPath, records empty prior, copies executable hooks', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed', 'githooks');
  const res = await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  assert.deepEqual(res, {
    installed: true,
    alreadyInstalled: false,
    managedDir: managed,
    priorHooksPathCapture: 'captured',
    declinedHooksPath: null,
    priorHooksPath: '',
    priorHooksPathHeal: 'not-needed',
    corruptPriorHooksPath: null,
    corruptPriorHooksPathScope: null,
  });
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(managed));
  assert.equal(await config(repo, 'continuity.priorHooksPath'), '');
  for (const n of [...STANDARD_HOOKS, 'commit-msg']) {
    assert.ok(await isExecutable(join(managed, n)), `not executable: ${n}`);
  }
});

test('installCommitMsgHook records a pre-existing hooksPath as the prior', async (t) => {
  const repo = await initRepo(t);
  const priorPath = join(repo, 'user-hooks');
  await gitExec(repo, ['config', 'core.hooksPath', priorPath]);
  const managed = join(repo, 'managed', 'githooks');
  const res = await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  assert.equal(res.priorHooksPath, priorPath);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), priorPath);
});

test('installCommitMsgHook reinstall reports alreadyInstalled and never overwrites the recorded prior', async (t) => {
  const repo = await initRepo(t);
  const priorPath = join(repo, 'user-hooks');
  await gitExec(repo, ['config', 'core.hooksPath', priorPath]);
  const managed = join(repo, 'managed', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  const res = await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  assert.equal(res.installed, true);
  assert.equal(res.alreadyInstalled, true);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), priorPath);
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(managed));
});

test('installCommitMsgHook installing a second managed dir keeps the real prior instead of capturing a managed dir', async (t) => {
  const repo = await initRepo(t);
  const priorPath = '.githooks';
  await gitExec(repo, ['config', 'core.hooksPath', priorPath]);
  const mainManaged = join(repo, 'data', 'main-key', 'githooks');
  const worktreeManaged = join(repo, 'data', 'worktree-key', 'githooks');

  await installCommitMsgHook({ repoDir: repo, managedDir: mainManaged, sourceHook: SOURCE_HOOK });
  assert.equal(await config(repo, 'continuity.priorHooksPath'), priorPath);

  const res = await installCommitMsgHook({ repoDir: repo, managedDir: worktreeManaged, sourceHook: SOURCE_HOOK });

  assert.equal(await config(repo, 'continuity.priorHooksPath'), priorPath);
  assert.equal(res.priorHooksPath, priorPath);
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(worktreeManaged));
});

test('installCommitMsgHook alternating between two managed dirs never degrades the prior', async (t) => {
  const repo = await initRepo(t);
  const priorPath = '.githooks';
  await gitExec(repo, ['config', 'core.hooksPath', priorPath]);
  const a = join(repo, 'data', 'key-a', 'githooks');
  const b = join(repo, 'data', 'key-b', 'githooks');
  for (const managedDir of [a, b, a, b, a]) {
    await installCommitMsgHook({ repoDir: repo, managedDir, sourceHook: SOURCE_HOOK });
    assert.equal(await config(repo, 'continuity.priorHooksPath'), priorPath);
  }
});

test('installCommitMsgHook drives continuity.trailer from disableTrailer', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK, disableTrailer: true });
  assert.equal(await config(repo, 'continuity.trailer'), 'false');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK, disableTrailer: false });
  assert.equal(await config(repo, 'continuity.trailer'), null);
});

test('uninstallCommitMsgHook restores the git default and clears the prior key', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  const res = await uninstallCommitMsgHook({ repoDir: repo, managedDir: managed });
  assert.deepEqual(res, { removed: true, restoredHooksPath: null });
  assert.equal(await config(repo, 'core.hooksPath'), null);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), null);
});

test('uninstallCommitMsgHook restores a recorded prior hooksPath', async (t) => {
  const repo = await initRepo(t);
  const priorPath = join(repo, 'user-hooks');
  await gitExec(repo, ['config', 'core.hooksPath', priorPath]);
  const managed = join(repo, 'managed', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  const res = await uninstallCommitMsgHook({ repoDir: repo, managedDir: managed });
  assert.equal(res.removed, true);
  assert.equal(resolve(res.restoredHooksPath), resolve(priorPath));
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(priorPath));
  assert.equal(await config(repo, 'continuity.priorHooksPath'), null);
});

async function seedLegacyPoisonedState(t, poisonedPrior) {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed', 'githooks');
  await gitExec(repo, ['config', '--local', 'core.hooksPath', managed]);
  await gitExec(repo, ['config', '--local', 'continuity.priorHooksPath', poisonedPrior]);
  return { repo, managed };
}

test('uninstallCommitMsgHook drops a legacy prior pin that a global core.hooksPath already provides', async (t) => {
  const trap = await hostileGitEnvironment(t);
  const { repo, managed } = await seedLegacyPoisonedState(t, trap.hooksDir);

  const res = await withGitEnv(
    { GIT_CONFIG_GLOBAL: trap.globalConfig, GIT_CONFIG_SYSTEM: trap.systemConfig },
    () => uninstallCommitMsgHook({ repoDir: repo, managedDir: managed }),
  );
  assert.deepEqual(res, { removed: true, restoredHooksPath: null });
  assert.equal(await config(repo, 'core.hooksPath'), null);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), null);
});

test('uninstallCommitMsgHook drops a legacy prior pin that only a system core.hooksPath provides', async (t) => {
  const trap = await hostileGitEnvironment(t);
  const { repo, managed } = await seedLegacyPoisonedState(t, trap.hooksDir);

  const res = await withGitEnv(
    { GIT_CONFIG_GLOBAL: trap.emptyConfig, GIT_CONFIG_SYSTEM: trap.systemConfig },
    () => uninstallCommitMsgHook({ repoDir: repo, managedDir: managed }),
  );
  assert.deepEqual(res, { removed: true, restoredHooksPath: null });
  assert.equal(await config(repo, 'core.hooksPath'), null);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), null);
});

test('uninstallCommitMsgHook still restores a prior that differs from the inherited hooksPath', async (t) => {
  const trap = await hostileGitEnvironment(t);
  const priorPath = join(trap.dir, 'user-hooks');
  const { repo, managed } = await seedLegacyPoisonedState(t, priorPath);

  const res = await withGitEnv(
    { GIT_CONFIG_GLOBAL: trap.globalConfig, GIT_CONFIG_SYSTEM: trap.systemConfig },
    () => uninstallCommitMsgHook({ repoDir: repo, managedDir: managed }),
  );
  assert.equal(res.removed, true);
  assert.equal(resolve(res.restoredHooksPath), resolve(priorPath));
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(priorPath));
  assert.equal(await config(repo, 'continuity.priorHooksPath'), null);
});

test('uninstallCommitMsgHook no-ops when the managed dir is not the current hooksPath', async (t) => {
  const repo = await initRepo(t);
  const managed = join(repo, 'managed', 'githooks');
  const unset = await uninstallCommitMsgHook({ repoDir: repo, managedDir: managed });
  assert.deepEqual(unset, { removed: false });

  const otherPath = join(repo, 'other-hooks');
  await gitExec(repo, ['config', '--local', 'core.hooksPath', otherPath]);
  const mismatched = await uninstallCommitMsgHook({ repoDir: repo, managedDir: managed });
  assert.deepEqual(mismatched, { removed: false });
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(otherPath));
});

test('installCommitMsgHook configures the target repo despite an ambient GIT_DIR', async (t) => {
  const repo = await initRepo(t);
  const foreign = await initRepo(t);
  const managed = join(repo, 'managed', 'githooks');
  const res = await withGitEnv(
    { GIT_DIR: join(foreign, '.git') },
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
  assert.equal(res.alreadyInstalled, false);
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(managed));
  assert.equal(await config(foreign, 'core.hooksPath'), null);
  assert.equal(await config(foreign, 'continuity.priorHooksPath'), null);
});

test('installCommitMsgHook reports alreadyInstalled from the target repo under an ambient GIT_DIR', async (t) => {
  const repo = await initRepo(t);
  const foreign = await initRepo(t);
  const managed = join(repo, 'managed', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  const res = await withGitEnv(
    { GIT_DIR: join(foreign, '.git') },
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
  assert.equal(res.alreadyInstalled, true);
});

async function assertCycleKeepsLocalStateClean(t, hostileFor) {
  const repo = await initRepo(t);
  const trap = await hostileGitEnvironment(t);
  const hostile = hostileFor(trap);
  const managed = join(repo, 'managed', 'githooks');

  const res = await withGitEnv(
    hostile,
    () => installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK }),
  );
  assert.equal(res.priorHooksPath, '');
  assert.equal(await config(repo, 'continuity.priorHooksPath'), '');
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(managed));

  const removal = await withGitEnv(
    hostile,
    () => uninstallCommitMsgHook({ repoDir: repo, managedDir: managed }),
  );
  assert.deepEqual(removal, { removed: true, restoredHooksPath: null });
  assert.equal(await config(repo, 'core.hooksPath'), null);
  assert.equal(await config(repo, 'continuity.priorHooksPath'), null);
}

test('an install cycle never adopts a global or system core.hooksPath as the repo local state', async (t) => {
  await assertCycleKeepsLocalStateClean(t, (trap) => ({
    GIT_CONFIG_GLOBAL: trap.globalConfig,
    GIT_CONFIG_SYSTEM: trap.systemConfig,
  }));
});

test('an install cycle never adopts an env-injected core.hooksPath as the repo local state', async (t) => {
  await assertCycleKeepsLocalStateClean(t, hostileConfigEnv);
});

test('uninstallCommitMsgHook restores the target repo despite an ambient GIT_DIR', async (t) => {
  const repo = await initRepo(t);
  const foreign = await initRepo(t);
  const priorPath = join(repo, 'user-hooks');
  await gitExec(repo, ['config', 'core.hooksPath', priorPath]);
  const managed = join(repo, 'managed', 'githooks');
  await installCommitMsgHook({ repoDir: repo, managedDir: managed, sourceHook: SOURCE_HOOK });
  const res = await withGitEnv(
    { GIT_DIR: join(foreign, '.git') },
    () => uninstallCommitMsgHook({ repoDir: repo, managedDir: managed }),
  );
  assert.equal(res.removed, true);
  assert.equal(resolve(await config(repo, 'core.hooksPath')), resolve(priorPath));
  assert.equal(await config(foreign, 'core.hooksPath'), null);
});
