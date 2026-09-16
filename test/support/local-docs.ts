import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const LOCAL_DOCS_ROOT = fileURLToPath(new URL('../../docs', import.meta.url))

export const skipWithoutLocalDocs: string | false = existsSync(LOCAL_DOCS_ROOT)
  ? false
  : 'docs/ holds local-only development documents and is absent from this checkout'
