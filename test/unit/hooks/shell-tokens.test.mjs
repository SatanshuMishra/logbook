import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSegments } from '../../../hooks/lib/shell-tokens.mjs';

const R = '/data/-proj/ledger';

const words = (segment) => segment.filter((token) => token.kind === 'word');
const texts = (segment) => segment.map((token) => token.text);
const kinds = (segment) => segment.map((token) => token.kind);
const heads = (segments) => segments.map((segment) => words(segment)[0].text);

test('an unquoted ampersand is an ordinary word character and never splits a segment', () => {
  const segments = scanSegments(`ls ${R} & rm -rf ${R}`);
  assert.equal(segments.length, 1);
  assert.equal(words(segments[0])[0].text, 'ls');
  assert.deepEqual(texts(segments[0]), ['ls', R, '&', 'rm', '-rf', R]);
});

test('parentheses are ordinary word characters and never split a segment', () => {
  const segments = scanSegments(`( rm -rf ${R} )`);
  assert.equal(segments.length, 1);
  assert.equal(words(segments[0])[0].text, '(');
  assert.deepEqual(texts(segments[0]), ['(', 'rm', '-rf', R, ')']);
});

test('braces are ordinary word characters and never split a segment', () => {
  const segments = scanSegments(`{ rm -rf ${R} }`);
  assert.equal(segments.length, 1);
  assert.equal(words(segments[0])[0].text, '{');
  assert.deepEqual(texts(segments[0]), ['{', 'rm', '-rf', R, '}']);
});

test('a semicolon splits a brace group into two segments', () => {
  const segments = scanSegments(`{ rm -rf ${R}; }`);
  assert.equal(segments.length, 2);
  assert.deepEqual(texts(segments[0]), ['{', 'rm', '-rf', R]);
  assert.deepEqual(texts(segments[1]), ['}']);
  assert.deepEqual(heads(segments), ['{', '}']);
});

test('a glued ampersand stays inside one word token joined to both neighbours', () => {
  const segments = scanSegments(`ls ${R}&rm -rf ${R}`);
  assert.equal(segments.length, 1);
  assert.deepEqual(texts(segments[0]), ['ls', `${R}&rm`, '-rf', R]);
  assert.equal(words(segments[0])[1].text.includes('&'), true);
});

test('a glued open paren fuses into the head word token', () => {
  const segments = scanSegments(`(rm -rf ${R})`);
  assert.equal(segments.length, 1);
  assert.equal(words(segments[0])[0].text, '(rm');
  assert.equal(words(segments[0])[0].text.startsWith('('), true);
  assert.deepEqual(texts(segments[0]), ['(rm', '-rf', `${R})`]);
});

test('a duplicating stderr redirect emits a redirect token followed by an ampersand word', () => {
  const segments = scanSegments(`ls -la ${R} 2>&1`);
  assert.equal(segments.length, 1);
  assert.deepEqual(kinds(segments[0]), ['word', 'word', 'word', 'redirect', 'word']);
  assert.equal(segments[0][3].text, '2>');
  assert.equal(segments[0][4].kind, 'word');
  assert.equal(segments[0][4].text, '&1');
});

test('paired duplicating redirects each emit a redirect token then an ampersand word', () => {
  const segments = scanSegments(`cat ${R}/f 1>&2 2>&1`);
  assert.equal(segments.length, 1);
  assert.deepEqual(kinds(segments[0]), ['word', 'word', 'redirect', 'word', 'redirect', 'word']);
  assert.deepEqual(texts(segments[0]).slice(2), ['1>', '&2', '2>', '&1']);
});

test('a single-quoted inner command survives as one opaque word token', () => {
  const segments = scanSegments(`sh -c 'rm -rf ${R}'`);
  assert.equal(segments.length, 1);
  assert.deepEqual(texts(segments[0]), ['sh', '-c', `rm -rf ${R}`]);
  assert.equal(words(segments[0]).length, 3);
});

test('a double-quoted inner command survives as one opaque word token', () => {
  const segments = scanSegments(`bash -c "rm -rf ${R}"`);
  assert.equal(segments.length, 1);
  assert.deepEqual(texts(segments[0]), ['bash', '-c', `rm -rf ${R}`]);
});

test('a single-quoted region is resolvable and a dollar inside double quotes is not', () => {
  const quoted = scanSegments(`rm -rf '${R}'`);
  assert.equal(quoted[0][2].unresolvable, false);
  assert.equal(quoted[0][2].text, R);
  const expanded = scanSegments('rm -rf "$D"');
  assert.equal(expanded[0][2].unresolvable, true);
  assert.equal(expanded[0][2].text, '$D');
});

test('an input redirect emits an operator token', () => {
  const segments = scanSegments(`xargs rm -rf < ${R}/list`);
  assert.equal(segments.length, 1);
  assert.deepEqual(kinds(segments[0]), ['word', 'word', 'word', 'operator', 'word']);
  assert.equal(segments[0][3].text, '<');
});

test('a heredoc body becomes its own segments with arbitrary first words', () => {
  const segments = scanSegments(`cat > ${R}/f <<'EOT'\nline one\nEOT`);
  assert.equal(segments.length, 3);
  assert.deepEqual(kinds(segments[0]), ['word', 'redirect', 'word', 'operator', 'operator', 'word']);
  assert.deepEqual(texts(segments[0]), ['cat', '>', `${R}/f`, '<', '<', 'EOT']);
  assert.deepEqual(texts(segments[1]), ['line', 'one']);
  assert.deepEqual(texts(segments[2]), ['EOT']);
  assert.deepEqual(heads(segments), ['cat', 'line', 'EOT']);
});

test('a dollar-single-quote head loses only the quotes and keeps the dollar', () => {
  const segments = scanSegments(`$'rm' -rf ${R}`);
  assert.equal(segments.length, 1);
  assert.equal(words(segments[0])[0].text, '$rm');
  assert.deepEqual(texts(segments[0]), ['$rm', '-rf', R]);
});

test('a dollar-single-quote argument keeps the dollar glued to the path', () => {
  const segments = scanSegments(`rm -rf $'${R}'`);
  assert.equal(segments.length, 1);
  assert.deepEqual(texts(segments[0]), ['rm', '-rf', `$${R}`]);
  assert.equal(segments[0][2].unresolvable, false);
});

test('a pipe splits into segments', () => {
  const segments = scanSegments(`cat ${R}/f | xargs rm -rf`);
  assert.equal(segments.length, 2);
  assert.deepEqual(texts(segments[0]), ['cat', `${R}/f`]);
  assert.deepEqual(texts(segments[1]), ['xargs', 'rm', '-rf']);
  assert.deepEqual(heads(segments), ['cat', 'xargs']);
});
