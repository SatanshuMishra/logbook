import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_JSON_SEARCH_DEPTH = 10

export const pluginVersion = (): string => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let depth = 0; depth < PACKAGE_JSON_SEARCH_DEPTH; depth += 1) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const parsed: unknown = JSON.parse(readFileSync(candidate, 'utf8'))
      const version =
        typeof parsed === 'object' && parsed !== null && 'version' in parsed
          ? (parsed as { version: unknown }).version
          : undefined
      if (typeof version !== 'string') {
        throw new Error(`main: package.json at ${candidate} has no string "version" field`)
      }
      return version
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  throw new Error('main: could not locate package.json by walking up from the module directory')
}
