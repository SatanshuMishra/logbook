import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { isUnderRoot } from './ledger-roots.mjs';
import { tokenList, tokenText } from './token-access.mjs';

const SUBSTITUTION_RESIDUE = /`|\$\(/;

function rootList(roots) {
  return Array.isArray(roots) ? roots : [];
}

export function expandHome(text) {
  if (text === '~') {
    return homedir();
  }
  return text.startsWith('~/') ? resolve(homedir(), text.slice(2)) : text;
}

export function resolvesUnderRoot(token, roots, cwd) {
  if (!token || token.unresolvable) {
    return false;
  }
  return isUnderRoot(expandHome(tokenText(token)), rootList(roots), cwd);
}

export function redirectTargetsRoot(tokens, roots, cwd) {
  return tokenList(tokens).some((token, index) => {
    const target = tokenList(tokens)[index + 1];
    return token.kind === 'redirect'
      && target !== undefined
      && target.kind === 'word'
      && resolvesUnderRoot(target, roots, cwd);
  });
}

export function nextCwd(cwd, token) {
  if (!token || token.unresolvable) {
    return cwd;
  }
  return resolve(cwd, expandHome(tokenText(token)));
}

export function cwdUnderRoot(cwd, roots) {
  return typeof cwd === 'string' && isUnderRoot(cwd, rootList(roots), cwd);
}

export function touchesRoot(tokens, roots, cwd) {
  if (cwdUnderRoot(cwd, roots)) {
    return true;
  }
  return tokenList(tokens).some((token) => {
    const text = tokenText(token);
    if (rootList(roots).some((root) => text.includes(root))) {
      return true;
    }
    return token.kind === 'word' && resolvesUnderRoot(token, roots, cwd);
  });
}

export function hasSuspiciousResidue(tokens) {
  return tokenList(tokens).some((token) => SUBSTITUTION_RESIDUE.test(tokenText(token)));
}

export function hasUnresolvable(tokens) {
  return tokenList(tokens).some((token) => token.unresolvable === true);
}
