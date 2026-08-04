import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv from 'ajv';
import { projectValidationErrors } from '../../../src/schema/error-projection.mjs';

const ajv = new Ajv({ allErrors: true, verbose: true });

const WIDE_PAYLOAD_ITEMS = 1200;
const WIDE_PAYLOAD_BUDGET_MS = 250;

const DISCRIMINATED_UNION = {
  type: 'object',
  anyOf: [
    {
      required: ['kind', 'payload', 'sig'],
      properties: { kind: { const: 'a' } },
    },
    {
      required: ['kind'],
      properties: { kind: { const: 'b' }, payload: { type: 'string' } },
    },
  ],
};

const UNDISCRIMINATED_UNION = {
  type: 'object',
  properties: {
    value: {
      anyOf: [
        { type: 'object', properties: { nested: { type: 'string' } }, required: ['nested'] },
        { type: 'string' },
      ],
    },
  },
};

const NESTED_UNION = {
  type: 'object',
  properties: {
    value: {
      anyOf: [
        {
          type: 'object',
          required: ['inner'],
          properties: {
            inner: {
              anyOf: [
                { type: 'object', properties: { leaf: { type: 'string' } }, required: ['leaf'] },
                { type: 'object', required: ['other'] },
              ],
            },
          },
        },
        { type: 'string' },
      ],
    },
  },
};

function errorsFor(schema, data) {
  const validate = ajv.compile(schema);
  assert.equal(validate(data), false, 'the fixture payload must fail validation');
  return [...validate.errors];
}

test('a discriminated union repairs the branch the caller chose instead of flipping the discriminator', () => {
  const errors = errorsFor(DISCRIMINATED_UNION, { kind: 'a', payload: 1 });
  const problems = projectValidationErrors(errors, { prefix: 'call' });

  assert.deepEqual(problems.map((problem) => problem.field), ['call.sig']);
  assert.equal(problems[0].code, 'missing_parameter');
  assert.equal(problems.some((problem) => problem.code === 'invalid_const'), false);
});

test('a discriminator the caller did agree with keeps its branch, whatever the depth of the loser', () => {
  const errors = errorsFor(DISCRIMINATED_UNION, { kind: 'b', payload: 1 });
  const problems = projectValidationErrors(errors, { prefix: 'call' });

  assert.deepEqual(problems.map((problem) => problem.field), ['call.payload']);
  assert.equal(problems[0].code, 'invalid_type');
});

test('depth still breaks the tie when no branch carries a discriminator disagreement', () => {
  const errors = errorsFor(UNDISCRIMINATED_UNION, { value: { nested: 5 } });
  const problems = projectValidationErrors(errors, { prefix: 'call' });

  assert.deepEqual(problems.map((problem) => problem.field), ['call.value.nested']);
});

test('a branch that fails only on a missing property outranks nothing it should outrank', () => {
  const errors = errorsFor(UNDISCRIMINATED_UNION, { value: {} });
  const problems = projectValidationErrors(errors, { prefix: 'call' });

  assert.deepEqual(
    problems.map((problem) => problem.field),
    ['call.value.nested', 'call.value'],
  );
});

test('a nested union suppresses the losing inner branch instead of guiding one value two ways', () => {
  const errors = errorsFor(NESTED_UNION, { value: { inner: { leaf: 5 } } });
  const problems = projectValidationErrors(errors, { prefix: 'call' });

  assert.deepEqual(problems.map((problem) => problem.field), ['call.value.inner.leaf']);
});

test('branch suppression scales linearly enough to stay off the stdio thread budget', () => {
  const schema = {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: { text: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
        },
      },
    },
  };
  const data = { items: Array.from({ length: WIDE_PAYLOAD_ITEMS }, () => ({ text: true })) };
  const errors = errorsFor(schema, data);
  assert.ok(errors.length >= WIDE_PAYLOAD_ITEMS, `expected a wide error list, measured ${errors.length}`);

  const started = process.hrtime.bigint();
  const problems = projectValidationErrors(errors, { prefix: 'call' });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  assert.equal(problems.length, WIDE_PAYLOAD_ITEMS);
  assert.ok(
    elapsedMs < WIDE_PAYLOAD_BUDGET_MS,
    `expected under ${WIDE_PAYLOAD_BUDGET_MS}ms, measured ${elapsedMs.toFixed(1)}ms`,
  );
});
