import { selectDriver } from '../drivers/select.mjs';

export async function buildContext({ projectDir, userConfig, now } = {}) {
  const resolvedDir = typeof projectDir === 'string' && projectDir.length > 0
    ? projectDir
    : (process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const cfg = userConfig && typeof userConfig === 'object' ? userConfig : {};
  const clock = typeof now === 'function' ? now : () => new Date().toISOString();
  const driver = selectDriver(resolvedDir, cfg);
  await driver.init();
  return { driver, projectDir: resolvedDir, userConfig: cfg, now: clock };
}
