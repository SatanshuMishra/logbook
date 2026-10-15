import { nodeFloorFailure } from '../../src/runtime/node-floor.ts'
import { productionRuntime, type Runtime } from '../../src/runtime/runtime.ts'
import { findRepository, startDirectory, type RepoPaths } from '../../src/thread/paths.ts'

export type HookInput = { event: Record<string, unknown>; sessionId: string; paths: RepoPaths; rt: Runtime }

export type HookOutput = Record<string, unknown>

const MAX_STDIN_BYTES = 32 * 1024 * 1024

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)

const hookInputFor = (parsed: unknown): HookInput | null => {
  if (!isRecord(parsed)) return null
  const sessionId = nonEmptyString(parsed.session_id)
  const cwd = nonEmptyString(parsed.cwd)
  if (sessionId === null || cwd === null) return null
  const rt = productionRuntime()
  const found = findRepository(rt, startDirectory(rt, cwd))
  if (!found.ok) return null
  return { event: parsed, sessionId, paths: found.value, rt }
}

const writeFlushed = (stream: NodeJS.WritableStream, text: string): Promise<void> =>
  new Promise((resolve) => {
    stream.write(text, () => resolve())
  })

const failureMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const runHook: (
  name: string,
  handler: (input: HookInput) => HookOutput | Promise<HookOutput>
) => Promise<never> = async (name, handler) => {
  const floorFailure = nodeFloorFailure(process.versions.node)
  if (floorFailure !== null) {
    process.stderr.write(`${floorFailure}\n`)
    process.exit(1)
  }
  try {
    const input = hookInputFor(parseEvent(await readStdin()))
    const output = input === null ? {} : await handler(input)
    await writeFlushed(process.stdout, JSON.stringify(output))
    process.exit(0)
  } catch (error) {
    await writeFlushed(process.stderr, `${name} failed: ${failureMessage(error)}\n`)
    process.exit(1)
  }
}
