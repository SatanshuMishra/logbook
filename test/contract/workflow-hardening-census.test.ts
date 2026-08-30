import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { census, type Classified } from '../support/census.ts'

type ParsedStep = {
  index: number
  name: string | undefined
  uses: string | undefined
  run: string | undefined
  withValue: unknown
}

type ParsedJob = {
  id: string
  permissions: unknown
  steps: ParsedStep[]
  ifExpression: string | undefined
  referencesPullRequestContext: boolean
}

type ParsedWorkflow = {
  file: string
  topPermissions: unknown
  triggers: unknown
  jobs: ParsedJob[]
}

const TEST_FILE_PATH = fileURLToPath(import.meta.url)
const WORKFLOW_EXTENSIONS = new Set(['.yml', '.yaml'])
const WORKFLOWS_SUBPATH = ['.github', 'workflows']
const PULL_REQUEST_CONTEXT_TOKEN = 'github.event.pull_request'

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const findRepoRoot = (startDir: string): string => {
  let current = startDir
  while (true) {
    if (existsSync(path.join(current, ...WORKFLOWS_SUBPATH))) return current
    const parent = path.dirname(current)
    if (parent === current) {
      throw new Error(
        `workflow-hardening-census: walked up from ${startDir} to the filesystem root without finding an ancestor containing .github/workflows`
      )
    }
    current = parent
  }
}

const stepLabel = (step: ParsedStep): string => {
  if (step.name !== undefined) return `step #${step.index} "${step.name}"`
  if (step.uses !== undefined) return `step #${step.index} uses:${step.uses}`
  return `step #${step.index} run:<inline script>`
}

const parseStep = (workflowLabel: string, jobId: string, index: number, stepValue: unknown): ParsedStep => {
  assert.ok(isPlainObject(stepValue), `${workflowLabel} job "${jobId}" step #${index}: step value is not a mapping`)
  const step = stepValue as Record<string, unknown>
  const uses = typeof step.uses === 'string' ? step.uses : undefined
  const run = typeof step.run === 'string' ? step.run : undefined
  assert.ok(
    uses !== undefined || run !== undefined,
    `${workflowLabel} job "${jobId}" step #${index}: carries neither uses: nor run:, cannot classify`
  )
  const name = typeof step.name === 'string' ? step.name : undefined
  return { index, name, uses, run, withValue: step.with }
}

const parseJob = (workflowLabel: string, jobId: string, jobValue: unknown): ParsedJob => {
  assert.ok(isPlainObject(jobValue), `${workflowLabel} job "${jobId}": job value is not a mapping`)
  const job = jobValue as Record<string, unknown>
  const stepsNode = job.steps
  assert.ok(Array.isArray(stepsNode), `${workflowLabel} job "${jobId}": has no steps: array`)
  const steps = stepsNode.map((stepValue, index) => parseStep(workflowLabel, jobId, index, stepValue))
  return {
    id: jobId,
    permissions: job.permissions,
    steps,
    ifExpression: typeof job.if === 'string' ? job.if : undefined,
    referencesPullRequestContext: JSON.stringify(job).includes(PULL_REQUEST_CONTEXT_TOKEN)
  }
}

const parseWorkflowFile = (absolutePath: string, label: string): ParsedWorkflow => {
  const raw = readFileSync(absolutePath, 'utf8')
  const doc: unknown = parseYaml(raw)
  assert.ok(isPlainObject(doc), `${label}: did not parse to a YAML mapping`)
  const jobsNode = (doc as Record<string, unknown>).jobs
  assert.ok(isPlainObject(jobsNode), `${label}: has no jobs: mapping`)
  const jobs = Object.entries(jobsNode as Record<string, unknown>).map(([jobId, jobValue]) =>
    parseJob(label, jobId, jobValue)
  )
  assert.ok(jobs.length > 0, `${label}: jobs: mapping is empty`)
  return {
    file: label,
    topPermissions: (doc as Record<string, unknown>).permissions,
    triggers: (doc as Record<string, unknown>).on,
    jobs
  }
}

const loadWorkflows = (): ParsedWorkflow[] => {
  const repoRoot = findRepoRoot(path.dirname(TEST_FILE_PATH))
  const workflowsDir = path.join(repoRoot, ...WORKFLOWS_SUBPATH)
  const fileNames = readdirSync(workflowsDir)
    .filter((name) => WORKFLOW_EXTENSIONS.has(path.extname(name)))
    .sort()
  assert.ok(fileNames.length > 0, `workflow-hardening-census: ${workflowsDir} contains zero workflow files`)
  return fileNames.map((name) =>
    parseWorkflowFile(path.join(workflowsDir, name), path.posix.join(...WORKFLOWS_SUBPATH, name))
  )
}

const describeViolations = <T>(
  property: string,
  population: readonly T[],
  classify: (item: T) => Classified<T>['verdict'] | 'unclassifiable'
): string => {
  const violations = population.filter((item) => classify(item) !== 'allowed')
  return [
    `workflow-hardening.${property}: ${violations.length} of ${population.length} items violate or cannot be classified`,
    ...violations.map((item) => JSON.stringify(item))
  ].join('\n')
}

type PermissionsItem = {
  workflow: string
  job: string
  scopeSource: 'job' | 'workflow' | 'none'
  value: unknown
}

const WRITE_SCOPE_VALUE = 'write'
const READ_ALL_PERMISSIONS_VALUE = 'read-all'
const WRITE_ALL_PERMISSIONS_VALUE = 'write-all'

const permissionsItemFor = (workflow: ParsedWorkflow, job: ParsedJob): PermissionsItem => {
  if (job.permissions !== undefined) {
    return { workflow: workflow.file, job: job.id, scopeSource: 'job', value: job.permissions }
  }
  if (workflow.topPermissions !== undefined) {
    return { workflow: workflow.file, job: job.id, scopeSource: 'workflow', value: workflow.topPermissions }
  }
  return { workflow: workflow.file, job: job.id, scopeSource: 'none', value: undefined }
}

const classifyPermissions = (item: PermissionsItem): Classified<PermissionsItem>['verdict'] | 'unclassifiable' => {
  if (item.scopeSource === 'none') return 'forbidden'
  const value = item.value
  if (value === READ_ALL_PERMISSIONS_VALUE) return 'allowed'
  if (value === WRITE_ALL_PERMISSIONS_VALUE) return 'forbidden'
  if (typeof value === 'string') return 'unclassifiable'
  if (isPlainObject(value)) {
    return Object.values(value).some((scopeValue) => scopeValue === WRITE_SCOPE_VALUE) ? 'forbidden' : 'allowed'
  }
  return 'unclassifiable'
}

type CredentialsItem = {
  workflow: string
  job: string
  step: string
  withValue: unknown
}

const CHECKOUT_ACTION_NAME = 'actions/checkout'
const PERSIST_CREDENTIALS_KEY = 'persist-credentials'

const isCheckoutStep = (step: ParsedStep): boolean =>
  step.uses !== undefined && step.uses.split('@')[0] === CHECKOUT_ACTION_NAME

const credentialsItemFor = (workflow: ParsedWorkflow, job: ParsedJob, step: ParsedStep): CredentialsItem => ({
  workflow: workflow.file,
  job: job.id,
  step: stepLabel(step),
  withValue: step.withValue
})

const classifyCredentials = (item: CredentialsItem): Classified<CredentialsItem>['verdict'] | 'unclassifiable' => {
  if (item.withValue === undefined) return 'forbidden'
  if (!isPlainObject(item.withValue)) return 'unclassifiable'
  return item.withValue[PERSIST_CREDENTIALS_KEY] === false ? 'allowed' : 'forbidden'
}

const QUOTED_SEGMENT_PATTERN = /'[^']*'|"[^"]*"/g
const SHELL_SEPARATOR_PATTERN = /\|\||&&|;|\||&/
const SHELL_CONTROL_WORDS = new Set(['if', 'then', 'else', 'elif', 'fi', 'do', 'done', 'while', 'for', 'case', 'esac', 'set', '{', '}'])
const PACKAGE_MANAGER_TOKENS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'bun'])
const SUDO_TOKEN = 'sudo'
const IGNORE_SCRIPTS_FLAG = '--ignore-scripts'
const PACKAGE_MANAGER_TOKEN_PATTERN = new RegExp(`(?<![\\w-])(${[...PACKAGE_MANAGER_TOKENS].join('|')})(?![\\w-])`, 'g')

const blankQuotedSegments = (script: string): string =>
  script.replace(QUOTED_SEGMENT_PATTERN, (match) => ' '.repeat(match.length))

const candidateCommandsFrom = (script: string): string[] =>
  blankQuotedSegments(script)
    .split('\n')
    .flatMap((line) => line.split(SHELL_SEPARATOR_PATTERN))
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate.length > 0 && !SHELL_CONTROL_WORDS.has(candidate))

const rawPackageManagerTokenCount = (script: string): number =>
  (script.match(PACKAGE_MANAGER_TOKEN_PATTERN) ?? []).length

const firstNonFlagToken = (tokens: string[]): string | undefined => tokens.find((token) => !token.startsWith('-'))

const npxTargetFrom = (
  manager: string,
  subcommand: string | undefined,
  tokens: string[],
  firstIndex: number
): string | undefined => {
  if (manager === 'npx') return firstNonFlagToken(tokens.slice(firstIndex + 1))
  if (manager === 'npm' && subcommand === 'exec') return firstNonFlagToken(tokens.slice(firstIndex + 2))
  return undefined
}

type PackageManagerInvocation = {
  manager: string
  subcommand: string | undefined
  hasIgnoreScriptsFlag: boolean
  command: string
  npxTarget: string | undefined
}

const invocationFromCandidate = (candidate: string): PackageManagerInvocation | undefined => {
  const tokens = candidate.split(/\s+/).filter((token) => token.length > 0)
  const firstIndex = tokens[0] === SUDO_TOKEN ? 1 : 0
  const manager = tokens[firstIndex]
  if (manager === undefined || !PACKAGE_MANAGER_TOKENS.has(manager)) return undefined
  const subcommand = tokens[firstIndex + 1]
  return {
    manager,
    subcommand,
    hasIgnoreScriptsFlag: tokens.includes(IGNORE_SCRIPTS_FLAG),
    command: candidate,
    npxTarget: npxTargetFrom(manager, subcommand, tokens, firstIndex)
  }
}

const packageManagerInvocationsIn = (script: string): PackageManagerInvocation[] =>
  candidateCommandsFrom(script)
    .map(invocationFromCandidate)
    .filter((invocation): invocation is PackageManagerInvocation => invocation !== undefined)

type InvocationItem = {
  kind: 'invocation'
  workflow: string
  job: string
  step: string
  manager: string
  subcommand: string | undefined
  command: string
  hasIgnoreScriptsFlag: boolean
  npxTarget: string | undefined
}

type ReconciliationItem = {
  kind: 'reconciliation'
  workflow: string
  job: string
  step: string
  rawTokenCount: number
  extractedCount: number
}

type InstallItem = InvocationItem | ReconciliationItem

const installItemsForStep = (workflow: ParsedWorkflow, job: ParsedJob, step: ParsedStep): InstallItem[] => {
  if (step.run === undefined) return []
  const script = step.run
  const invocations = packageManagerInvocationsIn(script)
  const invocationItems: InstallItem[] = invocations.map((invocation) => ({
    kind: 'invocation',
    workflow: workflow.file,
    job: job.id,
    step: stepLabel(step),
    manager: invocation.manager,
    subcommand: invocation.subcommand,
    command: invocation.command,
    hasIgnoreScriptsFlag: invocation.hasIgnoreScriptsFlag,
    npxTarget: invocation.npxTarget
  }))
  const reconciliationItem: InstallItem = {
    kind: 'reconciliation',
    workflow: workflow.file,
    job: job.id,
    step: stepLabel(step),
    rawTokenCount: rawPackageManagerTokenCount(script),
    extractedCount: invocations.length
  }
  return [...invocationItems, reconciliationItem]
}

const NPM_INSTALLING_SUBCOMMANDS = new Set(['ci', 'install', 'i', 'add', 'install-test', 'it', 'install-ci-test', 'cit'])
const NPM_NON_INSTALLING_SUBCOMMANDS = new Set([
  'run',
  'run-script',
  'test',
  'ls',
  'version',
  'pack',
  'publish',
  'view',
  'config',
  'cache',
  'audit',
  'whoami',
  'prune',
  'rebuild',
  'init',
  'why',
  'outdated',
  'link'
])

const isRegistryFetchTarget = (target: string): boolean => target.includes('@') || target.includes('/')

const classifyNpxTarget = (
  target: string | undefined,
  resolvableBinNames: ReadonlySet<string>
): Classified<InstallItem>['verdict'] | 'unclassifiable' => {
  if (target === undefined) return 'unclassifiable'
  if (isRegistryFetchTarget(target)) return 'unclassifiable'
  return resolvableBinNames.has(target) ? 'allowed' : 'unclassifiable'
}

const classifyInstallItem =
  (resolvableBinNames: ReadonlySet<string>) =>
  (item: InstallItem): Classified<InstallItem>['verdict'] | 'unclassifiable' => {
    if (item.kind === 'reconciliation') {
      return item.rawTokenCount > item.extractedCount ? 'unclassifiable' : 'allowed'
    }
    if (item.manager === 'npx') return classifyNpxTarget(item.npxTarget, resolvableBinNames)
    if (item.manager !== 'npm') return 'unclassifiable'
    if (item.subcommand === 'exec') return classifyNpxTarget(item.npxTarget, resolvableBinNames)
    if (item.subcommand !== undefined && NPM_INSTALLING_SUBCOMMANDS.has(item.subcommand)) {
      return item.hasIgnoreScriptsFlag ? 'allowed' : 'forbidden'
    }
    if (item.subcommand !== undefined && NPM_NON_INSTALLING_SUBCOMMANDS.has(item.subcommand)) {
      return 'allowed'
    }
    return 'unclassifiable'
  }

const PACKAGE_JSON_FILE_NAME = 'package.json'
const PACKAGE_LOCK_FILE_NAME = 'package-lock.json'
const NODE_MODULES_PREFIX = 'node_modules/'

const readJsonFile = (absolutePath: string, label: string): unknown => {
  const raw = readFileSync(absolutePath, 'utf8')
  try {
    return JSON.parse(raw)
  } catch (error) {
    throw new Error(`workflow-hardening-census: ${label} did not parse as JSON: ${(error as Error).message}`)
  }
}

const declaredDependencyNames = (packageJsonDoc: unknown, label: string): string[] => {
  assert.ok(isPlainObject(packageJsonDoc), `${label}: did not parse to a JSON mapping`)
  const pkg = packageJsonDoc as Record<string, unknown>
  return [pkg.dependencies, pkg.devDependencies].flatMap((section) =>
    isPlainObject(section) ? Object.keys(section) : []
  )
}

const binNamesForPackage = (packageName: string, lockPackages: Record<string, unknown>): string[] => {
  const entry = lockPackages[`${NODE_MODULES_PREFIX}${packageName}`]
  if (!isPlainObject(entry)) return []
  const bin = entry.bin
  return isPlainObject(bin) ? Object.keys(bin) : []
}

const resolvableBinNamesFrom = (repoRoot: string): ReadonlySet<string> => {
  const packageJsonDoc = readJsonFile(path.join(repoRoot, PACKAGE_JSON_FILE_NAME), PACKAGE_JSON_FILE_NAME)
  const packageLockDoc = readJsonFile(path.join(repoRoot, PACKAGE_LOCK_FILE_NAME), PACKAGE_LOCK_FILE_NAME)
  assert.ok(isPlainObject(packageLockDoc), `workflow-hardening-census: ${PACKAGE_LOCK_FILE_NAME} did not parse to a JSON mapping`)
  const lockPackagesNode = (packageLockDoc as Record<string, unknown>).packages
  assert.ok(isPlainObject(lockPackagesNode), `workflow-hardening-census: ${PACKAGE_LOCK_FILE_NAME} has no packages mapping`)
  const lockPackages = lockPackagesNode as Record<string, unknown>
  const dependencyNames = declaredDependencyNames(packageJsonDoc, PACKAGE_JSON_FILE_NAME)
  return new Set(dependencyNames.flatMap((name) => binNamesForPackage(name, lockPackages)))
}

test('workflow-hardening.permissions', () => {
  const workflows = loadWorkflows()
  const population = workflows.flatMap((workflow) => workflow.jobs.map((job) => permissionsItemFor(workflow, job)))

  assert.ok(
    population.length > 0,
    'workflow-hardening.permissions: zero jobs found across all workflows; a census over an empty population proves nothing'
  )

  assert.doesNotThrow(
    () => census(population, classifyPermissions),
    describeViolations('permissions', population, classifyPermissions)
  )
})

test('workflow-hardening.checkout-credentials', () => {
  const workflows = loadWorkflows()
  const population = workflows.flatMap((workflow) =>
    workflow.jobs.flatMap((job) => job.steps.filter(isCheckoutStep).map((step) => credentialsItemFor(workflow, job, step)))
  )

  assert.ok(
    population.length > 0,
    'workflow-hardening.checkout-credentials: zero actions/checkout steps found across all workflows; a census over an empty population proves nothing'
  )

  assert.doesNotThrow(
    () => census(population, classifyCredentials),
    describeViolations('checkout-credentials', population, classifyCredentials)
  )
})

test('workflow-hardening.install-ignore-scripts', () => {
  const workflows = loadWorkflows()
  const repoRoot = findRepoRoot(path.dirname(TEST_FILE_PATH))
  const resolvableBinNames = resolvableBinNamesFrom(repoRoot)
  const population = workflows.flatMap((workflow) =>
    workflow.jobs.flatMap((job) => job.steps.flatMap((step) => installItemsForStep(workflow, job, step)))
  )

  assert.ok(
    population.length > 0,
    'workflow-hardening.install-ignore-scripts: zero package-manager invocations found across all workflows; a census over an empty population proves nothing'
  )

  const classify = classifyInstallItem(resolvableBinNames)
  assert.doesNotThrow(
    () => census(population, classify),
    describeViolations('install-ignore-scripts', population, classify)
  )
})

const PULL_REQUEST_EVENT_GUARD = "github.event_name == 'pull_request'"
const PUSH_TRIGGER_KEY = 'push'
const TRIGGER_BRANCHES_KEY = 'branches'
const TRUNK_BRANCH_NAME = 'main'

type TrunkVerificationItem = {
  workflow: string
  job: string
  triggers: unknown
  referencesPullRequestContext: boolean
  ifExpression: string | undefined
}

const trunkVerificationItemFor = (workflow: ParsedWorkflow, job: ParsedJob): TrunkVerificationItem => ({
  workflow: workflow.file,
  job: job.id,
  triggers: workflow.triggers,
  referencesPullRequestContext: job.referencesPullRequestContext,
  ifExpression: job.ifExpression
})

const classifyTrunkVerification = (
  item: TrunkVerificationItem
): Classified<TrunkVerificationItem>['verdict'] | 'unclassifiable' => {
  if (!isPlainObject(item.triggers)) return 'unclassifiable'
  const pushNode = item.triggers[PUSH_TRIGGER_KEY]
  if (pushNode !== undefined && !isPlainObject(pushNode)) return 'unclassifiable'
  const branchesNode = isPlainObject(pushNode) ? pushNode[TRIGGER_BRANCHES_KEY] : undefined
  if (pushNode !== undefined && !Array.isArray(branchesNode)) return 'unclassifiable'
  const runsOnPushToTrunk = Array.isArray(branchesNode) && branchesNode.includes(TRUNK_BRANCH_NAME)
  if (!item.referencesPullRequestContext) return runsOnPushToTrunk ? 'allowed' : 'forbidden'
  if (!runsOnPushToTrunk) return item.ifExpression === undefined ? 'allowed' : 'unclassifiable'
  return item.ifExpression === PULL_REQUEST_EVENT_GUARD ? 'allowed' : 'forbidden'
}

test('workflow-hardening.trunk-verification', () => {
  const workflows = loadWorkflows()
  const population = workflows.flatMap((workflow) =>
    workflow.jobs.map((job) => trunkVerificationItemFor(workflow, job))
  )

  assert.ok(
    population.length > 0,
    'workflow-hardening.trunk-verification: zero jobs found across all workflows; a census over an empty population proves nothing'
  )

  assert.doesNotThrow(
    () => census(population, classifyTrunkVerification),
    describeViolations('trunk-verification', population, classifyTrunkVerification)
  )
})
