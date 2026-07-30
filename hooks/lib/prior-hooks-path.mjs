import { join, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { CHAINABLE_HOOKS } from './hook-names.mjs';
import {
  WRITABLE_SCOPE_FLAG,
  isInsideWorkTree,
  originScope,
  persistentScopeExec,
  readConfig,
  readOriginValuePairs,
  realDir,
  repoExec,
  trimTrailingNewline,
} from './git-config-scope.mjs';
import { isManagedHooksDirIdentity } from './managed-hooks-identity.mjs';

export const PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPath';
export const CAPTURED_PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPathCaptured';
export const CORRUPT_PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPathCorrupt';
export const DECLINED_PRIOR_HOOKS_PATH_KEY = 'continuity.priorHooksPathDeclined';

export const PRIOR_HOOKS_PATH_KEYS = Object.freeze([
  PRIOR_HOOKS_PATH_KEY,
  CAPTURED_PRIOR_HOOKS_PATH_KEY,
  CORRUPT_PRIOR_HOOKS_PATH_KEY,
  DECLINED_PRIOR_HOOKS_PATH_KEY,
]);

export const PRIOR_HOOKS_PATH_HEAL = Object.freeze({
  notNeeded: 'not-needed',
  healed: 'healed',
  unrecoverable: 'unrecoverable',
  unrecovered: 'unrecovered',
  failed: 'failed',
});

export const PRIOR_HOOKS_PATH_CAPTURE = Object.freeze({
  captured: 'captured',
  declined: 'declined-managed',
  retained: 'retained',
});

const INHERITED_HOOKS_PATH_SCOPES = Object.freeze(['--global', '--system']);

export async function readInheritedHooksPath(repoDir) {
  for (const scope of INHERITED_HOOKS_PATH_SCOPES) {
    const { code, stdout } = await persistentScopeExec(
      repoDir,
      ['config', scope, '--get', 'core.hooksPath'],
    );
    if (code === 0 && trimTrailingNewline(stdout).length > 0) {
      return trimTrailingNewline(stdout);
    }
  }
  return null;
}

async function holdsChainableHook(dir) {
  for (const name of CHAINABLE_HOOKS) {
    try {
      if ((await stat(join(dir, name))).isFile()) {
        return true;
      }
    } catch {
      continue;
    }
  }
  return false;
}

async function isRunnablePriorDir(dir) {
  const real = await realDir(dir);
  if (real === null) {
    return false;
  }
  try {
    if (!(await stat(real)).isDirectory()) {
      return false;
    }
  } catch {
    return false;
  }
  return holdsChainableHook(real);
}

export async function readEffectivePriorHooksPath(repoDir) {
  const pairs = await readOriginValuePairs(repoDir, PRIOR_HOOKS_PATH_KEY);
  if (pairs.length === 0) {
    return { value: null, values: [], count: 0, scope: null };
  }
  const effective = pairs[pairs.length - 1];
  return {
    value: effective.value,
    values: pairs.map((pair) => pair.value),
    count: pairs.filter((pair) => pair.origin === effective.origin).length,
    scope: await originScope(repoDir, effective.origin),
  };
}

async function priorHooksPathIsCorrupt(repoDir, managedDir, effective) {
  if (typeof effective.value !== 'string' || effective.value.length === 0) {
    return false;
  }
  return isManagedHooksDirIdentity(resolve(repoDir, effective.value), managedDir, repoDir);
}

async function collapseDuplicateValues(repoDir, effective) {
  const flag = WRITABLE_SCOPE_FLAG[effective.scope];
  if (effective.count <= 1 || flag === undefined) {
    return;
  }
  await repoExec(
    repoDir,
    ['config', flag, '--replace-all', PRIOR_HOOKS_PATH_KEY, effective.value],
    { check: false },
  );
}

async function usablePriorCandidate(repoDir, managedDir, candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return null;
  }
  const absolute = resolve(repoDir, candidate);
  if (await isManagedHooksDirIdentity(absolute, managedDir, repoDir)) {
    return null;
  }
  return (await isRunnablePriorDir(absolute)) ? absolute : null;
}

async function recoverFromSiblingValues(repoDir, managedDir, effective) {
  for (const value of [...effective.values].reverse()) {
    const usable = await usablePriorCandidate(repoDir, managedDir, value);
    if (usable !== null) {
      return usable;
    }
  }
  return null;
}

async function recoverFromInheritedHooksPath(repoDir, managedDir) {
  const inherited = await readInheritedHooksPath(repoDir);
  const absolute = await usablePriorCandidate(repoDir, managedDir, inherited);
  if (absolute === null || await isInsideWorkTree(repoDir, absolute)) {
    return { value: '', recovered: false };
  }
  return { value: absolute, recovered: true };
}

export async function recoverPriorHooksPath(repoDir, managedDir, effective) {
  const sibling = await recoverFromSiblingValues(repoDir, managedDir, effective);
  if (sibling !== null) {
    return { value: sibling, recovered: true };
  }
  const captured = await readConfig(repoDir, CAPTURED_PRIOR_HOOKS_PATH_KEY);
  if (captured !== null && captured.length === 0) {
    return { value: '', recovered: true };
  }
  const usable = await usablePriorCandidate(repoDir, managedDir, captured);
  if (usable !== null) {
    return { value: usable, recovered: true };
  }
  return recoverFromInheritedHooksPath(repoDir, managedDir);
}

function healOutcome(corruptValue, scope, priorHooksPath, priorHooksPathHeal) {
  return {
    priorHooksPath,
    priorHooksPathHeal,
    corruptPriorHooksPath: corruptValue,
    corruptPriorHooksPathScope: scope,
  };
}

function writeLocal(repoDir, key, value) {
  return repoExec(repoDir, ['config', '--local', '--replace-all', key, value], { check: false });
}

function clearLocal(repoDir, key) {
  return repoExec(repoDir, ['config', '--local', '--unset-all', key], { check: false });
}

async function clearDiagnosedScopeValue(repoDir, scope) {
  if (scope !== 'worktree') {
    return;
  }
  await repoExec(
    repoDir,
    ['config', '--worktree', '--unset-all', PRIOR_HOOKS_PATH_KEY],
    { check: false },
  );
}

async function writeHealedPriorHooksPath(repoDir, effective, recovered) {
  const corruptValue = effective.value ?? '';
  const scope = effective.scope;
  await writeLocal(repoDir, CORRUPT_PRIOR_HOOKS_PATH_KEY, corruptValue);
  const { code } = await writeLocal(repoDir, PRIOR_HOOKS_PATH_KEY, recovered.value);
  if (code !== 0) {
    return healOutcome(corruptValue, scope, corruptValue, PRIOR_HOOKS_PATH_HEAL.failed);
  }
  await clearDiagnosedScopeValue(repoDir, scope);
  if (!recovered.recovered) {
    return healOutcome(corruptValue, scope, '', PRIOR_HOOKS_PATH_HEAL.unrecoverable);
  }
  await clearLocal(repoDir, CORRUPT_PRIOR_HOOKS_PATH_KEY);
  return healOutcome(null, null, recovered.value, PRIOR_HOOKS_PATH_HEAL.healed);
}

async function settleCorruptRecord(repoDir, managedDir, effective) {
  const value = effective.value ?? '';
  const record = await readConfig(repoDir, CORRUPT_PRIOR_HOOKS_PATH_KEY);
  if (record === null) {
    return healOutcome(null, null, value, PRIOR_HOOKS_PATH_HEAL.notNeeded);
  }
  if (value.length > 0) {
    await clearLocal(repoDir, CORRUPT_PRIOR_HOOKS_PATH_KEY);
    return healOutcome(null, null, value, PRIOR_HOOKS_PATH_HEAL.notNeeded);
  }
  const scope = effective.scope ?? 'local';
  const recovered = await recoverPriorHooksPath(repoDir, managedDir, effective);
  if (!recovered.recovered || recovered.value.length === 0) {
    return healOutcome(record, scope, '', PRIOR_HOOKS_PATH_HEAL.unrecovered);
  }
  const { code } = await writeLocal(repoDir, PRIOR_HOOKS_PATH_KEY, recovered.value);
  if (code !== 0) {
    return healOutcome(record, scope, value, PRIOR_HOOKS_PATH_HEAL.failed);
  }
  await clearLocal(repoDir, CORRUPT_PRIOR_HOOKS_PATH_KEY);
  return healOutcome(null, null, recovered.value, PRIOR_HOOKS_PATH_HEAL.healed);
}

export async function healPriorHooksPath(repoDir, managedDir) {
  const effective = await readEffectivePriorHooksPath(repoDir);
  if (await priorHooksPathIsCorrupt(repoDir, managedDir, effective)) {
    const recovered = await recoverPriorHooksPath(repoDir, managedDir, effective);
    return writeHealedPriorHooksPath(repoDir, effective, recovered);
  }
  await collapseDuplicateValues(repoDir, effective);
  return settleCorruptRecord(repoDir, managedDir, effective);
}

export async function capturePriorHooksPath(repoDir, managedDir, current, currentDir) {
  if (currentDir !== null && await isManagedHooksDirIdentity(currentDir, managedDir, repoDir)) {
    await writeLocal(repoDir, DECLINED_PRIOR_HOOKS_PATH_KEY, currentDir);
    return {
      priorHooksPathCapture: PRIOR_HOOKS_PATH_CAPTURE.declined,
      declinedHooksPath: currentDir,
    };
  }
  const value = current ?? '';
  await repoExec(repoDir, ['config', '--local', '--replace-all', PRIOR_HOOKS_PATH_KEY, value]);
  await writeLocal(
    repoDir,
    CAPTURED_PRIOR_HOOKS_PATH_KEY,
    value.length === 0 ? '' : resolve(repoDir, value),
  );
  await clearLocal(repoDir, DECLINED_PRIOR_HOOKS_PATH_KEY);
  return { priorHooksPathCapture: PRIOR_HOOKS_PATH_CAPTURE.captured, declinedHooksPath: null };
}
