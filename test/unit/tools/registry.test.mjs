import test from 'node:test';
import assert from 'node:assert/strict';
import { listTools, callTool, TOOLS, ToolValidationError } from '../../../src/tools/registry.mjs';
import * as barrel from '../../../src/tools/index.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

const FROZEN = [
  'open_thread', 'bind_branch', 'append_session_event', 'record_decision',
  'transition_thread', 'update_thread', 'archive_thread', 'create_successor',
  'reopen', 'reconcile', 'rebuild_index', 'get_resume_brief',
];

test('listTools exposes exactly the frozen 12-tool surface with inputSchemas', () => {
  const names = listTools().map((t) => t.name);
  assert.deepEqual([...names].sort(), [...FROZEN].sort());
  assert.equal(names.length, 12);
  for (const descriptor of listTools()) {
    assert.equal(descriptor.inputSchema.type, 'object');
    assert.equal('handler' in descriptor, false);
  }
  assert.equal(TOOLS.length, 12);
});

test('callTool validates args against the per-tool schema before dispatch', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(() => callTool('open_thread', {}, ctx), ToolValidationError);
  await assert.rejects(() => callTool('open_thread', { title: 'X', bogus: 1 }, ctx), ToolValidationError);
});

test('callTool dispatches a valid call to the handler', async (t) => {
  const ctx = await makeToolCtx(t);
  const { thread } = await callTool('open_thread', { title: 'Via Registry' }, ctx);
  assert.equal(thread.slug, 'via-registry');
  assert.equal(thread.status, 'active');
});

test('callTool rejects an unknown tool name', async (t) => {
  const ctx = await makeToolCtx(t);
  await assert.rejects(() => callTool('destroy_everything', {}, ctx), /unknown tool/);
});

test('the barrel re-exports the server/CLI seam', () => {
  for (const name of ['buildContext', 'commitAndReindex', 'listTools', 'callTool', 'TOOLS']) {
    assert.ok(name in barrel, `expected export: ${name}`);
  }
});
