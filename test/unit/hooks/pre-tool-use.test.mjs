import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  classifyPreToolUse,
  hasMutatingConstruct,
  handlePreToolUse,
} from '../../../hooks/lib/pre-tool-use.mjs';
import { resolveLedgerRoots } from '../../../hooks/lib/ledger-roots.mjs';
import { projectKey } from '../../../src/util/project-key.mjs';
import { tempDir, cleanup, useEnv } from './fixtures.mjs';

const ROOTS = ['/data/-proj/ledger'];

test('hasMutatingConstruct detects redirects and destructive verbs', () => {
  assert.equal(hasMutatingConstruct('echo x > /data/-proj/ledger/threads/a.json'), true);
  assert.equal(hasMutatingConstruct('rm -rf /data/-proj/ledger'), true);
  assert.equal(hasMutatingConstruct('cat /data/-proj/ledger/threads/a.json'), false);
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

test('handlePreToolUse auto-approves any mcp__ledger__* tool', async () => {
  const ctx = { input: { tool_name: 'mcp__ledger__open_thread' }, env: {}, projectDir: '/proj' };
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
