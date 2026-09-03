import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import type { Ok, Refusal } from '../schema/declare.ts'
import { projectKey } from './project-key.ts'

export type StoreLayout = {
  root: string
  records: string
  state: string
  projectRoot: string
}

const CLAUDE_PLUGIN_DATA = 'CLAUDE_PLUGIN_DATA'

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

const canonicalise = (
  projectRoot: string
): { ok: true; value: string } | { ok: false; code: string; detail: string } => {
  try {
    return { ok: true, value: realpathSync.native(projectRoot) }
  } catch (error) {
    return {
      ok: false,
      code: errnoCode(error),
      detail: error instanceof Error ? error.message : String(error)
    }
  }
}

export const layoutFor = (rt: Runtime, projectRoot: string | null): Ok<StoreLayout> | Refusal => {
  if (projectRoot === null) {
    return {
      ok: false,
      field: 'projectRoot',
      accepted: 'an absolute path to an existing, readable directory',
      example: '/Users/example/project',
      retryable: false,
      message: 'projectRoot is unavailable because the process could not read its own working directory; start the session from a readable directory'
    }
  }
  const canonical = canonicalise(projectRoot)
  if (!canonical.ok) {
    return withDetail(
      {
        ok: false,
        field: 'projectRoot',
        accepted: 'an absolute path to an existing, readable directory',
        example: '/Users/example/project',
        retryable: true,
        message: `projectRoot could not be canonicalised: ${canonical.code}`
      },
      canonical.detail
    )
  }
  const canonicalProjectRoot = canonical.value

  const pluginData = rt.env[CLAUDE_PLUGIN_DATA]
  if (pluginData === undefined || pluginData.length === 0) {
    return {
      ok: false,
      field: CLAUDE_PLUGIN_DATA,
      accepted: 'a non-empty absolute path set in the environment',
      example: '/Users/example/.claude/plugin-data',
      retryable: true,
      message: `${CLAUDE_PLUGIN_DATA} is not set; the store cannot be located without it`
    }
  }
  if (!path.isAbsolute(pluginData)) {
    return {
      ok: false,
      field: CLAUDE_PLUGIN_DATA,
      accepted: 'a non-empty absolute path set in the environment',
      example: '/Users/example/.claude/plugin-data',
      retryable: true,
      message: `${CLAUDE_PLUGIN_DATA} is set to a relative path; a relative value resolves against whatever directory the process happens to start in and can point at a different store on every launch`
    }
  }

  const key = projectKey(canonicalProjectRoot)
  const root = path.join(pluginData, key)
  const records = path.join(root, 'records')
  const state = path.join(root, 'state')

  return { ok: true, value: { root, records, state, projectRoot: canonicalProjectRoot } }
}

export const createStoreDirectories = (layout: StoreLayout): void => {
  mkdirSync(layout.records, { recursive: true })
  mkdirSync(layout.state, { recursive: true })
  const originPath = path.join(layout.state, 'origin.json')
  if (!existsSync(originPath)) {
    writeFileSync(originPath, JSON.stringify({ project_root: layout.projectRoot }), 'utf8')
  }
}

export const createStateDirectory = (layout: StoreLayout): void => {
  mkdirSync(layout.state, { recursive: true })
}
