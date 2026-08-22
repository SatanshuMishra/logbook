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
