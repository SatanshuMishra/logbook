import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { projectKey } from '../../../src/util/project-key.mjs';
import { serializeRecord } from '../../../src/drivers/layout.mjs';
import { handlePreCompact } from '../../../hooks/lib/pre-compact.mjs';
import { tempDir, cleanup } from './fixtures.mjs';

function ctxFor(projectDir, dataRoot, input) {
  return { input, env: { CLAUDE_PLUGIN_DATA: dataRoot }, projectDir, pluginRoot: null };
}

test('handlePreCompact writes a canonical checkpoint sentinel under checkpoints/', async (t) => {
  const projectDir = await tempDir('hooks-precompact-proj-');
  const dataRoot = await tempDir('hooks-precompact-data-');
  cleanup(t, projectDir, dataRoot);
  const input = { session_id: 'sess-1', transcript_path: '/x/t.jsonl', trigger: 'auto', custom_instructions: '' };

  const result = await handlePreCompact(ctxFor(projectDir, dataRoot, input));
  assert.deepEqual(result, {});

  const dir = join(dataRoot, projectKey(projectDir), 'checkpoints');
  const files = await readdir(dir);
  assert.equal(files.length, 1);
  const raw = await readFile(join(dir, files[0]), 'utf8');
  const record = JSON.parse(raw);
  assert.equal(record.event, 'precompact');
  assert.equal(record.session_id, 'sess-1');
  assert.equal(record.trigger, 'auto');
  assert.equal(typeof record.recorded_at, 'string');
  assert.equal(raw, serializeRecord(record));
});

test('handlePreCompact no-ops when CLAUDE_PLUGIN_DATA is unset', async (t) => {
  const projectDir = await tempDir('hooks-precompact-proj-');
  cleanup(t, projectDir);
  const result = await handlePreCompact({ input: { session_id: 's' }, env: {}, projectDir, pluginRoot: null });
  assert.deepEqual(result, {});
});
