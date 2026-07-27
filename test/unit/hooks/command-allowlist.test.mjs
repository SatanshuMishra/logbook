import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSegments } from '../../../hooks/lib/shell-tokens.mjs';
import { normalizeHead, resolveGitSubcommand } from '../../../hooks/lib/command-allowlist.mjs';

const words = (command) => scanSegments(command)[0].filter((token) => token.kind === 'word');

const gitSubcommand = (command) => {
  const list = words(command);
  const head = normalizeHead(list);
  assert.deepEqual(head, { kind: 'name', name: 'git', index: 0 });
  return resolveGitSubcommand(list, head.index + 1);
};

test('resolveGitSubcommand fails closed on an unknown git global flag', () => {
  assert.deepEqual(gitSubcommand('git -Z log'), { ok: false });
});

test('resolveGitSubcommand resolves past the spaced form of a valued global', () => {
  assert.deepEqual(gitSubcommand('git --git-dir /r/.git log'), { ok: true, subcommand: 'log' });
});

test('resolveGitSubcommand resolves past a chain of spaced valued globals', () => {
  assert.deepEqual(gitSubcommand('git --git-dir /r/.git -C /r status'), { ok: true, subcommand: 'status' });
});

test('resolveGitSubcommand fails closed on the config global', () => {
  assert.deepEqual(gitSubcommand('git -c core.x=1 -C /r status'), { ok: false });
});

test('resolveGitSubcommand fails closed on the pager global', () => {
  assert.deepEqual(gitSubcommand('git -p log'), { ok: false });
});

test('normalizeHead reports assignment-only for a bare assignment with no command', () => {
  assert.deepEqual(normalizeHead(words('FOO=bar')), { kind: 'assignment-only' });
});

test('normalizeHead reports assignment-only for an empty word list', () => {
  assert.deepEqual(normalizeHead([]), { kind: 'assignment-only' });
});

test('normalizeHead skips the numeric operand of the timeout prefix', () => {
  assert.deepEqual(normalizeHead(words('timeout 5 cat /r/f')), { kind: 'name', name: 'cat', index: 2 });
});

test('normalizeHead skips the flag and numeric operand of the nice prefix', () => {
  assert.deepEqual(normalizeHead(words('nice -n 5 cat /r/f')), { kind: 'name', name: 'cat', index: 3 });
});
