#!/usr/bin/env node
import { productionRuntime } from '../src/runtime/runtime.ts'
import { main } from '../src/server/main.ts'

const rt = productionRuntime()

const reportFatal = (source: string, error: unknown): void => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  process.stderr.write(`${JSON.stringify({ level: 'error', source, message })}\n`)
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
