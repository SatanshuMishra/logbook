import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import openThread from '../../../src/tools/open-thread.mjs';
import { activeThreadPath, readActiveThread } from '../../../src/util/active-thread.mjs';
import { gitExec } from '../../../src/util/git-exec.mjs';
import { clearedGitLocationEnv } from '../../../src/util/git-env.mjs';
import { projectKey } from '../../../src/util/project-key.mjs';
import { makeGitToolCtx } from '../../fixtures/tool-ctx.mjs';

test('a git-backed tool context routes the active pointer through the repo git common dir', async (t) => {
  const ctx = await makeGitToolCtx(t);
  assert.equal(ctx.driver.isGit(), true);

  const { thread } = await openThread.handler(ctx, {
    title: 'A',
    completion_criteria: [{ text: 'ship it' }],
  });

  const { stdout } = await gitExec(ctx.projectDir, ['rev-parse', '--git-common-dir'], {
    env: clearedGitLocationEnv(),
  });
  const commonDir = await realpath(resolve(ctx.projectDir, stdout.trim()));

  const pointer = await activeThreadPath(ctx);
  assert.equal(pointer, join(commonDir, 'ledger', 'active-thread'));
  assert.equal((await readFile(pointer, 'utf8')).trim(), thread.id);
  assert.equal(await readActiveThread(ctx), thread.id);

  const nonGitPointer = join(
    process.env.CLAUDE_PLUGIN_DATA,
    projectKey(ctx.projectDir),
    'active-thread',
  );
  await assert.rejects(() => access(nonGitPointer), { code: 'ENOENT' });
});

test('activeThreadPath asks the git driver for the pointer path instead of resolving git a second time', async (t) => {
  const ctx = await makeGitToolCtx(t);
  const sentinel = '/sentinel/active-thread';
  ctx.driver.activeThreadPointerPath = async () => sentinel;
  assert.equal(await activeThreadPath(ctx), sentinel);
});
