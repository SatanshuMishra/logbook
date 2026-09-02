import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import type { StoreLayout } from './layout.ts'

type OriginFile = { project_root?: unknown }

const errnoCode = (error: unknown): string => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return 'unknown'
}

const withDetail = <R extends Refusal>(refusal: R, detail: string): R => {
  Object.defineProperty(refusal, 'detail', {
    value: detail,
    enumerable: false,
    writable: false,
    configurable: false
  })
  return refusal
}

const readOriginProjectRoot = (pluginDataRoot: string, key: string): string | null => {
  const originPath = path.join(pluginDataRoot, key, 'state', 'origin.json')
  try {
    const raw = readFileSync(originPath, 'utf8')
    const parsed = JSON.parse(raw) as OriginFile
    return typeof parsed.project_root === 'string' ? parsed.project_root : null
  } catch {
    return null
  }
}

const canonicalOrSelf = (candidatePath: string): string => {
  try {
    return realpathSync.native(candidatePath)
  } catch {
    return candidatePath
  }
}

const conflictsUnderOtherRoots = (
  rt: Runtime,
  pluginDataRoot: string,
  ownKey: string,
  projectRoot: string,
  ownRoot: string
): string[] => {
  const parent = path.dirname(pluginDataRoot)
  const ownRootName = path.basename(pluginDataRoot)
  const ownRootCanonical = canonicalOrSelf(ownRoot)

  let rootNames: string[]
  try {
    rootNames = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name)
      .filter((name) => name !== ownRootName)
  } catch (error) {
    rt.log({ level: 'error', event: 'store.cross-root-scan-skipped', code: errnoCode(error) })
    return []
  }

  const found: string[] = []
  for (const name of rootNames) {
    const rootPath = path.join(parent, name)
    const candidatePath = path.join(rootPath, ownKey)
    let candidateIsDirectory = false
    try {
      const candidate = lstatSync(candidatePath, { throwIfNoEntry: false })
      candidateIsDirectory = candidate !== undefined && candidate.isDirectory()
    } catch (error) {
      rt.log({ level: 'error', event: 'store.cross-root-candidate-skipped', code: errnoCode(error) })
      continue
    }
    if (!candidateIsDirectory) continue
    if (canonicalOrSelf(candidatePath) === ownRootCanonical) continue
    if (readOriginProjectRoot(rootPath, ownKey) === projectRoot) {
      found.push(`${name}/${ownKey}`)
    }
  }
  return found
}

export const ensureSingleStore = (rt: Runtime, layout: StoreLayout): Ok<StoreLayout> | Refusal => {
  const pluginDataRoot = path.dirname(layout.root)
  const ownKey = path.basename(layout.root)

  let siblingKeys: string[]
  try {
    siblingKeys = readdirSync(pluginDataRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name !== ownKey)
  } catch (error) {
    if (errnoCode(error) === 'ENOENT') {
      siblingKeys = []
    } else {
      const detail = error instanceof Error ? error.message : String(error)
      return withDetail(
        {
          ok: false,
          field: 'pluginData',
          accepted: 'a readable plugin-data directory',
          example: 'CLAUDE_PLUGIN_DATA=/Users/example/.claude/plugin-data',
          retryable: true,
          message: `plugin-data directory could not be listed: ${errnoCode(error)}`
        },
        detail
      )
    }
  }

  const conflicts = [
    ...siblingKeys.filter((name) => readOriginProjectRoot(pluginDataRoot, name) === layout.projectRoot),
    ...conflictsUnderOtherRoots(rt, pluginDataRoot, ownKey, layout.projectRoot, layout.root)
  ]

  if (conflicts.length > 0) {
    return {
      ok: false,
      field: 'store',
      accepted: 'exactly one store directory per project',
      example: ownKey,
      retryable: false,
      message: `two stores exist for this project: ${ownKey} and ${conflicts.join(', ')}`
    }
  }

  return { ok: true, value: layout }
}
