#!/usr/bin/env node
import { nodeFloorFailure } from '../src/runtime/node-floor.ts'
import { productionRuntime } from '../src/runtime/runtime.ts'
import { writeAllSync } from '../src/runtime/write-all.ts'
import { main } from '../src/server/main.ts'

const STDERR_FD = 2

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
