import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';

const MAX_BUFFER = 64 * 1024 * 1024;

async function missingWorkingDirectory(repoDir) {
  try {
    return !(await stat(repoDir)).isDirectory();
  } catch {
    return true;
  }
}

async function spawnFailure(repoDir, error) {
  if (error?.code !== 'ENOENT') return error;
  if (!(await missingWorkingDirectory(repoDir))) return error;
  return new Error(
    `gitExec: git could not start because its working directory ${repoDir} is not a directory`,
    { cause: error },
  );
}

export function gitExec(repoDir, args, options = {}) {
  const { env, check = true } = options;
  if (typeof repoDir !== 'string' || repoDir.length === 0) {
    return Promise.reject(new Error('gitExec: repoDir must be a non-empty string'));
  }
  if (!Array.isArray(args)) {
    return Promise.reject(new Error('gitExec: args must be an array of strings'));
  }
  const mergedEnv = env ? { ...process.env, ...env } : process.env;
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: repoDir, env: mergedEnv, maxBuffer: MAX_BUFFER, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') {
          spawnFailure(repoDir, error).then(reject, reject);
          return;
        }
        const code = error ? error.code : 0;
        const result = { code, stdout: stdout ?? '', stderr: stderr ?? '' };
        if (check && code !== 0) {
          const failure = new Error(
            `git ${args.join(' ')} failed (exit ${code}): ${result.stderr.trim()}`,
          );
          failure.code = code;
          failure.stdout = result.stdout;
          failure.stderr = result.stderr;
          reject(failure);
          return;
        }
        resolve(result);
      },
    );
  });
}
