import { rebuildIndex } from '../index/rebuild-index.mjs';

export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

export function isRecoveryDegraded(commitResult) {
  return commitResult != null && commitResult.degraded === true;
}

export async function commitAndReindex(driver, message) {
  const counts = await rebuildIndex(driver);
  const result = await driver.commit(message);
  return { counts, recovery_degraded: isRecoveryDegraded(result) };
}
