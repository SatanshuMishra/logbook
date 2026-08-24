import { createHash } from 'node:crypto'

export const projectKey = (canonicalAbsolutePath: string): string =>
  createHash('sha256').update(canonicalAbsolutePath, 'utf8').digest('hex').slice(0, 32)
