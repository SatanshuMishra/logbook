#!/usr/bin/env node
import { writeSync } from 'node:fs'
import { nodeFloorFailure } from '../src/runtime/node-floor.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { main } from '../src/server/main.ts'

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

const floorFailure = nodeFloorFailure(process.versions.node)
if (floorFailure !== null) {
  writeAllSync(STDERR_FD, `${floorFailure}\n`)
  process.exit(1)
}

const rt = productionRuntime()

const reportFatal = (source: string, error: unknown): void => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  writeAllSync(STDERR_FD, `${JSON.stringify({ level: 'error', source, message })}\n`)
  process.exitCode = 1
}

process.on('uncaughtException', (error) => {
  reportFatal('uncaughtException', error)
  process.exit(1)
})

process.on('unhandledRejection', (reason) => {
  reportFatal('unhandledRejection', reason)
  process.exit(1)
})

main(rt).catch((error: unknown) => {
  reportFatal('main', error)
  process.exit(1)
})
