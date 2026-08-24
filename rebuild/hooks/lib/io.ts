import { clipGraphemes } from '../../src/render/escape.ts'

export type HookVerdict = { block: false; json: object } | { block: true; reason: string }

const MAX_STDIN_BYTES = 32 * 1024 * 1024
const MAX_FIELD_GRAPHEMES = 10000

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

export const runHook: (name: string, handler: (event: unknown) => HookVerdict) => Promise<never> = async (
  name,
  handler
) => {
  try {
    const raw = await readStdin()
    const event = parseEvent(raw)
    const verdict = handler(event)
    if (verdict.block) {
      process.stderr.write(`${clipGraphemes(verdict.reason, MAX_FIELD_GRAPHEMES)}\n`)
      process.exit(2)
    }
    process.stdout.write(JSON.stringify(clipDeep(verdict.json)))
    process.exit(0)
  } catch (error) {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`${name} crashed: ${message}\n`)
    process.exit(1)
  }
}
