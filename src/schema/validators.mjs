import Ajv from 'ajv';
import { LedgerError } from '../errors.mjs';
import { projectValidationErrors } from './error-projection.mjs';
import { threadSchema } from './thread.schema.mjs';
import { bindingSchema } from './binding.schema.mjs';

const ajv = new Ajv({ allErrors: true, verbose: true });

const RECORD_REMEDY = 'the stored record does not satisfy the schema; repair the record itself, not the call';

export function formatValidationErrors(errors) {
  if (!errors || errors.length === 0) return 'no errors';
  const problems = projectValidationErrors(errors);
  if (problems.length === 0) return 'no errors';
  return problems.map((problem) => `${problem.field}: ${problem.expected}`).join('; ');
}

export class SchemaValidationError extends LedgerError {
  constructor(recordKind, errors) {
    const problems = projectValidationErrors(errors, {
      prefix: recordKind,
      remedy: RECORD_REMEDY,
    });
    super({
      layer: 'record',
      ...(problems[0] ?? {
        code: 'record_invalid',
        field: recordKind,
        expected: 'a record the schema accepts',
        retryable: false,
        remedy: RECORD_REMEDY,
      }),
      problems,
    });
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

const compiledBinding = ajv.compile(bindingSchema);

export function validateBinding(record) {
  const valid = compiledBinding(record);
  return { valid, errors: valid ? [] : [...compiledBinding.errors] };
}

export function assertValidBinding(record) {
  const { valid, errors } = validateBinding(record);
  if (!valid) throw new SchemaValidationError('BranchBinding', errors);
  return record;
}
