import { riskAnchor, type Risk, type Ulid } from '../schema/thread.ts'
import { unescapeStored } from '../render/escape.ts'

const WHITE_SPACE_RUN = /\p{White_Space}+/gu
const EDGE_SPACE = /^ | $/gu

export const normalisedRiskText = (storedText: string): string =>
  unescapeStored(storedText).replace(WHITE_SPACE_RUN, ' ').replace(EDGE_SPACE, '').toLowerCase()

export const riskIdentity = (anchor: Ulid | null, storedText: string): string =>
  JSON.stringify([anchor, normalisedRiskText(storedText)])

export const liveRiskIdsByIdentity = (risks: readonly Risk[]): ReadonlyMap<string, Ulid> =>
  new Map(
    risks
      .filter((risk) => !risk.retired)
      .map((risk) => [riskIdentity(riskAnchor(risk), risk.text), risk.id] as const)
      .reverse()
  )
