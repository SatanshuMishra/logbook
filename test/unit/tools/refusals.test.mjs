import test from 'node:test';
import assert from 'node:assert/strict';
import { callTool } from '../../../src/tools/registry.mjs';
import { MESSAGE_MAX_CHARS, LEDGER_ERROR_LAYERS, LedgerError } from '../../../src/errors.mjs';
import { renderToolFailure } from '../../../bin/ledger-server.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

const ABSENT_ULID = '01HXV3W4Z9QK7T2M8N5P6R0S1T';
const AMEND_HYPOTHESIS_MAX_CHARS = 200;

async function refuse(ctx, name, args) {
  try {
    await callTool(name, args, ctx);
  } catch (error) {
    return error;
  }
  return assert.fail(`expected ${name} to refuse`);
}

async function seedThread(ctx) {
  const { thread } = await callTool('open_thread', {
    title: 'Legible Refusals',
    completion_criteria: [{ text: 'ship it' }, { text: 'prove it' }],
  }, ctx);
  return thread;
}

test('a record_decision call that omits options names options, says it is absent, and refuses retry', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'record_decision', {
    thread_id: ABSENT_ULID,
    slug: 'legible-refusals',
    title: 'Make refusals legible',
    context: 'the incident',
    outcome: 'ship MSP-1',
  });

  assert.equal(error.code, 'missing_parameter');
  assert.equal(error.layer, 'input');
  assert.equal(error.field, 'record_decision.options');
  assert.equal(error.retryable, false);
  assert.match(error.message, /options/);
  assert.match(error.message, /absent from the call/);
  assert.match(error.message, /^retryable: false$/m);
  assert.match(error.remedy, /re-emit the call/);
});

test('the first line of a refusal is code, field and what is accepted; the second is retryability', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'record_decision', {
    thread_id: ABSENT_ULID,
    slug: 'legible-refusals',
    title: 'Make refusals legible',
    context: 'the incident',
    outcome: 'ship MSP-1',
  });

  const [head, second] = error.message.split('\n');
  assert.equal(head, `${error.code}: ${error.field}: ${error.expected}`);
  assert.equal(second, 'retryable: false');
});

test('a malformed amend_criteria op yields one hypothesis naming the bad value and the three valid ops', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'amend_criteria', {
    thread_id: thread.id,
    operations: [{ op: 'update', id: 'c1', text: 'a rewritten criterion' }],
  });

  assert.equal(error.problems.length, 1);
  assert.equal(error.code, 'invalid_enum');
  assert.equal(error.field, 'amend_criteria.operations[0].op');
  assert.equal(error.expected, 'one of "insert", "rewrite", "strike"');
  assert.match(error.message, /"update"/);
  assert.equal(error.retryable, false);
  assert.ok(
    error.message.length < AMEND_HYPOTHESIS_MAX_CHARS,
    `expected under ${AMEND_HYPOTHESIS_MAX_CHARS} chars, measured ${error.message.length}`,
  );
});

test('a malformed amend_criteria op never names a field belonging to a branch it did not choose', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'amend_criteria', {
    thread_id: thread.id,
    operations: [{ op: 'insert', text: 'a new criterion' }],
  });

  assert.deepEqual(error.problems.map((p) => p.field), ['amend_criteria.operations[0].kind']);
  assert.doesNotMatch(error.message, /decision_ref/);
  assert.doesNotMatch(error.message, /oneOf/);
});

test('an unexpected property is named, so the caller learns which one to drop', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'amend_criteria', {
    thread_id: thread.id,
    operations: [{ op: 'strike', id: 'c1', decision_ref: '0001-x', text: 'not allowed here' }],
  });

  assert.equal(error.code, 'unexpected_parameter');
  assert.equal(error.field, 'amend_criteria.operations[0].text');
  assert.match(error.message, /remove text and re-send/);
});

test('a pattern rejection states the regex and one conforming example', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'get_resume_brief', { thread_id: 'not-a-ulid' });

  assert.equal(error.code, 'invalid_pattern');
  assert.equal(error.example, '01ARZ3NDEKTSV4RRFFQ69G5FAV');
  assert.match(error.message, /\^\[0-9A-HJKMNP-TV-Z\]\{26\}\$/);
  assert.match(error.message, /example: 01ARZ3NDEKTSV4RRFFQ69G5FAV/);
});

test('an enum rejection lists every permitted value', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'transition_thread', {
    thread_id: thread.id,
    to_status: 'finished',
  });

  assert.equal(error.code, 'invalid_enum');
  for (const status of ['active', 'paused', 'blocked', 'done', 'abandoned']) {
    assert.match(error.expected, new RegExp(`"${status}"`));
  }
});

test('a refusal a different call can clear is retryable, unlike a malformed payload', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'transition_thread', {
    thread_id: thread.id,
    to_status: 'done',
    closure_statement: 'shipped',
  });

  assert.equal(error.code, 'dod_unmet');
  assert.equal(error.retryable, true);
  assert.match(error.message, /^retryable: true$/m);
  assert.match(error.remedy, /re-send this call unchanged/);
});

test('a terminal-thread refusal is permanent and points at create_successor', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await callTool('archive_thread', { thread_id: thread.id, reason: 'superseded' }, ctx);
  const error = await refuse(ctx, 'update_thread', {
    thread_id: thread.id,
    spine: { active_goal: 'still going' },
  });

  assert.equal(error.code, 'terminal_thread');
  assert.equal(error.retryable, false);
  assert.match(error.remedy, /create_successor/);
});

test('an illegal transition out of a terminal thread never suggests an impossible repair', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await callTool('archive_thread', { thread_id: thread.id, reason: 'superseded' }, ctx);
  const error = await refuse(ctx, 'archive_thread', { thread_id: thread.id, reason: 'again' });

  assert.equal(error.code, 'illegal_transition');
  assert.equal(error.expected, 'abandoned is terminal and has no outgoing transition');
  assert.doesNotMatch(error.message, /blocked -> paused/);
});

test('a cap violation names the spine path the caller can address', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'update_thread', {
    thread_id: thread.id,
    spine: { active_goal: 'a'.repeat(201) },
  });

  assert.equal(error.code, 'cap_exceeded');
  assert.equal(error.layer, 'cap');
  assert.equal(error.field, 'spine.active_goal');
  assert.equal(error.expected, 'at most 200 characters');
  assert.equal(error.retryable, false);
});

test('an unknown criterion id lists the ids the thread actually carries', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'update_thread', {
    thread_id: thread.id,
    completion_criteria: [{ id: 'c99', done: true }],
  });

  assert.equal(error.code, 'unknown_criterion');
  assert.equal(error.expected, 'one of c1, c2');
  assert.equal(error.retryable, false);
});

test('every refusal the tool surface can produce stays inside the message budget', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const long = 'a'.repeat(4000);
  const corpus = [
    ['nonexistent_tool', {}],
    ['open_thread', {}],
    ['open_thread', { title: long, completion_criteria: [] }],
    ['open_thread', { title: 'x', completion_criteria: [{ text: long }] }],
    ['record_decision', { thread_id: ABSENT_ULID, slug: 'x', title: 't', context: 'c', outcome: 'o' }],
    ['record_decision', { thread_id: ABSENT_ULID }],
    ['record_decision', { thread_id: thread.id, slug: 'x', title: 't', context: 'c', outcome: 'o', options: [] }],
    ['record_decision', { thread_id: ABSENT_ULID, slug: 'x', title: 't', context: 'c', outcome: 'o', options: 5 }],
    ['amend_criteria', { thread_id: thread.id, operations: [{ op: long }] }],
    ['amend_criteria', { thread_id: thread.id, operations: [{ op: 'insert', text: long, kind: 'nope' }] }],
    ['amend_criteria', { thread_id: thread.id, operations: [{ op: 'rewrite', id: 'c9', text: 't', decision_ref: '0001-x' }] }],
    ['amend_criteria', { thread_id: thread.id, operations: [] }],
    ['update_thread', { thread_id: thread.id, spine: { active_goal: long, next_step: long, last_session: long } }],
    ['update_thread', { thread_id: thread.id, spine: { open_risks: [{ text: long }] } }],
    ['update_thread', { thread_id: thread.id, spine: { open_risks: [] } }],
    ['update_thread', { thread_id: thread.id, replace_scopes: { open_risks: ['legacy'] } }],
    ['update_thread', { thread_id: long, bogus: 1, spine: { nope: 1 } }],
    ['transition_thread', { thread_id: thread.id, to_status: 'blocked' }],
    ['transition_thread', { thread_id: thread.id, to_status: long }],
    ['read_decision', { nnnn: '9999' }],
    ['bind_branch', { thread_id: ABSENT_ULID, repo: 'r', branch: 'b' }],
    ['create_successor', { predecessor_id: thread.id, title: 't', completion_criteria: [{ text: 'x' }] }],
    ['reopen', { thread_id: thread.id }],
  ];

  for (const [name, args] of corpus) {
    const error = await refuse(ctx, name, args);
    assert.ok(error instanceof LedgerError, `${name} threw a non-LedgerError: ${error.name}`);
    assert.ok(
      error.message.length <= MESSAGE_MAX_CHARS,
      `${name} produced a ${error.message.length}-char message: ${error.message}`,
    );
    assert.ok(LEDGER_ERROR_LAYERS.includes(error.layer), `${name} used layer ${error.layer}`);
    assert.equal(typeof error.retryable, 'boolean', `${name} left retryable unset`);
    assert.ok(error.code.length > 0 && error.field.length > 0 && error.remedy.length > 0);
  }
});

test('the server renders a refusal as an isError result carrying the message then the structured record', () => {
  const error = new LedgerError({
    code: 'missing_parameter',
    layer: 'input',
    field: 'record_decision.options',
    expected: 'required, but absent from the call',
    retryable: false,
    remedy: 'the parameter did not arrive; re-emit the call',
  });
  const result = renderToolFailure(error, 'record_decision');

  assert.equal(result.isError, true);
  assert.equal(result.content[0].text, error.message);
  assert.equal(result.content[0].text.split('\n')[1], 'retryable: false');
  const detail = JSON.parse(result.content[1].text);
  assert.equal(detail.code, 'missing_parameter');
  assert.equal(detail.field, 'record_decision.options');
  assert.equal(detail.retryable, false);
  assert.equal(detail.layer, 'input');
});

test('a non-LedgerError throw is rendered as a server-layer fault, never as a payload defect', () => {
  const result = renderToolFailure(new Error('selectDriver: CLAUDE_PLUGIN_DATA is not set'), 'open_thread');
  const detail = JSON.parse(result.content[1].text);

  assert.equal(result.isError, true);
  assert.equal(detail.code, 'internal_error');
  assert.equal(detail.layer, 'server');
  assert.equal(detail.field, 'open_thread');
  assert.equal(detail.retryable, false);
  assert.match(result.content[0].text, /CLAUDE_PLUGIN_DATA is not set/);
});
