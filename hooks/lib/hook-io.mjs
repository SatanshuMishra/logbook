import { invokeCli, invokeCliJson } from './cli.mjs';

export async function readHookInput(stream = process.stdin) {
  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
  } catch {
    return {};
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function hookContext(input, env = process.env) {
  const source = input && typeof input === 'object' ? input : {};
  const projectDir = env.CLAUDE_PROJECT_DIR || source.cwd || process.cwd();
  return {
    input: source,
    env,
    projectDir,
    pluginRoot: env.CLAUDE_PLUGIN_ROOT ?? null,
    invokeCli: (args, options) => invokeCli(args, { env, cwd: projectDir, ...options }),
    invokeCliJson: (args, options) => invokeCliJson(args, { env, cwd: projectDir, ...options }),
  };
}

export function writeResult(result = {}) {
  if (result.json !== undefined) {
    process.stdout.write(`${JSON.stringify(result.json)}\n`);
  } else if (typeof result.stdout === 'string' && result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (typeof result.stderr === 'string' && result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  process.exitCode = Number.isInteger(result.exitCode) ? result.exitCode : 0;
}

export async function runEntry(handler, { stream = process.stdin, env = process.env } = {}) {
  try {
    const input = await readHookInput(stream);
    const ctx = hookContext(input, env);
    const result = await handler(ctx);
    writeResult(result ?? {});
  } catch {
    process.exitCode = 0;
  }
}
