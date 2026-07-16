import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { projectKey } from '../../../src/util/project-key.mjs';
import { tempDir, cleanup, REPO_ROOT } from './fixtures.mjs';

const ENTRIES = [
  'session-start.mjs',
  'user-prompt-submit.mjs',
  'pre-tool-use.mjs',
  'post-tool-use.mjs',
  'stop.mjs',
  'pre-compact.mjs',
];

function runEntryScript(script, payload, env) {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [join(REPO_ROOT, 'hooks', script)],
      { env: { ...process.env, ...env }, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout, stderr });
      },
    );
    child.stdin.end(JSON.stringify(payload));
  });
}

test('every hook entry script carries the executable bit', async () => {
  for (const entry of ENTRIES) {
    await access(join(REPO_ROOT, 'hooks', entry), constants.X_OK);
  }
});

test('the pre-compact entry parses stdin and writes a checkpoint end to end', async (t) => {
  const projectDir = await tempDir('hooks-entry-proj-');
  const dataRoot = await tempDir('hooks-entry-data-');
  cleanup(t, projectDir, dataRoot);
  const res = await runEntryScript(
    'pre-compact.mjs',
    { session_id: 'e2e-sess', trigger: 'manual', transcript_path: '/x/t.jsonl' },
    { CLAUDE_PLUGIN_DATA: dataRoot, CLAUDE_PROJECT_DIR: projectDir },
  );
  assert.equal(res.code, 0);
  const files = await readdir(join(dataRoot, projectKey(projectDir), 'checkpoints'));
  assert.equal(files.length, 1);
  const record = JSON.parse(await readFile(join(dataRoot, projectKey(projectDir), 'checkpoints', files[0]), 'utf8'));
  assert.equal(record.session_id, 'e2e-sess');
});

test('the stop entry emits nothing and exits 0 when the pointer read yields no CLI (fail-open)', async () => {
  const res = await runEntryScript('stop.mjs', { hook_event_name: 'Stop' }, {});
  assert.equal(res.code, 0);
  assert.equal(res.stdout.trim(), '');
});
