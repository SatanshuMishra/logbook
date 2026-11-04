import { writeSync } from 'node:fs'

const isEagain = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === 'EAGAIN'

export const writeAllSync = (fd: number, data: string): void => {
  const buffer = Buffer.from(data, 'utf8')
  let offset = 0
  while (offset < buffer.length) {
    try {
      offset += writeSync(fd, buffer, offset, buffer.length - offset)
    } catch (error) {
      if (!isEagain(error)) throw error
    }
  }
}
