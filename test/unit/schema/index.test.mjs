import test from 'node:test';
import assert from 'node:assert/strict';
import * as schema from '../../../src/schema/index.mjs';

test('the barrel re-exports the full public surface', () => {
  for (const name of [
    'validateThread',
    'assertValidThread',
    'validateBinding',
    'assertValidBinding',
    'SchemaValidationError',
    'formatValidationErrors',
    'threadSchema',
    'bindingSchema',
  ]) {
    assert.ok(name in schema, `expected export: ${name}`);
  }
  assert.equal(typeof schema.assertValidThread, 'function');
  assert.equal(typeof schema.assertValidBinding, 'function');
  assert.equal(schema.threadSchema.additionalProperties, false);
  assert.equal(schema.bindingSchema.additionalProperties, false);
});

test('assertValidThread from the barrel validates a real record end-to-end', () => {
  const thread = {
    schema_version: 1,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    slug: 's',
    title: 't',
    status: 'active',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [],
    vcs_ref: null,
    external_refs: [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      status: 'active',
      active_goal: '',
      next_step: '',
      open_risks: [],
      key_decisions: [],
      out_of_scope: [],
    },
    created_at: '2026-07-14T10:00:00Z',
    updated_at: '2026-07-14T10:00:00Z',
  };
  assert.equal(schema.assertValidThread(thread), thread);
  assert.throws(
    () => schema.assertValidBinding({ id: 'nope' }),
    schema.SchemaValidationError,
  );
});
