import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  computeNudgeThreshold,
  isCommitish,
  handlePostToolUse,
} from '../../../hooks/lib/post-tool-use.mjs';
import { tempDir, cleanup, initGitRepo } from './fixtures.mjs';

test('computeNudgeThreshold uses defaults and honors valid overrides', () => {
  assert.equal(computeNudgeThreshold({}), 1_200_000 * 0.7);
  assert.equal(computeNudgeThreshold({ LEDGER_NUDGE_FRACTION: '0.5', LEDGER_NUDGE_BYTES: '1000' }), 500);
});

test('computeNudgeThreshold falls back on out-of-range fraction or bad budget', () => {
  assert.equal(computeNudgeThreshold({ LEDGER_NUDGE_FRACTION: '1.5' }), 1_200_000 * 0.7);
  assert.equal(computeNudgeThreshold({ LEDGER_NUDGE_FRACTION: '0' }), 1_200_000 * 0.7);
  assert.equal(computeNudgeThreshold({ LEDGER_NUDGE_BYTES: '-5' }), 1_200_000 * 0.7);
  assert.equal(computeNudgeThreshold({ LEDGER_NUDGE_BYTES: 'abc' }), 1_200_000 * 0.7);
});

test('isCommitish is true only for a git commit-ish Bash command', () => {
  assert.equal(isCommitish({ tool_name: 'Bash', tool_input: { command: 'git commit -m x' } }), true);
  assert.equal(isCommitish({ tool_name: 'Bash', tool_input: { command: 'git rebase -i main' } }), true);
  assert.equal(isCommitish({ tool_name: 'Bash', tool_input: { command: 'git status' } }), false);
  assert.equal(isCommitish({ tool_name: 'Edit', tool_input: { file_path: '/x' } }), false);
});

test('handlePostToolUse nudges once the transcript crosses the byte threshold', async (t) => {
  const dir = await tempDir('hooks-posttool-');
  cleanup(t, dir);
  const transcript = join(dir, 't.jsonl');
  await writeFile(transcript, 'x'.repeat(2000));
  const calls = [];
  const ctx = {
    input: { tool_name: 'Edit', tool_input: { file_path: '/x' }, transcript_path: transcript },
    env: { LEDGER_NUDGE_BYTES: '1000', LEDGER_NUDGE_FRACTION: '0.5' },
    projectDir: dir,
    invokeCli: async (args) => { calls.push(args); return { code: 0, stdout: '{}', stderr: '' }; },
  };
  const result = await handlePostToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(result.json.hookSpecificOutput.additionalContext, /hand off|handoff/i);
  assert.deepEqual(calls, []);
});

test('handlePostToolUse records HEAD sha on a commit-ish op and skips the nudge below threshold', async (t) => {
  const dir = await tempDir('hooks-posttool-git-');
  cleanup(t, dir);
  await initGitRepo(dir);
  const calls = [];
  const ctx = {
    input: { tool_name: 'Bash', tool_input: { command: 'git commit -m x' }, transcript_path: null },
    env: {},
    projectDir: dir,
    invokeCli: async (args) => { calls.push(args); return { code: 0, stdout: '{}', stderr: '' }; },
  };
  const result = await handlePostToolUse(ctx);
  assert.deepEqual(result, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'record-sha');
  assert.match(calls[0][1], /^[0-9a-f]{40}$/);
});
