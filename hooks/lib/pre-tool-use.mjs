import { homedir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';
import { resolveLedgerRoots, isUnderRoot, canonicalPath } from './ledger-roots.mjs';
import { shellCwd } from './hook-io.mjs';
import { DEFAULT_LEDGER_BRANCH } from '../../src/drivers/git-ledger.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const LEDGER_TOOL = /^mcp__(?:plugin_session-continuity_)?ledger__/;
const MAX_COMMAND_BYTES = 16384;
const CONSTANT_TRIGGERS = Object.freeze([DEFAULT_LEDGER_BRANCH, 'refs/ledger/', 'CLAUDE_PLUGIN_DATA']);
const HOME_PREFIXES = Object.freeze(['~', '$HOME', '${HOME}']);
const TRAILING_SEP = /[\\/]+$/;
const DENY_SUFFIX =
  'use the ledger MCP tools (mcp__ledger__* when the server is configured directly, mcp__plugin_session-continuity_ledger__* when installed as a plugin)';
const GUARDRAIL_NOTE = 'this guard prompts for confirmation and is not a security boundary';
const BASH_REASONS = Object.freeze({
  deny: `this Bash command is larger than the session-continuity guard reads and names the ledger store; ${DENY_SUFFIX}`,
  ask: `this Bash command is larger than the session-continuity guard reads; ${GUARDRAIL_NOTE}; to write the ledger store, ${DENY_SUFFIX}`,
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

function trimTrailingSep(value) {
  const trimmed = value.replace(TRAILING_SEP, '');
  return trimmed.length > 0 ? trimmed : value;
}

function homeSpellings(root, home) {
  if (home.length === 0 || !root.startsWith(home + sep)) {
    return [];
  }
  const tail = root.slice(home.length);
  return HOME_PREFIXES.map((prefix) => `${prefix}${tail}`);
}

function relativeSpellings(root, projectDir) {
  if (typeof projectDir !== 'string' || !isAbsolute(projectDir) || !isAbsolute(root)) {
    return [];
  }
  const rel = relative(projectDir, root);
  const escapes = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  return rel.length === 0 || escapes ? [] : [rel];
}

function ledgerTriggers(roots, projectDir) {
  const home = trimTrailingSep(homedir());
  const paths = roots.filter((root) => typeof root === 'string' && root.length > 0);
  const spellings = paths.flatMap((root) => [
    root,
    canonicalPath(root),
    ...homeSpellings(root, home),
    ...relativeSpellings(root, projectDir),
  ]);
  return [...new Set([...CONSTANT_TRIGGERS, ...spellings])]
    .filter((trigger) => typeof trigger === 'string' && trigger.length > 0);
}

function matchedTrigger(command, roots, projectDir) {
  return ledgerTriggers(roots, projectDir).find((trigger) => command.includes(trigger)) ?? null;
}

export function classifyBashCommand(command, roots, projectDir) {
  if (typeof command !== 'string' || !Array.isArray(roots) || roots.length === 0) {
    return null;
  }
  const trigger = matchedTrigger(command, roots, projectDir);
  if (command.length > MAX_COMMAND_BYTES) {
    return trigger === null ? 'ask' : 'deny';
  }
  return trigger === null ? null : 'ask';
}

function bashReason(verdict, command, roots, projectDir) {
  if (command.length > MAX_COMMAND_BYTES) {
    return BASH_REASONS[verdict];
  }
  const trigger = matchedTrigger(command, roots, projectDir);
  return trigger === null
    ? BASH_REASONS.ask
    : `this Bash command contains "${trigger}", which names the session-continuity ledger store; ${GUARDRAIL_NOTE}; to write the store, ${DENY_SUFFIX}`;
}

function targetPath(input) {
  const toolInput = input && input.tool_input ? input.tool_input : {};
  return toolInput.file_path ?? toolInput.notebook_path ?? null;
}

export function classifyPreToolUse(input, roots, baseDir, projectDir) {
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
    const verdict = classifyBashCommand(command, roots, projectDir);
    return verdict ? decision(verdict, bashReason(verdict, command, roots, projectDir)) : null;
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
  const result = classifyPreToolUse(ctx.input, roots, shellCwd(ctx, ctx.projectDir), ctx.projectDir);
  return result ? { json: result } : {};
}
