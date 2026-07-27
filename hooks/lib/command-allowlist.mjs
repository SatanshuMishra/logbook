import { basename, dirname } from 'node:path';

const freezeSet = (values) => Object.freeze(new Set(values));

export const PREFIX_WORDS = freezeSet([
  'sudo', 'doas', 'command', 'builtin', 'exec', 'env', 'nohup', 'time',
  'timeout', 'stdbuf', 'nice', 'ionice', 'then', 'else', 'do', '!',
]);

export const TRUSTED_BIN_DIRS = freezeSet([
  '/bin', '/sbin', '/usr/bin', '/usr/sbin',
  '/usr/local/bin', '/usr/local/sbin',
  '/opt/homebrew/bin', '/opt/homebrew/sbin',
]);

export const ALLOW_HEADS = freezeSet([
  'cat', 'head', 'tail', 'nl', 'wc',
  'ls', 'stat', 'du', 'df',
  'realpath', 'readlink', 'basename', 'dirname', 'pwd',
  'grep', 'egrep', 'fgrep',
  'jq',
  'diff', 'cmp',
  'cut', 'tr', 'column', 'paste', 'join',
  'md5', 'md5sum', 'shasum', 'sha256sum', 'cksum', 'od', 'strings',
  'cd',
]);

export const SINK_HEADS = freezeSet([
  'rm', 'mv', 'cp', 'dd', 'tee', 'truncate', 'install', 'ln', 'shred',
  'chmod', 'chown', 'mkdir', 'rmdir', 'touch', 'xargs',
  'sh', 'bash', 'zsh', 'dash', 'ksh',
  'awk', 'perl', 'python', 'python3', 'node', 'ruby', 'sed',
  'rsync', 'tar', 'git', 'find',
]);

export const GIT_READ_SUBCOMMANDS = freezeSet([
  'log', 'show', 'status', 'diff', 'blame', 'cat-file', 'rev-parse', 'rev-list',
  'ls-files', 'ls-tree', 'describe', 'shortlog', 'grep', 'whatchanged',
]);

const GIT_VALUED_GLOBALS = freezeSet([
  '-C', '--git-dir', '--work-tree',
]);

const GIT_VALUELESS_GLOBALS = freezeSet([
  '--no-pager', '--bare',
  '--literal-pathspecs', '--no-literal-pathspecs',
  '--glob-pathspecs', '--icase-pathspecs',
  '--no-replace-objects', '--no-optional-locks',
  '--html-path', '--man-path', '--info-path', '--version', '--help',
]);

const OPERAND_PREFIXES = freezeSet(['timeout', 'nice', 'ionice']);

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
const OBFUSCATION = /[$`'"\\(){}&*?\[]/;
const OPERAND_SHAPE = /^[0-9]+(\.[0-9]+)?[smhd]?$/;
const FIND_ACTIONS = /^-(delete|exec|execdir|ok|okdir|fls|fprint|fprint0|fprintf)$/;
const SORT_OUTPUT = Object.freeze([/^--output(=|$)/, /^-[A-Za-z]*o/]);
const TREE_OUTPUT = Object.freeze([/^--output(=|$)/, /^-o$/]);
const FILE_COMPILE = Object.freeze([/^--compile$/, /^-[A-Za-z]*C/]);
const RG_SPAWN = Object.freeze([/^--pre(=|$)/, /^--hostname-bin(=|$)/]);
const GIT_OUTPUT = Object.freeze([/^--output(=|$)/, /^-O/, /^--open-files-in-pager/]);
const GIT_EXEC_REDIRECT = Object.freeze([/^--exec-path=/]);

function tokenText(token) {
  return token && typeof token.text === 'string' ? token.text : '';
}

function wordList(words) {
  return Array.isArray(words) ? words : [];
}

function skipPrefixOperands(words, start, prefix) {
  let index = start;
  while (index < words.length && tokenText(words[index]).startsWith('-')) {
    index += 1;
  }
  if (
    OPERAND_PREFIXES.has(prefix)
    && index < words.length
    && OPERAND_SHAPE.test(tokenText(words[index]))
  ) {
    index += 1;
  }
  return index;
}

export function normalizeHead(words) {
  const list = wordList(words);
  let index = 0;
  for (;;) {
    if (index >= list.length) {
      return { kind: 'assignment-only' };
    }
    const text = tokenText(list[index]);
    if (ASSIGNMENT.test(text)) {
      index += 1;
      continue;
    }
    const prefix = basename(text);
    if (!PREFIX_WORDS.has(prefix)) {
      break;
    }
    if (OBFUSCATION.test(text) || (text.includes('/') && !TRUSTED_BIN_DIRS.has(dirname(text)))) {
      return { kind: 'untrusted-path' };
    }
    index = skipPrefixOperands(list, index + 1, prefix);
  }
  const raw = tokenText(list[index]);
  if (OBFUSCATION.test(raw)) {
    return { kind: 'obfuscated' };
  }
  if (raw.includes('/')) {
    if (!TRUSTED_BIN_DIRS.has(dirname(raw))) {
      return { kind: 'untrusted-path' };
    }
    return { kind: 'name', name: basename(raw), index };
  }
  return { kind: 'name', name: raw, index };
}

export function resolveGitSubcommand(words, startIndex) {
  const list = wordList(words);
  let index = Number.isInteger(startIndex) ? startIndex : 0;
  while (index >= 0 && index < list.length) {
    const text = tokenText(list[index]);
    if (!text.startsWith('-')) {
      return { ok: true, subcommand: text };
    }
    if (GIT_VALUELESS_GLOBALS.has(text)) {
      index += 1;
      continue;
    }
    const equals = text.indexOf('=');
    if (equals > 0 && GIT_VALUED_GLOBALS.has(text.slice(0, equals))) {
      index += 1;
      continue;
    }
    if (GIT_VALUED_GLOBALS.has(text)) {
      index += 2;
      continue;
    }
    return { ok: false };
  }
  return { ok: false };
}

function lacksAny(patterns, words) {
  return !wordList(words).some((token) => {
    const text = tokenText(token);
    return patterns.some((pattern) => pattern.test(text));
  });
}

function operandsAfterHead(words, head) {
  const start = head && Number.isInteger(head.index) ? head.index + 1 : 0;
  return wordList(words)
    .slice(start)
    .filter((token) => !tokenText(token).startsWith('-'));
}

export function findAllows(words) {
  return !wordList(words).some((token) => FIND_ACTIONS.test(tokenText(token)));
}

export function sortAllows(words) {
  return lacksAny(SORT_OUTPUT, words);
}

export function treeAllows(words) {
  return lacksAny(TREE_OUTPUT, words);
}

export function fileAllows(words) {
  return lacksAny(FILE_COMPILE, words);
}

export function rgAllows(words) {
  return lacksAny(RG_SPAWN, words);
}

export function gitAllows(words, head) {
  if (!lacksAny(GIT_OUTPUT, words)) {
    return false;
  }
  const start = head && Number.isInteger(head.index) ? head.index + 1 : 0;
  const resolved = resolveGitSubcommand(words, start);
  return resolved.ok === true && GIT_READ_SUBCOMMANDS.has(resolved.subcommand);
}

export function gitRedirectsExec(words) {
  return !lacksAny(GIT_EXEC_REDIRECT, words);
}

export function uniqAllows(words, head) {
  return operandsAfterHead(words, head).length <= 1;
}

export function xxdAllows(words, head) {
  return operandsAfterHead(words, head).length <= 1;
}

export const CONDITIONAL_ALLOWS = Object.freeze(new Map([
  ['git', gitAllows],
  ['find', findAllows],
  ['sort', sortAllows],
  ['tree', treeAllows],
  ['file', fileAllows],
  ['rg', rgAllows],
  ['uniq', uniqAllows],
  ['xxd', xxdAllows],
]));
