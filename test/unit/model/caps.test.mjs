import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPINE_CAPS,
  CapViolationError,
  assertSpineCaps,
} from '../../../src/model/caps.mjs';

function spine(overrides) {
  return {
    active_goal: 'g',
    next_step: 'n',
    last_session: 's',
    open_risks: [],
    key_decisions: [],
    out_of_scope: [],
    ...overrides,
  };
}

function risk(overrides = {}) {
  return { text: 'hold the lock — the writer is not reentrant', scope: 'c1', refs: [], ...overrides };
}

function decision(overrides = {}) {
  return { ref: '0001-adopt-x', title: 'Adopt X', scope: 'c1', ...overrides };
}

function risks(count, scope) {
  return Array.from({ length: count }, (_, i) => risk({ text: `risk ${i} — why ${i}`, scope }));
}

test('SPINE_CAPS carries a cap per field and is frozen', () => {
  assert.deepEqual(SPINE_CAPS, {
    activeGoalMaxChars: 200,
    nextStepMaxChars: 500,
    lastSessionMaxChars: 300,
    openRisksMaxPerScope: 20,
    riskTextMaxChars: 300,
    riskRefsMaxItems: 8,
    riskRefMaxChars: 200,
    decisionTitleMaxChars: 120,
    outOfScopeMaxItems: 20,
    outOfScopeItemMaxChars: 300,
  });
  assert.ok(Object.isFrozen(SPINE_CAPS));
});

test('a within-caps spine is returned unchanged', () => {
  const s = spine({ open_risks: [risk()], key_decisions: [decision()], out_of_scope: ['later'] });
  assert.equal(assertSpineCaps(s), s);
});

test('active_goal is capped at 200 chars, not the old 500', () => {
  const s = spine({ active_goal: 'a'.repeat(200) });
  assert.equal(assertSpineCaps(s), s);
  assert.throws(
    () => assertSpineCaps(spine({ active_goal: 'a'.repeat(201) })),
    (err) => {
      assert.ok(err instanceof CapViolationError);
      assert.equal(err.name, 'CapViolationError');
      assert.equal(err.field, 'spine.active_goal');
      assert.equal(err.expected, 'at most 200 characters');
      assert.equal(err.retryable, false);
      return true;
    },
  );
});

test('next_step is capped at 500 chars', () => {
  const s = spine({ next_step: 'a'.repeat(500) });
  assert.equal(assertSpineCaps(s), s);
  assert.throws(() => assertSpineCaps(spine({ next_step: 'a'.repeat(501) })), /next_step/);
});

test('last_session is capped at 300 chars', () => {
  const s = spine({ last_session: 'a'.repeat(300) });
  assert.equal(assertSpineCaps(s), s);
  assert.throws(() => assertSpineCaps(spine({ last_session: 'a'.repeat(301) })), /last_session/);
});

test('open_risks are counted per scope group, not per thread', () => {
  const s = spine({ open_risks: [...risks(20, 'c1'), ...risks(20, 'c2'), ...risks(20, 'thread')] });
  assert.equal(assertSpineCaps(s), s);
});

test('a single scope group over 20 risks throws, naming the scope', () => {
  assert.throws(
    () => assertSpineCaps(spine({ open_risks: [...risks(21, 'c2'), ...risks(3, 'thread')] })),
    (err) => {
      assert.ok(err instanceof CapViolationError);
      assert.equal(err.field, 'spine.open_risks');
      assert.match(err.message, /c2/);
      return true;
    },
  );
});

test('a risk text over 300 chars throws', () => {
  assert.throws(
    () => assertSpineCaps(spine({ open_risks: [risk({ text: 'a'.repeat(301) })] })),
    (err) => {
      assert.equal(err.field, 'spine.open_risks[].text');
      return true;
    },
  );
});

test('risk refs are capped at 8 items of 200 chars each', () => {
  const eight = Array.from({ length: 8 }, (_, i) => `src/f${i}.mjs`);
  const s = spine({ open_risks: [risk({ refs: eight })] });
  assert.equal(assertSpineCaps(s), s);
  assert.throws(
    () => assertSpineCaps(spine({ open_risks: [risk({ refs: [...eight, 'src/f8.mjs'] })] })),
    /open_risks\[\]\.refs/,
  );
  assert.throws(
    () => assertSpineCaps(spine({ open_risks: [risk({ refs: ['a'.repeat(201)] })] })),
    /open_risks\[\]\.refs/,
  );
});

test('a decision title over 120 chars throws while key_decisions stays count-exempt', () => {
  const many = Array.from({ length: 21 }, (_, i) => decision({ ref: `${String(i + 1).padStart(4, '0')}-d` }));
  const s = spine({ key_decisions: many });
  assert.equal(assertSpineCaps(s), s);
  assert.throws(
    () => assertSpineCaps(spine({ key_decisions: [decision({ title: 'a'.repeat(121) })] })),
    (err) => {
      assert.equal(err.field, 'spine.key_decisions[].title');
      return true;
    },
  );
});

test('out_of_scope keeps a thread-wide count cap of 20 and a 300-char item cap', () => {
  const twenty = Array.from({ length: 20 }, (_, i) => `entry ${i}`);
  const s = spine({ out_of_scope: twenty });
  assert.equal(assertSpineCaps(s), s);
  assert.throws(
    () => assertSpineCaps(spine({ out_of_scope: [...twenty, 'one more'] })),
    (err) => {
      assert.equal(err.field, 'spine.out_of_scope');
      return true;
    },
  );
  assert.throws(
    () => assertSpineCaps(spine({ out_of_scope: ['a'.repeat(301)] })),
    (err) => {
      assert.equal(err.field, 'spine.out_of_scope[]');
      return true;
    },
  );
});

test('a non-object spine throws CapViolationError', () => {
  assert.throws(() => assertSpineCaps(null), CapViolationError);
  assert.throws(() => assertSpineCaps('nope'), CapViolationError);
});

test('every violation is reported in one error naming each field and the cap it broke', () => {
  const s = spine({
    active_goal: 'a'.repeat(201),
    next_step: 'b'.repeat(501),
    last_session: 'c'.repeat(301),
    open_risks: risks(21, 'c1'),
    key_decisions: [decision({ title: 'd'.repeat(121) })],
    out_of_scope: Array.from({ length: 21 }, (_, i) => `entry ${i}`),
  });
  assert.throws(
    () => assertSpineCaps(s),
    (err) => {
      assert.ok(err instanceof CapViolationError);
      assert.deepEqual(err.problems.map((p) => [p.field, p.expected]), [
        ['spine.active_goal', 'at most 200 characters'],
        ['spine.next_step', 'at most 500 characters'],
        ['spine.last_session', 'at most 300 characters'],
        ['spine.open_risks', 'at most 20 items per scope'],
        ['spine.key_decisions[].title', 'at most 120 characters'],
        ['spine.out_of_scope', 'at most 20 items'],
      ]);
      assert.deepEqual([...err.fields], [
        'spine.active_goal',
        'spine.next_step',
        'spine.last_session',
        'spine.open_risks',
        'spine.key_decisions[].title',
        'spine.out_of_scope',
      ]);
      assert.equal(err.field, 'spine.active_goal');
      assert.match(err.message, /^problems: 6 /m);
      return true;
    },
  );
});

test('each over-cap risk scope group is named, not just the first', () => {
  assert.throws(
    () => assertSpineCaps(spine({ open_risks: [...risks(21, 'c1'), ...risks(21, 'thread')] })),
    (err) => {
      assert.deepEqual(err.problems.map((p) => p.field), ['spine.open_risks', 'spine.open_risks']);
      assert.match(err.problems[0].remedy, /scope c1 carries 21 risks/);
      assert.match(err.problems[1].remedy, /scope thread carries 21 risks/);
      assert.deepEqual([...err.fields], ['spine.open_risks']);
      return true;
    },
  );
});

test('a field violating two caps at once is named once in fields', () => {
  const refs = Array.from({ length: 9 }, () => 'a'.repeat(201));
  assert.throws(
    () => assertSpineCaps(spine({ open_risks: [risk({ refs })] })),
    (err) => {
      assert.deepEqual(err.problems.map((p) => p.expected), [
        'at most 8 items',
        'at most 200 characters per ref',
      ]);
      assert.deepEqual([...err.fields], ['spine.open_risks[].refs']);
      return true;
    },
  );
});

test('a repeated per-item violation is reported once, not once per item', () => {
  const over = Array.from({ length: 3 }, (_, i) => risk({ text: `${'a'.repeat(301)} — why ${i}` }));
  assert.throws(
    () => assertSpineCaps(spine({ open_risks: over })),
    (err) => {
      assert.equal(err.problems.length, 1);
      assert.equal(err.field, 'spine.open_risks[].text');
      assert.equal(err.expected, `at most ${SPINE_CAPS.riskTextMaxChars} characters`);
      return true;
    },
  );
});
