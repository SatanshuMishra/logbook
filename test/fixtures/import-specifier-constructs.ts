import { join } from 'node:path'
import type { Stats } from 'node:fs'
export { EOL } from 'node:os'

export const dynamicSpecifierLoad = (): Promise<typeof import('node:util')> => import('node:util')

export const requireSpecifierLoad = (): unknown => require('node:crypto')

export const usesJoin = (a: string, b: string): string => join(a, b)

export type StatsAlias = Stats
