import { clipGraphemes } from '../../src/render/escape.ts'
import { nodeFloorFailure } from '../../src/runtime/node-floor.ts'

export type HookVerdict = { block: false; json: object } | { block: true; reason: string }

const MAX_STDIN_BYTES = 32 * 1024 * 1024
const MAX_FIELD_GRAPHEMES = 14000

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of process.stdin) {
    const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer)
    total += buffer.byteLength
    if (total > MAX_STDIN_BYTES) throw new Error('hook stdin exceeded the maximum accepted size')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const parseEvent = (raw: string): unknown => {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? {} : JSON.parse(trimmed)
}

const clipDeep = (value: unknown): unknown => {
  if (typeof value === 'string') return clipGraphemes(value, MAX_FIELD_GRAPHEMES)
  if (Array.isArray(value)) return value.map(clipDeep)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, clipDeep(entry)]))
  }
  return value
}

const isPreToolUseContext = (value: unknown): value is { additionalContext: string } =>
  typeof value === 'object' &&
  value !== null &&
  (value as Record<string, unknown>).hookEventName === 'PreToolUse' &&
  typeof (value as Record<string, unknown>).additionalContext === 'string'

const clipOutput = (json: object): unknown => {
  const output = (json as { hookSpecificOutput?: unknown }).hookSpecificOutput
  if (!isPreToolUseContext(output)) return clipDeep(json)
  const clipped = clipDeep({ ...json, hookSpecificOutput: { ...output, additionalContext: '' } }) as Record<string, object>
  return { ...clipped, hookSpecificOutput: { ...clipped.hookSpecificOutput, additionalContext: output.additionalContext } }
}

const writeFlushed = (stream: NodeJS.WritableStream, text: string): Promise<void> =>
  new Promise((resolve) => {
    stream.write(text, () => resolve())
  })

export const runHook: (name: string, handler: (event: unknown) => HookVerdict) => Promise<never> = async (
  name,
  handler
) => {
  const floorFailure = nodeFloorFailure(process.versions.node)
  if (floorFailure !== null) {
    process.stderr.write(`${floorFailure}\n`)
    process.exit(1)
  }
  try {
    const raw = await readStdin()
    const event = parseEvent(raw)
    const verdict = handler(event)
    if (verdict.block) {
      await writeFlushed(process.stderr, `${verdict.reason}\n`)
      process.exit(2)
    }
    await writeFlushed(process.stdout, JSON.stringify(clipOutput(verdict.json)))
    process.exit(0)
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`${name} crashed: ${message}\n`)
    process.exit(1)
  }
}
