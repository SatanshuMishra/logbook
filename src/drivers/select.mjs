import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { projectKey } from '../util/project-key.mjs';
import { DEFAULT_LEDGER_BRANCH, DEFAULT_REMOTE } from './git-ledger.mjs';
import { LocalDriver } from './local-driver.mjs';
import { GitRefDriver } from './git-ref-driver.mjs';

export function isGitWorkTreeSync(projectDir) {
  if (typeof projectDir !== 'string' || projectDir.length === 0) {
    throw new Error('isGitWorkTreeSync: projectDir must be a non-empty string');
  }
  try {
    const out = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: projectDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

function ledgerDataRoot(projectDir) {
  const dataRoot = process.env.CLAUDE_PLUGIN_DATA;
  if (typeof dataRoot !== 'string' || dataRoot.length === 0) {
    throw new Error('selectDriver: CLAUDE_PLUGIN_DATA is not set');
  }
  return join(dataRoot, projectKey(projectDir));
}

export function selectDriver(projectDir, userConfig = {}) {
  if (typeof projectDir !== 'string' || projectDir.length === 0) {
    throw new Error('selectDriver: projectDir must be a non-empty string');
  }
  const base = ledgerDataRoot(projectDir);
  if (isGitWorkTreeSync(projectDir)) {
    return new GitRefDriver({
      repoDir: projectDir,
      worktreeDir: join(base, 'ledger-worktree'),
      backend: userConfig.ledger_backend ?? 'orphan-branch',
      branch: userConfig.ledger_branch ?? DEFAULT_LEDGER_BRANCH,
      remote: DEFAULT_REMOTE,
    });
  }
  return new LocalDriver(join(base, 'ledger'));
}
