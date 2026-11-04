import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'

type WriteSync = typeof fs.writeSync

const FD = 7
const CHUNK_BYTES = 4

const errorWithCode = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: write failed`), { code })

const withWriteSync = async (
  replacement: (...args: Parameters<WriteSync>) => number,
  fn: (writeAllSync: (fd: number, data: string) => void) => void
): Promise<void> => {
  mock.method(fs, 'writeSync', replacement)
  syncBuiltinESMExports()
  try {
    const { writeAllSync } = await import('../../src/runtime/write-all.ts')
    fn(writeAllSync)
  } finally {
    mock.restoreAll()
    syncBuiltinESMExports()
  }
}

const chunkedSink = (failures: readonly NodeJS.ErrnoException[]) => {
  const pending = [...failures]
  const written: Buffer[] = []
  let calls = 0
  const write = (fd: number, buffer: NodeJS.ArrayBufferView, offset?: number | null, length?: number | null): number => {
    calls += 1
    assert.equal(fd, FD)
    const failure = pending.shift()
    if (failure !== undefined) throw failure
    const start = offset ?? 0
    const size = Math.min(length ?? CHUNK_BYTES, CHUNK_BYTES)
    written.push(Buffer.from((buffer as Buffer).subarray(start, start + size)))
    return size
  }
  return { write, written: () => Buffer.concat(written).toString('utf8'), calls: () => calls }
}

test('write-all.retries-a-write-that-reports-eagain-until-every-byte-is-written', async () => {
  const sink = chunkedSink([errorWithCode('EAGAIN'), errorWithCode('EAGAIN')])
  await withWriteSync(sink.write as never, (writeAllSync) => {
    writeAllSync(FD, 'hello, logbook\n')
  })
  assert.equal(sink.written(), 'hello, logbook\n')
  assert.equal(sink.calls(), 6)
})

test('write-all.throws-an-error-that-is-not-eagain-on-the-first-write', async () => {
  const sink = chunkedSink([errorWithCode('EPIPE')])
  await withWriteSync(sink.write as never, (writeAllSync) => {
    assert.throws(() => writeAllSync(FD, 'hello\n'), { code: 'EPIPE' })
  })
  assert.equal(sink.written(), '')
  assert.equal(sink.calls(), 1)
})
