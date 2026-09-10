import { THREAD_SLUG_MAX } from './caps.ts'

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/
export const SLUG_PATTERN = new RegExp(`^[a-z0-9][a-z0-9-]{0,${THREAD_SLUG_MAX - 1}}$`)
export const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
export const BRANCH_PATTERN = /^(?!\/)(?!.*\.\.)(?!.*\/\/)(?!.*\.lock$)(?!.*\/$)(?!.*\.$)[A-Za-z0-9._/-]+$/
export const SHA_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
