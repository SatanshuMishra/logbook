#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

export const MUTANTS = [
  {
    name: 'a-tick-without-evidence-is-accepted',
    file: 'src/doc/check.ts',
    find: "after.box === 'x' && before.box !== 'x' && !hasReason(after.text, EVIDENCE_MARKER)",
    replace: "after.box === 'x' && before.box !== 'x' && hasReason(after.text, EVIDENCE_MARKER)",
    caughtBy: 'test/unit/**/*.test.ts'
  },
  {
    name: 'a-done-close-with-open-criteria-is-accepted',
    file: 'src/doc/check.ts',
    find: "if (after.status?.kind !== 'done' || before.status?.kind === 'done') return []",
    replace: "if (after.status?.kind !== 'abandoned' || before.status?.kind === 'done') return []",
    caughtBy: 'test/unit/**/*.test.ts'
  },
  {
    name: 'the-next-id-reuses-the-highest-number',
    file: 'src/doc/document.ts',
    find: 'Math.max(highest, item.number + 1)',
    replace: 'Math.max(highest, item.number)',
    caughtBy: 'test/unit/**/*.test.ts'
  },
  {
    name: 'a-base-conflict-marker-is-not-reported',
    file: 'src/doc/document.ts',
    find: "const CONFLICT_MARKERS: readonly string[] = ['<<<<<<<', '|||||||', '>>>>>>>']",
    replace: "const CONFLICT_MARKERS: readonly string[] = ['<<<<<<<', '>>>>>>>']",
    caughtBy: 'test/unit/**/*.test.ts'
  }
]

const run = (args) => spawnSync(process.execPath, args, { cwd: ROOT, stdio: 'ignore' }).status ?? 1
const git = (args) => spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' })

const readSource = (relative) => readFileSync(path.join(ROOT, relative), 'utf8')
const writeSource = (relative, text) => writeFileSync(path.join(ROOT, relative), text)

export const seed = (source, find, replace) => {
  const occurrences = source.split(find).length - 1
  if (occurrences !== 1) return { ok: false, occurrences }
  return { ok: true, occurrences, seeded: source.replace(find, replace) }
}

const main = () => {
  const targets = [...new Set(MUTANTS.map((mutant) => mutant.file))]
  const dirty = git(['status', '--porcelain', '--', ...targets]).stdout.trim()
  if (dirty.length > 0) {
    console.error(
      `seeded-mutants: a file this run mutates is already modified, so a restore could not be told apart from an edit:\n${dirty}`
    )
    process.exit(1)
  }

  const baseline = run(['--test', 'test/unit/**/*.test.ts'])
  if (baseline !== 0) {
    console.error(`seeded-mutants: the unit layer is already red at exit ${baseline}, so no mutant can prove anything`)
    process.exit(1)
  }

  const survivors = []
  for (const mutant of MUTANTS) {
    const original = readSource(mutant.file)
    const attempt = seed(original, mutant.find, mutant.replace)
    if (!attempt.ok) {
      console.error(
        `seeded-mutants: ${mutant.name} expected exactly one occurrence of its target in ${mutant.file}, found ${attempt.occurrences}; the target has moved and this mutant needs updating`
      )
      process.exit(1)
    }

    writeSource(mutant.file, attempt.seeded)
    const status = run(['--test', mutant.caughtBy])
    writeSource(mutant.file, original)

    const restored = git(['diff', '--exit-code', '--', mutant.file]).status
    if (restored !== 0) {
      console.error(`seeded-mutants: ${mutant.file} did not restore cleanly after ${mutant.name}`)
      process.exit(1)
    }

    if (status === 0) survivors.push(mutant.name)
    console.log(`${status === 0 ? 'SURVIVED' : 'killed  '}  ${mutant.name}`)
  }

  if (survivors.length > 0) {
    console.error(`\nseeded-mutants: ${survivors.length} mutant(s) survived: ${survivors.join(', ')}`)
    process.exit(1)
  }
  console.log(`\nseeded-mutants: all ${MUTANTS.length} mutants were killed`)
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
