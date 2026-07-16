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

const text = readSkill('resume-project');
const front = parseFrontmatter(text);
const body = skillBody(text);

test('resume-project frontmatter names the skill and carries a description', () => {
  assert.equal(front.name, 'resume-project');
  assert.ok(front.description && front.description.length > 0);
});

test('resume-project allowed-tools is EXACTLY the three read-side ledger tools', () => {
  assert.deepEqual(allowedTools(front).sort(), [...TOOLS].sort());
});

test('resume-project exposes no write or session-reading tool', () => {
  const tools = allowedTools(front);
  for (const forbidden of WRITE_OR_SESSION_TOOLS) {
    assert.equal(tools.includes(forbidden), false, `must not allow ${forbidden}`);
  }
});

test('resume-project prose invokes each allowed tool it declares', () => {
  for (const tool of TOOLS) {
    assert.ok(body.includes(tool), `expected the prose to call ${tool}`);
  }
});

test('resume-project renders the brief then STOPS (present-then-stop invariant)', () => {
  const briefAt = body.indexOf('mcp__ledger__get_resume_brief');
  assert.ok(briefAt >= 0, 'the brief must be rendered');
  const stopAfterBrief = body.indexOf('STOP', briefAt);
  assert.ok(stopAfterBrief > briefAt, 'a STOP directive must follow rendering the brief');
});

test('resume-project restates NO server-owned logic (thinness invariant)', () => {
  for (const forbidden of FORBIDDEN_SUBSTRINGS) {
    assert.ok(!text.includes(forbidden), `thinness violation: contains "${forbidden}"`);
  }
});

test('resume-project contains no emojis', () => {
  assert.equal(hasEmoji(text), false);
});
