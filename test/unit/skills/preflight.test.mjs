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
import reconcile from '../../../src/tools/reconcile.mjs';

const PLUGIN_PREFIX = 'mcp__plugin_logbook_ledger__';

const namespaced = (tool) => tool.replace('mcp__ledger__', PLUGIN_PREFIX);

const TOOLS = [
  'mcp__ledger__reconcile',
  'mcp__ledger__rebuild_index',
  'mcp__ledger__get_resume_brief',
  'mcp__ledger__read_decision',
];

const WRITE_OR_SESSION_TOOLS = [
  'mcp__ledger__append_session_event',
  'mcp__ledger__record_decision',
  'mcp__ledger__update_thread',
  'mcp__ledger__transition_thread',
];

const text = readSkill('preflight');
const front = parseFrontmatter(text);
const body = skillBody(text);

test('preflight frontmatter names the skill and carries a description', () => {
  assert.equal(front.name, 'preflight');
  assert.ok(front.description && front.description.length > 0);
});

test('preflight allowed-tools is EXACTLY both spellings of the four read-side ledger tools', () => {
  assert.deepEqual(allowedTools(front).sort(), [...TOOLS, ...TOOLS.map(namespaced)].sort());
});

test('preflight exposes no write or session-reading tool', () => {
  const tools = allowedTools(front);
  for (const forbidden of [...WRITE_OR_SESSION_TOOLS, ...WRITE_OR_SESSION_TOOLS.map(namespaced)]) {
    assert.equal(tools.includes(forbidden), false, `must not allow ${forbidden}`);
  }
});

test('preflight prose invokes each allowed tool it declares under both spellings', () => {
  for (const tool of TOOLS) {
    assert.ok(body.includes(tool), `expected the prose to call ${tool}`);
  }
  assert.ok(body.includes(PLUGIN_PREFIX), 'expected the prose to name the plugin-namespaced spelling');
});

test('preflight prints the server-rendered briefing then STOPS (present-then-stop invariant)', () => {
  const briefAt = body.indexOf('mcp__ledger__get_resume_brief');
  assert.ok(briefAt >= 0, 'the briefing must be rendered');
  const step = body.slice(briefAt, briefAt + 400);
  assert.match(step, /`briefing`/, 'the step must name the briefing field it prints');
  assert.match(step, /VERBATIM/, 'the step must demand a verbatim print');
  const stopAfterBrief = body.indexOf('STOP', briefAt);
  assert.ok(stopAfterBrief > briefAt, 'a STOP directive must follow printing the briefing');
});

test('preflight describes reconcile as the global call its schema declares', () => {
  assert.deepEqual(Object.keys(reconcile.inputSchema.properties), []);
  const line = body.split('\n').find((l) => l.includes('mcp__ledger__reconcile'));
  assert.ok(line, 'the prose must call reconcile');
  const prose = line.replace(/mcp__[a-z_]+/g, '');
  assert.equal(
    /thread/i.test(prose),
    false,
    'reconcile takes no arguments, so the prose must not scope it to a thread',
  );
});

test('preflight restates NO server-owned logic (thinness invariant)', () => {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!text.includes(forbidden), `thinness violation: contains "${forbidden}"`);
  }
});

test('preflight contains no emojis', () => {
  assert.equal(hasEmoji(text), false);
});
