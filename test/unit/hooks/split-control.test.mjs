import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSegments } from '../../../hooks/lib/shell-tokens.mjs';
import { splitControl } from '../../../hooks/lib/pre-tool-use.mjs';

const R = '/data/-proj/ledger';

const words = (segment) => segment.filter((token) => token.kind === 'word');
const texts = (segment) => segment.map((token) => token.text);
const heads = (subSegments) => subSegments.map((segment) => words(segment)[0].text);
const split = (command) => splitControl(scanSegments(command)[0]);

test('a file-descriptor duplication after a redirect never splits the segment', () => {
  const subSegments = split(`ls -la ${R} 2>&1 | head -12`);
  assert.equal(subSegments.length, 1);
  assert.deepEqual(texts(subSegments[0]), ['ls', '-la', R, '2>', '&1']);
});

test('repeated file-descriptor duplications never split the segment', () => {
  const subSegments = split(`cat ${R}/f 1>&2 2>&1`);
  assert.equal(subSegments.length, 1);
  assert.deepEqual(texts(subSegments[0]), ['cat', `${R}/f`, '1>', '&2', '2>', '&1']);
});

test('a standalone ampersand splits a backgrounded command from its successor', () => {
  const subSegments = split(`true & rm -rf ${R}`);
  assert.equal(subSegments.length, 2);
  assert.deepEqual(heads(subSegments), ['true', 'rm']);
  assert.deepEqual(texts(subSegments[0]), ['true']);
  assert.deepEqual(texts(subSegments[1]), ['rm', '-rf', R]);
});

test('an ampersand glued inside a word still splits the segment', () => {
  const subSegments = split(`ls ${R}&rm -rf ${R}`);
  assert.equal(subSegments.length, 2);
  assert.deepEqual(heads(subSegments), ['ls', 'rm']);
  assert.deepEqual(texts(subSegments[0]), ['ls', R]);
  assert.deepEqual(texts(subSegments[1]), ['rm', '-rf', R]);
});

test('a spaced subshell group exposes the grouped command as its own sub-segment', () => {
  const subSegments = split(`( rm -rf ${R} )`);
  assert.equal(subSegments.length, 1);
  assert.deepEqual(heads(subSegments), ['rm']);
  assert.deepEqual(texts(subSegments[0]), ['rm', '-rf', R]);
});

test('a spaced brace group exposes the grouped command as its own sub-segment', () => {
  const subSegments = split(`{ rm -rf ${R}; }`);
  assert.equal(subSegments.length, 1);
  assert.deepEqual(heads(subSegments), ['rm']);
  assert.deepEqual(texts(subSegments[0]), ['rm', '-rf', R]);
});

test('a leading parenthesis glued to the command becomes a boundary', () => {
  const subSegments = split(`(rm -rf ${R})`);
  assert.equal(subSegments.length, 1);
  assert.deepEqual(heads(subSegments), ['rm']);
  assert.deepEqual(texts(subSegments[0]), ['rm', '-rf', `${R})`]);
});

test('a mid-token parenthesis never splits the segment', () => {
  const subSegments = split(`jq -r '.[] | select(.x)' ${R}/f`);
  assert.equal(subSegments.length, 1);
  assert.deepEqual(texts(subSegments[0]), ['jq', '-r', '.[] | select(.x)', `${R}/f`]);
});

test('a leading brace splits and keeps the remainder as a word', () => {
  const subSegments = split(`jq '{a:.b}' ${R}/f`);
  assert.equal(subSegments.length, 2);
  assert.deepEqual(texts(subSegments[0]), ['jq']);
  assert.equal(texts(subSegments[1])[0], 'a:.b}');
  assert.deepEqual(texts(subSegments[1]), ['a:.b}', `${R}/f`]);
});

test('process substitution splits into the outer command and each substituted command', () => {
  const subSegments = split(`diff <(cat ${R}/a) <(cat ${R}/b)`);
  assert.equal(subSegments.length, 3);
  assert.deepEqual(heads(subSegments), ['diff', 'cat', 'cat']);
  assert.deepEqual(texts(subSegments[0]), ['diff', '<']);
  assert.deepEqual(texts(subSegments[1]), ['cat', `${R}/a)`, '<']);
  assert.deepEqual(texts(subSegments[2]), ['cat', `${R}/b)`]);
});

test('split parts inherit the unresolvable flag of the token they came from', () => {
  const subSegments = split('ls "$D&rm" -rf');
  assert.equal(subSegments.length, 2);
  assert.deepEqual(subSegments[0][1], { kind: 'word', text: '$D', unresolvable: true });
  assert.deepEqual(subSegments[1][0], { kind: 'word', text: 'rm', unresolvable: true });
});

test('splitControl leaves the tokenizer output untouched', () => {
  const segment = scanSegments(`( ls ${R} & rm -rf ${R} )`)[0];
  const before = texts(segment);
  splitControl(segment);
  assert.deepEqual(texts(segment), before);
});
