import { resolveLedgerRoots, isUnderRoot } from './ledger-roots.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const MUTATING = /(?:(?:^|[\s;&|`(])(?:rm|mv|cp|dd|tee|truncate|install|ln|shred|chmod|chown|mkdir|rmdir|touch)\s)|>>?|>\||\bsed\s+-[a-zA-Z]*i\b/;

function decision(permissionDecision, reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision,
      permissionDecisionReason: reason,
    },
  };
}

export function hasMutatingConstruct(command) {
  return typeof command === 'string' && MUTATING.test(command);
}

function targetPath(input) {
  const toolInput = input && input.tool_input ? input.tool_input : {};
  return toolInput.file_path ?? toolInput.notebook_path ?? null;
}

function referencesRoot(command, roots) {
  return typeof command === 'string' && roots.some((root) => command.includes(root));
}

export function classifyPreToolUse(input, roots, baseDir) {
  const toolName = input && typeof input.tool_name === 'string' ? input.tool_name : '';
  if (WRITE_TOOLS.has(toolName)) {
    const path = targetPath(input);
    if (path && isUnderRoot(path, roots, baseDir)) {
      return decision('deny', `${toolName} into the session-continuity ledger store is not permitted; use the ledger MCP tools (mcp__ledger__* when the server is configured directly, mcp__plugin_session-continuity_ledger__* when installed as a plugin)`);
    }
    return null;
  }
  if (toolName === 'Bash') {
    const command = input && input.tool_input ? input.tool_input.command : undefined;
    if (hasMutatingConstruct(command) && referencesRoot(command, roots)) {
      return decision('deny', 'a mutating Bash command targeting the session-continuity ledger store is not permitted; use the ledger MCP tools (mcp__ledger__* when the server is configured directly, mcp__plugin_session-continuity_ledger__* when installed as a plugin)');
    }
    return null;
  }
  return null;
}

export async function handlePreToolUse(ctx) {
  const toolName = ctx.input && typeof ctx.input.tool_name === 'string' ? ctx.input.tool_name : '';
  if (/^mcp__ledger__/.test(toolName)) {
    return { json: decision('allow', 'session-continuity ledger tool auto-approved') };
  }
  const roots = await resolveLedgerRoots(ctx.projectDir, ctx.env);
  if (roots.length === 0) {
    return {};
  }
  const result = classifyPreToolUse(ctx.input, roots, ctx.projectDir);
  return result ? { json: result } : {};
}
