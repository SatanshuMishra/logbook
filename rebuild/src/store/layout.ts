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

const canonicalise = (projectRoot: string): { ok: true; value: string } | { ok: false; detail: string } => {
  try {
    return { ok: true, value: realpathSync.native(projectRoot) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { ok: false, detail }
  }
}

export const layoutFor = (rt: Runtime, projectRoot: string): Ok<StoreLayout> | Refusal => {
  const canonical = canonicalise(projectRoot)
  if (!canonical.ok) {
    return {
      ok: false,
      field: 'projectRoot',
      accepted: 'an absolute path to an existing, readable directory',
      example: '/Users/example/project',
      retryable: true,
      message: `projectRoot could not be canonicalised: ${canonical.detail}`
    }
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

  const key = projectKey(canonicalProjectRoot)
  const root = path.join(pluginData, key)
  const records = path.join(root, 'records')
  const state = path.join(root, 'state')
  const originPath = path.join(state, 'origin.json')

  mkdirSync(records, { recursive: true })
  mkdirSync(state, { recursive: true })
  if (!existsSync(originPath)) {
    writeFileSync(originPath, JSON.stringify({ project_root: canonicalProjectRoot }), 'utf8')
  }

  return { ok: true, value: { root, records, state, projectRoot: canonicalProjectRoot } }
}
