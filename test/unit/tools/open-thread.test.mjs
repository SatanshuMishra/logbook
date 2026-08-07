import test from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import openThread from '../../../src/tools/open-thread.mjs';
import { callTool, ToolValidationError } from '../../../src/tools/registry.mjs';
import { readActiveThread } from '../../../src/util/active-thread.mjs';
import { makeToolCtx, FIXED } from '../../fixtures/tool-ctx.mjs';

const DOD = [{ text: 'ship it' }];

test('open_thread declares the frozen name and an object inputSchema', () => {
  assert.equal(openThread.name, 'open_thread');
  assert.equal(openThread.inputSchema.type, 'object');
  assert.equal(openThread.inputSchema.additionalProperties, false);
});

test('open_thread creates an active thread, writes the pointer, and returns {thread}', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, { title: 'My Thread', completion_criteria: DOD });
  assert.equal(thread.status, 'active');
  assert.equal(thread.slug, 'my-thread');
  assert.equal(thread.created_at, FIXED);
  assert.equal(await readActiveThread(ctx), thread.id);
  assert.deepEqual(await ctx.driver.readThread(thread.id), thread);
});

test('open_thread allocates c1..cN ids, defaults kind to planned and struck_by to null', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await openThread.handler(ctx, {
    title: 'X', completion_criteria: [{ text: 'ship' }, { text: 'measure', kind: 'detour' }],
  });
  assert.deepEqual(thread.completion_criteria, [
    { id: 'c1', text: 'ship', done: false, kind: 'planned', struck_by: null },
    { id: 'c2', text: 'measure', done: false, kind: 'detour', struck_by: null },
  ]);
});

test('open_thread requires at least one completion_criteria entry', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => callTool('open_thread', { title: 'No DoD', completion_criteria: [] }, ctx),
    ToolValidationError,
  );
  await assert.rejects(
    () => callTool('open_thread', { title: 'No DoD' }, ctx),
    ToolValidationError,
  );
});

test('open_thread refuses a submitted criterion text over 200 chars', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => callTool('open_thread', { title: 'Wordy', completion_criteria: [{ text: 'c'.repeat(201) }] }, ctx),
    ToolValidationError,
  );
  await assert.rejects(
    () => openThread.handler(ctx, { title: 'Wordy', completion_criteria: [{ text: 'c'.repeat(201) }] }),
    /completion_criteria/,
  );
});

test('open_thread rejects an unknown parent_id (referential integrity)', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(
    () => openThread.handler(ctx, { title: 'X', parent_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', completion_criteria: DOD }),
    /unknown_thread: open_thread\.parent_id/,
  );
});

test('open_thread links an EXISTING parent_id', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread: parent } = await openThread.handler(ctx, { title: 'Parent', completion_criteria: DOD });
  const { thread: child } = await openThread.handler(ctx, { title: 'Child', parent_id: parent.id, completion_criteria: DOD });
  assert.equal(child.parent_id, parent.id);
});

test('open_thread still writes the pointer when CLAUDE_PLUGIN_DATA is unset after the context is built', async (t) => {
  const ctx = await makeToolCtx(t);
  const prior = process.env.CLAUDE_PLUGIN_DATA;
  delete process.env.CLAUDE_PLUGIN_DATA;
  try {
    const result = await callTool('open_thread', { title: 'Pointerless', completion_criteria: DOD }, ctx);
    assert.deepEqual(await ctx.driver.readThread(result.thread.id), result.thread);
    assert.equal(result.warnings, undefined);
    assert.equal(await readActiveThread(ctx), result.thread.id);
  } finally {
    if (prior !== undefined) process.env.CLAUDE_PLUGIN_DATA = prior;
  }
});

test('open_thread reports recovery_degraded:false while the recovery repo is healthy', async (t) => {
  const ctx = await makeToolCtx(t);
  const result = await openThread.handler(ctx, { title: 'Healthy', completion_criteria: DOD });
  assert.equal(result.recovery_degraded, false);
});

test('open_thread reports recovery_degraded:true when the recovery repo is gone', async (t) => {
  const ctx = await makeToolCtx(t);
  await rm(join(await ctx.driver.root(), '.git'), { recursive: true, force: true });
  const result = await openThread.handler(ctx, { title: 'Degraded', completion_criteria: DOD });
  assert.equal(result.recovery_degraded, true);
  assert.equal(result.thread.status, 'active');
});
