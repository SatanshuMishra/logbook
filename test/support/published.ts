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

export type PublishedClaim = { phrase: string; providers: readonly string[] }

export const PUBLISHED_CLAIMS: Readonly<Record<string, readonly PublishedClaim[]>> = {
  open_thread: [
    {
      phrase:
        'A thread needs a one-line title, a short slug that is unique in this project, and at least one completion criterion',
      providers: ['open_thread.title', 'open_thread.slug', 'open_thread.completion_criteria']
    }
  ],
  update_thread: [
    { phrase: 'mark criteria done', providers: ['update_thread.criteria_done'] },
    {
      phrase: 'refresh any of the six running-summary fields',
      providers: [
        'update_thread.active_goal',
        'update_thread.next_step',
        'update_thread.last_session',
        'update_thread.risks_add',
        'update_thread.key_decisions_add',
        'update_thread.out_of_scope_add'
      ]
    },
    {
      phrase: 'set or clear what the thread is blocked on',
      providers: ['update_thread.blocked_by', 'update_thread.blocked_by_clear']
    },
    { phrase: 'add or retire risks', providers: ['update_thread.risks_add', 'update_thread.risks_retire'] }
  ],
  close_thread: [
    {
      phrase: 'Closes one thread as either done or abandoned',
      providers: ['close_thread.thread_id', 'close_thread.outcome']
    },
    { phrase: 'a closure statement must be supplied', providers: ['close_thread.detail'] }
  ],
  amend_criteria: [
    {
      phrase: 'inserting a new one, rewriting the text of an existing one, or striking it',
      providers: ['amend_criteria.operation', 'amend_criteria.text', 'amend_criteria.criterion_id']
    },
    { phrase: 'Every amendment carries a decision_id', providers: ['amend_criteria.decision_id'] },
    { phrase: 'Insert also takes an optional zero-based position', providers: ['amend_criteria.position'] }
  ],
  bind_branch: [
    { phrase: 'Takes a thread id and a branch name', providers: ['bind_branch.thread_id', 'bind_branch.branch'] }
  ],
  resume_thread: [
    {
      phrase:
        'in a single call: it marks the thread as the one being worked on this machine and renders what the previous session left.',
      providers: []
    },
    { phrase: 'Takes one thread id', providers: ['resume_thread.thread_id'] }
  ],
  park_thread: [
    {
      phrase: 'refreshes the last_session and next_step fields',
      providers: ['park_thread.last_session', 'park_thread.next_step']
    },
    { phrase: 'Send the outcome as text', providers: ['park_thread.outcome'] },
    { phrase: 'the thread id is optional', providers: ['park_thread.thread_id'] }
  ],
  record_decision: [
    {
      phrase:
        'Takes the thread it belongs to, a one-line title, the situation that forced the choice, the options that were on the table as a list of strings, and the outcome that was chosen',
      providers: [
        'record_decision.thread_id',
        'record_decision.title',
        'record_decision.context',
        'record_decision.options',
        'record_decision.outcome'
      ]
    },
    { phrase: 'names the old one in supersedes', providers: ['record_decision.supersedes'] }
  ],
  log_session_event: [
    {
      phrase: 'Takes the thread id, who is speaking as a short string',
      providers: ['log_session_event.thread_id', 'log_session_event.actor']
    },
    { phrase: 'the entry body as Markdown text up to 8000 characters', providers: ['log_session_event.body'] }
  ],
  sync_ledger: [{ phrase: 'Takes no arguments', providers: [] }],
  resolve_conflict: [
    { phrase: 'Takes a list of {record, field, winner}', providers: ['resolve_conflict.resolutions'] }
  ],
  list_threads: [
    { phrase: 'pass `cursor` from a previous reply to read the next page', providers: ['list_threads.cursor'] },
    { phrase: '`limit` to change the page size from its default of 25', providers: ['list_threads.limit'] },
    { phrase: 'A thread that is blocked shows what it is blocked on', providers: ['update_thread.blocked_by'] }
  ]
}

type ProviderResolution = 'reachable' | 'unreachable' | 'unresolvable'

const resolveProvider = (address: string, published: readonly PublishedTool[]): ProviderResolution => {
  const separator = address.indexOf('.')
  if (separator <= 0 || separator === address.length - 1) return 'unresolvable'
  const toolName = address.slice(0, separator)
  const key = address.slice(separator + 1)
  const tool = published.find((candidate) => candidate.name === toolName)
  if (tool === undefined) return 'unresolvable'
  const properties = tool.inputSchema.properties
  if (!isPlainObject(properties)) return 'unresolvable'
  return Object.prototype.hasOwnProperty.call(properties, key) ? 'reachable' : 'unreachable'
}

export type ClaimCensusItem = {
  tool: string
  description: string
  phrase: string
  providers: readonly string[] | null
}

export const claimPopulation = (published: readonly PublishedTool[]): ClaimCensusItem[] =>
  published.flatMap((tool): ClaimCensusItem[] => {
    const claims = PUBLISHED_CLAIMS[tool.name]
    if (claims === undefined || claims.length === 0) {
      return [{ tool: tool.name, description: tool.description, phrase: '', providers: null }]
    }
    return claims.map((claim) => ({
      tool: tool.name,
      description: tool.description,
      phrase: claim.phrase,
      providers: claim.providers
    }))
  })

export const classifyPublishedClaim = (item: ClaimCensusItem, published: readonly PublishedTool[]): Verdict => {
  if (item.providers === null) return 'unclassifiable'
  if (!item.description.includes(item.phrase)) return 'unclassifiable'
  if (item.providers.length === 0) return 'allowed'
  const resolutions = item.providers.map((provider) => resolveProvider(provider, published))
  if (resolutions.some((resolution) => resolution === 'unresolvable')) return 'unclassifiable'
  return resolutions.every((resolution) => resolution === 'reachable') ? 'allowed' : 'forbidden'
}

export const claimsReachable = (published: readonly PublishedTool[]): string[] =>
  published
    .filter((tool) => claimPopulation([tool]).every((item) => classifyPublishedClaim(item, published) === 'allowed'))
    .map((tool) => tool.name)

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
  descriptionClaimsReachable: readonly string[]
}

const TOOLS_BARREL_PATH = join(TOOLS_DIR, `${BARREL_BASENAME}.ts`)

const importToolBarrel = async (): Promise<void> => {
  if (!existsSync(TOOLS_BARREL_PATH)) return
  await import(pathToFileURL(TOOLS_BARREL_PATH).href)
}

export const readRegistryCensus = async (s: SpawnedServer): Promise<RegistryCensus> => {
  await importToolBarrel()
  const listed = await s.client.listTools()
  const published: PublishedTool[] = listed.tools.map((tool) => ({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as unknown as Record<string, unknown>
  }))
  return {
    files: toolFileBasenames(TOOLS_DIR),
    registered: ALL_TOOLS.map((tool) => tool.name),
    published: published.map((tool) => tool.name),
    guardApproved: [...LEDGER_TOOL_NAMES],
    descriptionClaimsReachable: claimsReachable(published)
  }
}

export const classifyRegistryName = (name: string, c: RegistryCensus): Verdict => {
  const inFiles = c.files.includes(name)
  const inRegistered = c.registered.includes(name)
  const inPublished = c.published.includes(name)
  const inGuardApproved = c.guardApproved.includes(name)
  const inClaimsReachable = c.descriptionClaimsReachable.includes(name)
  return inFiles && inRegistered && inPublished && inGuardApproved && inClaimsReachable
    ? 'allowed'
    : 'unclassifiable'
}

export const registryPopulation = (c: RegistryCensus): readonly string[] =>
  [...new Set([...c.files, ...c.registered, ...c.published, ...c.guardApproved, ...c.descriptionClaimsReachable])]
