import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { ALL_TOOLS } from '../../src/server/register.ts'
import { LEDGER_TOOL_NAMES } from '../../src/server/tool-names.ts'
import type { Classified } from './census.ts'
import type { SpawnedServer } from './spawn-client.ts'

export type Verdict = Classified<unknown>['verdict'] | 'unclassifiable'

export type PublishedTool = { name: string; description: string; inputSchema: Record<string, unknown> }

export const listPublishedTools = async (s: SpawnedServer): Promise<PublishedTool[]> => {
  const listed = await s.client.listTools()
  return listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as unknown as Record<string, unknown>
  }))
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const ROOT_UNION_KEYS = ['oneOf', 'anyOf', 'allOf'] as const

export const classifyPublishedInput = (
  published: Record<string, unknown>,
  enforcedKeys: readonly string[]
): Verdict => {
  if (ROOT_UNION_KEYS.some((key) => key in published)) return 'unclassifiable'
  if (published.type !== 'object') return 'unclassifiable'
  if (!isPlainObject(published.properties)) return 'unclassifiable'

  const publishedKeys = Object.keys(published.properties).slice().sort()
  const sortedEnforced = [...enforcedKeys].sort()
  const matches =
    publishedKeys.length === sortedEnforced.length &&
    publishedKeys.every((key, index) => key === sortedEnforced[index])
  return matches ? 'allowed' : 'forbidden'
}

export const BUDGET_BYTES = 2048
export const LEAD_SENTENCE_BYTES = 200

const SENTENCE_TERMINATOR_PATTERN = /[.!?](?:\s|$)/

const leadSentenceByteLength = (description: string): number | null => {
  const match = SENTENCE_TERMINATOR_PATTERN.exec(description)
  if (match === null) return null
  return Buffer.byteLength(description.slice(0, match.index + 1), 'utf8')
}

export const classifyDescription = (description: string): Verdict => {
  if (Buffer.byteLength(description, 'utf8') >= BUDGET_BYTES) return 'forbidden'
  const leadBytes = leadSentenceByteLength(description)
  if (leadBytes === null) return 'unclassifiable'
  return leadBytes > LEAD_SENTENCE_BYTES ? 'forbidden' : 'allowed'
}

const TOOLS_DIR = fileURLToPath(new URL('../../src/server/tools', import.meta.url))

const BARREL_BASENAME = 'index'

const toolFileBasenames = (dir: string): string[] => {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => entry.name.slice(0, -3))
    .filter((basename) => basename !== BARREL_BASENAME)
}

export type RegistryCensus = {
  files: readonly string[]
  registered: readonly string[]
  published: readonly string[]
  guardApproved: readonly string[]
}

const TOOLS_BARREL_PATH = join(TOOLS_DIR, `${BARREL_BASENAME}.ts`)

const importToolBarrel = async (): Promise<void> => {
  if (!existsSync(TOOLS_BARREL_PATH)) return
  await import(pathToFileURL(TOOLS_BARREL_PATH).href)
}

export const readRegistryCensus = async (s: SpawnedServer): Promise<RegistryCensus> => {
  await importToolBarrel()
  const listed = await s.client.listTools()
  return {
    files: toolFileBasenames(TOOLS_DIR),
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: listed.tools.map((tool) => tool.name),
    guardApproved: [...LEDGER_TOOL_NAMES]
  }
}

export const classifyRegistryName = (name: string, c: RegistryCensus): Verdict => {
  const inFiles = c.files.includes(name)
  const inRegistered = c.registered.includes(name)
  const inPublished = c.published.includes(name)
  const inGuardApproved = c.guardApproved.includes(name)
  return inFiles && inRegistered && inPublished && inGuardApproved ? 'allowed' : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published, ...c.guardApproved])]
