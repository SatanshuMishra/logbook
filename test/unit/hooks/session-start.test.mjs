import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { managedHooksDir } from '../../../hooks/lib/installer.mjs';
import { handleSessionStart } from '../../../hooks/lib/session-start.mjs';
import { tempDir, cleanup, initGitRepo, REPO_ROOT } from './fixtures.mjs';

async function config(repo, key) {
  const { code, stdout } = await gitExec(repo, ['config', '--local', '--get', key], { check: false });
  return code === 0 ? stdout.replace(/\r?\n$/, '') : null;
}

function ctxFor(projectDir, dataRoot, calls) {
  return {
    input: {},
    env: { CLAUDE_PLUGIN_DATA: dataRoot, CLAUDE_PLUGIN_ROOT: REPO_ROOT },
    projectDir,
    pluginRoot: REPO_ROOT,
    invokeCli: async (args) => { calls.push(args); return { code: 0, stdout: '{}', stderr: '' }; },
    invokeCliJson: async (args) => { calls.push(args); return args[0] === 'roster' ? [] : {}; },
  };
}

test('SessionStart self-heals the git-hooks install then syncs, reconciles, and injects the roster', async (t) => {
  const projectDir = await tempDir('hooks-sessionstart-git-');
  const dataRoot = await tempDir('hooks-sessionstart-data-');
  cleanup(t, projectDir, dataRoot);
  await initGitRepo(projectDir);
  const calls = [];

  const result = await handleSessionStart(ctxFor(projectDir, dataRoot, calls));

  const managed = managedHooksDir(dataRoot, projectDir);
  assert.equal(resolve(await config(projectDir, 'core.hooksPath')), resolve(managed));
  assert.deepEqual(calls, [['sync'], ['reconcile'], ['roster']]);
  assert.equal(result.json.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(result.json.hookSpecificOutput.additionalContext, /no resumable threads|resumable threads/);
});

test('SessionStart skips the installer for a non-git project but still runs the CLI trio', async (t) => {
  const projectDir = await tempDir('hooks-sessionstart-plain-');
  const dataRoot = await tempDir('hooks-sessionstart-data-');
  cleanup(t, projectDir, dataRoot);
  const calls = [];

  const result = await handleSessionStart(ctxFor(projectDir, dataRoot, calls));

  assert.deepEqual(calls, [['sync'], ['reconcile'], ['roster']]);
  assert.equal(result.json.hookSpecificOutput.hookEventName, 'SessionStart');
});
