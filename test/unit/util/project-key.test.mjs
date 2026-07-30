import test from 'node:test';
import assert from 'node:assert/strict';
import { isProjectKey, projectKey } from '../../../src/util/project-key.mjs';

const ABSOLUTE_PATHS = [
  '/Users/me/Dev/my.proj_1',
  '/abc123',
  '/',
  '/a',
  '/var/folders/tz/T/tmp-XYZ/repo',
  '/Users/me/Documents/DevLabs/continuity-ledger-plugin',
];

test('isProjectKey accepts every key projectKey can emit', () => {
  for (const path of ABSOLUTE_PATHS) {
    assert.equal(isProjectKey(projectKey(path)), true, `rejected the key for ${path}`);
  }
});

test('isProjectKey rejects the ordinary directory names a data root can hold', () => {
  for (const name of ['dotfiles', 'hooks', 'githooks', 'local', 'share', 'bin', '', 'a b', '..', '.']) {
    assert.equal(isProjectKey(name), false, `accepted ${JSON.stringify(name)} as a project key`);
  }
});

test('isProjectKey rejects non-strings without throwing', () => {
  for (const value of [null, undefined, 42, {}, []]) {
    assert.equal(isProjectKey(value), false);
  }
});

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
