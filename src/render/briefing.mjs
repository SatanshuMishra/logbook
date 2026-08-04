import { selectCurrent } from '../model/selection.mjs';
import { SPINE_CAPS } from '../model/caps.mjs';
import { CRITERION_TEXT_MAX_CHARS, THREAD_SCOPE, LEGACY_SCOPE } from '../schema/patterns.mjs';

const ELLIPSIS = '…';
const DETOUR_KIND = 'detour';
const DECISION_NUMBER = /^([0-9]{4,})-/;

function truncate(value, max) {
  const text = typeof value === 'string' ? value : '';
  return text.length <= max ? text : `${text.slice(0, max - 1)}${ELLIPSIS}`;
}

function decisionNumber(ref) {
  if (typeof ref !== 'string') return '';
  const match = DECISION_NUMBER.exec(ref);
  return match ? match[1] : ref;
}

function isStruck(criterion) {
  return typeof criterion.struck_by === 'string' && criterion.struck_by.length > 0;
}

function marker(criterion, currentId) {
  if (isStruck(criterion)) return '[~]';
  if (criterion.id === currentId) return '[>]';
  if (criterion.done === true) return '[x]';
  if (criterion.kind === DETOUR_KIND) return '[!]';
  return '[ ]';
}

function criterionSuffix(criterion) {
  const parts = [];
  if (criterion.kind === DETOUR_KIND) parts.push('(detour)');
  if (isStruck(criterion)) parts.push(`(struck — decision ${decisionNumber(criterion.struck_by)})`);
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

function headerBlock(thread, selection) {
  const fraction = selection.state === 'ready-to-close'
    ? `${selection.total} of ${selection.total} done — ready to close`
    : `${selection.done} of ${selection.total} done`;
  const day = typeof thread.updated_at === 'string' ? thread.updated_at.slice(0, 10) : '';
  return [
    `# PREFLIGHT BRIEFING — ${thread.title}`,
    `${thread.status} · ${fraction} · ${selection.detoursOpen} detour(s) open · last worked ${day}`,
  ];
}

function whyBlock(spine) {
  return ['## WHY', truncate(spine.active_goal, SPINE_CAPS.activeGoalMaxChars)];
}

function driftBlock(drift) {
  const entries = Array.isArray(drift) ? drift : [];
  const lines = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    const signals = Array.isArray(entry.signals) ? entry.signals : [];
    for (const signal of signals) {
      if (!signal || typeof signal !== 'object') continue;
      const detail = typeof signal.detail === 'string' && signal.detail.length > 0
        ? `: ${signal.detail}`
        : '';
      lines.push(`- ${entry.classification} ${entry.branch} — ${signal.code}${detail}`);
    }
  }
  return lines.length === 0 ? null : ['## SINCE YOU LEFT', ...lines];
}

function progressBlock(thread, selection) {
  const criteria = Array.isArray(thread.completion_criteria) ? thread.completion_criteria : [];
  const currentId = selection.current ? selection.current.id : null;
  const lines = criteria
    .filter((c) => c && typeof c === 'object')
    .map((c) => {
      const text = truncate(c.text, CRITERION_TEXT_MAX_CHARS);
      return `- ${marker(c, currentId)} ${c.id} — ${text}${criterionSuffix(c)}`;
    });
  return ['## PROGRESS', ...lines];
}

function lastSessionBlock(spine) {
  const text = truncate(spine.last_session, SPINE_CAPS.lastSessionMaxChars);
  return text.length === 0 ? null : ['## LAST SESSION', text];
}

function nextStepBlock(spine) {
  return ['## NEXT STEP', truncate(spine.next_step, SPINE_CAPS.nextStepMaxChars)];
}

function riskLines(risk) {
  const lines = [`- ${truncate(risk.text, SPINE_CAPS.riskTextMaxChars)}`];
  const refs = Array.isArray(risk.refs)
    ? risk.refs.filter((ref) => typeof ref === 'string' && ref.length > 0)
    : [];
  if (refs.length > 0) {
    lines.push(`  refs: ${refs.map((ref) => truncate(ref, SPINE_CAPS.riskRefMaxChars)).join(', ')}`);
  }
  return lines;
}

function risksBlock(spine, visibleScopes) {
  const risks = Array.isArray(spine.open_risks) ? spine.open_risks : [];
  const visible = risks.filter((r) => r && typeof r === 'object' && visibleScopes.has(r.scope));
  if (visible.length === 0) return null;
  const step = visible.filter((r) => r.scope !== THREAD_SCOPE);
  const standing = visible.filter((r) => r.scope === THREAD_SCOPE);
  const lines = ['## WATCH OUT FOR'];
  for (const risk of step) lines.push(...riskLines(risk));
  if (standing.length > 0) {
    if (step.length > 0) lines.push('');
    lines.push('Standing:');
    for (const risk of standing) lines.push(...riskLines(risk));
  }
  return lines;
}

function decisionsBlock(spine, visibleScopes) {
  const decisions = Array.isArray(spine.key_decisions) ? spine.key_decisions : [];
  const visible = decisions.filter((d) => d && typeof d === 'object' && visibleScopes.has(d.scope));
  if (visible.length === 0) return null;
  return [
    '## DECIDED ON THIS STEP',
    ...visible.map((d) => `- ${decisionNumber(d.ref)} — ${truncate(d.title, SPINE_CAPS.decisionTitleMaxChars)}`),
  ];
}

function outOfScopeBlock(spine) {
  const entries = Array.isArray(spine.out_of_scope) ? spine.out_of_scope : [];
  const lines = entries
    .filter((entry) => typeof entry === 'string' && entry.length > 0)
    .map((entry) => `- ${truncate(entry, SPINE_CAPS.outOfScopeItemMaxChars)}`);
  return lines.length === 0 ? null : ['## NOT IN SCOPE', ...lines];
}

function relatedBlock(children, predecessor) {
  const kids = Array.isArray(children) ? children.filter((c) => c && typeof c.slug === 'string') : [];
  const pred = predecessor && typeof predecessor.slug === 'string' ? predecessor : null;
  if (kids.length === 0 && pred === null) return null;
  const lines = ['## RELATED'];
  for (const child of kids) lines.push(`- child: ${child.slug} (${child.status})`);
  if (pred !== null) lines.push(`- succeeds: ${pred.slug}`);
  return lines;
}

function notShownBlock(spine, visibleScopes) {
  const risks = Array.isArray(spine.open_risks) ? spine.open_risks : [];
  const decisions = Array.isArray(spine.key_decisions) ? spine.key_decisions : [];
  const hiddenRisks = risks.filter((r) => r && !visibleScopes.has(r.scope)).length;
  const legacy = decisions.filter((d) => d && d.scope === LEGACY_SCOPE).length;
  const hiddenDecisions = decisions
    .filter((d) => d && d.scope !== LEGACY_SCOPE && !visibleScopes.has(d.scope)).length;
  return [
    '## NOT SHOWN',
    `${hiddenRisks} risk(s) and ${hiddenDecisions} decision(s) from other steps; ${legacy} legacy decision(s).`,
    'Ask for any decision by number: read_decision.',
  ];
}

export function renderBriefing(brief) {
  if (!brief || typeof brief !== 'object') {
    throw new TypeError('renderBriefing: brief must be an object');
  }
  const { thread } = brief;
  if (!thread || typeof thread !== 'object' || Array.isArray(thread)) {
    throw new TypeError('renderBriefing: brief.thread must be a thread record');
  }
  const spine = thread.spine && typeof thread.spine === 'object' ? thread.spine : {};
  const selection = selectCurrent(thread);
  const blocks = [
    headerBlock(thread, selection),
    whyBlock(spine),
    driftBlock(brief.drift),
    progressBlock(thread, selection),
    lastSessionBlock(spine),
    nextStepBlock(spine),
    risksBlock(spine, selection.visibleScopes),
    decisionsBlock(spine, selection.visibleScopes),
    outOfScopeBlock(spine),
    relatedBlock(brief.children, brief.predecessor),
    notShownBlock(spine, selection.visibleScopes),
  ];
  return blocks.filter(Boolean).map((block) => block.join('\n')).join('\n\n');
}
