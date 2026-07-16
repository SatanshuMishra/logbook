import test from 'node:test';
import assert from 'node:assert/strict';
import { serializeRecord } from '../../../src/drivers/layout.mjs';

test('serializeRecord emits 2-space pretty JSON with a single trailing newline', () => {
  const out = serializeRecord({ a: 1, b: [2, 3] });
  assert.equal(out, '{\n  "a": 1,\n  "b": [\n    2,\n    3\n  ]\n}\n');
});

test('serializeRecord ends with exactly one trailing newline', () => {
  const out = serializeRecord({ x: 1 });
  assert.equal(out.endsWith('\n'), true);
  assert.equal(out.endsWith('\n\n'), false);
});

test('serializeRecord is byte-identical to JSON.stringify(obj, null, 2) + newline', () => {
  const obj = { id: 'X', nested: { k: 'v' }, list: [] };
  assert.equal(serializeRecord(obj), JSON.stringify(obj, null, 2) + '\n');
});
