import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { REPO_ROOT } from './fixtures.mjs';

async function loadHooksJson() {
  return JSON.parse(await readFile(join(REPO_ROOT, 'hooks', 'hooks.json'), 'utf8'));
}

test('hooks.json wires exactly the six lifecycle events', async () => {
  const cfg = await loadHooksJson();
  assert.deepEqual(
    Object.keys(cfg.hooks).sort(),
    ['PreCompact', 'PreToolUse', 'PostToolUse', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort(),
  );
});

test('hooks.json points each event at its plugin-root entry script', async () => {
  const cfg = await loadHooksJson();
  const entry = (name) => cfg.hooks[name][0].hooks[0].command;
  assert.match(entry('SessionStart'), /hooks\/session-start\.mjs/);
  assert.match(entry('UserPromptSubmit'), /hooks\/user-prompt-submit\.mjs/);
  assert.match(entry('PreToolUse'), /hooks\/pre-tool-use\.mjs/);
  assert.match(entry('PostToolUse'), /hooks\/post-tool-use\.mjs/);
  assert.match(entry('Stop'), /hooks\/stop\.mjs/);
  assert.match(entry('PreCompact'), /hooks\/pre-compact\.mjs/);
  for (const name of Object.keys(cfg.hooks)) {
    assert.match(cfg.hooks[name][0].hooks[0].command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.equal(cfg.hooks[name][0].hooks[0].type, 'command');
  }
});

test('the PreToolUse matcher reaches both ledger tool-name spellings', async () => {
  const cfg = await loadHooksJson();
  const matcher = new RegExp(cfg.hooks.PreToolUse[0].matcher);
  assert.equal(matcher.test('mcp__ledger__open_thread'), true);
  assert.equal(matcher.test('mcp__plugin_session-continuity_ledger__open_thread'), true);
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']) {
    assert.equal(matcher.test(tool), true);
  }
});

test('only PreToolUse and PostToolUse carry a matcher', async () => {
  const cfg = await loadHooksJson();
  assert.equal(cfg.hooks.PostToolUse[0].matcher, 'Write|Edit|MultiEdit|NotebookEdit|Bash');
  for (const name of ['SessionStart', 'UserPromptSubmit', 'Stop', 'PreCompact']) {
    assert.equal(Object.prototype.hasOwnProperty.call(cfg.hooks[name][0], 'matcher'), false);
  }
});

test('the top-level env block delivers only LEDGER_DISABLE_TRAILER and no nudge knobs', async () => {
  const cfg = await loadHooksJson();
  assert.deepEqual(cfg.env, { LEDGER_DISABLE_TRAILER: '${user_config.disable_trailer}' });
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.env, 'LEDGER_NUDGE_FRACTION'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(cfg.env, 'LEDGER_NUDGE_BYTES'), false);
});
