import test from 'node:test';
import assert from 'node:assert/strict';
import { branchSlug } from '../../../src/drift/slug.mjs';

test('branchSlug replaces a single slash with a dash', () => {
  assert.equal(branchSlug('fix/signup-bug'), 'fix-signup-bug');
});

test('branchSlug replaces every slash in a nested branch name', () => {
  assert.equal(branchSlug('feat/area/thing'), 'feat-area-thing');
});

test('branchSlug trims surrounding whitespace before converting', () => {
  assert.equal(branchSlug('  main  '), 'main');
  assert.equal(branchSlug(' fix/x '), 'fix-x');
});

test('branchSlug passes through a slashless name unchanged', () => {
  assert.equal(branchSlug('main'), 'main');
});

test('branchSlug throws on a non-string branch', () => {
  assert.throws(() => branchSlug(null), /branch/);
  assert.throws(() => branchSlug(42), /branch/);
});

test('branchSlug throws on an empty or blank branch', () => {
  assert.throws(() => branchSlug(''), /branch/);
  assert.throws(() => branchSlug('   '), /branch/);
});
