import { invokeCli, invokeCliJson } from './cli.mjs';

const GUARDED_TOOLS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const GUARD_FAILURE_REASON =
  'the session-continuity guard could not evaluate this tool call and refused it; this is a guard failure, not a finding about the call itself';

export async function readHookInputResult(stream = process.stdin) {
  const chunks = [];
  try {
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
  } catch {
    return { ok: false, reason: 'stream-error' };
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (raw.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object'
      ? { ok: true, input: parsed }
      : { ok: false, reason: 'malformed' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export async function readHookInput(stream = process.stdin) {
  const result = await readHookInputResult(stream);
  return result.ok ? result.input : {};
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

function guardDenial() {
  return {
    json: {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: GUARD_FAILURE_REASON,
      },
    },
  };
}

export async function runGuardEntry(handler, { stream = process.stdin, env = process.env } = {}) {
  const read = await readHookInputResult(stream);
  if (!read.ok) {
    writeResult(guardDenial());
    return;
  }
  try {
    const result = await handler(hookContext(read.input, env));
    writeResult(result ?? {});
  } catch {
    writeResult(GUARDED_TOOLS.has(read.input.tool_name) ? guardDenial() : {});
  }
}
