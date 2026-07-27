import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  classifyPreToolUse,
  classifyBashCommand,
  handlePreToolUse,
} from '../../../hooks/lib/pre-tool-use.mjs';
import { resolveLedgerRoots } from '../../../hooks/lib/ledger-roots.mjs';
import { hookContext } from '../../../hooks/lib/hook-io.mjs';
import { projectKey } from '../../../src/util/project-key.mjs';
import { tempDir, cleanup, useEnv } from './fixtures.mjs';

const ROOTS = ['/data/-proj/ledger'];
const SPACED_ROOTS = ['/data/-proj/led ger'];
const ROOT_READ = 'cat /data/-proj/ledger/f ';
const OUTSIDE_READ = 'cat /tmp/f ';

function padTo(head, length) {
  return head + 'x'.repeat(length - head.length);
}

test('classifyBashCommand denies a write whose target lands under a root', () => {
  assert.equal(classifyBashCommand('echo x > /data/-proj/ledger/threads/a.json', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('rm -rf /data/-proj/ledger', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('cat /data/-proj/ledger/threads/a.json', ROOTS, '/proj'), null);
});

test('classifyBashCommand ignores a redirect that names a root but writes elsewhere', () => {
  assert.equal(classifyBashCommand('grep -r x /data/-proj/ledger 2>/dev/null', ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand('ls -la /data/-proj/ledger 2>&1', ROOTS, '/proj'), null);
});

test('classifyBashCommand follows cd into a root before a destructive verb', () => {
  assert.equal(classifyBashCommand('cd ledger && rm -rf .', ROOTS, '/data/-proj'), 'deny');
});

test('classifyBashCommand resolves a quoted destructive target', () => {
  assert.equal(classifyBashCommand('rm -rf "/data/-proj/ledger"', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand("rm -rf '/data/-proj/ledger'", ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('rm -rf "/data/-proj/ledger/threads"', ROOTS, '/proj'), 'deny');
});

test('classifyBashCommand resolves a quoted redirect target', () => {
  assert.equal(classifyBashCommand('echo x > "/data/-proj/ledger/threads/x.json"', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand("echo x > '/data/-proj/ledger/threads/x.json'", ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('echo x >> "/data/-proj/ledger/log"', ROOTS, '/proj'), 'deny');
});

test('classifyBashCommand keeps a quoted path with spaces as a single token', () => {
  assert.equal(classifyBashCommand('rm -rf "/data/-proj/led ger/threads"', SPACED_ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand("rm -rf '/data/-proj/led ger'", SPACED_ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('echo x > "/data/-proj/led ger/threads/a.json"', SPACED_ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('rm -rf /data/-proj/led\\ ger/threads', SPACED_ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('rm -rf "/data/-proj/led"', SPACED_ROOTS, '/proj'), null);
});

test('classifyBashCommand resolves a quoted in-place sed target', () => {
  assert.equal(classifyBashCommand("sed -i '' s/x/y/ \"/data/-proj/ledger/f\"", ROOTS, '/proj'), 'deny');
});

test('classifyBashCommand leaves read-only inspection of a root allowed', () => {
  assert.equal(classifyBashCommand('ls -la /data/-proj/ledger 2>/dev/null', ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand('ls -la "/data/-proj/ledger" 2>/dev/null', ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand('git -C /data/-proj/ledger show HEAD --stat 2>&1', ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand('git -C "/data/-proj/ledger" show HEAD --stat 2>&1', ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand('echo hi >/tmp/safe.txt && ls /data/-proj/ledger', ROOTS, '/proj'), null);
});

test('classifyBashCommand tracks cd into a root through a quoted target', () => {
  assert.equal(classifyBashCommand('cd /data/-proj/ledger && rm -rf threads', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('cd "/data/-proj/ledger" && rm -rf threads', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand("cd '/data/-proj/ledger' && echo x > threads/a.json", ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('cd "/data/-proj/led ger" && rm -rf threads', SPACED_ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('cd "/data/-proj/ledger" && ls -la threads', ROOTS, '/proj'), null);
});

test('classifyBashCommand splits segments only on unquoted separators', () => {
  assert.equal(classifyBashCommand('rm -rf "/data/-proj/ledger/a && b"', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('rm -rf "/data/-proj/ledger/a;b"', ROOTS, '/proj'), 'deny');
  assert.equal(classifyBashCommand('rm -rf "/data/-proj/ledger/a|b"', ROOTS, '/proj'), 'deny');
});

test('classifyBashCommand leaves an unresolvable expansion outside every root allowed', () => {
  assert.equal(classifyBashCommand('rm -rf "$(cat target.txt)"', ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand('rm -rf "`cat target.txt`"', ROOTS, '/proj'), null);
});

test('classifyBashCommand holds the tracked cwd when a cd target is unresolvable', () => {
  assert.equal(classifyBashCommand('cd "$D" && rm -rf threads', ROOTS, '/data/-proj/ledger'), 'deny');
  assert.equal(classifyBashCommand('cd "$D" && rm -rf threads', ROOTS, '/proj'), null);
});

test('classifyBashCommand denies an oversized command that names a ledger root', () => {
  const under = padTo(ROOT_READ, 16383);
  const atCap = padTo(ROOT_READ, 16384);
  const over = padTo(ROOT_READ, 16385);
  assert.equal(under.length, 16383);
  assert.equal(atCap.length, 16384);
  assert.equal(over.length, 16385);
  assert.equal(classifyBashCommand(under, ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand(atCap, ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand(over, ROOTS, '/proj'), 'deny');
});

test('classifyBashCommand asks about an oversized command that never names a ledger root', () => {
  const under = padTo(OUTSIDE_READ, 16383);
  const atCap = padTo(OUTSIDE_READ, 16384);
  const over = padTo(OUTSIDE_READ, 16385);
  assert.equal(under.length, 16383);
  assert.equal(atCap.length, 16384);
  assert.equal(over.length, 16385);
  assert.equal(classifyBashCommand(under, ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand(atCap, ROOTS, '/proj'), null);
  assert.equal(classifyBashCommand(over, ROOTS, '/proj'), 'ask');
});

test('classifyPreToolUse denies a quoted destructive Bash target', () => {
  const d = classifyPreToolUse(
    { tool_name: 'Bash', tool_input: { command: 'rm -rf "/data/-proj/ledger"' } },
    ROOTS,
    '/proj',
  );
  assert.equal(d.hookSpecificOutput.permissionDecision, 'deny');
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

async function shellCwdCtx(t, command, cwdOf) {
  const projectDir = await tempDir('hooks-cwd-proj-');
  const dataRoot = await tempDir('hooks-cwd-data-');
  cleanup(t, projectDir, dataRoot);
  const root = join(dataRoot, projectKey(projectDir));
  return hookContext(
    { tool_name: 'Bash', tool_input: { command }, cwd: cwdOf({ projectDir, root }) },
    { CLAUDE_PROJECT_DIR: projectDir, CLAUDE_PLUGIN_DATA: dataRoot },
  );
}

test('handlePreToolUse denies a bare relative destructive command run from inside a root', async (t) => {
  const ctx = await shellCwdCtx(t, 'rm -rf sessions', ({ root }) => join(root, 'ledger'));
  const result = await handlePreToolUse(ctx);
  assert.equal(result.json.hookSpecificOutput.permissionDecision, 'deny');
});

test('handlePreToolUse leaves a bare relative destructive command outside every root alone', async (t) => {
  const ctx = await shellCwdCtx(t, 'rm -rf sessions', ({ projectDir }) => projectDir);
  assert.deepEqual(await handlePreToolUse(ctx), {});
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
