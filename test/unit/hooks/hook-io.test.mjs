import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { readHookInput, readHookInputResult, hookContext } from '../../../hooks/lib/hook-io.mjs';
import { REPO_ROOT } from './fixtures.mjs';

const GUARD_FIXTURE = join(REPO_ROOT, 'test/unit/hooks/fixtures/guard-entry.mjs');

function failingStream() {
  return Readable.from((async function* generate() {
    throw new Error('stream boom');
  })());
}

function runGuardFixture(mode, payload, source) {
  return new Promise((resolve) => {
    const child = execFile(
      'node',
      [GUARD_FIXTURE, mode, source ?? 'stdin'],
      { env: process.env, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout, stderr });
      },
    );
    child.stdin.end(payload);
  });
}

function soleDecision(res) {
  assert.equal(res.code, 0);
  const lines = res.stdout.split('\n').filter((line) => line.length > 0);
  assert.equal(lines.length, 1);
  return JSON.parse(lines[0]).hookSpecificOutput;
}

function assertGuardDeny(res) {
  const output = soleDecision(res);
  assert.equal(output.hookEventName, 'PreToolUse');
  assert.equal(output.permissionDecision, 'deny');
  assert.equal(typeof output.permissionDecisionReason, 'string');
  assert.ok(output.permissionDecisionReason.length > 0);
}

function assertSilentAllow(res) {
  assert.equal(res.code, 0);
  assert.equal(res.stdout, '');
}

const BASH_PAYLOAD = JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'rm -rf /x' } });
const EDIT_PAYLOAD = JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: '/x/PROJECT.md' } });
const READ_PAYLOAD = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: '/x/PROJECT.md' } });

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

test('hookContext exposes the shell cwd separately from the project dir', () => {
  const ctx = hookContext({ cwd: '/from/input' }, { CLAUDE_PROJECT_DIR: '/from/env' });
  assert.equal(ctx.projectDir, '/from/env');
  assert.equal(ctx.cwd, '/from/input');
});

test('hookContext falls back to the project dir when the input carries no cwd', () => {
  assert.equal(hookContext({}, { CLAUDE_PROJECT_DIR: '/from/env' }).cwd, '/from/env');
  assert.equal(hookContext({ cwd: '' }, { CLAUDE_PROJECT_DIR: '/from/env' }).cwd, '/from/env');
  assert.equal(hookContext({ cwd: 7 }, { CLAUDE_PROJECT_DIR: '/from/env' }).cwd, '/from/env');
});

test('readHookInputResult separates parsed input from the three unreadable states', async () => {
  assert.deepEqual(
    await readHookInputResult(Readable.from([JSON.stringify({ tool_name: 'Bash' })])),
    { ok: true, input: { tool_name: 'Bash' } },
  );
  assert.deepEqual(await readHookInputResult(Readable.from([''])), { ok: false, reason: 'empty' });
  assert.deepEqual(
    await readHookInputResult(Readable.from(['{not json'])),
    { ok: false, reason: 'malformed' },
  );
  assert.deepEqual(await readHookInputResult(failingStream()), { ok: false, reason: 'stream-error' });
});

test('readHookInputResult rejects a JSON payload that is not a plain object', async () => {
  for (const raw of ['[1,2,3]', '[]', '"hello"', '42', 'null', 'true']) {
    assert.deepEqual(
      await readHookInputResult(Readable.from([raw])),
      { ok: false, reason: 'malformed' },
      raw,
    );
  }
});

test('runGuardEntry denies when stdin holds malformed JSON', async () => {
  assertGuardDeny(await runGuardFixture('silent', '{not json'));
});

test('runGuardEntry denies when stdin holds a JSON array', async () => {
  assertGuardDeny(await runGuardFixture('silent', '[1,2,3]'));
  assertGuardDeny(await runGuardFixture('throw', '[1,2,3]'));
});

test('runGuardEntry denies when the handler throws and the tool name is unreadable', async () => {
  assertGuardDeny(await runGuardFixture('throw', JSON.stringify({ tool_input: { command: 'rm -rf /x' } })));
  assertGuardDeny(await runGuardFixture('throw', JSON.stringify({ tool_name: 42 })));
  assertGuardDeny(await runGuardFixture('throw', JSON.stringify({ __proto__: { tool_name: 'Bash' } })));
  assertGuardDeny(await runGuardFixture('throw', '{"__proto__":{"tool_name":"Bash"}}'));
});

test('runGuardEntry denies when stdin is empty', async () => {
  assertGuardDeny(await runGuardFixture('silent', ''));
});

test('runGuardEntry denies when the stdin stream errors', async () => {
  assertGuardDeny(await runGuardFixture('silent', '', 'stream-error'));
});

test('runGuardEntry denies when the handler throws on a Bash call', async () => {
  assertGuardDeny(await runGuardFixture('throw', BASH_PAYLOAD));
});

test('runGuardEntry denies when the handler rejects on a Bash call', async () => {
  assertGuardDeny(await runGuardFixture('reject', BASH_PAYLOAD));
});

test('runGuardEntry denies when the handler throws on a write tool', async () => {
  assertGuardDeny(await runGuardFixture('throw', EDIT_PAYLOAD));
});

test('runGuardEntry stays silent when the handler throws on an unguarded tool', async () => {
  assertSilentAllow(await runGuardFixture('throw', READ_PAYLOAD));
});

test('runGuardEntry leaves the ordinary allow path silent', async () => {
  assertSilentAllow(await runGuardFixture('silent', BASH_PAYLOAD));
});

test('runGuardEntry treats a nullish handler result as allow', async () => {
  assertSilentAllow(await runGuardFixture('nullish', BASH_PAYLOAD));
});

test('runGuardEntry forwards a handler decision unchanged', async () => {
  const res = await runGuardFixture('decision', BASH_PAYLOAD);
  assert.deepEqual(soleDecision(res), {
    hookEventName: 'PreToolUse',
    permissionDecision: 'ask',
    permissionDecisionReason: 'handler verdict',
  });
});

test('runGuardEntry hands the parsed input and env-derived projectDir to the handler', async () => {
  const res = await runGuardFixture('echo', BASH_PAYLOAD);
  assert.equal(res.code, 0);
  assert.deepEqual(JSON.parse(res.stdout), { seen: 'Bash', projectDir: '/from/env' });
});
