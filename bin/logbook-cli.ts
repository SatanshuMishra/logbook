#!/usr/bin/env node
import { writeSync } from 'node:fs'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { parseSessionStartEvent, runSessionStart } from '../src/cli/session-start.ts'
import { parseSessionEndEvent, runSessionEnd } from '../src/cli/session-end.ts'

const STDOUT_FD = 1
const STDERR_FD = 2

const isEagain = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'EAGAIN'

const writeAllSync = (fd: number, data: string): void => {
  const buffer = Buffer.from(data, 'utf8')
  let offset = 0
  while (offset < buffer.length) {
    try {
      offset += writeSync(fd, buffer, offset, buffer.length - offset)
    } catch (error) {
      if (!isEagain(error)) throw error
    }
  }
}

const readStdin = async (): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer))
  }
  return Buffer.concat(chunks).toString('utf8')
}

const fail = (message: string): never => {
  writeAllSync(STDERR_FD, `logbook-cli: ${message}\n`)
  process.exit(1)
}

const parseStdinEvent = (raw: string): unknown => {
  const trimmed = raw.trim()
  return trimmed.length === 0 ? {} : JSON.parse(trimmed)
}

const main = async (): Promise<void> => {
  const command = process.argv[2]
  const raw = await readStdin()

  let event: unknown
  try {
    event = parseStdinEvent(raw)
  } catch (error) {
    fail(`stdin did not parse as JSON: ${(error as Error).message}`)
    return
  }

  const rt = productionRuntime()

  if (command === 'session-start') {
    const parsed = parseSessionStartEvent(event)
    if (parsed === null) {
      fail('stdin did not match the SessionStart event shape')
      return
    }
    writeAllSync(STDOUT_FD, JSON.stringify(runSessionStart(rt, parsed)))
    return
  }

  if (command === 'session-end') {
    const parsed = parseSessionEndEvent(event)
    if (parsed === null) {
      fail('stdin did not match the SessionEnd event shape')
      return
    }
    writeAllSync(STDOUT_FD, JSON.stringify(runSessionEnd(rt, parsed)))
    return
  }

  fail(`unknown command "${command ?? ''}"; expected "session-start" or "session-end"`)
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  fail(message)
})
