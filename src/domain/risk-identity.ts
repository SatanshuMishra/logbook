import type { Ulid } from '../schema/thread.ts'
import { unescapeStored } from '../render/escape.ts'

const WHITESPACE_RUN = /\s+/gu

export const normalisedRiskText = (storedText: string): string =>
  unescapeStored(storedText).trim().replace(WHITESPACE_RUN, ' ').toLowerCase()

export const riskIdentity = (anchor: Ulid | null, storedText: string): string =>
  JSON.stringify([anchor, normalisedRiskText(storedText)])
