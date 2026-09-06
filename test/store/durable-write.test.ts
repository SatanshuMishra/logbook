import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { test } from 'node:test'
import { durableWrite, isDurableWriteTempPath } from '../../src/store/durable-write.ts'

type SnapshotEntry = { path: string; size: number; hash: string }

const snapshotDir = (root: string): SnapshotEntry[] => {
  const entries: SnapshotEntry[] = []
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name)
      const stat = statSync(full)
      if (stat.isDirectory()) {
        walk(full)
      } else {
        const contents = readFileSync(full)
        entries.push({
          path: relative(root, full),
          size: stat.size,
          hash: createHash('sha256').update(contents).digest('hex')
        })
      }
    }
  }
  walk(root)
  return entries.sort((a, b) => a.path.localeCompare(b.path))
}

const withTempDir = (fn: (dir: string) => void): void => {
  const dir = mkdtempSync(join(tmpdir(), 'durable-write-test-'))
  try {
    fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('write.atomic-on-failure', () => {
  withTempDir((dir) => {
    const target = join(dir, 'thread.json')
    writeFileSync(target, 'original contents')
    writeFileSync(join(dir, 'sibling.json'), 'untouched')

    const before = snapshotDir(dir)

    assert.throws(() => {
      durableWrite(target, 'new contents', {
        log: () => {},
        rename: () => {
          throw new Error('injected rename failure')
        }
      })
    }, /injected rename failure/)

    const after = snapshotDir(dir)
    assert.deepStrictEqual(after, before)

    const leftoverTempFiles = readdirSync(dir).filter((name) => isDurableWriteTempPath(name))
    assert.deepStrictEqual(leftoverTempFiles, [])
  })
})

test('write.fsyncs-directory-last', () => {
  withTempDir((dir) => {
    const target = join(dir, 'thread.json')
    writeFileSync(target, 'original contents')

    const order: string[] = []
    const fdLabels = new Map<number, 'tmp' | 'dir'>()

    const recordingOps = {
      log: (): void => {},
      open: (path: string, flags: string): number => {
        const label: 'tmp' | 'dir' = path === dir ? 'dir' : 'tmp'
        order.push(`open(${label})`)
        const fd = openSync(path, flags)
        fdLabels.set(fd, label)
        return fd
      },
      fsync: (fd: number): void => {
        order.push(`fsync(${fdLabels.get(fd)})`)
        fsyncSync(fd)
      },
      rename: (from: string, to: string): void => {
        order.push('rename')
        renameSync(from, to)
      },
      close: (fd: number): void => {
        closeSync(fd)
      }
    }

    durableWrite(target, 'new contents', recordingOps)

    assert.deepStrictEqual(order, ['open(tmp)', 'fsync(tmp)', 'rename', 'open(dir)', 'fsync(dir)'])
    assert.strictEqual(readFileSync(target, 'utf8'), 'new contents')
  })
})

test('write.log-is-required-by-type', () => {
  const callWithoutLog = (): void => {
    // @ts-expect-error log has no default; an ops bag that omits it must not type-check
    durableWrite(join(tmpdir(), 'unused-durable-write-target.json'), 'contents', {})
  }
  assert.equal(typeof callWithoutLog, 'function')
})

test('write.logs-directory-fsync-shortfall', () => {
  withTempDir((dir) => {
    const target = join(dir, 'thread.json')
    writeFileSync(target, 'original contents')

    const logs: Record<string, unknown>[] = []
    const fdLabels = new Map<number, 'tmp' | 'dir'>()

    durableWrite(target, 'new contents', {
      log: (record) => {
        logs.push(record)
      },
      open: (path, flags) => {
        const label: 'tmp' | 'dir' = path === dir ? 'dir' : 'tmp'
        const fd = openSync(path, flags)
        fdLabels.set(fd, label)
        return fd
      },
      fsync: (fd) => {
        if (fdLabels.get(fd) === 'dir') {
          const shortfall = new Error('simulated directory fsync shortfall') as NodeJS.ErrnoException
          shortfall.code = 'EINVAL'
          throw shortfall
        }
        fsyncSync(fd)
      }
    })

    assert.strictEqual(readFileSync(target, 'utf8'), 'new contents')
    assert.strictEqual(logs.length, 1)
    assert.strictEqual(logs[0]?.level, 'warn')
    assert.strictEqual(logs[0]?.event, 'durable-write.directory-fsync-unavailable')
    assert.strictEqual(logs[0]?.code, 'EINVAL')
  })
})

test('write.write-is-injectable', () => {
  withTempDir((dir) => {
    const target = join(dir, 'thread.json')
    writeFileSync(target, 'original contents')

    const writes: { fd: number; contents: string | Uint8Array }[] = []
    const closes: number[] = []

    durableWrite(target, 'captured contents', {
      log: () => {},
      open: () => 7,
      write: (fd, contents) => {
        writes.push({ fd, contents })
      },
      fsync: () => {},
      rename: () => {},
      close: (fd) => {
        closes.push(fd)
      }
    })

    assert.deepStrictEqual(writes, [{ fd: 7, contents: 'captured contents' }])
    assert.deepStrictEqual(closes, [7, 7])
    assert.strictEqual(readFileSync(target, 'utf8'), 'original contents')
  })
})

test('write.preserves-original-error-when-tmp-close-fails', () => {
  withTempDir((dir) => {
    const target = join(dir, 'thread.json')
    writeFileSync(target, 'original contents')

    assert.throws(
      () => {
        durableWrite(target, 'new contents', {
          log: () => {},
          fsync: () => {
            throw new Error('original fsync failure')
          },
          close: () => {
            throw new Error('close failure that must not mask the original')
          }
        })
      },
      /original fsync failure/
    )
  })
})

test('write.preserves-original-error-when-dir-close-fails', () => {
  withTempDir((dir) => {
    const target = join(dir, 'thread.json')
    writeFileSync(target, 'original contents')

    const fdLabels = new Map<number, 'tmp' | 'dir'>()

    assert.throws(
      () => {
        durableWrite(target, 'new contents', {
          log: () => {},
          open: (path, flags) => {
            const label: 'tmp' | 'dir' = path === dir ? 'dir' : 'tmp'
            const fd = openSync(path, flags)
            fdLabels.set(fd, label)
            return fd
          },
          fsync: (fd) => {
            if (fdLabels.get(fd) === 'dir') {
              const original = new Error('original directory fsync failure') as NodeJS.ErrnoException
              original.code = 'EACCES'
              throw original
            }
            fsyncSync(fd)
          },
          close: (fd) => {
            if (fdLabels.get(fd) === 'dir') {
              throw new Error('close failure that must not mask the original')
            }
            closeSync(fd)
          }
        })
      },
      /original directory fsync failure/
    )
  })
})
