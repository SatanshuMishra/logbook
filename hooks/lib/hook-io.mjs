import { invokeCli, invokeCliJson } from './cli.mjs';

const GUARDED_TOOLS = new Set(['Bash', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
const GUARD_FAILURE_REASON =
  'the Logbook guard could not evaluate this tool call and refused it; this is a guard failure, not a finding about the call itself';

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function readHookInputResult(stream = process.stdin, { maxBytes = MAX_INPUT_BYTES } = {}) {
  const chunks = [];
  let raw;
  try {
    let total = 0;
    for await (const chunk of stream) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      if (!ArrayBuffer.isView(buffer)) {
        return { ok: false, reason: 'stream-error' };
      }
      total += buffer.byteLength;
      if (total > maxBytes) {
        return { ok: false, reason: 'oversized' };
      }
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString('utf8').trim();
  } catch {
    return { ok: false, reason: 'stream-error' };
  }
  if (raw.length === 0) {
    return { ok: false, reason: 'empty' };
  }
  try {
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? { ok: true, input: parsed } : { ok: false, reason: 'malformed' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

export async function readHookInput(stream = process.stdin) {
  const result = await readHookInputResult(stream);
  return result.ok ? result.input : {};
}

export function shellCwd(source, fallback) {
  const value = source && typeof source === 'object' ? source.cwd : undefined;
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

export function hookContext(input, env = process.env) {
  const source = input && typeof input === 'object' ? input : {};
  const projectDir = env.CLAUDE_PROJECT_DIR || source.cwd || process.cwd();
  return {
    input: source,
    env,
    projectDir,
    cwd: shellCwd(source, projectDir),
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

function isKnownUnguardedTool(input) {
  const toolName = isPlainObject(input) ? input.tool_name : undefined;
  return typeof toolName === 'string' && !GUARDED_TOOLS.has(toolName);
}

export async function runGuardEntry(handler, { stream = process.stdin, env = process.env } = {}) {
  let emitted = false;
  const emit = (result) => {
    emitted = true;
    writeResult(result);
  };
  try {
    const read = await readHookInputResult(stream);
    if (!read.ok) {
      emit(guardDenial());
      return;
    }
    try {
      const result = await handler(hookContext(read.input, env));
      emit(result ?? {});
    } catch {
      emit(isKnownUnguardedTool(read.input) ? {} : guardDenial());
    }
  } catch {
    if (!emitted) {
      try {
        emit(guardDenial());
      } catch {
        void 0;
      }
    }
  } finally {
    if (!Number.isInteger(process.exitCode)) {
      process.exitCode = 0;
    }
  }
}
