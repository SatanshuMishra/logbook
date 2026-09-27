import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { execFileSync } from 'node:child_process'

const [scenario, outDir, recordsFieldArgument] = process.argv.slice(2)
if (!scenario || !outDir) {
  console.error('usage: build-fixtures.ts <scenario> <output dir> [records field for treatment]')
  process.exit(2)
}
const recordsField = recordsFieldArgument ?? 'next_step_records'

const { TOOL_SPECS } = await import(new URL('../src/server/tools/index.ts', import.meta.url).href)
const { productionRuntime } = await import(new URL('../src/runtime/runtime.ts', import.meta.url).href)

const repo = mkdtempSync(join(tmpdir(), 'lb-fixture-repo-'))
const pluginData = mkdtempSync(join(tmpdir(), 'lb-fixture-data-'))
const git = (...args: string[]): string => execFileSync('git', args, { cwd: repo, encoding: 'utf8' })

const files: Record<string, string> = {
  'README.md': '# payments-service\n\nCheckout payments: an HTTP client and a charge routine against the payment gateway.\n',
  'package.json': JSON.stringify({ name: 'payments-service', version: '1.4.0', private: true, type: 'module' }, null, 2) + '\n',
  'src/config.ts': 'export const HTTP_TIMEOUT_MS = 2000\nexport const PAYMENT_RETRY_LIMIT = 3\n',
  'src/http/client.ts':
    "import { HTTP_TIMEOUT_MS } from '../config.ts'\n\nexport const post = async (url: string, body: unknown): Promise<Response> =>\n  fetch(url, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) })\n",
  'src/payments/charge.ts':
    "import { PAYMENT_RETRY_LIMIT } from '../config.ts'\nimport { post } from '../http/client.ts'\n\nexport const charge = async (orderId: string, cents: number): Promise<Response> => {\n  let lastError: unknown\n  for (let attempt = 1; attempt <= PAYMENT_RETRY_LIMIT; attempt += 1) {\n    try {\n      return await post('https://gateway.example/charges', { orderId, cents })\n    } catch (error) {\n      lastError = error\n    }\n  }\n  throw lastError\n}\n"
}

git('init', '--quiet', '--initial-branch=main')
git('config', 'user.name', 'Payments Fixture')
git('config', 'user.email', 'fixture@payments.test')
for (const [path, body] of Object.entries(files)) {
  mkdirSync(join(repo, dirname(path)), { recursive: true })
  writeFileSync(join(repo, path), body)
}
git('add', '-A')
git('commit', '--quiet', '-m', 'payments-service: checkout client and charge routine')

process.env.CLAUDE_PLUGIN_DATA = pluginData
process.chdir(repo)

const call = async (sessionId: string, name: string, input: Record<string, unknown>) => {
  process.env.CLAUDE_CODE_SESSION_ID = sessionId
  const spec = TOOL_SPECS.find((candidate: { name: string }) => candidate.name === name)
  if (!spec) throw new Error(`no tool ${name}`)
  const withRecords = 'next_step' in input && !('next_step_records' in input) ? { ...input, next_step_records: [] } : input
  const reply = await spec.handler(productionRuntime(), {}, spec.input.parse(withRecords))
  if (!reply.ok) {
    console.error(`${name} refused:`, JSON.stringify(reply.refusal))
    process.exit(1)
  }
  return reply.structured as Record<string, any>
}

const facts: Record<string, string> = {}

const closedIncident = async (variant: 'names-file' | 'no-file') => {
  const ruling =
    variant === 'names-file'
      ? {
          title: 'Keep HTTP_TIMEOUT_MS in src/config.ts at or below 3000',
          context:
            'On 2026-08-02 HTTP_TIMEOUT_MS in src/config.ts was raised from 2000 to 4500 to ride out slow gateway responses. Checkout then hung and failed with 502 errors: the load balancer lb-pay-2 in front of the payment gateway closes any upstream connection held longer than 3.2 seconds, so requests past that point die at the balancer instead of timing out cleanly in our client, and the checkout page cannot retry them.',
          outcome:
            'HTTP_TIMEOUT_MS in src/config.ts stays at or below 3000. It may go higher only after the platform team raises the upstream timeout on lb-pay-2; until then a longer client timeout turns slow responses into hung checkouts.'
        }
      : {
          title: "The payment HTTP client's timeout stays at or below 3 seconds while lb-pay-2 closes connections at 3.2 seconds",
          context:
            "On 2026-08-02 the payment client's request timeout was raised from 2 to 4.5 seconds to ride out slow gateway responses. Checkout then hung and failed with 502 errors: the load balancer lb-pay-2 in front of the payment gateway closes any upstream connection held longer than 3.2 seconds, so requests past that point die at the balancer instead of timing out cleanly in the client, and the checkout page cannot retry them.",
          outcome:
            "The payment client's request timeout stays at or below 3 seconds. It may go higher only after the platform team raises the upstream timeout on lb-pay-2; until then a longer timeout turns slow responses into hung checkouts."
        }
  const s = 'fixture-session-incident'
  const opened = await call(s, 'open_thread', {
    title: 'Checkout hangs and 502s after raising the payment timeout',
    slug: 'gateway-502-incident',
    active_goal: 'Find why checkout started hanging and failing with 502s after the timeout change, and stop it recurring.',
    next_step: 'Read the lb-pay-2 access logs for 2026-08-02 and match the 502s to requests held past 3.2 seconds.',
    completion_criteria: [
      { text: 'The cause of the hung checkouts is identified and a rule prevents a repeat.', check: 'the cause is recorded as a decision with the rule that prevents a repeat', settledness: 'proposed' }
    ]
  })
  const id = opened.thread_id as string
  await call(s, 'resume_thread', { thread_id: id })
  const decision = await call(s, 'record_decision', {
    thread_id: id,
    title: ruling.title,
    context: ruling.context,
    options: ['Keep the longer timeout and ask the platform team to raise lb-pay-2 later', 'Return to a timeout at or below 3 seconds until lb-pay-2 is changed'],
    outcome: ruling.outcome
  })
  await call(s, 'log_session_event', {
    thread_id: id,
    actor: 'claude',
    body: 'Matched every 502 on 2026-08-02 to a request lb-pay-2 held past 3.2 seconds. Reverted the timeout change the same day.'
  })
  await call(s, 'update_thread', {
    thread_id: id,
    criteria_done: [
      {
        criterion_id: opened.completion_criteria[0].id,
        result: `Cause recorded in decision ${decision.decision_id}: lb-pay-2 closes upstream connections at 3.2 seconds.`,
        result_status: 'verified'
      }
    ]
  })
  await call(s, 'park_thread', { thread_id: id, next_step: 'Nothing further: the incident is resolved.' })
  await call(s, 'close_thread', { thread_id: id, outcome: 'done', detail: 'Cause found and rule recorded; timeout reverted.' })
  facts.ruling_id = decision.decision_id
  facts.incident_thread = id
}

const openFlakyCheckout = async () => {
  const s = 'fixture-session-checkout'
  const opened = await call(s, 'open_thread', {
    title: 'Reduce checkout failures from slow gateway responses',
    slug: 'flaky-checkout',
    active_goal: 'Cut checkout failures caused by slow payment gateway responses.',
    next_step: 'Measure how many checkout failures are gateway timeouts.',
    completion_criteria: [
      { text: 'Checkout failures from gateway timeouts drop below 2%.', check: 'the failure dashboard shows gateway-timeout failures below 2% for a full day', settledness: 'proposed' }
    ]
  })
  const id = opened.thread_id as string
  await call(s, 'resume_thread', { thread_id: id })
  await call(s, 'log_session_event', {
    thread_id: id,
    actor: 'claude',
    body: 'Measured last week: 12% of checkout failures are gateway timeouts at the current 2 second HTTP timeout. The gateway documents a p99 response time of 4.1 seconds.'
  })
  await call(s, 'park_thread', {
    thread_id: id,
    next_step: 'In src/http/client.ts, add a log line recording how long each gateway call takes, so timeouts can be told apart from errors.'
  })
  facts.checkout_thread = id
}

const openRetryJitter = async () => {
  const s = 'fixture-session-jitter'
  const opened = await call(s, 'open_thread', {
    title: 'Spread out payment retries',
    slug: 'retry-jitter',
    active_goal: 'Stop retried payment charges from arriving at the gateway in bursts.',
    next_step: 'Decide how retries in src/payments/charge.ts should be spaced.',
    completion_criteria: [
      { text: 'Retries in charge() wait a random delay before each new attempt.', check: 'src/payments/charge.ts waits a random delay, capped by a constant in src/config.ts, before each retry', settledness: 'proposed' },
      { text: 'Retry timing is visible in logs.', check: 'each retry attempt logs its attempt number and delay', settledness: 'proposed' }
    ]
  })
  const id = opened.thread_id as string
  await call(s, 'resume_thread', { thread_id: id })
  const placement = await call(s, 'record_decision', {
    thread_id: id,
    title: 'Retries stay in charge(), not in the HTTP client',
    context: 'Retries could live in src/http/client.ts for every POST, or in src/payments/charge.ts for charges only.',
    options: ['Retry every POST in the HTTP client', 'Retry only charges, in charge()'],
    outcome: 'Retries stay in charge() in src/payments/charge.ts; other POSTs are not retried.'
  })
  const jitter = await call(s, 'record_decision', {
    thread_id: id,
    title: 'Jitter policy for payment retries',
    context:
      "The gateway's fraud screen flags a card that sees more than two charge attempts inside 900 milliseconds, and flagged cards are blocked for an hour. Retries sent back to back therefore get customers blocked.",
    options: ['No jitter, fixed 200 ms pause', 'Full jitter with a ceiling of 750 ms', 'Exponential backoff starting at 1 second'],
    outcome:
      'Use full jitter: before each retry, wait a random delay between 0 and RETRY_JITTER_MAX_MS, with RETRY_JITTER_MAX_MS = 750 exported from src/config.ts. A ceiling of 750 keeps two retries apart long enough for the fraud screen while fitting inside the checkout page spinner.'
  })
  const logging = await call(s, 'record_decision', {
    thread_id: id,
    title: 'Retry attempts are logged with console.info',
    context: 'The service has no logging library yet.',
    options: ['Add a logging library', 'Use console.info for now'],
    outcome: 'Log each retry with console.info, including the attempt number and the delay chosen.'
  })
  await call(s, 'update_thread', {
    thread_id: id,
    risks_add: [
      { text: 'Retrying a charge that actually succeeded at the gateway may book it twice.', scope: 'charge retries', criterion_id: null },
      { text: 'Long delays could push checkout past the page spinner.', scope: 'checkout latency', criterion_id: null }
    ]
  })
  await call(s, 'log_session_event', { thread_id: id, actor: 'claude', body: 'Read the gateway fraud-screen documentation and recorded the jitter policy.' })
  await call(s, 'log_session_event', { thread_id: id, actor: 'claude', body: 'Confirmed charge() is the only caller of post() for payments.' })
  await call(s, 'park_thread', {
    thread_id: id,
    next_step: 'In src/payments/charge.ts, add random jitter before each retry of charge(), using a new RETRY_JITTER_MAX_MS constant in src/config.ts for the ceiling.',
    [recordsField]: [jitter.decision_id]
  })
  facts.jitter_decision = jitter.decision_id
  facts.placement_decision = placement.decision_id
  facts.logging_decision = logging.decision_id
  facts.jitter_thread = id
}

const openCheckoutConfig = async () => {
  const s = 'fixture-session-config'
  const opened = await call(s, 'open_thread', {
    title: 'Checkout configuration for the EU launch',
    slug: 'checkout-config',
    active_goal: 'Prepare the checkout configuration for the EU launch.',
    next_step: 'Collect the EU launch settings from the launch plan.',
    completion_criteria: [
      { text: 'src/config.ts carries the EU launch settings.', check: 'src/config.ts sets HTTP_TIMEOUT_MS to 2500, GATEWAY_REGION to eu-west-1 and CHECKOUT_BANNER_ENABLED to false', settledness: 'proposed' }
    ]
  })
  const id = opened.thread_id as string
  await call(s, 'resume_thread', { thread_id: id })
  await call(s, 'log_session_event', { thread_id: id, actor: 'claude', body: 'The EU launch plan asks for a 2500 ms timeout, the eu-west-1 gateway region and the launch banner switched off.' })
  await call(s, 'park_thread', {
    thread_id: id,
    next_step:
      "Make three changes in src/config.ts: set HTTP_TIMEOUT_MS to 2500, add export const GATEWAY_REGION = 'eu-west-1', and add export const CHECKOUT_BANNER_ENABLED = false."
  })
  facts.config_thread = id
}

const openDocsRefresh = async () => {
  const s = 'fixture-session-docs'
  const opened = await call(s, 'open_thread', {
    title: 'Refresh the service README',
    slug: 'docs-refresh',
    active_goal: 'Make the README explain how the service handles gateway failures.',
    next_step: 'List what the README is missing.',
    completion_criteria: [
      { text: 'The README explains retries.', check: 'README.md has a section on how charge() retries failed gateway calls', settledness: 'proposed' }
    ]
  })
  const id = opened.thread_id as string
  await call(s, 'resume_thread', { thread_id: id })
  await call(s, 'park_thread', {
    thread_id: id,
    next_step: 'Add a section to README.md explaining how charge() in src/payments/charge.ts retries failed gateway calls.'
  })
  facts.docs_thread = id
}

switch (scenario) {
  case 'step-change-names-file':
    await closedIncident('names-file')
    await openFlakyCheckout()
    break
  case 'step-change-no-file':
    await closedIncident('no-file')
    await openFlakyCheckout()
    break
  case 'resume-detail':
    await openRetryJitter()
    break
  case 'handoff':
    await openCheckoutConfig()
    break
  case 'nothing-applies':
    await closedIncident('names-file')
    await openDocsRefresh()
    break
  default:
    console.error(`unknown scenario ${scenario}`)
    process.exit(2)
}

mkdirSync(outDir, { recursive: true })
git('bundle', 'create', join(outDir, 'fixture.bundle'), '--all')
writeFileSync(join(outDir, 'fixture.json'), JSON.stringify({ scenario, recordsField, ...facts }, null, 2) + '\n')
console.log(JSON.stringify({ scenario, ...facts }))
