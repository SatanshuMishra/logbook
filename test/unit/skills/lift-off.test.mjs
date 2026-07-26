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

const PLUGIN_PREFIX = 'mcp__plugin_session-continuity_ledger__';

const namespaced = (tool) => tool.replace('mcp__ledger__', PLUGIN_PREFIX);

const TOOLS = [
  'mcp__ledger__reconcile',
  'mcp__ledger__rebuild_index',
  'mcp__ledger__get_resume_brief',
];

const WRITE_OR_SESSION_TOOLS = [
  'mcp__ledger__append_session_event',
  'mcp__ledger__record_decision',
  'mcp__ledger__update_thread',
  'mcp__ledger__transition_thread',
];

const text = readSkill('lift-off');
const front = parseFrontmatter(text);
const body = skillBody(text);

test('lift-off frontmatter names the skill and carries a description', () => {
  assert.equal(front.name, 'lift-off');
  assert.ok(front.description && front.description.length > 0);
});

test('lift-off allowed-tools is EXACTLY both spellings of the three read-side ledger tools', () => {
  assert.deepEqual(allowedTools(front).sort(), [...TOOLS, ...TOOLS.map(namespaced)].sort());
});

test('lift-off exposes no write or session-reading tool', () => {
  const tools = allowedTools(front);
  for (const forbidden of [...WRITE_OR_SESSION_TOOLS, ...WRITE_OR_SESSION_TOOLS.map(namespaced)]) {
    assert.equal(tools.includes(forbidden), false, `must not allow ${forbidden}`);
  }
});

test('lift-off prose invokes each allowed tool it declares under both spellings', () => {
  for (const tool of TOOLS) {
    assert.ok(body.includes(tool), `expected the prose to call ${tool}`);
  }
  assert.ok(body.includes(PLUGIN_PREFIX), 'expected the prose to name the plugin-namespaced spelling');
});

test('lift-off renders the brief then STOPS (present-then-stop invariant)', () => {
  const briefAt = body.indexOf('mcp__ledger__get_resume_brief');
  assert.ok(briefAt >= 0, 'the brief must be rendered');
  const stopAfterBrief = body.indexOf('STOP', briefAt);
  assert.ok(stopAfterBrief > briefAt, 'a STOP directive must follow rendering the brief');
});

test('lift-off restates NO server-owned logic (thinness invariant)', () => {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!text.includes(forbidden), `thinness violation: contains "${forbidden}"`);
  }
});

test('lift-off contains no emojis', () => {
  assert.equal(hasEmoji(text), false);
});
