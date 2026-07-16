import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readSkill,
  parseFrontmatter,
  allowedTools,
  skillBody,
  hasEmoji,
  FORBIDDEN_SUBSTRINGS,
} from './skill-invariants.mjs';

const TOOLS = [
  'mcp__ledger__append_session_event',
  'mcp__ledger__record_decision',
  'mcp__ledger__update_thread',
  'mcp__ledger__transition_thread',
  'mcp__ledger__rebuild_index',
];

const text = readSkill('session-handoff');
const front = parseFrontmatter(text);
const body = skillBody(text);

test('session-handoff frontmatter names the skill and carries a description', () => {
  assert.equal(front.name, 'session-handoff');
  assert.ok(front.description && front.description.length > 0);
});

test('session-handoff allowed-tools is EXACTLY the five write-side ledger tools', () => {
  assert.deepEqual(allowedTools(front).sort(), [...TOOLS].sort());
});

test('session-handoff prose invokes each allowed tool it declares', () => {
  for (const tool of TOOLS) {
    assert.ok(body.includes(tool), `expected the prose to call ${tool}`);
  }
});

test('session-handoff refreshes the spine BEFORE it transitions', () => {
  assert.ok(
    body.indexOf('mcp__ledger__update_thread') < body.indexOf('mcp__ledger__transition_thread'),
    'the spine refresh must appear before the transition',
  );
});

test('session-handoff restates NO server-owned logic (thinness invariant)', () => {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!text.includes(forbidden), `thinness violation: contains "${forbidden}"`);
  }
});

test('session-handoff contains no emojis', () => {
  assert.equal(hasEmoji(text), false);
});
