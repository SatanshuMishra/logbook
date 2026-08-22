import { randomBytes } from 'node:crypto'
import { closeSync, fsyncSync, openSync, renameSync, unlinkSync, writeSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

export type DurableWriteOps = {
  open: (path: string, flags: string) => number
  fsync: (fd: number) => void
  write: (fd: number, contents: string) => void
  rename: (from: string, to: string) => void
  close: (fd: number) => void
  log: (record: Record<string, unknown>) => void
}

export type DurableWriteInput = Partial<Omit<DurableWriteOps, 'log'>> & Pick<DurableWriteOps, 'log'>

const defaultFsOps: Omit<DurableWriteOps, 'log'> = {
  open: (path, flags) => openSync(path, flags),
  fsync: (fd) => fsyncSync(fd),
  write: (fd, contents) => {
    writeSync(fd, contents)
  },
  rename: (from, to) => renameSync(from, to),
  close: (fd) => closeSync(fd)
}

const TMP_INFIX = '.durable-write-'
const TMP_SUFFIX = '.tmp'

export const TEMP_FILE_PATTERN = /\.durable-write-[0-9a-f]+\.tmp$/

export const isDurableWriteTempPath = (path: string): boolean => TEMP_FILE_PATTERN.test(path)

const tmpPathFor = (target: string): string => {
  const suffix = randomBytes(9).toString('hex')
  return join(dirname(target), `${basename(target)}${TMP_INFIX}${suffix}${TMP_SUFFIX}`)
}

const isDirectoryFsyncShortfall = (error: unknown): error is NodeJS.ErrnoException => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return code === 'EISDIR' || code === 'EINVAL' || code === 'EPERM'
}

const removeIfPresent = (path: string): void => {
  try {
    unlinkSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error
    }
  }
}

export const durableWrite = (target: string, contents: string, ops: DurableWriteInput): void => {
  const resolved: DurableWriteOps = { ...defaultFsOps, ...ops }
  const dir = dirname(target)
  const tmpPath = tmpPathFor(target)

  const tmpFd = resolved.open(tmpPath, 'w')
  try {
    resolved.write(tmpFd, contents)
    resolved.fsync(tmpFd)
  } catch (error) {
    resolved.close(tmpFd)
    removeIfPresent(tmpPath)
    throw error
  }
  resolved.close(tmpFd)

  try {
    resolved.rename(tmpPath, target)
  } catch (error) {
    removeIfPresent(tmpPath)
    throw error
  }

  const dirFd = resolved.open(dir, 'r')
  try {
    resolved.fsync(dirFd)
  } catch (error) {
    if (!isDirectoryFsyncShortfall(error)) {
      throw error
    }
    resolved.log({
      level: 'warn',
      event: 'durable-write.directory-fsync-unavailable',
      directory: dir,
      code: (error as NodeJS.ErrnoException).code
    })
  } finally {
    resolved.close(dirFd)
  }
}
