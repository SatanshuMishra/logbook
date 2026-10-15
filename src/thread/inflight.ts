import { mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { durableWrite } from '../store/durable-write.ts'
import { toolSummary } from './activity.ts'
import { inflightDir, markerPath, type RepoPaths } from './paths.ts'

export type Marker = { tool_use_id: string; tool: string; summary: string; started_at: string; session: string }

export type MarkerInput = { toolUseId: string; tool: string; toolInput: Record<string, unknown>; session: string }

type MarkerFile = { file: string; marker: Marker }

const MARKER_EXTENSION = '.json'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toMarker = (value: unknown): Marker | null => {
  if (!isPlainObject(value)) return null
  const { tool_use_id, tool, summary, started_at, session } = value
  if (
    typeof tool_use_id !== 'string' ||
    typeof tool !== 'string' ||
    typeof summary !== 'string' ||
    typeof started_at !== 'string' ||
    typeof session !== 'string'
  ) {
    return null
  }
  return { tool_use_id, tool, summary, started_at, session }
}

const parseMarker = (file: string): Marker | null => {
  try {
    return toMarker(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return null
  }
}

const markerFileNames = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(MARKER_EXTENSION))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

const byStart = (left: MarkerFile, right: MarkerFile): number =>
  left.marker.started_at === right.marker.started_at
    ? left.file.localeCompare(right.file)
    : left.marker.started_at.localeCompare(right.marker.started_at)

const readMarkerFiles = (paths: RepoPaths, slug: string): MarkerFile[] => {
  const dir = inflightDir(paths, slug)
  if (!dir.ok) return []
  return markerFileNames(dir.value)
    .map((name) => path.join(dir.value, name))
    .flatMap((file): MarkerFile[] => {
      const marker = parseMarker(file)
      return marker === null ? [] : [{ file, marker }]
    })
    .sort(byStart)
}

const removeIfPresent = (file: string): void => {
  try {
    unlinkSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export const writeMarker = (rt: Runtime, paths: RepoPaths, slug: string, input: MarkerInput): boolean => {
  const target = markerPath(paths, slug, input.toolUseId)
  if (!target.ok) return false
  const marker: Marker = {
    tool_use_id: input.toolUseId,
    tool: input.tool,
    summary: toolSummary(input.tool, input.toolInput, null),
    started_at: rt.now(),
    session: input.session
  }
  mkdirSync(path.dirname(target.value), { recursive: true })
  durableWrite(target.value, `${JSON.stringify(marker)}\n`, { log: rt.log })
  return true
}

export const clearMarker = (paths: RepoPaths, slug: string, toolUseId: string): void => {
  const target = markerPath(paths, slug, toolUseId)
  if (!target.ok) return
  removeIfPresent(target.value)
}

export const listMarkers = (paths: RepoPaths, slug: string): Marker[] =>
  readMarkerFiles(paths, slug).map((entry) => entry.marker)

export const sweepMarkers = (paths: RepoPaths, slug: string, keepSession: string): void => {
  readMarkerFiles(paths, slug)
    .filter((entry) => entry.marker.session !== keepSession)
    .forEach((entry) => removeIfPresent(entry.file))
}
