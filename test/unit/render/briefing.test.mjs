import test from 'node:test';
import assert from 'node:assert/strict';
import { renderBriefing } from '../../../src/render/briefing.mjs';
import { upcastThread } from '../../../src/schema/upcast.mjs';

const NOT_SHOWN_FOOTER = 'Ask for any decision by number: read_decision.';

function criterion(id, text, overrides = {}) {
  return { id, text, done: false, kind: 'planned', struck_by: null, ...overrides };
}

function makeThread(overrides = {}) {
  const base = {
    schema_version: 2,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    slug: 'widget',
    title: 'Widget',
    status: 'paused',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [criterion('c1', 'ship the widget')],
    vcs_ref: null,
    external_refs: [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      active_goal: '',
      next_step: '',
      last_session: '',
      open_risks: [],
      key_decisions: [],
      out_of_scope: [],
    },
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-15T10:00:00Z',
  };
  return {
    ...base,
    ...overrides,
    spine: { ...base.spine, ...(overrides.spine ?? {}) },
  };
}

test('renderBriefing renders every section in contract order for a normal thread', () => {
  const rendered = renderBriefing({
    thread: makeThread({
      completion_criteria: [
        criterion('c1', 'set up the harness', { done: true }),
        criterion('c2', 'wire the adapter'),
        criterion('c3', 'ship it'),
      ],
      spine: {
        active_goal: 'ship the widget end to end',
        next_step: 'add the failing integration test',
        last_session: 'wired the adapter and left the test red',
        open_risks: [
          {
            text: 'rerun the widget suite before pushing — ci is flaky on that path',
            scope: 'c2',
            refs: ['test/e2e/widget.test.mjs'],
          },
          { text: 'never edit the vendored sdk — upgrades are managed upstream', scope: 'thread', refs: [] },
          { text: 'the harness needs a seed — it was fixed in the first step', scope: 'c1', refs: [] },
        ],
        key_decisions: [
          { ref: '0018-use-widget', title: 'Use the widget', scope: 'c2' },
          { ref: '0007-pick-harness', title: 'Pick the harness', scope: 'c1' },
          { ref: '0003-ancient', title: 'Ancient', scope: 'legacy' },
        ],
        out_of_scope: ['widget documentation'],
      },
    }),
    drift: [],
    children: [{ slug: 'widget-leaf', status: 'active' }],
    predecessor: { slug: 'widget-v1' },
  });

  assert.equal(rendered, [
    '# PREFLIGHT BRIEFING — Widget',
    'paused · 1 of 3 done · 0 detour(s) open · last worked 2026-07-15',
    '',
    '## WHY',
    'ship the widget end to end',
    '',
    '## PROGRESS',
    '- [x] c1 — set up the harness',
    '- [>] c2 — wire the adapter',
    '- [ ] c3 — ship it',
    '',
    '## LAST SESSION',
    'wired the adapter and left the test red',
    '',
    '## NEXT STEP',
    'add the failing integration test',
    '',
    '## WATCH OUT FOR',
    '- rerun the widget suite before pushing — ci is flaky on that path',
    '  refs: test/e2e/widget.test.mjs',
    '',
    'Standing:',
    '- never edit the vendored sdk — upgrades are managed upstream',
    '',
    '## DECIDED ON THIS STEP',
    '- 0018 — Use the widget',
    '',
    '## NOT IN SCOPE',
    '- widget documentation',
    '',
    '## RELATED',
    '- child: widget-leaf (active)',
    '- succeeds: widget-v1',
    '',
    '## NOT SHOWN',
    '1 risk(s) and 1 decision(s) from other steps; 1 legacy decision(s).',
    NOT_SHOWN_FOOTER,
  ].join('\n'));
});

test('renderBriefing replaces the header fraction when the thread is ready to close', () => {
  const rendered = renderBriefing({
    thread: makeThread({
      completion_criteria: [
        criterion('c1', 'set up the harness', { done: true }),
        criterion('c2', 'wire the adapter', { done: true }),
      ],
      spine: { active_goal: 'close it out', next_step: 'run the close checklist' },
    }),
  });

  assert.equal(rendered, [
    '# PREFLIGHT BRIEFING — Widget',
    'paused · 2 of 2 done — ready to close · 0 detour(s) open · last worked 2026-07-15',
    '',
    '## WHY',
    'close it out',
    '',
    '## PROGRESS',
    '- [x] c1 — set up the harness',
    '- [x] c2 — wire the adapter',
    '',
    '## NEXT STEP',
    'run the close checklist',
    '',
    '## NOT SHOWN',
    '0 risk(s) and 0 decision(s) from other steps; 0 legacy decision(s).',
    NOT_SHOWN_FOOTER,
  ].join('\n'));
});

test('an open detour is current, carries the detour suffix and leaves the fraction alone', () => {
  const rendered = renderBriefing({
    thread: makeThread({
      completion_criteria: [
        criterion('c4', 'patch the seed', { kind: 'detour', done: true }),
        criterion('c1', 'set up the harness', { done: true }),
        criterion('c5', 'fix the flaky fixture', { kind: 'detour' }),
        criterion('c2', 'wire the adapter'),
        criterion('c3', 'ship it'),
      ],
      spine: { active_goal: 'ship the widget', next_step: 'stabilise the fixture' },
    }),
  });

  assert.equal(rendered, [
    '# PREFLIGHT BRIEFING — Widget',
    'paused · 1 of 3 done · 1 detour(s) open · last worked 2026-07-15',
    '',
    '## WHY',
    'ship the widget',
    '',
    '## PROGRESS',
    '- [x] c4 — patch the seed (detour)',
    '- [x] c1 — set up the harness',
    '- [>] c5 — fix the flaky fixture (detour)',
    '- [ ] c2 — wire the adapter',
    '- [ ] c3 — ship it',
    '',
    '## NEXT STEP',
    'stabilise the fixture',
    '',
    '## NOT SHOWN',
    '0 risk(s) and 0 decision(s) from other steps; 0 legacy decision(s).',
    NOT_SHOWN_FOOTER,
  ].join('\n'));
});

test('an open detour that is not current renders the open-detour glyph', () => {
  const rendered = renderBriefing({
    thread: makeThread({
      completion_criteria: [
        criterion('c1', 'wire the adapter'),
        criterion('c2', 'fix the flaky fixture', { kind: 'detour' }),
      ],
    }),
  });
  assert.ok(rendered.includes('- [>] c1 — wire the adapter'));
  assert.ok(rendered.includes('- [!] c2 — fix the flaky fixture (detour)'));
});

test('a struck criterion is retained, marked and attributed to its decision', () => {
  const rendered = renderBriefing({
    thread: makeThread({
      completion_criteria: [
        criterion('c1', 'set up the harness', { done: true }),
        criterion('c2', 'wire the adapter', { struck_by: '0021-drop-the-step' }),
        criterion('c3', 'ship it'),
      ],
      spine: { active_goal: 'ship the widget', next_step: 'ship it' },
    }),
  });

  assert.equal(rendered, [
    '# PREFLIGHT BRIEFING — Widget',
    'paused · 1 of 2 done · 0 detour(s) open · last worked 2026-07-15',
    '',
    '## WHY',
    'ship the widget',
    '',
    '## PROGRESS',
    '- [x] c1 — set up the harness',
    '- [~] c2 — wire the adapter (struck — decision 0021)',
    '- [>] c3 — ship it',
    '',
    '## NEXT STEP',
    'ship it',
    '',
    '## NOT SHOWN',
    '0 risk(s) and 0 decision(s) from other steps; 0 legacy decision(s).',
    NOT_SHOWN_FOOTER,
  ].join('\n'));
});

test('drift renders SINCE YOU LEFT with one line per signal', () => {
  const rendered = renderBriefing({
    thread: makeThread({ spine: { active_goal: 'ship the widget', next_step: 'read the drift' } }),
    drift: [
      {
        binding_id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
        thread_id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        repo: '/repo',
        branch: 'feat/widget',
        classification: 'CRITICAL',
        signals: [
          { code: 'force-push', classification: 'CRITICAL', detail: 'non-fast-forward rewrite' },
          { code: 'head-missing', classification: 'CRITICAL', detail: null },
        ],
      },
    ],
  });

  assert.ok(rendered.includes([
    '## SINCE YOU LEFT',
    '- CRITICAL feat/widget — force-push: non-fast-forward rewrite',
    '- CRITICAL feat/widget — head-missing',
  ].join('\n')));
  assert.ok(rendered.indexOf('## SINCE YOU LEFT') < rendered.indexOf('## PROGRESS'));
});

test('every conditional section is omitted rather than rendered empty', () => {
  const rendered = renderBriefing({ thread: makeThread({ status: 'active' }) });

  assert.equal(rendered, [
    '# PREFLIGHT BRIEFING — Widget',
    'active · 0 of 1 done · 0 detour(s) open · last worked 2026-07-15',
    '',
    '## WHY',
    '',
    '',
    '## PROGRESS',
    '- [>] c1 — ship the widget',
    '',
    '## NEXT STEP',
    '',
    '',
    '## NOT SHOWN',
    '0 risk(s) and 0 decision(s) from other steps; 0 legacy decision(s).',
    NOT_SHOWN_FOOTER,
  ].join('\n'));
  for (const heading of [
    '## SINCE YOU LEFT', '## LAST SESSION', '## WATCH OUT FOR',
    '## DECIDED ON THIS STEP', '## NOT IN SCOPE', '## RELATED',
  ]) {
    assert.equal(rendered.includes(heading), false, `${heading} must be omitted, not empty`);
  }
});

test('a v1-upcast thread truncates its over-cap active_goal and hides its legacy decisions', () => {
  const goal = `${'g'.repeat(280)}!`;
  const thread = upcastThread({
    schema_version: 1,
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    slug: 'legacy-thread',
    title: 'Legacy Thread',
    status: 'paused',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: [{ text: 'first', done: true }, { text: 'second', done: false }],
    vcs_ref: null,
    external_refs: [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      status: 'active',
      active_goal: goal,
      next_step: 'keep going',
      open_risks: ['a legacy risk with no shape at all'],
      key_decisions: ['0003-old-choice', '0004-older-choice'],
      out_of_scope: ['docs'],
    },
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-15T10:00:00Z',
  });

  const rendered = renderBriefing({ thread });

  assert.equal(rendered, [
    '# PREFLIGHT BRIEFING — Legacy Thread',
    'paused · 1 of 2 done · 0 detour(s) open · last worked 2026-07-15',
    '',
    '## WHY',
    `${goal.slice(0, 199)}…`,
    '',
    '## PROGRESS',
    '- [x] c1 — first',
    '- [>] c2 — second',
    '',
    '## NEXT STEP',
    'keep going',
    '',
    '## WATCH OUT FOR',
    'Standing:',
    '- a legacy risk with no shape at all',
    '',
    '## NOT IN SCOPE',
    '- docs',
    '',
    '## NOT SHOWN',
    '0 risk(s) and 0 decision(s) from other steps; 2 legacy decision(s).',
    NOT_SHOWN_FOOTER,
  ].join('\n'));
  assert.equal(rendered.includes(goal), false);
});

test('RELATED lists a child alone', () => {
  const rendered = renderBriefing({
    thread: makeThread(),
    children: [{ slug: 'widget-leaf', status: 'active' }],
  });
  assert.ok(rendered.includes('## RELATED\n- child: widget-leaf (active)\n\n## NOT SHOWN'));
});

test('RELATED lists a predecessor alone', () => {
  const rendered = renderBriefing({
    thread: makeThread(),
    predecessor: { slug: 'widget-v1' },
  });
  assert.ok(rendered.includes('## RELATED\n- succeeds: widget-v1\n\n## NOT SHOWN'));
});

test('RELATED lists every child and then the predecessor', () => {
  const rendered = renderBriefing({
    thread: makeThread(),
    children: [{ slug: 'widget-leaf', status: 'active' }, { slug: 'widget-twig', status: 'done' }],
    predecessor: { slug: 'widget-v1' },
  });
  assert.ok(rendered.includes([
    '## RELATED',
    '- child: widget-leaf (active)',
    '- child: widget-twig (done)',
    '- succeeds: widget-v1',
  ].join('\n')));
});

test('an aged thread briefs at the same size as a young one with the same current step', () => {
  const criteria = [
    criterion('c1', 'set up the harness', { done: true }),
    criterion('c2', 'wire the adapter'),
  ];
  const currentStep = {
    active_goal: 'ship the widget end to end',
    next_step: 'add the failing integration test',
    open_risks: [{ text: 'rerun the widget suite — ci is flaky on that path', scope: 'c2', refs: [] }],
    key_decisions: [{ ref: '0071-use-widget', title: 'Use the widget', scope: 'c2' }],
    out_of_scope: ['widget documentation'],
  };
  const history = {
    open_risks: Array.from({ length: 40 }, (_, i) => ({
      text: `an aged risk number ${i} — it belongs to a step that is already done`,
      scope: 'c1',
      refs: [],
    })),
    key_decisions: Array.from({ length: 70 }, (_, i) => ({
      ref: `${String(i).padStart(4, '0')}-aged-choice`,
      title: `An aged choice number ${i} that nobody needs on this step`,
      scope: i % 2 === 0 ? 'c1' : 'legacy',
    })),
  };

  const young = renderBriefing({ thread: makeThread({ completion_criteria: criteria, spine: currentStep }) });
  const aged = renderBriefing({
    thread: makeThread({
      completion_criteria: criteria,
      spine: {
        ...currentStep,
        open_risks: [...history.open_risks, ...currentStep.open_risks],
        key_decisions: [...history.key_decisions, ...currentStep.key_decisions],
      },
    }),
  });

  const above = (text) => text.slice(0, text.indexOf('## NOT SHOWN'));
  assert.equal(above(aged), above(young));
  assert.ok(young.includes('0 risk(s) and 0 decision(s) from other steps; 0 legacy decision(s).'));
  assert.ok(aged.includes('40 risk(s) and 35 decision(s) from other steps; 35 legacy decision(s).'));
  assert.ok(aged.length - young.length < 20, `aged briefing grew by ${aged.length - young.length} chars`);
});

test('renderBriefing refuses a payload carrying no thread record', () => {
  assert.throws(() => renderBriefing({}), /brief\.thread must be a thread record/);
  assert.throws(() => renderBriefing(null), /brief must be an object/);
});
