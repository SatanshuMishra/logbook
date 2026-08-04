import { LedgerError } from '../errors.mjs';

export const SPINE_CAPS = Object.freeze({
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

const SCALAR_CAPS = Object.freeze([
  ['active_goal', SPINE_CAPS.activeGoalMaxChars],
  ['next_step', SPINE_CAPS.nextStepMaxChars],
  ['last_session', SPINE_CAPS.lastSessionMaxChars],
]);

export class CapViolationError extends LedgerError {
  constructor(violations) {
    const problems = violations.map((violation) => ({
      code: 'cap_exceeded',
      field: violation.field,
      expected: violation.expected,
      retryable: false,
      remedy: violation.remedy,
    }));
    super({ layer: 'cap', ...problems[0], problems });
    this.name = 'CapViolationError';
    this.fields = Object.freeze([...new Set(problems.map((problem) => problem.field))]);
  }
}

function broke(condition, field, expected, remedy) {
  return condition ? [{ field, expected, remedy }] : [];
}

function scalarViolations(spine) {
  return SCALAR_CAPS.flatMap(([field, max]) => {
    const value = spine[field];
    const length = typeof value === 'string' ? value.length : 0;
    return broke(
      length > max,
      `spine.${field}`,
      `at most ${max} characters`,
      `spine.${field} is ${length} characters; shorten it to ${max} or fewer and re-send`,
    );
  });
}

function riskCountViolations(risks) {
  const perScope = new Map();
  for (const risk of risks) {
    const scope = risk && typeof risk.scope === 'string' ? risk.scope : 'unscoped';
    perScope.set(scope, (perScope.get(scope) ?? 0) + 1);
  }
  return [...perScope.entries()]
    .filter(([, count]) => count > SPINE_CAPS.openRisksMaxPerScope)
    .map(([scope, count]) => ({
      field: 'spine.open_risks',
      expected: `at most ${SPINE_CAPS.openRisksMaxPerScope} items per scope`,
      remedy: `scope ${scope} carries ${count} risks; retire risks in that scope until ${SPINE_CAPS.openRisksMaxPerScope} or fewer remain`,
    }));
}

function riskItemViolations(risks) {
  const items = risks.filter((risk) => risk && typeof risk === 'object');
  const refLists = items.map((risk) => risk.refs).filter(Array.isArray);
  return [
    ...broke(
      items.some((r) => typeof r.text === 'string' && r.text.length > SPINE_CAPS.riskTextMaxChars),
      'spine.open_risks[].text',
      `at most ${SPINE_CAPS.riskTextMaxChars} characters`,
      `at least one risk text is longer than ${SPINE_CAPS.riskTextMaxChars} characters; shorten it and re-send`,
    ),
    ...broke(
      refLists.some((refs) => refs.length > SPINE_CAPS.riskRefsMaxItems),
      'spine.open_risks[].refs',
      `at most ${SPINE_CAPS.riskRefsMaxItems} items`,
      `at least one risk carries more than ${SPINE_CAPS.riskRefsMaxItems} refs; drop the surplus and re-send`,
    ),
    ...broke(
      refLists.some((refs) => refs.some(
        (ref) => typeof ref === 'string' && ref.length > SPINE_CAPS.riskRefMaxChars,
      )),
      'spine.open_risks[].refs',
      `at most ${SPINE_CAPS.riskRefMaxChars} characters per ref`,
      `at least one risk ref is longer than ${SPINE_CAPS.riskRefMaxChars} characters; shorten it and re-send`,
    ),
  ];
}

function decisionViolations(decisions) {
  return broke(
    decisions.some((d) => d && typeof d === 'object' && typeof d.title === 'string'
      && d.title.length > SPINE_CAPS.decisionTitleMaxChars),
    'spine.key_decisions[].title',
    `at most ${SPINE_CAPS.decisionTitleMaxChars} characters`,
    `at least one decision title is longer than ${SPINE_CAPS.decisionTitleMaxChars} characters; shorten it and re-send`,
  );
}

function outOfScopeViolations(entries) {
  return [
    ...broke(
      entries.length > SPINE_CAPS.outOfScopeMaxItems,
      'spine.out_of_scope',
      `at most ${SPINE_CAPS.outOfScopeMaxItems} items`,
      `spine.out_of_scope carries ${entries.length} entries; drop the surplus and re-send`,
    ),
    ...broke(
      entries.some((e) => typeof e === 'string' && e.length > SPINE_CAPS.outOfScopeItemMaxChars),
      'spine.out_of_scope[]',
      `at most ${SPINE_CAPS.outOfScopeItemMaxChars} characters per entry`,
      `at least one out_of_scope entry is longer than ${SPINE_CAPS.outOfScopeItemMaxChars} characters; shorten it and re-send`,
    ),
  ];
}

function collectViolations(spine) {
  const risks = Array.isArray(spine.open_risks) ? spine.open_risks : [];
  return [
    ...scalarViolations(spine),
    ...riskCountViolations(risks),
    ...riskItemViolations(risks),
    ...decisionViolations(Array.isArray(spine.key_decisions) ? spine.key_decisions : []),
    ...outOfScopeViolations(Array.isArray(spine.out_of_scope) ? spine.out_of_scope : []),
  ];
}

export function assertSpineCaps(spine) {
  if (!spine || typeof spine !== 'object') {
    throw new CapViolationError([{
      field: 'spine',
      expected: 'an object carrying the spine fields',
      remedy: 'send spine as an object keyed by the spine field names and re-send',
    }]);
  }
  const violations = collectViolations(spine);
  if (violations.length > 0) {
    throw new CapViolationError(violations);
  }
  return spine;
}
