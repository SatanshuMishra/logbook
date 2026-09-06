import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { Runtime } from '../runtime/runtime.ts'
import { createStateDirectory, type StoreLayout } from '../store/layout.ts'
import { durableWrite } from '../store/durable-write.ts'
import { git } from '../store/git.ts'
import { LEDGER_REF } from '../store/ref.ts'
import { SHA_PATTERN } from '../schema/ids.ts'

const BASELINE_FILE_NAME = 'resume-baseline.json'

export type ResumeBaseline = { session_id: string; ledger_head: string | null }

const baselinePathFor = (stateDir: string): string => path.join(stateDir, BASELINE_FILE_NAME)

const REF_ABSENT_EXIT_CODE = 1

export const readLedgerHead = (rt: Runtime, projectRoot: string): string | null => {
  const result = git(rt, projectRoot, ['rev-parse', '--verify', '--quiet', LEDGER_REF])
  if (!result.ok) {
    if (result.code !== REF_ABSENT_EXIT_CODE) {
      rt.log({ level: 'warn', event: 'stop-gate.ledger-ref-unreadable', code: result.code, detail: result.stderr.trim() })
    }
    return null
  }
  const trimmed = result.stdout.trim()
  return trimmed.length === 0 ? null : trimmed
}

export type LedgerDiff = { ok: true; paths: string[] } | { ok: false; detail: string }

export const ledgerPathsChangedSince = (rt: Runtime, projectRoot: string, baselineHead: string): LedgerDiff => {
  if (!SHA_PATTERN.test(baselineHead)) {
    const detail = 'the recorded ledger head is not an object id'
    rt.log({ level: 'warn', event: 'stop-gate.ledger-baseline-not-an-object-id', detail })
    return { ok: false, detail }
  }
  const result = git(rt, projectRoot, ['diff', '--name-only', '--end-of-options', baselineHead, LEDGER_REF, '--'])
  if (!result.ok) {
    const detail = result.stderr.trim()
    rt.log({ level: 'warn', event: 'stop-gate.ledger-diff-unreadable', code: result.code, detail })
    return { ok: false, detail }
  }
  return { ok: true, paths: result.stdout.split('\n').map((line) => line.trim()).filter((line) => line.length > 0) }
}

export const readResumeBaseline = (layout: StoreLayout): ResumeBaseline | null => {
  const target = baselinePathFor(layout.state)
  let raw: string
  try {
    raw = readFileSync(target, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw new Error(`readResumeBaseline: failed to read ${target}: ${(error as Error).message}`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>
  const sessionId = candidate.session_id
  const ledgerHead = candidate.ledger_head
  if (typeof sessionId !== 'string' || sessionId.length === 0) return null
  if (ledgerHead !== null && typeof ledgerHead !== 'string') return null
  if (ledgerHead !== null && !SHA_PATTERN.test(ledgerHead)) return null
  return { session_id: sessionId, ledger_head: ledgerHead }
}

export const recordResumeBaseline = (rt: Runtime, layout: StoreLayout, sessionId: string): ResumeBaseline => {
  const baseline: ResumeBaseline = { session_id: sessionId, ledger_head: readLedgerHead(rt, layout.projectRoot) }
  createStateDirectory(layout)
  durableWrite(baselinePathFor(layout.state), JSON.stringify(baseline), { log: rt.log })
  return baseline
}
