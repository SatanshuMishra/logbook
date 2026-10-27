import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  WARNING_PREFIX,
  appendEvent,
  eventPath,
  runId,
  storeRoot,
  summaryPath,
  writeCatalogue,
  writeSummary,
  type Fields
} from '../../metrics/metrics-writer.ts'
import type { Runtime } from '../runtime/runtime.ts'
import { pluginVersion } from '../runtime/version.ts'
import type { RepoPaths } from '../thread/paths.ts'
import { readDocument } from '../thread/store.ts'
import { buildSummary, type EventLine } from './summary.ts'

const PLUGIN = 'logbook'
const CATALOGUE_URL = new URL('./catalogue.json', import.meta.url)
const STAMP_AND_SUFFIX = /^([0-9]{8}T[0-9]{6}Z)\.jsonl?$/

const warn = (rt: Runtime, reason: string): void => {
  rt.log({ level: 'warn', event: 'metrics.not-written', reason })
}

const reported = (rt: Runtime, warning: string | null | undefined): void => {
  if (typeof warning === 'string') warn(rt, warning)
}

const guarded = <T>(rt: Runtime, fallback: T, work: () => T): T => {
  try {
    return work()
  } catch (error) {
    warn(rt, `${WARNING_PREFIX}${error instanceof Error ? error.message : String(error)}`)
    return fallback
  }
}

export const metricsRepo = (paths: RepoPaths): string => path.basename(path.dirname(paths.commonDir))

const copyCatalogue = (rt: Runtime): void =>
  guarded(rt, undefined, () => {
    const catalogue: unknown = JSON.parse(readFileSync(CATALOGUE_URL, 'utf8'))
    reported(rt, writeCatalogue({ plugin: PLUGIN, catalogue, environ: rt.env }))
  })

export const startRun = (rt: Runtime, _paths: RepoPaths, slug: string): string | null => {
  copyCatalogue(rt)
  return guarded(rt, null, () => runId(slug, new Date(rt.now())))
}

const stampsIn = (folder: string, slug: string): string[] => {
  const prefix = `${slug}.`
  try {
    return readdirSync(folder)
      .filter((name) => name.startsWith(prefix))
      .map((name) => STAMP_AND_SUFFIX.exec(name.slice(prefix.length))?.[1])
      .filter((stamp): stamp is string => stamp !== undefined)
  } catch {
    return []
  }
}

const newestRun = (rt: Runtime, paths: RepoPaths, slug: string): string | null => {
  const root = storeRoot(rt.env)
  const repo = metricsRepo(paths)
  const folders = [eventPath(root, PLUGIN, repo, slug), summaryPath(root, PLUGIN, repo, slug)].map((file) =>
    path.dirname(file)
  )
  const newest = folders
    .flatMap((folder) => stampsIn(folder, slug))
    .reduce<string | null>((best, stamp) => (best === null || stamp > best ? stamp : best), null)
  return newest === null ? null : `${slug}.${newest}`
}

export const threadRun = (rt: Runtime, paths: RepoPaths, slug: string): string | null =>
  guarded(rt, null, () => newestRun(rt, paths, slug)) ?? startRun(rt, paths, slug)

export const recordInRun = (rt: Runtime, paths: RepoPaths, run: string, event: string, fields: Fields): void =>
  guarded(rt, undefined, () => {
    reported(
      rt,
      appendEvent({
        plugin: PLUGIN,
        pluginVersion: pluginVersion(),
        repo: metricsRepo(paths),
        run,
        event,
        fields,
        environ: rt.env,
        now: new Date(rt.now())
      })
    )
  })

export const recordEvent = (rt: Runtime, paths: RepoPaths, slug: string, event: string, fields: Fields): void =>
  guarded(rt, undefined, () => {
    const run = threadRun(rt, paths, slug)
    if (run !== null) recordInRun(rt, paths, run, event, fields)
  })

const isEventLine = (value: unknown): value is EventLine =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const parsedLine = (text: string): EventLine | null => {
  try {
    const value: unknown = JSON.parse(text)
    return isEventLine(value) ? value : null
  } catch {
    return null
  }
}

const runLines = (rt: Runtime, paths: RepoPaths, run: string): EventLine[] => {
  const file = eventPath(storeRoot(rt.env), PLUGIN, metricsRepo(paths), run)
  try {
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0)
      .map(parsedLine)
      .filter((line): line is EventLine => line !== null)
  } catch {
    return []
  }
}

export const writeThreadSummary = (rt: Runtime, paths: RepoPaths, slug: string): void =>
  guarded(rt, undefined, () => {
    const run = threadRun(rt, paths, slug)
    if (run === null) return
    const now = rt.now()
    const fields = buildSummary(runLines(rt, paths, run), readDocument(rt, paths, slug)?.text ?? '', now)
    copyCatalogue(rt)
    reported(
      rt,
      writeSummary({
        plugin: PLUGIN,
        pluginVersion: pluginVersion(),
        repo: metricsRepo(paths),
        run,
        fields,
        environ: rt.env,
        now: new Date(now)
      })
    )
  })
