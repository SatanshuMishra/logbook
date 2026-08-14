import { homedir } from 'node:os';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { resolveLedgerRoots, isUnderRoot, canonicalPath } from './ledger-roots.mjs';
import { shellCwd } from './hook-io.mjs';
import { DEFAULT_LEDGER_BRANCH } from '../../src/drivers/git-ledger.mjs';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const LEDGER_TOOL = /^mcp__(?:plugin_logbook_)?ledger__(.+)$/;
const TOOL_REGISTRY = '../../src/tools/registry.mjs';
const REF_TRIGGERS = Object.freeze([DEFAULT_LEDGER_BRANCH, 'refs/ledger/']);
const CONSTANT_TRIGGERS = Object.freeze([...REF_TRIGGERS, 'CLAUDE_PLUGIN_DATA']);
const GIT_READ_SUBCOMMANDS = Object.freeze(
  new Set([
    'blame',
    'cat-file',
    'describe',
    'diff',
    'for-each-ref',
    'log',
    'ls-files',
    'ls-tree',
    'rev-list',
    'rev-parse',
    'shortlog',
    'show',
    'show-ref',
    'status',
  ]),
);
const GIT_VALUE_OPTIONS = Object.freeze(
  new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path']),
);
const SEGMENT_SPLIT = /\|\||&&|[|;\n\r]/;
const PATH_SEPARATOR = /[\\/]/;
const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const REGEXP_META = /[.*+?^${}()|[\]\\]/g;
const HOME_PREFIXES = Object.freeze(['~', '$HOME', '${HOME}']);
const TRAILING_SEP = /[\\/]+$/;
const DENY_SUFFIX =
  'use the ledger MCP tools (mcp__ledger__* when the server is configured directly, mcp__plugin_logbook_ledger__* when installed as a plugin)';
const GUARDRAIL_NOTE = 'this guard prompts for confirmation and is not a security boundary';
const UNREADABLE_COMMAND_REASON = `the Logbook guard could not read this Bash command as a string and refused to judge it; ${GUARDRAIL_NOTE}; to write the ledger store, ${DENY_SUFFIX}`;
const SILENT = Object.freeze({ verdict: null, reason: null });
const BASH_GUARD_DISABLE_KEYS = Object.freeze([
  'LEDGER_DISABLE_BASH_GUARD',
  'CLAUDE_PLUGIN_OPTION_DISABLE_BASH_GUARD',
]);
const DISABLED = 'true';

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

function isFilesystemRoot(path) {
  return dirname(path) === path;
}

function dataRootSpellings(env, home) {
  const raw = env && typeof env === 'object' ? env.CLAUDE_PLUGIN_DATA : undefined;
  if (typeof raw !== 'string' || raw.length === 0 || !isAbsolute(raw)) {
    return [];
  }
  const root = resolve(raw);
  if (isFilesystemRoot(root)) {
    return [];
  }
  return [root, canonicalPath(root), ...homeSpellings(root, home)]
    .filter((spelling) => !isFilesystemRoot(spelling));
}

function ledgerTriggers(roots, projectDir, env) {
  const home = trimTrailingSep(homedir());
  const paths = roots.filter((root) => typeof root === 'string' && root.length > 0);
  const spellings = paths.flatMap((root) => [
    root,
    canonicalPath(root),
    ...homeSpellings(root, home),
    ...relativeSpellings(root, projectDir),
  ]);
  return [...new Set([...CONSTANT_TRIGGERS, ...spellings, ...dataRootSpellings(env, home)])]
    .filter((trigger) => typeof trigger === 'string' && trigger.length > 0);
}

function escapeRegExp(value) {
  return value.replace(REGEXP_META, '\\$&');
}

function triggerMatches(text, trigger) {
  if (PATH_SEPARATOR.test(trigger)) {
    return text.includes(trigger);
  }
  return new RegExp(`(?<![A-Za-z0-9_-])${escapeRegExp(trigger)}(?![A-Za-z0-9_-])`).test(text);
}

function matchedTriggers(command, roots, projectDir, env) {
  return ledgerTriggers(roots, projectDir, env).filter((trigger) => triggerMatches(command, trigger));
}

function gitSubcommand(segment) {
  const tokens = segment.trim().split(/\s+/).filter(Boolean);
  let index = 0;
  while (index < tokens.length && ENV_ASSIGNMENT.test(tokens[index])) {
    index += 1;
  }
  if (tokens[index] !== 'git') {
    return null;
  }
  index += 1;
  while (index < tokens.length && tokens[index].startsWith('-')) {
    const option = tokens[index];
    index += 1;
    if (GIT_VALUE_OPTIONS.has(option)) {
      index += 1;
    }
  }
  return tokens[index] ?? null;
}

function isGitRead(segment) {
  const subcommand = gitSubcommand(segment);
  return subcommand !== null && GIT_READ_SUBCOMMANDS.has(subcommand);
}

function isLedgerRead(command, triggers) {
  if (!triggers.every((trigger) => REF_TRIGGERS.includes(trigger))) {
    return false;
  }
  return command
    .split(SEGMENT_SPLIT)
    .every(
      (segment) =>
        !triggers.some((trigger) => triggerMatches(segment, trigger)) || isGitRead(segment),
    );
}

function triggerReason(trigger) {
  return `this Bash command contains "${trigger}", which names the Logbook ledger store; ${GUARDRAIL_NOTE}; to write the store, ${DENY_SUFFIX}`;
}

function isBashGuardDisabled(env) {
  const source = env && typeof env === 'object' ? env : {};
  return BASH_GUARD_DISABLE_KEYS.some((key) => source[key] === DISABLED);
}

function bashJudgment(command, roots, projectDir, env) {
  if (isBashGuardDisabled(env)) {
    return SILENT;
  }
  if (!Array.isArray(roots) || roots.length === 0) {
    return SILENT;
  }
  if (typeof command !== 'string') {
    return { verdict: 'ask', reason: UNREADABLE_COMMAND_REASON };
  }
  const triggers = matchedTriggers(command, roots, projectDir, env);
  if (triggers.length === 0 || isLedgerRead(command, triggers)) {
    return SILENT;
  }
  return { verdict: 'ask', reason: triggerReason(triggers[0]) };
}

export function classifyBashCommand(command, roots, projectDir, env = process.env) {
  return bashJudgment(command, roots, projectDir, env).verdict;
}

function targetPath(input) {
  const toolInput = input && input.tool_input ? input.tool_input : {};
  return toolInput.file_path ?? toolInput.notebook_path ?? null;
}

export function classifyPreToolUse(input, roots, baseDir, projectDir, env = process.env) {
  const toolName = input && typeof input.tool_name === 'string' ? input.tool_name : '';
  if (WRITE_TOOLS.has(toolName)) {
    const path = targetPath(input);
    if (path && isUnderRoot(path, roots, baseDir)) {
      return decision('deny', `${toolName} into the Logbook ledger store is not permitted; ${DENY_SUFFIX}`);
    }
    return null;
  }
  if (toolName === 'Bash') {
    const command = input && input.tool_input ? input.tool_input.command : undefined;
    const { verdict, reason } = bashJudgment(command, roots, projectDir, env);
    return verdict ? decision(verdict, reason) : null;
  }
  return null;
}

let registeredToolNames = null;

async function isRegisteredLedgerTool(toolName) {
  const match = LEDGER_TOOL.exec(toolName);
  if (match === null) {
    return false;
  }
  if (registeredToolNames === null) {
    const { TOOLS } = await import(TOOL_REGISTRY);
    registeredToolNames = new Set(TOOLS.map((tool) => tool.name));
  }
  return registeredToolNames.has(match[1]);
}

export async function handlePreToolUse(ctx) {
  const toolName = ctx.input && typeof ctx.input.tool_name === 'string' ? ctx.input.tool_name : '';
  if (await isRegisteredLedgerTool(toolName)) {
    return { json: decision('allow', 'logbook ledger tool auto-approved') };
  }
  const roots = await resolveLedgerRoots(ctx.projectDir, ctx.env);
  if (roots.length === 0) {
    return {};
  }
  const result = classifyPreToolUse(
    ctx.input,
    roots,
    shellCwd(ctx, ctx.projectDir),
    ctx.projectDir,
    ctx.env,
  );
  return result ? { json: result } : {};
}
