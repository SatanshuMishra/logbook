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

const text = readSkill('ledgerize');
const front = parseFrontmatter(text);
const body = skillBody(text);

test('ledgerize frontmatter names the skill and carries a description', () => {
  assert.equal(front.name, 'ledgerize');
  assert.ok(front.description && front.description.length > 0);
});

test('ledgerize allowed-tools is EXACTLY the five write-side ledger tools', () => {
  assert.deepEqual(allowedTools(front).sort(), [...TOOLS].sort());
});

test('ledgerize prose invokes each allowed tool it declares', () => {
  for (const tool of TOOLS) {
    assert.ok(body.includes(tool), `expected the prose to call ${tool}`);
  }
});

test('ledgerize refreshes the spine BEFORE it transitions', () => {
  assert.ok(
    body.indexOf('mcp__ledger__update_thread') < body.indexOf('mcp__ledger__transition_thread'),
    'the spine refresh must appear before the transition',
  );
});

test('ledgerize restates NO server-owned logic (thinness invariant)', () => {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!text.includes(forbidden), `thinness violation: contains "${forbidden}"`);
  }
});

test('ledgerize contains no emojis', () => {
  assert.equal(hasEmoji(text), false);
});
