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

const PLUGIN_PREFIX = 'mcp__plugin_logbook_ledger__';

const namespaced = (tool) => tool.replace('mcp__ledger__', PLUGIN_PREFIX);

const TOOLS = [
  'mcp__ledger__append_session_event',
  'mcp__ledger__record_decision',
  'mcp__ledger__amend_criteria',
  'mcp__ledger__update_thread',
  'mcp__ledger__transition_thread',
  'mcp__ledger__rebuild_index',
];

const text = readSkill('debrief');
const front = parseFrontmatter(text);
const body = skillBody(text);

test('debrief frontmatter names the skill and carries a description', () => {
  assert.equal(front.name, 'debrief');
  assert.ok(front.description && front.description.length > 0);
});

test('debrief allowed-tools is EXACTLY both spellings of the six write-side ledger tools', () => {
  assert.deepEqual(allowedTools(front).sort(), [...TOOLS, ...TOOLS.map(namespaced)].sort());
});

test('debrief prose invokes each allowed tool it declares under both spellings', () => {
  for (const tool of TOOLS) {
    assert.ok(body.includes(tool), `expected the prose to call ${tool}`);
  }
  assert.ok(body.includes(PLUGIN_PREFIX), 'expected the prose to name the plugin-namespaced spelling');
});

test('debrief refreshes the spine BEFORE it transitions', () => {
  assert.ok(
    body.indexOf('mcp__ledger__update_thread') < body.indexOf('mcp__ledger__transition_thread'),
    'the spine refresh must appear before the transition',
  );
});

test('debrief amends the criteria AFTER the decision record and BEFORE the spine refresh', () => {
  const amend = body.indexOf('mcp__ledger__amend_criteria');
  assert.ok(
    body.indexOf('mcp__ledger__record_decision') < amend,
    'a rewrite or strike needs its decision record to exist first',
  );
  assert.ok(
    amend < body.indexOf('mcp__ledger__update_thread'),
    'the criteria must be amended before the spine refresh resolves ids and scopes against them',
  );
});

test('the amendment step covers detours, rewrites, strikes and the decision they need', () => {
  const step = body.slice(
    body.indexOf('mcp__ledger__amend_criteria'),
    body.indexOf('mcp__ledger__update_thread'),
  );
  for (const token of ['detour', 'rewrite', 'strike', 'decision_ref']) {
    assert.ok(step.includes(token), `expected the amendment step to cover ${token}`);
  }
});

test('debrief restates NO server-owned logic (thinness invariant)', () => {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!text.includes(forbidden), `thinness violation: contains "${forbidden}"`);
  }
});

test('debrief contains no emojis', () => {
  assert.equal(hasEmoji(text), false);
});
