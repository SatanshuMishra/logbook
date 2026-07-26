import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { resolveLedgerRoots, isUnderRoot } from './ledger-roots.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const LEDGER_TOOL = /^mcp__(?:plugin_session-continuity_)?ledger__/;
const DESTRUCTIVE = new Set([
  'rm', 'mv', 'cp', 'dd', 'tee', 'truncate', 'install', 'ln', 'shred',
  'chmod', 'chown', 'mkdir', 'rmdir', 'touch',
]);
const TOKEN = /\d*&?>{1,2}\|?|<|[^\s<>]+/g;
const REDIRECT = /^\d*&?>{1,2}\|?$/;
const SEGMENT = /\s*(?:&&|\|\||;|(?<!>)\||\n)\s*/;
const DENY_SUFFIX =
  'use the ledger MCP tools (mcp__ledger__* when the server is configured directly, mcp__plugin_session-continuity_ledger__* when installed as a plugin)';

function decision(permissionDecision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  };
}

function stripQuoted(command) {
  return command.replace(/'[^']*'/g, ' ').replace(/"[^"]*"/g, ' ');
}

function expandHome(token) {
  if (token === '~') {
    return homedir();
  }
  return token.startsWith('~/') ? resolve(homedir(), token.slice(2)) : token;
}

function isInPlaceSed(head, words) {
  return head === 'sed' && words.some((word) => /^-[a-zA-Z]*i/.test(word));
}

export function mutatesUnderRoot(command, roots, baseDir) {
  if (typeof command !== 'string' || !Array.isArray(roots) || roots.length === 0) {
    return false;
  }
  let cwd = baseDir ?? process.cwd();
  for (const segment of stripQuoted(command).split(SEGMENT)) {
    const tokens = segment.match(TOKEN) ?? [];
    if (tokens.length === 0) {
      continue;
    }
    for (let i = 0; i < tokens.length; i += 1) {
      const target = tokens[i + 1];
      if (!REDIRECT.test(tokens[i]) || !target || REDIRECT.test(target)) {
        continue;
      }
      if (isUnderRoot(expandHome(target), roots, cwd)) {
        return true;
      }
    }
    const words = tokens.filter((token) => !REDIRECT.test(token));
    const head = words[0];
    const args = words.slice(1).filter((word) => !word.startsWith('-'));
    if (head === 'cd') {
      if (args[0]) {
        cwd = resolve(cwd, expandHome(args[0]));
      }
      continue;
    }
    if (DESTRUCTIVE.has(head) || isInPlaceSed(head, words)) {
      if (args.some((arg) => isUnderRoot(expandHome(arg), roots, cwd))) {
        return true;
      }
    }
  }
  return false;
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
    if (mutatesUnderRoot(command, roots, baseDir)) {
      return decision('deny', `a mutating Bash command targeting the session-continuity ledger store is not permitted; ${DENY_SUFFIX}`);
    }
    return null;
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
