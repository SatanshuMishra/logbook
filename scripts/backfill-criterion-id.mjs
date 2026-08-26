#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ThreadRecord } from '../src/schema/thread.ts'
import { backfillCriterionIds } from '../src/domain/criterion-backfill.ts'

const [, , inputPath, outputPath] = process.argv

if (inputPath === undefined) {
  process.stderr.write('usage: node scripts/backfill-criterion-id.mjs <thread.json> [output.json]\n')
  process.exit(1)
}

const resolvedInput = resolve(inputPath)
const raw = readFileSync(resolvedInput, 'utf8')
const parsedInput = ThreadRecord.parse(JSON.parse(raw))
if (!parsedInput.ok) {
  process.stderr.write(`backfill-criterion-id: ${resolvedInput} does not parse as a thread: ${parsedInput.message}\n`)
  process.exit(1)
}

const migrated = backfillCriterionIds(parsedInput.value)
const parsedOutput = ThreadRecord.parse(migrated)
if (!parsedOutput.ok) {
  process.stderr.write(`backfill-criterion-id: the migrated record failed to re-validate: ${parsedOutput.message}\n`)
  process.exit(1)
}

const serialised = `${JSON.stringify(parsedOutput.value, null, 2)}\n`

if (outputPath === undefined) {
  process.stdout.write(serialised)
} else {
  const resolvedOutput = resolve(outputPath)
  writeFileSync(resolvedOutput, serialised)
  process.stderr.write(`backfill-criterion-id: wrote ${resolvedOutput}\n`)
}
