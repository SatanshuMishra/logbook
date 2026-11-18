#!/usr/bin/env node
import { answerHookEvent, type HookEventFields } from '../../../src/hook/event.ts'
import { productionRuntime } from '../../../src/runtime/runtime.ts'
import { HOOK_EVENT_FIELDS } from '../../../src/server/hook-tool.ts'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const substituted = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const fieldsOf = (event: Record<string, unknown>): HookEventFields =>
  Object.fromEntries(HOOK_EVENT_FIELDS.map((field) => [field, substituted(event[field])]))

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = await process.stdin.toArray()
  return Buffer.concat(chunks).toString('utf8')
}

const writeFlushed = (stream: NodeJS.WritableStream, text: string): Promise<void> =>
  new Promise((resolve) => {
    stream.write(text, () => resolve())
  })

try {
  const raw = (await readStdin()).trim()
  const parsed: unknown = raw.length === 0 ? {} : JSON.parse(raw)
  const event = isRecord(parsed) ? parsed : {}
  await writeFlushed(process.stdout, await answerHookEvent(productionRuntime(), fieldsOf(event)))
  process.exit(0)
} catch (error) {
  await writeFlushed(process.stderr, `hook-event failed: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}
