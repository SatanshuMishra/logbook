import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { openStore, type Store } from '../../src/store/records.ts'
import { rawGit } from './git-fixture.ts'
import { testRuntime } from './runtime.ts'

export type Teammate = {
  name: string
  repo: string
  store: Store
  rt: Runtime
  goOffline: () => void
  goOnline: () => void
}

type TeammateIdentity = {
  name: string
  email: string
  ulidTimePrefix: string
}

const ANA_IDENTITY: TeammateIdentity = { name: 'ana', email: 'ana@example.test', ulidTimePrefix: '01ANATEAMA' }
const BEN_IDENTITY: TeammateIdentity = { name: 'ben', email: 'ben@example.test', ulidTimePrefix: '01BENTEAMB' }

const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

const encodeMonotonicSuffix = (seq: number): string => {
  let value = seq
  const chars: string[] = []
  for (let i = 0; i < 16; i += 1) {
    chars.unshift(CROCKFORD_ALPHABET[value % 32] as string)
    value = Math.floor(value / 32)
  }
  return chars.join('')
}

const withDistinctUlidFactory = (rt: Runtime, timePrefix: string): Runtime => {
  let sequence = 0
  return {
    ...rt,
    ulid: () => {
      const suffix = encodeMonotonicSuffix(sequence)
      sequence += 1
      return `${timePrefix}${suffix}`
    }
  }
}

const runSetupStep = (repo: string, args: string[]): void => {
  const result = rawGit(repo, args)
  if (result.status !== 0) {
    throw new Error(`clone fixture setup failed: git ${args.join(' ')}: ${result.stderr}`)
  }
}

const unreachablePath = (): string => join(tmpdir(), `logbook-unreachable-${randomUUID()}`)

type ProvisionedTeammate = { teammate: Teammate; cleanupDirs: string[] }

const provisionTeammate = (remote: string, identity: TeammateIdentity): ProvisionedTeammate => {
  const repo = mkdtempSync(join(tmpdir(), `logbook-clone-${identity.name}-`))
  runSetupStep(repo, ['clone', remote, '.'])
  runSetupStep(repo, ['config', 'user.name', identity.name])
  runSetupStep(repo, ['config', 'user.email', identity.email])

  const pluginDataHome = mkdtempSync(join(tmpdir(), `logbook-plugin-data-${identity.name}-`))
  const pluginData = join(pluginDataHome, 'plugin-data')
  mkdirSync(pluginData)
  const baseRt = testRuntime({ env: { HOME: process.env.HOME, CLAUDE_PLUGIN_DATA: pluginData } })
  const rt = withDistinctUlidFactory(baseRt, identity.ulidTimePrefix)

  const opened = openStore(rt, repo)
  if (!opened.ok) {
    throw new Error(`clone fixture could not open ${identity.name}'s store: ${opened.message}`)
  }

  const goOffline = (): void => {
    runSetupStep(repo, ['remote', 'set-url', 'origin', unreachablePath()])
  }
  const goOnline = (): void => {
    runSetupStep(repo, ['remote', 'set-url', 'origin', remote])
  }

  const teammate: Teammate = { name: identity.name, repo, store: opened.value, rt, goOffline, goOnline }
  return { teammate, cleanupDirs: [repo, pluginDataHome] }
}

export const withTwoClones = (fn: (ana: Teammate, ben: Teammate, remote: string) => void): void => {
  const remote = mkdtempSync(join(tmpdir(), 'logbook-remote-'))
  const cleanupDirs: string[] = []
  try {
    runSetupStep(remote, ['init', '--bare', '--initial-branch=main'])

    const anaProvisioned = provisionTeammate(remote, ANA_IDENTITY)
    cleanupDirs.push(...anaProvisioned.cleanupDirs)

    const benProvisioned = provisionTeammate(remote, BEN_IDENTITY)
    cleanupDirs.push(...benProvisioned.cleanupDirs)

    fn(anaProvisioned.teammate, benProvisioned.teammate, remote)
  } finally {
    for (const dir of cleanupDirs) {
      rmSync(dir, { recursive: true, force: true })
    }
    rmSync(remote, { recursive: true, force: true })
  }
}
