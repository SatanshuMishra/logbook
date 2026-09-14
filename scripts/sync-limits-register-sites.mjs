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

const refuse = (problem, lines) => {
  process.stderr.write(`sync-limits-register-sites: ${problem}:\n${lines.join('\n')}\n`)
  process.exit(1)
}

const recordedSites = rows.map((row) => row.site)
const sharedSites = rows.filter((row, index) => recordedSites.indexOf(row.site) !== index)
if (sharedSites.length > 0) {
  refuse(`${sharedSites.length} row(s) share a recorded site, so a mirror naming that site is ambiguous`, sharedSites.map((row) => `${row.site} ${row.name}`))
}

const danglingMirrors = rows.filter((row) => row.mirrors !== null && !recordedSites.includes(row.mirrors))
if (danglingMirrors.length > 0) {
  refuse(`${danglingMirrors.length} row(s) mirror a site no row records`, danglingMirrors.map((row) => `${row.name} mirrors ${row.mirrors}`))
}

const liveSites = rows.map(liveSiteOf)
const missing = rows.filter((_, index) => liveSites[index] === null)
if (missing.length > 0) {
  refuse(`no declaration found for ${missing.length} row(s)`, missing.map((row) => `${row.site} ${row.name}`))
}

const moves = new Map(rows.map((row, index) => [row.site, liveSites[index]]))

const synced = rows.map((row, index) => ({
  ...row,
  site: liveSites[index],
  mirrors: row.mirrors === null ? null : moves.get(row.mirrors)
}))

writeFileSync(REGISTER_PATH, `${JSON.stringify(synced, null, 2)}\n`)
const movedCount = rows.filter((row, index) => liveSites[index] !== row.site).length
process.stdout.write(`sync-limits-register-sites: ${movedCount} site(s) moved\n`)
