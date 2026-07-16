import test from 'node:test';
import assert from 'node:assert/strict';
import { isResumeIntent, handleUserPromptSubmit } from '../../../hooks/lib/user-prompt-submit.mjs';

function stubCtx(prompt, rosterResult) {
  const calls = [];
  return {
    calls,
    input: { prompt },
    env: {},
    projectDir: '/proj',
    invokeCliJson: async (args) => { calls.push(args); return rosterResult; },
  };
}

test('isResumeIntent matches resume phrasing and rejects unrelated prompts', () => {
  assert.equal(isResumeIntent('resume where we left off'), true);
  assert.equal(isResumeIntent('can you catch me up?'), true);
  assert.equal(isResumeIntent('where were we yesterday'), true);
  assert.equal(isResumeIntent('add a new feature to the parser'), false);
  assert.equal(isResumeIntent(''), false);
  assert.equal(isResumeIntent(undefined), false);
});

test('UserPromptSubmit injects the roster on resume-intent', async () => {
  const ctx = stubCtx('resume the project', [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', slug: 's', title: 't', status: 'paused', next_step: 'n' }]);
  const result = await handleUserPromptSubmit(ctx);
  assert.equal(result.json.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(result.json.hookSpecificOutput.additionalContext, /resumable threads \(1\)/);
  assert.deepEqual(ctx.calls, [['roster']]);
});

test('UserPromptSubmit is a no-op without resume-intent (no CLI call)', async () => {
  const ctx = stubCtx('write me a haiku', []);
  const result = await handleUserPromptSubmit(ctx);
  assert.deepEqual(result, {});
  assert.deepEqual(ctx.calls, []);
});

test('UserPromptSubmit injects nothing when the roster is empty', async () => {
  const ctx = stubCtx('resume please', []);
  const result = await handleUserPromptSubmit(ctx);
  assert.deepEqual(result, {});
  assert.deepEqual(ctx.calls, [['roster']]);
});
