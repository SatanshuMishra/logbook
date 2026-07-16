import { execFile } from 'node:child_process';
import { join } from 'node:path';

const MAX_BUFFER = 16 * 1024 * 1024;

export function ledgerCliPath(env = process.env) {
  const root = env.CLAUDE_PLUGIN_ROOT;
  return typeof root === 'string' && root.length > 0 ? join(root, 'bin', 'ledger-cli.mjs') : null;
}

export function invokeCli(args, { env = process.env, cwd } = {}) {
  const cliPath = ledgerCliPath(env);
  if (!cliPath) {
    return Promise.resolve({ code: -1, stdout: '', stderr: 'CLAUDE_PLUGIN_ROOT is not set' });
  }
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [cliPath, ...args],
      { cwd: cwd ?? process.cwd(), env, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const code = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
}

export async function invokeCliJson(args, options) {
  const { code, stdout } = await invokeCli(args, options);
  if (code !== 0) {
    return null;
  }
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}
