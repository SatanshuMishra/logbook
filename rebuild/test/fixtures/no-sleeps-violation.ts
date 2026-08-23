import { setTimeout as sleep } from 'node:timers/promises'
import { spawnSync } from 'node:child_process'

export const importedSleepAlias = async (): Promise<void> => {
  await sleep(500)
}

export const globalThisTimeout = (): void => {
  globalThis.setTimeout(() => {}, 250)
}

export const spawnedSleep = (): void => {
  spawnSync('sleep', ['1'])
}
