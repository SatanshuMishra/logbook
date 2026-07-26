import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  classifyPreToolUse,
  mutatesUnderRoot,
  handlePreToolUse,
} from '../../../hooks/lib/pre-tool-use.mjs';
import { resolveLedgerRoots } from '../../../hooks/lib/ledger-roots.mjs';
import { projectKey } from '../../../src/util/project-key.mjs';
import { tempDir, cleanup, useEnv } from './fixtures.mjs';

const ROOTS = ['/data/-proj/ledger'];

test('mutatesUnderRoot flags a write whose target lands under a root', () => {
  assert.equal(mutatesUnderRoot('echo x > /data/-proj/ledger/threads/a.json', ROOTS, '/proj'), true);
  assert.equal(mutatesUnderRoot('rm -rf /data/-proj/ledger', ROOTS, '/proj'), true);
  assert.equal(mutatesUnderRoot('cat /data/-proj/ledger/threads/a.json', ROOTS, '/proj'), false);
});

test('mutatesUnderRoot ignores a redirect that names a root but writes elsewhere', () => {
  assert.equal(mutatesUnderRoot('grep -r x /data/-proj/ledger 2>/dev/null', ROOTS, '/proj'), false);
  assert.equal(mutatesUnderRoot('ls -la /data/-proj/ledger 2>&1', ROOTS, '/proj'), false);
});

test('mutatesUnderRoot ignores an angle bracket inside quotes', () => {
  assert.equal(mutatesUnderRoot("awk '$1 > 5' /data/-proj/ledger/threads/a.json", ROOTS, '/proj'), false);
});

test('mutatesUnderRoot follows cd into a root before a destructive verb', () => {
  assert.equal(mutatesUnderRoot('cd ledger && rm -rf .', ROOTS, '/data/-proj'), true);
});

test('classifyPreToolUse denies a Write under a ledger root', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Write', tool_input: { file_path: '/data/-proj/ledger/threads/a.json' } },
    ROOTS,
    '/proj',
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
});

test('classifyPreToolUse allows a Write outside every ledger root', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Write', tool_input: { file_path: '/proj/src/app.js' } },
    ROOTS,
    '/proj',
  );
  assert.equal(d, null);
});

test('classifyPreToolUse denies a mutating Bash that targets a ledger root but allows reads', () => {
  const deny = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: 'echo x > /data/-proj/ledger/threads/a.json' } },
    ROOTS,
    '/proj',
  );
  assert.equal(deny.hookSpecificOutput.permissionDecision, 'deny');
  const read = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: 'cat /data/-proj/ledger/threads/a.json' } },
    ROOTS,
    '/proj',
  );
  assert.equal(read, null);
});

test('classifyPreToolUse allows a read-only inspection that redirects stderr', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: 'ls -la /data/-proj/ledger 2>&1 | head -12' } },
    ROOTS,
    '/proj',
  );
  assert.equal(d, null);
});

test('classifyPreToolUse denies a destructive Bash that reaches a root by cd', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: 'cd ledger && rm -rf .' } },
    ROOTS,
    '/data/-proj',
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
});

test('handlePreToolUse auto-approves any mcp__ledger__* tool', async () => {
  const ctx = { input: { tool_name: 'mcp__ledger__open_thread' }, env: {}, projectDir: '/proj' };
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'allow');
});

test('handlePreToolUse auto-approves the plugin-namespaced ledger tool', async () => {
  const ctx = {
    input: { tool_name: 'mcp__plugin_session-continuity_ledger__open_thread' },
    env: {},
    projectDir: '/proj',
  };
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'allow');
});

test('resolveLedgerRoots keys the managed dir by project-key under CLAUDE_PLUGIN_DATA', async (t) => {
  const projectDir = await tempDir('hooks-roots-proj-');
  const dataRoot = await tempDir('hooks-roots-data-');
  cleanup(t, projectDir, dataRoot);
  useEnv(t, { CLAUDE_PLUGIN_DATA: dataRoot });
  const roots = await resolveLedgerRoots(projectDir, process.env);
  assert.equal(roots.includes(join(dataRoot, projectKey(projectDir))), true);
});

test('handlePreToolUse denies a real ledger-root write end to end', async (t) => {
  const projectDir = await tempDir('hooks-roots-proj-');
  const dataRoot = await tempDir('hooks-roots-data-');
  cleanup(t, projectDir, dataRoot);
  const target = join(dataRoot, projectKey(projectDir), 'ledger', 'threads', 'a.json');
  const ctx = {
    input: { tool_name: 'Write', tool_input: { file_path: target } },
    env: { CLAUDE_PLUGIN_DATA: dataRoot },
    projectDir,
  };
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'deny');
});
