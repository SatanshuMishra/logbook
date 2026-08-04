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

export class CapViolationError extends Error {
  constructor(message, fields) {
    super(message);
    this.name = 'CapViolationError';
    this.fields = Object.freeze(Array.isArray(fields) ? [...fields] : [fields]);
    this.field = this.fields[0];
  }
}

function broke(condition, field, detail) {
  return condition ? [{ field, detail }] : [];
}

function scalarViolations(spine) {
  return SCALAR_CAPS.flatMap(([field, max]) => broke(
    typeof spine[field] === 'string' && spine[field].length > max,
    field,
    `spine.${field} exceeds ${max} chars`,
  ));
}

function riskCountViolations(risks) {
  const perScope = new Map();
  for (const risk of risks) {
    const scope = risk && typeof risk.scope === 'string' ? risk.scope : 'unscoped';
    perScope.set(scope, (perScope.get(scope) ?? 0) + 1);
  }
  return [...perScope.entries()]
    .filter(([, count]) => count > SPINE_CAPS.openRisksMaxPerScope)
    .map(([scope]) => ({
      field: 'open_risks',
      detail: `spine.open_risks exceeds ${SPINE_CAPS.openRisksMaxPerScope} items for scope ${scope}`,
    }));
}

function riskItemViolations(risks) {
  const items = risks.filter((risk) => risk && typeof risk === 'object');
  const refLists = items.map((risk) => risk.refs).filter(Array.isArray);
  return [
    ...broke(
      items.some((r) => typeof r.text === 'string' && r.text.length > SPINE_CAPS.riskTextMaxChars),
      'open_risks[].text',
      `spine.open_risks item text exceeds ${SPINE_CAPS.riskTextMaxChars} chars`,
    ),
    ...broke(
      refLists.some((refs) => refs.length > SPINE_CAPS.riskRefsMaxItems),
      'open_risks[].refs',
      `spine.open_risks[].refs exceeds ${SPINE_CAPS.riskRefsMaxItems} items`,
    ),
    ...broke(
      refLists.some((refs) => refs.some(
        (ref) => typeof ref === 'string' && ref.length > SPINE_CAPS.riskRefMaxChars,
      )),
      'open_risks[].refs',
      `spine.open_risks[].refs item exceeds ${SPINE_CAPS.riskRefMaxChars} chars`,
    ),
  ];
}

function decisionViolations(decisions) {
  return broke(
    decisions.some((d) => d && typeof d === 'object' && typeof d.title === 'string'
      && d.title.length > SPINE_CAPS.decisionTitleMaxChars),
    'key_decisions[].title',
    `spine.key_decisions item title exceeds ${SPINE_CAPS.decisionTitleMaxChars} chars`,
  );
}

function outOfScopeViolations(entries) {
  return [
    ...broke(
      entries.length > SPINE_CAPS.outOfScopeMaxItems,
      'out_of_scope',
      `spine.out_of_scope exceeds ${SPINE_CAPS.outOfScopeMaxItems} items`,
    ),
    ...broke(
      entries.some((e) => typeof e === 'string' && e.length > SPINE_CAPS.outOfScopeItemMaxChars),
      'out_of_scope[]',
      `spine.out_of_scope item exceeds ${SPINE_CAPS.outOfScopeItemMaxChars} chars`,
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
    throw new CapViolationError('assertSpineCaps: spine must be an object', 'spine');
  }
  const violations = collectViolations(spine);
  if (violations.length > 0) {
    throw new CapViolationError(
      violations.map((v) => v.detail).join('; '),
      [...new Set(violations.map((v) => v.field))],
    );
  }
  return spine;
}
