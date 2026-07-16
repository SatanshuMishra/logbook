import test from 'node:test';
import assert from 'node:assert/strict';
import { StorageDriver } from '../../../src/drivers/storage-driver.mjs';

test('StorageDriver.isGit throws not-implemented on the abstract base', () => {
  const base = new StorageDriver();
  assert.throws(() => base.isGit(), /StorageDriver\.isGit not implemented/);
});

test('StorageDriver.writeThread rejects with not-implemented on the abstract base', async () => {
  const base = new StorageDriver();
  await assert.rejects(() => base.writeThread({}), /StorageDriver\.writeThread not implemented/);
});

test('StorageDriver git-only methods throw git-drivers-only on the base default', async () => {
  const base = new StorageDriver();
  await assert.rejects(() => base.observeBranch({}), /observeBranch: git drivers only/);
});
