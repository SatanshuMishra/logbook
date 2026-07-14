import Ajv from 'ajv';
import { threadSchema } from './thread.schema.mjs';

const ajv = new Ajv({ allErrors: true });

export function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) return 'no errors';
  return errors
    .map((e) => `${e.instancePath || '(root)'} ${e.message}`.trim())
    .join('; ');
}

export class SchemaValidationError extends Error {
  constructor(recordKind, errors) {
    super(`${recordKind} failed schema validation: ${formatValidationErrors(errors)}`);
    this.name = 'SchemaValidationError';
    this.recordKind = recordKind;
    this.errors = errors;
  }
}

const compiledThread = ajv.compile(threadSchema);

export function validateThread(record) {
  const valid = compiledThread(record);
  return { valid, errors: valid ? [] : [...compiledThread.errors] };
}

export function assertValidThread(record) {
  const { valid, errors } = validateThread(record);
  if (!valid) throw new SchemaValidationError('Thread', errors);
  return record;
}
