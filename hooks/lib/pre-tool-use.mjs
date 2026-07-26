import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { resolveLedgerRoots, isUnderRoot } from './ledger-roots.mjs';
import { scanSegments } from './shell-tokens.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const LEDGER_TOOL = /^mcp__(?:plugin_session-continuity_)?ledger__/;
const DESTRUCTIVE = new Set([
  'rm', 'mv', 'cp', 'dd', 'tee', 'truncate', 'install', 'ln', 'shred',
  'chmod', 'chown', 'mkdir', 'rmdir', 'touch',
]);
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

function expandHome(text) {
  if (text === '~') {
    return homedir();
  }
  return text.startsWith('~/') ? resolve(homedir(), text.slice(2)) : text;
}

function resolvesUnderRoot(token, roots, cwd) {
  if (!token || token.unresolvable) {
    return false;
  }
  return isUnderRoot(expandHome(token.text), roots, cwd);
}

function redirectTargetsRoot(tokens, roots, cwd) {
  return tokens.some((token, index) => {
    const target = tokens[index + 1];
    return token.kind === 'redirect'
      && target !== undefined
      && target.kind === 'word'
      && resolvesUnderRoot(target, roots, cwd);
  });
}

function isInPlaceSed(head, words) {
  return head === 'sed' && words.some((word) => /^-[a-zA-Z]*i/.test(word.text));
}

function nextCwd(cwd, token) {
  if (!token || token.unresolvable) {
    return cwd;
  }
  return resolve(cwd, expandHome(token.text));
}

export function mutatesUnderRoot(command, roots, baseDir) {
  if (typeof command !== 'string' || !Array.isArray(roots) || roots.length === 0) {
    return false;
  }
  let cwd = baseDir ?? process.cwd();
  for (const tokens of scanSegments(command)) {
    if (redirectTargetsRoot(tokens, roots, cwd)) {
      return true;
    }
    const words = tokens.filter((token) => token.kind === 'word');
    const head = words.length > 0 ? words[0].text : undefined;
    const args = words.slice(1).filter((word) => !word.text.startsWith('-'));
    if (head === 'cd') {
      cwd = nextCwd(cwd, args[0]);
      continue;
    }
    if (DESTRUCTIVE.has(head) || isInPlaceSed(head, words)) {
      if (args.some((arg) => resolvesUnderRoot(arg, roots, cwd))) {
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
