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
  constructor(message, field) {
    super(message);
    this.name = 'CapViolationError';
    this.field = field;
  }
}

function assertScalars(spine) {
  for (const [field, max] of SCALAR_CAPS) {
    const value = spine[field];
    if (typeof value === 'string' && value.length > max) {
      throw new CapViolationError(`spine.${field} exceeds ${max} chars`, field);
    }
  }
}

function assertRiskCounts(risks) {
  const perScope = new Map();
  for (const risk of risks) {
    const scope = risk && typeof risk.scope === 'string' ? risk.scope : 'unscoped';
    const next = (perScope.get(scope) ?? 0) + 1;
    if (next > SPINE_CAPS.openRisksMaxPerScope) {
      throw new CapViolationError(
        `spine.open_risks exceeds ${SPINE_CAPS.openRisksMaxPerScope} items for scope ${scope}`,
        'open_risks',
      );
    }
    perScope.set(scope, next);
  }
}

function assertRiskItems(risks) {
  for (const risk of risks) {
    if (!risk || typeof risk !== 'object') continue;
    if (typeof risk.text === 'string' && risk.text.length > SPINE_CAPS.riskTextMaxChars) {
      throw new CapViolationError(
        `spine.open_risks item text exceeds ${SPINE_CAPS.riskTextMaxChars} chars`,
        'open_risks[].text',
      );
    }
    if (!Array.isArray(risk.refs)) continue;
    if (risk.refs.length > SPINE_CAPS.riskRefsMaxItems) {
      throw new CapViolationError(
        `spine.open_risks[].refs exceeds ${SPINE_CAPS.riskRefsMaxItems} items`,
        'open_risks[].refs',
      );
    }
    for (const ref of risk.refs) {
      if (typeof ref === 'string' && ref.length > SPINE_CAPS.riskRefMaxChars) {
        throw new CapViolationError(
          `spine.open_risks[].refs item exceeds ${SPINE_CAPS.riskRefMaxChars} chars`,
          'open_risks[].refs',
        );
      }
    }
  }
}

function assertDecisions(decisions) {
  for (const decision of decisions) {
    if (!decision || typeof decision !== 'object') continue;
    if (typeof decision.title === 'string' && decision.title.length > SPINE_CAPS.decisionTitleMaxChars) {
      throw new CapViolationError(
        `spine.key_decisions item title exceeds ${SPINE_CAPS.decisionTitleMaxChars} chars`,
        'key_decisions[].title',
      );
    }
  }
}

function assertOutOfScope(entries) {
  if (entries.length > SPINE_CAPS.outOfScopeMaxItems) {
    throw new CapViolationError(
      `spine.out_of_scope exceeds ${SPINE_CAPS.outOfScopeMaxItems} items`,
      'out_of_scope',
    );
  }
  for (const entry of entries) {
    if (typeof entry === 'string' && entry.length > SPINE_CAPS.outOfScopeItemMaxChars) {
      throw new CapViolationError(
        `spine.out_of_scope item exceeds ${SPINE_CAPS.outOfScopeItemMaxChars} chars`,
        'out_of_scope[]',
      );
    }
  }
}

export function assertSpineCaps(spine) {
  if (!spine || typeof spine !== 'object') {
    throw new CapViolationError('assertSpineCaps: spine must be an object', 'spine');
  }
  assertScalars(spine);
  const risks = Array.isArray(spine.open_risks) ? spine.open_risks : [];
  assertRiskCounts(risks);
  assertRiskItems(risks);
  assertDecisions(Array.isArray(spine.key_decisions) ? spine.key_decisions : []);
  assertOutOfScope(Array.isArray(spine.out_of_scope) ? spine.out_of_scope : []);
  return spine;
}
