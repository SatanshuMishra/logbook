import test from 'node:test';
import assert from 'node:assert/strict';
import { envToUserConfig, SERVER_ENV_MAP } from '../../../bin/ledger-server.mjs';

test('SERVER_ENV_MAP maps EXACTLY the two server keys UPPER->lower', () => {
  assert.deepEqual(SERVER_ENV_MAP, {
    LEDGER_BACKEND: 'ledger_backend',
    LEDGER_BRANCH: 'ledger_branch',
  });
});

test('envToUserConfig maps LEDGER_BACKEND/LEDGER_BRANCH into userConfig', () => {
  const cfg = envToUserConfig({ LEDGER_BACKEND: 'custom-ref', LEDGER_BRANCH: 'ledger/main' });
  assert.deepEqual(cfg, { ledger_backend: 'custom-ref', ledger_branch: 'ledger/main' });
});

test('envToUserConfig omits absent or empty keys so selectDriver defaults apply', () => {
  assert.deepEqual(envToUserConfig({}), {});
  assert.deepEqual(envToUserConfig({ LEDGER_BACKEND: '' }), {});
  assert.deepEqual(envToUserConfig({ LEDGER_BRANCH: 'x' }), { ledger_branch: 'x' });
});

test('envToUserConfig NEVER consumes the hook-plane trailer/nudge vars', () => {
  const cfg = envToUserConfig({
    LEDGER_BACKEND: 'orphan-branch',
    LEDGER_DISABLE_TRAILER: 'true',
    LEDGER_NUDGE_FRACTION: '0.9',
    LEDGER_NUDGE_BYTES: '999',
  });
  assert.deepEqual(cfg, { ledger_backend: 'orphan-branch' });
  assert.equal('disable_trailer' in cfg, false);
});
