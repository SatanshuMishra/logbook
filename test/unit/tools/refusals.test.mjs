import test from 'node:test';
import assert from 'node:assert/strict';
import { callTool } from '../../../src/tools/registry.mjs';
import {
  MESSAGE_MAX_CHARS,
  DETAIL_MAX_BYTES,
  LEDGER_ERROR_LAYERS,
  LEDGER_ERROR_CODES,
  LedgerError,
} from '../../../src/errors.mjs';
import { renderToolFailure } from '../../../bin/ledger-server.mjs';
import { makeToolCtx } from '../../fixtures/tool-ctx.mjs';

const ABSENT_ULID = '01HXV3W4Z9QK7T2M8N5P6R0S1T';
const AMEND_HYPOTHESIS_MAX_CHARS = 200;
const WIDE_PAYLOAD_ERRORS = 1200;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function emittedStrings(value, path = '') {
  if (typeof value === 'string') return [[path, value]];
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => emittedStrings(entry, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, entry]) => (
      emittedStrings(entry, path === '' ? key : `${path}.${key}`)
    ));
  }
  return [];
}

function assertWellFormed(detail, label) {
  for (const [path, text] of emittedStrings(detail)) {
    assert.doesNotMatch(
      text,
      LONE_SURROGATE,
      `${label} emitted an unpaired surrogate at ${path}, which no strict UTF-8 client can decode`,
    );
  }
}

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
  assert.equal(error.field, 'archive_thread.thread_id');
  assert.equal(error.expected, 'a thread whose status is one of active, paused');
  assert.equal(error.retryable, false);
  assert.match(error.remedy, /create_successor/);
  assert.doesNotMatch(error.message, /blocked -> paused/);
});

test('a thread_id refusal describes a thread, never a status value the parameter cannot take', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await callTool('transition_thread', {
    thread_id: thread.id,
    to_status: 'blocked',
    blocked_by: 'waiting on review',
  }, ctx);
  const error = await refuse(ctx, 'archive_thread', { thread_id: thread.id, reason: 'giving up' });

  assert.equal(error.field, 'archive_thread.thread_id');
  assert.match(error.expected, /^a thread whose status is /);
  assert.doesNotMatch(error.expected, /^one of /);
});

test('an illegal transition names a parameter the refused call actually carries', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await callTool('transition_thread', {
    thread_id: thread.id,
    to_status: 'blocked',
    blocked_by: 'waiting on review',
  }, ctx);
  const error = await refuse(ctx, 'archive_thread', { thread_id: thread.id, reason: 'giving up' });

  assert.equal(error.code, 'illegal_transition');
  assert.equal(error.field, 'archive_thread.thread_id');
  assert.equal(error.expected, 'a thread whose status is one of active, paused');
  assert.doesNotMatch(error.message, /to_status/);
});

test('an illegal transition a second call can clear is retryable and names the intermediate hop', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await callTool('transition_thread', {
    thread_id: thread.id,
    to_status: 'blocked',
    blocked_by: 'waiting on review',
  }, ctx);
  const error = await refuse(ctx, 'archive_thread', { thread_id: thread.id, reason: 'giving up' });

  assert.equal(error.retryable, true);
  assert.match(error.message, /^retryable: true$/m);
  assert.match(error.remedy, /transition_thread/);
  assert.match(error.remedy, /active, paused/);
  assert.match(error.remedy, /re-send this call unchanged/);
  assert.doesNotMatch(error.remedy, /pick a status the FSM allows/);
});

test('an illegal transition out of a live thread stays retryable for transition_thread too', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  await callTool('transition_thread', { thread_id: thread.id, to_status: 'paused' }, ctx);
  const error = await refuse(ctx, 'transition_thread', { thread_id: thread.id, to_status: 'blocked' });

  assert.equal(error.code, 'illegal_transition');
  assert.equal(error.field, 'transition_thread.to_status');
  assert.equal(error.retryable, true);
});

test('a legal array argument is never told to re-send itself as a string', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'record_decision', {
    thread_id: thread.id,
    slug: 'legible-refusals',
    title: 'Make refusals legible',
    context: 'the incident',
    outcome: 'ship MSP-1B',
    options: [1, 2],
  });

  const contradictions = error.problems.filter(
    (problem) => problem.field === 'record_decision.options' && /string/.test(problem.expected),
  );
  assert.deepEqual(contradictions, []);
  assert.deepEqual(
    error.problems.map((problem) => problem.field),
    ['record_decision.options[0]', 'record_decision.options[1]'],
  );
  assert.doesNotMatch(error.message, /anyOf/);
});

test('an argument with no valid branch still reports every type the schema accepts', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'record_decision', {
    thread_id: thread.id,
    slug: 'legible-refusals',
    title: 'Make refusals legible',
    context: 'the incident',
    outcome: 'ship MSP-1B',
    options: 5,
  });

  assert.equal(error.field, 'record_decision.options');
  assert.equal(error.expected, 'type array or string');
});

test('the structured record stays inside its byte budget on a pathologically wide payload', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'open_thread', {
    title: 'Wide Payload',
    completion_criteria: Array.from({ length: WIDE_PAYLOAD_ERRORS }, () => ({ text: 5 })),
  });

  assert.equal(error.problems.length, WIDE_PAYLOAD_ERRORS);
  const record = renderToolFailure(error, 'open_thread').content[1].text;
  const detail = JSON.parse(record);
  assert.ok(
    Buffer.byteLength(record, 'utf8') <= DETAIL_MAX_BYTES,
    `expected at most ${DETAIL_MAX_BYTES} bytes, measured ${Buffer.byteLength(record, 'utf8')}`,
  );
  assert.equal(detail.total, WIDE_PAYLOAD_ERRORS);
  assert.equal(detail.shown, detail.problems.length);
  assert.ok(detail.shown < detail.total, 'a shed record must still say how many problems it shows');
});

test('a single-problem refusal reports the same three-field shape as a wide one', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'get_resume_brief', { thread_id: 'not-a-ulid' });
  const detail = JSON.parse(renderToolFailure(error, 'get_resume_brief').content[1].text);

  assert.equal(Array.isArray(detail.problems), true);
  assert.equal(detail.problems.length, 1);
  assert.equal(detail.shown, 1);
  assert.equal(detail.total, 1);
  assert.equal(detail.problems[0].code, detail.code);
  assert.equal('truncated' in detail, false, 'truncated conflated "some shown" with "none shown"');
});

test('a record shed for budget says zero are shown rather than leaving the count implied', async (t) => {
  const ctx = await makeToolCtx(t);
  const wide = '🧵"\\'.repeat(400);
  const error = await refuse(ctx, 'update_thread', {
    thread_id: wide,
    [wide]: 1,
    spine: { [wide]: wide },
  });
  const detail = JSON.parse(renderToolFailure(error, 'update_thread').content[1].text);

  assert.equal(typeof detail.shown, 'number');
  assert.equal(typeof detail.total, 'number');
  assert.equal(detail.shown, Array.isArray(detail.problems) ? detail.problems.length : 0);
});

test('the byte budget holds when every field the caller controls is multi-byte', async (t) => {
  const ctx = await makeToolCtx(t);
  const wide = '🧵"\\'.repeat(400);
  const error = await refuse(ctx, 'update_thread', {
    thread_id: wide,
    [wide]: 1,
    spine: { [wide]: wide },
  });

  const record = renderToolFailure(error, 'update_thread').content[1].text;
  const measured = Buffer.byteLength(record, 'utf8');
  assert.ok(measured <= DETAIL_MAX_BYTES, `expected at most ${DETAIL_MAX_BYTES} bytes, measured ${measured}`);
  assert.equal(typeof JSON.parse(record).code, 'string');
  assertWellFormed(JSON.parse(record), 'update_thread');
  assert.doesNotMatch(error.message, LONE_SURROGATE);
});

test('a title that yields no slug is a caller fault naming title, not a server fault', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'open_thread', {
    title: '日本語',
    completion_criteria: [{ text: 'ship it' }],
  });

  assert.notEqual(error.layer, 'server');
  assert.notEqual(error.code, 'internal_error');
  assert.equal(error.field, 'open_thread.title');
  assert.match(error.remedy, /slug/);
  assert.doesNotMatch(error.remedy, /server-side fault/);
});

test('a blank-after-trim string is refused as a caller fault naming the parameter', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const error = await refuse(ctx, 'bind_branch', {
    thread_id: thread.id,
    repo: '   ',
    branch: 'main',
  });

  assert.notEqual(error.layer, 'server');
  assert.equal(error.field, 'bind_branch.repo');
  assert.equal(error.retryable, false);
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
    ['open_thread', { title: '日本語', completion_criteria: [{ text: 'x' }] }],
    ['bind_branch', { thread_id: thread.id, repo: '   ', branch: 'b' }],
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
    for (const problem of error.problems) {
      assert.ok(
        LEDGER_ERROR_CODES.includes(problem.code),
        `${name} used code ${problem.code}, which is absent from LEDGER_ERROR_CODES`,
      );
    }
    const record = renderToolFailure(error, name).content[1].text;
    assert.ok(
      Buffer.byteLength(record, 'utf8') <= DETAIL_MAX_BYTES,
      `${name} produced a ${Buffer.byteLength(record, 'utf8')}-byte record`,
    );
    assertWellFormed(JSON.parse(record), name);
    assertWellFormed({ message: error.message }, name);
  }
});

test('an echoed tool name is quoted so it cannot imitate the server key: value grammar', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'retryable: true', {});

  assert.equal(error.code, 'unknown_tool');
  assert.match(error.remedy, /unknown tool: "retryable: true"/);
  assert.match(error.message, /^retryable: false$/m);
  assert.doesNotMatch(error.message, /^retryable: true$/m);
});

test('an echoed decision number is quoted rather than pasted into the remedy prose', async (t) => {
  const ctx = await makeToolCtx(t);
  const error = await refuse(ctx, 'read_decision', { nnnn: '9999' });

  assert.equal(error.code, 'unknown_decision');
  assert.match(error.remedy, /no decision numbered "9999" exists here/);
});

test('each refusal path names its exact code and layer, not merely a registered one', async (t) => {
  const ctx = await makeToolCtx(t);
  const thread = await seedThread(ctx);
  const contract = [
    ['open_thread', { title: '   ', completion_criteria: [{ text: 'x' }] }, 'blank_parameter', 'tool'],
    ['open_thread', { title: '日本語', completion_criteria: [{ text: 'x' }] }, 'underivable_slug', 'tool'],
    ['bind_branch', { thread_id: thread.id, repo: '   ', branch: 'b' }, 'blank_parameter', 'tool'],
    ['bind_branch', { thread_id: thread.id, repo: 'r', branch: '  ' }, 'blank_parameter', 'tool'],
    ['update_thread', { thread_id: thread.id, spine: { active_goal: 'a'.repeat(201) } }, 'cap_exceeded', 'cap'],
    ['update_thread', { thread_id: thread.id, spine: { next_step: 'n'.repeat(501) } }, 'cap_exceeded', 'cap'],
    ['bind_branch', { thread_id: ABSENT_ULID, repo: 'r', branch: 'b' }, 'unknown_thread', 'tool'],
    ['read_decision', { nnnn: '9999' }, 'unknown_decision', 'tool'],
    ['create_successor', { predecessor_id: thread.id, title: 't', completion_criteria: [{ text: 'x' }] }, 'not_terminal', 'tool'],
    ['transition_thread', { thread_id: thread.id, to_status: 'done', closure_statement: 's' }, 'dod_unmet', 'tool'],
    ['transition_thread', { thread_id: thread.id, to_status: 'finished' }, 'invalid_enum', 'input'],
    ['get_resume_brief', { thread_id: 'not-a-ulid' }, 'invalid_pattern', 'input'],
    ['open_thread', { title: 'x', completion_criteria: [] }, 'invalid_length', 'input'],
    ['nonexistent_tool', {}, 'unknown_tool', 'server'],
  ];

  for (const [name, args, code, layer] of contract) {
    const error = await refuse(ctx, name, args);
    assert.equal(error.code, code, `${name} emitted ${error.code}, not ${code}`);
    assert.equal(error.layer, layer, `${name} emitted layer ${error.layer}, not ${layer}`);
    assert.equal(
      JSON.parse(renderToolFailure(error, name).content[1].text).code,
      code,
      `${name} rendered a wire code that disagrees with the thrown one`,
    );
  }
});

const CODE_LITERAL = /code:\s*(['"`])([a-z0-9_]+)\1/g;
const CLASS_DECLARATION = /class\s+([A-Za-z0-9_$]+)\s+extends\s+([A-Za-z0-9_$]+)/g;

function ledgerErrorClasses(sources) {
  const declarations = sources.flatMap((source) => (
    [...source.matchAll(CLASS_DECLARATION)].map((match) => ({ name: match[1], parent: match[2] }))
  ));
  const closure = new Set(['LedgerError']);
  let grew = true;
  while (grew) {
    grew = false;
    for (const { name, parent } of declarations) {
      if (closure.has(parent) && !closure.has(name)) {
        closure.add(name);
        grew = true;
      }
    }
  }
  return closure;
}

async function scanSources() {
  const { readFile, readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../../', import.meta.url));

  const walk = async (entry) => {
    const nested = await readdir(entry, { withFileTypes: true }).catch(() => null);
    if (!nested) return [entry];
    const children = await Promise.all(nested.map((child) => walk(join(entry, child.name))));
    return children.flat();
  };
  const collect = async (relatives) => {
    const files = (await Promise.all(relatives.map((entry) => walk(join(root, entry)))))
      .flat()
      .filter((file) => file.endsWith('.mjs'));
    return { files, sources: await Promise.all(files.map((file) => readFile(file, 'utf8'))) };
  };
  return {
    declaring: await collect(['src/errors.mjs', 'src/model', 'src/schema', 'src/tools']),
    shipped: await collect(['src', 'bin']),
  };
}

test('every error code the source declares is a member of the frozen registry', async () => {
  const { declaring } = await scanSources();
  const declared = new Set(
    declaring.sources.flatMap((source) => [...source.matchAll(CODE_LITERAL)].map((m) => m[2])),
  );

  assert.ok(declaring.files.length > 0, 'the scan resolved no source files');
  assert.ok(declared.size > 0, 'found no code literals to check');
  for (const code of declared) {
    assert.ok(
      LEDGER_ERROR_CODES.includes(code),
      `${code} is declared in source but absent from LEDGER_ERROR_CODES`,
    );
  }
  assert.ok(Object.isFrozen(LEDGER_ERROR_CODES));
});

test('the stray-construction guard covers every LedgerError subclass the source declares', async () => {
  const { declaring, shipped } = await scanSources();
  const classes = ledgerErrorClasses(shipped.sources);

  for (const declared of ['ToolError', 'ToolValidationError', 'CapViolationError', 'SchemaValidationError']) {
    assert.ok(classes.has(declared), `${declared} is a LedgerError but escapes the stray guard`);
  }

  const constructions = new RegExp(`new (${[...classes].join('|')})\\(`);
  const strays = shipped.files.filter((file, index) => (
    constructions.test(shipped.sources[index]) && !declaring.files.includes(file)
  ));
  assert.deepEqual(strays, [], 'a ledger error is constructed outside the scanned roots');
});

test('a problem carrying a code outside the registry is refused at construction', () => {
  assert.throws(() => new LedgerError({
    code: 'invented_code',
    layer: 'tool',
    field: 'open_thread.title',
    expected: 'a value the schema accepts',
    retryable: false,
    remedy: 'correct it and re-send',
  }), TypeError);
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
