import { readFileSync, readdirSync } from 'node:fs'
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

export const ensureSingleStore = (rt: Runtime, layout: StoreLayout): Ok<StoreLayout> | Refusal => {
  void rt
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
      return { ok: true, value: layout }
    }
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

  const conflictingKeys = siblingKeys.filter(
    (name) => readOriginProjectRoot(pluginDataRoot, name) === layout.projectRoot
  )

  if (conflictingKeys.length > 0) {
    return {
      ok: false,
      field: 'store',
      accepted: 'exactly one store directory per project',
      example: ownKey,
      retryable: false,
      message: `two stores exist for this project: ${ownKey} and ${conflictingKeys.join(', ')}`
    }
  }

  return { ok: true, value: layout }
}
