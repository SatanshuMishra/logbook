import { rebuildIndex } from '../index/rebuild-index.mjs';

export class ToolError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolError';
  }
}

export async function commitAndReindex(driver, message) {
  const counts = await rebuildIndex(driver);
  await driver.commit(message);
  return counts;
}
