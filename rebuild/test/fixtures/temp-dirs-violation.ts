import { mkdir } from 'node:fs/promises'
import * as fs from 'node:fs'

export const promisedMkdirWithClock = async (): Promise<void> => {
  await mkdir(`/tmp/probe-${Date.now()}`)
}

export const namespacedMkdirSyncWithClock = (): void => {
  fs.mkdirSync(`/tmp/probe-${Date.now()}`)
}
