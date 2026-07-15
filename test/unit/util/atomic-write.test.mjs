import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../../../src/util/atomic-write.mjs';

async function scratch() {
  return mkdtemp(join(tmpdir(), 'atomic-write-'));
}

test('atomicWrite writes the exact contents to the target', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'record.json');
  const returned = await atomicWrite(target, '{"a":1}\n');
  assert.equal(returned, target);
  assert.equal(await readFile(target, 'utf8'), '{"a":1}\n');
});

test('atomicWrite creates missing parent directories', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'nested', 'deep', 'file.txt');
  await atomicWrite(target, 'hello');
  assert.equal(await readFile(target, 'utf8'), 'hello');
});

test('atomicWrite overwrites an existing target', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const target = join(dir, 'x.txt');
  await atomicWrite(target, 'first');
  await atomicWrite(target, 'second');
  assert.equal(await readFile(target, 'utf8'), 'second');
});

test('atomicWrite leaves no temp files behind', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await atomicWrite(join(dir, 'y.txt'), 'data');
  const entries = await readdir(dir);
  assert.deepEqual(entries, ['y.txt']);
});

test('atomicWrite rejects a non-string contents', async (t) => {
  const dir = await scratch();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await assert.rejects(() => atomicWrite(join(dir, 'z.txt'), { not: 'a string' }), /string/);
});

test('atomicWrite rejects an empty target path', async () => {
  await assert.rejects(() => atomicWrite('', 'data'), /non-empty/);
});
