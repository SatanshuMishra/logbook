import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { checkPackaging } from '../../scripts/check-packaging.mjs';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('checkPackaging reports the assembled plugin ensemble is complete', async () => {
  const { ok, problems } = await checkPackaging(REPO_ROOT);
  assert.equal(ok, true, `packaging ensemble incomplete:\n${problems.join('\n')}`);
});
