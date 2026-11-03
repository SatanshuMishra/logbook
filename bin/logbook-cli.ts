#!/usr/bin/env node
import { runCommandLine } from '../src/command/main.ts'
import { NODE_FLOOR_MAJOR, NODE_FLOOR_MINOR, nodeFloorFailure } from '../src/runtime/node-floor.ts'
import { writeAllSync } from '../src/runtime/write-all.ts'
import { refusalPayload } from '../src/server/errors.ts'

const STDOUT_FD = 1
const STDERR_FD = 2

const writeLines = (fd: number, lines: readonly string[]): void => {
  for (const line of lines) writeAllSync(fd, `${line}\n`)
}

const floorFailure = nodeFloorFailure(process.versions.node)

if (floorFailure !== null) {
  const payload = refusalPayload({
    ok: false,
    field: 'node',
    accepted: `Node.js ${NODE_FLOOR_MAJOR}.${NODE_FLOOR_MINOR} or newer`,
    example: `${NODE_FLOOR_MAJOR}.${NODE_FLOOR_MINOR}.0`,
    retryable: false,
    message: floorFailure
  })
  writeLines(STDOUT_FD, [JSON.stringify(payload)])
  writeLines(STDERR_FD, [floorFailure])
  process.exitCode = 1
} else {
  const result = await runCommandLine(process.argv.slice(2))
  writeLines(STDOUT_FD, result.stdout)
  writeLines(STDERR_FD, result.stderr)
  process.exitCode = result.exitCode
}
