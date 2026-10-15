import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

export type HookProcessRequest = { hook: string; event: object | string; env?: Record<string, string> }

export type HookProcessResult = { code: number | null; stdout: string; stderr: string }

const LOGBOOK_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const entryPath = (hook: string): string =>
  hook === 'io-probe'
    ? join(LOGBOOK_ROOT, 'test', 'hooks', 'fixtures', `${hook}.ts`)
    : join(LOGBOOK_ROOT, 'hooks', `${hook}.ts`)

const stdinText = (event: object | string): string => (typeof event === 'string' ? event : JSON.stringify(event))

const readAll = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = await stream.toArray()
  return Buffer.concat(chunks).toString('utf8')
}

const runIn = async (home: string, request: HookProcessRequest): Promise<HookProcessResult> => {
  const child = spawn(process.execPath, [entryPath(request.hook)], {
    env: { PATH: process.env.PATH ?? '', HOME: home, ...request.env }
  })
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once('error', reject)
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE') reject(error)
    })
    child.once('close', (code) => resolve(code))
  })
  child.stdin.end(stdinText(request.event))
  const [stdout, stderr, code] = await Promise.all([readAll(child.stdout), readAll(child.stderr), exited])
  return { code, stdout, stderr }
}

export const runHookProcess = async (request: HookProcessRequest): Promise<HookProcessResult> => {
  const home = mkdtempSync(join(tmpdir(), 'logbook-hook-home-'))
  try {
    return await runIn(home, request)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
}
