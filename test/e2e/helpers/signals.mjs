import assert from 'node:assert/strict';

export function findEntry(drift, branch) {
  return drift.find((entry) => entry.branch === branch);
}

export function expectSignal(entry, code, classification) {
  assert.ok(entry, `expected a drift entry but received ${entry}`);
  const codes = entry.signals.map((s) => s.code);
  const signal = entry.signals.find((s) => s.code === code);
  assert.ok(signal, `expected signal '${code}' among [${codes.join(', ')}]`);
  assert.equal(
    signal.classification,
    classification,
    `signal '${code}' classification: expected ${classification}, got ${signal.classification}`,
  );
  return signal;
}
