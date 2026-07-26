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
  'ls', 'stat', 'file', 'du', 'df', 'tree',
  'realpath', 'readlink', 'basename', 'dirname', 'pwd',
  'grep', 'egrep', 'fgrep', 'rg',
  'jq', 'yq',
  'diff', 'cmp',
  'sort', 'uniq', 'cut', 'tr', 'column', 'paste', 'join',
  'md5', 'md5sum', 'shasum', 'sha256sum', 'cksum', 'od', 'xxd', 'strings',
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
  '-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path',
  '--config-env', '--super-prefix',
]);

const GIT_VALUELESS_GLOBALS = freezeSet([
  '-p', '--paginate', '--no-pager', '--bare',
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
const SED_SHORT_IN_PLACE = /^-[a-zA-Z]*i/;
const SED_LONG_IN_PLACE = /^--in-place/;

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

export function findAllows(words) {
  return !wordList(words).some((token) => FIND_ACTIONS.test(tokenText(token)));
}

export function sedAllows(words) {
  return !wordList(words).some((token) => {
    const text = tokenText(token);
    return SED_SHORT_IN_PLACE.test(text) || SED_LONG_IN_PLACE.test(text);
  });
}
