import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readHookInput, hookContext } from '../../../hooks/lib/hook-io.mjs';

test('readHookInput parses a JSON stdin payload', async () => {
  const stream = Readable.from([JSON.stringify({ hook_event_name: 'Stop', session_id: 'abc' })]);
  assert.deepEqual(await readHookInput(stream), { hook_event_name: 'Stop', session_id: 'abc' });
});

test('readHookInput returns {} for empty input', async () => {
  assert.deepEqual(await readHookInput(Readable.from([''])), {});
});

test('readHookInput returns {} for malformed JSON (fail-open)', async () => {
  assert.deepEqual(await readHookInput(Readable.from(['{not json'])), {});
});

test('hookContext resolves projectDir from CLAUDE_PROJECT_DIR first', () => {
  const ctx = hookContext({ cwd: '/from/input' }, { CLAUDE_PROJECT_DIR: '/from/env', CLAUDE_PLUGIN_ROOT: '/root' });
  assert.equal(ctx.projectDir, '/from/env');
  assert.equal(ctx.pluginRoot, '/root');
  assert.equal(typeof ctx.invokeCli, 'function');
  assert.equal(typeof ctx.invokeCliJson, 'function');
});

test('hookContext falls back to input.cwd then pluginRoot null', () => {
  const ctx = hookContext({ cwd: '/from/input' }, {});
  assert.equal(ctx.projectDir, '/from/input');
  assert.equal(ctx.pluginRoot, null);
});
