import { resolveLedgerRoots, isUnderRoot } from './ledger-roots.mjs';
import { scanSegments } from './shell-tokens.mjs';
import { hasUnquotedAmpersand } from './shell-source.mjs';
import {
  ALLOW_HEADS,
  CONDITIONAL_ALLOWS,
  SINK_HEADS,
  gitRedirectsExec,
  normalizeHead,
} from './command-allowlist.mjs';
import {
  cwdUnderRoot,
  hasSuspiciousResidue,
  hasUnresolvable,
  nextCwd,
  redirectTargetsRoot,
  touchesRoot,
} from './command-scope.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const LEDGER_TOOL = /^mcp__(?:plugin_session-continuity_)?ledger__/;
const MAX_COMMAND_BYTES = 16384;
const CONTROL_WORDS = new Set(['(', ')', '{', '}']);
const GROUP_OPENERS = new Set(['(', '{']);
const FD_DUPLICATION = /^&(\d+|-)$/;
const ORIENTATION_HEADS = new Set(['git', 'find']);
const CLEARED_UNIT_SINKS = Object.freeze(
  new Set([...SINK_HEADS].filter((name) => !ORIENTATION_HEADS.has(name))),
);
const DENY_SUFFIX =
  'use the ledger MCP tools (mcp__ledger__* when the server is configured directly, mcp__plugin_session-continuity_ledger__* when installed as a plugin)';
const BASH_REASONS = Object.freeze({
  deny: `a Bash command that is not provably read-only against the session-continuity ledger store is not permitted; ${DENY_SUFFIX}`,
  ask: `this Bash command reaches the session-continuity ledger store in a way the guard cannot resolve; to write the store, ${DENY_SUFFIX}`,
});

function decision(permissionDecision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  };
}

function derivedToken(token, text) {
  return { kind: 'word', text, unresolvable: token.unresolvable };
}

function leadingOpeners(text) {
  let count = 0;
  while (count < text.length && GROUP_OPENERS.has(text.charAt(count))) {
    count += 1;
  }
  return count;
}

export function splitControl(tokens, splitsAmpersand = true) {
  if (!Array.isArray(tokens)) {
    return [];
  }
  let subSegments = [];
  let current = [];
  let previous = null;

  const emit = (token) => {
    current = [...current, token];
    previous = token;
  };

  const boundary = () => {
    if (current.length > 0) {
      subSegments = [...subSegments, current];
      current = [];
    }
  };

  const visit = (token) => {
    if (token.kind !== 'word') {
      emit(token);
      return;
    }
    const openers = leadingOpeners(token.text);
    if (openers > 0) {
      boundary();
    }
    const word = openers > 0 ? derivedToken(token, token.text.slice(openers)) : token;
    if (word.text === '') {
      return;
    }
    if (FD_DUPLICATION.test(word.text) && previous !== null && previous.kind === 'redirect') {
      emit(word);
      return;
    }
    if (CONTROL_WORDS.has(word.text)) {
      boundary();
      return;
    }
    if (splitsAmpersand && word.text.includes('&')) {
      word.text.split('&').forEach((part, index) => {
        if (index > 0) {
          boundary();
        }
        if (part !== '') {
          visit(derivedToken(word, part));
        }
      });
      return;
    }
    emit(word);
  };

  tokens.forEach((token) => visit(token));
  boundary();
  return subSegments;
}

function headClears(head, words) {
  const conditional = CONDITIONAL_ALLOWS.get(head.name);
  if (conditional) {
    return conditional(words, head);
  }
  return ALLOW_HEADS.has(head.name);
}

function unitOf(tokens, roots, cwd) {
  const words = tokens.filter((token) => token.kind === 'word');
  const head = normalizeHead(words);
  return {
    tokens,
    words,
    head,
    cwd,
    cleared: head.kind === 'assignment-only'
      || (head.kind === 'name' && headClears(head, words)),
    direct: touchesRoot(tokens, roots, cwd),
    unbounded: head.kind === 'name' && head.name === 'git' && gitRedirectsExec(words),
  };
}

function advanceCwd(unit) {
  if (unit.head.kind !== 'name' || unit.head.name !== 'cd') {
    return unit.cwd;
  }
  const target = unit.words
    .slice(unit.head.index + 1)
    .find((word) => !word.text.startsWith('-'));
  return nextCwd(unit.cwd, target);
}

function scanSegment(tokens, roots, state, splitsAmpersand) {
  const scanned = splitControl(tokens, splitsAmpersand).reduce((acc, sub) => {
    const unit = unitOf(sub, roots, acc.cwd);
    return {
      cwd: advanceCwd(unit),
      rooted: acc.rooted || cwdUnderRoot(acc.cwd, roots),
      units: [...acc.units, unit],
    };
  }, { cwd: state.cwd, rooted: state.rooted, units: [] });
  const inherited = scanned.rooted || scanned.units.some((unit) => unit.direct);
  return {
    cwd: scanned.cwd,
    rooted: scanned.rooted,
    units: scanned.units.map((unit) => ({ ...unit, inScope: unit.direct || inherited })),
  };
}

function scanCommand(command, roots, baseDir) {
  const splitsAmpersand = hasUnquotedAmpersand(command);
  return scanSegments(command).reduce((state, tokens) => {
    const scanned = scanSegment(tokens, roots, state, splitsAmpersand);
    return {
      cwd: scanned.cwd,
      rooted: scanned.rooted,
      units: [...state.units, ...scanned.units],
    };
  }, { cwd: baseDir, rooted: false, units: [] }).units;
}

function unitDenies(unit, roots) {
  if (redirectTargetsRoot(unit.tokens, roots, unit.cwd)) {
    return true;
  }
  if (unit.unbounded) {
    return true;
  }
  if (!unit.inScope) {
    return false;
  }
  if (unit.head.kind === 'obfuscated' || unit.head.kind === 'untrusted-path') {
    return true;
  }
  return unit.head.kind === 'name' && !unit.cleared;
}

function sinkElsewhere(units, index, sinks, predicate) {
  return units.some((unit, other) => (
    other !== index
    && unit.head.kind === 'name'
    && sinks.has(unit.head.name)
    && predicate(unit)
  ));
}

function overlaysAsk(units) {
  return units.some((unit, index) => {
    if (!unit.inScope) {
      return false;
    }
    if (unit.head.kind === 'name' && unit.cleared) {
      return sinkElsewhere(units, index, CLEARED_UNIT_SINKS, () => true);
    }
    if (unit.head.kind === 'assignment-only') {
      return sinkElsewhere(units, index, SINK_HEADS, (other) => hasUnresolvable(other.tokens));
    }
    return false;
  });
}

export function classifyBashCommand(command, roots, baseDir) {
  if (typeof command !== 'string' || !Array.isArray(roots) || roots.length === 0) {
    return null;
  }
  if (command.length > MAX_COMMAND_BYTES) {
    return roots.some((root) => command.includes(root)) ? 'deny' : 'ask';
  }
  const units = scanCommand(command, roots, baseDir ?? process.cwd());
  if (units.some((unit) => unitDenies(unit, roots))) {
    return 'deny';
  }
  const residue = units.some((unit) => (
    unit.inScope && unit.cleared && hasSuspiciousResidue(unit.tokens)
  ));
  return residue || overlaysAsk(units) ? 'ask' : null;
}

function targetPath(input) {
  const toolInput = input && input.tool_input ? input.tool_input : {};
  return toolInput.file_path ?? toolInput.notebook_path ?? null;
}

export function classifyPreToolUse(input, roots, baseDir) {
  const toolName = input && typeof input.tool_name === 'string' ? input.tool_name : '';
  if (WRITE_TOOLS.has(toolName)) {
    const path = targetPath(input);
    if (path && isUnderRoot(path, roots, baseDir)) {
      return decision('deny', `${toolName} into the session-continuity ledger store is not permitted; ${DENY_SUFFIX}`);
    }
    return null;
  }
  if (toolName === 'Bash') {
    const command = input && input.tool_input ? input.tool_input.command : undefined;
    const verdict = classifyBashCommand(command, roots, baseDir);
    return verdict ? decision(verdict, BASH_REASONS[verdict]) : null;
  }
  return null;
}

export async function handlePreToolUse(ctx) {
  const toolName = ctx.input && typeof ctx.input.tool_name === 'string' ? ctx.input.tool_name : '';
  if (LEDGER_TOOL.test(toolName)) {
    return { json: decision('allow', 'session-continuity ledger tool auto-approved') };
  }
  const roots = await resolveLedgerRoots(ctx.projectDir, ctx.env);
  if (roots.length === 0) {
    return {};
  }
  const result = classifyPreToolUse(ctx.input, roots, ctx.projectDir);
  return result ? { json: result } : {};
}
