#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REGISTER_PATH = path.join(ROOT, 'docs', 'registers', 'size-limits.json')

const rows = JSON.parse(readFileSync(REGISTER_PATH, 'utf8'))
const linesByFile = new Map()

const linesOf = (file) => {
  if (!linesByFile.has(file)) {
    linesByFile.set(file, readFileSync(path.join(ROOT, file), 'utf8').split('\n'))
  }
  return linesByFile.get(file)
}

const escapeForRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const fileOf = (site) => site.slice(0, site.lastIndexOf(':'))

const liveSiteOf = (row) => {
  const file = fileOf(row.site)
  const declaration = new RegExp(`^(export )?const ${escapeForRegExp(row.name)}\\b`)
  const index = linesOf(file).findIndex((line) => declaration.test(line))
  return index === -1 ? null : `${file}:${index + 1}`
}

const moves = new Map(rows.map((row) => [row.site, liveSiteOf(row)]))
const missing = rows.filter((row) => moves.get(row.site) === null)

if (missing.length > 0) {
  process.stderr.write(
    `sync-limits-register-sites: no declaration found for ${missing.length} row(s):\n${missing.map((row) => `${row.site} ${row.name}`).join('\n')}\n`
  )
  process.exit(1)
}

const synced = rows.map((row) => ({
  ...row,
  site: moves.get(row.site),
  mirrors: row.mirrors === null ? null : (moves.get(row.mirrors) ?? row.mirrors)
}))

writeFileSync(REGISTER_PATH, `${JSON.stringify(synced, null, 2)}\n`)
const movedCount = rows.filter((row) => moves.get(row.site) !== row.site).length
process.stdout.write(`sync-limits-register-sites: ${movedCount} site(s) moved\n`)
