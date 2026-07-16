import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildContext } from '../../../src/tools/context.mjs';

function withData(t) {
  const prevData = process.env.CLAUDE_PLUGIN_DATA;
  const prevProj = process.env.CLAUDE_PROJECT_DIR;
  t.after(() => {
    if (prevData === undefined) delete process.env.CLAUDE_PLUGIN_DATA;
    else process.env.CLAUDE_PLUGIN_DATA = prevData;
    if (prevProj === undefined) delete process.env.CLAUDE_PROJECT_DIR;
    else process.env.CLAUDE_PROJECT_DIR = prevProj;
  });
}

test('buildContext returns the {driver, projectDir, userConfig, now} shape and inits the driver', async (t) => {
  withData(t);
  const projectDir = await mkdtemp(join(tmpdir(), 'ctx-proj-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'ctx-data-'));
  t.after(() => Promise.all([rm(projectDir, { recursive: true, force: true }), rm(dataDir, { recursive: true, force: true })]));
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  const ctx = await buildContext({ projectDir, userConfig: { ledger_backend: 'orphan-branch' } });
  assert.equal(ctx.projectDir, projectDir);
  assert.deepEqual(ctx.userConfig, { ledger_backend: 'orphan-branch' });
  assert.equal(typeof ctx.now, 'function');
  assert.equal(ctx.driver.isGit(), false);
  const root = await ctx.driver.root();
  assert.equal((await stat(root)).isDirectory(), true);
});

test('buildContext resolves projectDir from CLAUDE_PROJECT_DIR when no arg is given', async (t) => {
  withData(t);
  const projectDir = await mkdtemp(join(tmpdir(), 'ctx-envproj-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'ctx-data-'));
  t.after(() => Promise.all([rm(projectDir, { recursive: true, force: true }), rm(dataDir, { recursive: true, force: true })]));
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  process.env.CLAUDE_PROJECT_DIR = projectDir;
  const ctx = await buildContext({});
  assert.equal(ctx.projectDir, projectDir);
});

test('buildContext defaults now to a wall-clock ISO function', async (t) => {
  withData(t);
  const projectDir = await mkdtemp(join(tmpdir(), 'ctx-clock-'));
  const dataDir = await mkdtemp(join(tmpdir(), 'ctx-data-'));
  t.after(() => Promise.all([rm(projectDir, { recursive: true, force: true }), rm(dataDir, { recursive: true, force: true })]));
  process.env.CLAUDE_PLUGIN_DATA = dataDir;
  const ctx = await buildContext({ projectDir });
  assert.equal(typeof ctx.now, 'function');
  assert.match(ctx.now(), /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}/);
});
