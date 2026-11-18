import type {
  EmptyHookOutput,
  PostToolUseHookOutput,
  PreToolUseHookOutput,
  SessionStartHookOutput,
  StopHookOutput
} from '../../src/hook/output.ts'
import { nodeFloorFailure } from '../../src/runtime/node-floor.ts'
import { hookInputFor, type HookInput } from '../../src/hook/input.ts'
import { productionRuntime } from '../../src/runtime/runtime.ts'

export type HookOutput =
  | EmptyHookOutput
  | StopHookOutput
  | PostToolUseHookOutput
  | SessionStartHookOutput
  | PreToolUseHookOutput

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
    const input = hookInputFor(productionRuntime, parseEvent(await readStdin()))
    const output = input === null ? {} : await handler(input)
    await writeFlushed(process.stdout, JSON.stringify(output))
    process.exit(0)
  } catch (error) {
    await writeFlushed(process.stderr, `${name} failed: ${failureMessage(error)}\n`)
    process.exit(1)
  }
}
