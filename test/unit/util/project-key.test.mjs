import test from 'node:test';
import assert from 'node:assert/strict';
import { projectKey } from '../../../src/util/project-key.mjs';

test('projectKey replaces every non-alphanumeric char with a dash', () => {
  assert.equal(projectKey('/Users/me/Dev/my.proj_1'), '-Users-me-Dev-my-proj-1');
});

test('projectKey leaves alphanumerics untouched', () => {
  assert.equal(projectKey('/abc123'), '-abc123');
});

test('projectKey is deterministic for the same input', () => {
  const p = '/Users/me/Documents/DevLabs/continuity-ledger-plugin';
  assert.equal(projectKey(p), projectKey(p));
});

test('projectKey throws on a non-string input', () => {
  assert.throws(() => projectKey(42), /string/);
  assert.throws(() => projectKey(undefined), /string/);
});

test('projectKey throws on a non-absolute path', () => {
  assert.throws(() => projectKey('relative/path'), /absolute/);
  assert.throws(() => projectKey('./x'), /absolute/);
});
