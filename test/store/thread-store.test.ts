import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ulid } from 'ulid'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { RepoPaths } from '../../src/thread/paths.ts'
import { rawGit, withRepo, withRepoNoIdentity } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const SLUG_PATTERN_TEXT = '^[a-z0-9][a-z0-9-]{0,63}$'

const GIT_ENV: Record<string, string | undefined> = {
  PATH: process.env.PATH,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0'
}

const withTempDir = <T>(prefix: string, fn: (dir: string) => T): T => {
  const dir = mkdtempSync(join(tmpdir(), `${prefix}-`))
  try {
    return fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const runtimeWith = (cwd: string, env: Record<string, string | undefined>): Runtime =>
  testRuntime({ cwd, env: { PATH: process.env.PATH, ...env } })

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const gitWithInput = (repo: string, args: string[], input: string): string => {
  const result = spawnSync('git', ['-C', repo, ...args], { env: GIT_ENV, encoding: 'utf8', input })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

const initRepository = (root: string): void => {
  mkdirSync(root, { recursive: true })
  mustGit(root, ['init', '--initial-branch=main'])
  mustGit(root, ['config', 'user.name', 'Thread Store Tester'])
  mustGit(root, ['config', 'user.email', 'tester@logbook.test'])
  writeFileSync(join(root, 'README.md'), 'thread store test repository\n')
  mustGit(root, ['add', 'README.md'])
  mustGit(root, ['commit', '-m', 'initial commit'])
}

const commonDirPrinted = (dir: string): string =>
  mustGit(dir, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim()

const sha256Prefix = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex').slice(0, 12)

const seedThreads = (repo: string, files: Record<string, string>): string => {
  const entries = Object.entries(files).map(([name, text]) => {
    const blob = gitWithInput(repo, ['hash-object', '-w', '--stdin'], text)
    return `100644 blob ${blob}\t${name}\n`
  })
  const tree = gitWithInput(repo, ['mktree'], entries.join(''))
  const commit = gitWithInput(repo, ['commit-tree', tree, '-m', 'seed threads'], '')
  mustGit(repo, ['update-ref', 'refs/logbook/threads', commit])
  return commit
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', 'refs/logbook/threads']).trim()

const parentsOf = (repo: string, commit: string): string[] =>
  mustGit(repo, ['rev-list', '--parents', '-n', '1', commit]).trim().split(' ').slice(1)

const namesAt = (repo: string, commit: string): string[] =>
  mustGit(repo, ['ls-tree', '--name-only', commit]).trim().split('\n')

const textAt = (repo: string, commit: string, name: string): string =>
  mustGit(repo, ['cat-file', 'blob', `${commit}:${name}`])

const blobAt = (repo: string, commit: string, name: string): string =>
  mustGit(repo, ['rev-parse', `${commit}:${name}`]).trim()

type StoreContext = { repo: string; home: string; rt: Runtime; paths: RepoPaths }

const withStore = <T>(
  findRepository: (rt: Runtime, dir: string) => { ok: true; value: RepoPaths } | { ok: false; message: string },
  fn: (context: StoreContext) => T
): T =>
  withRepo((repo) =>
    withTempDir('logbook-thread-store-home', (home) => {
      const rt = runtimeWith(repo, { HOME: home })
      const found = findRepository(rt, repo)
      assert.ok(found.ok, found.ok ? '' : found.message)
      return fn({ repo, home, rt, paths: found.value })
    })
  )

test('store.paths-from-the-main-checkout', async () => {
  const { findRepository, workingCopyPath, holdPath } = await import('../../src/thread/paths.ts')
  withTempDir('logbook-thread-paths', (scratch) => {
    const home = join(scratch, 'home')
    mkdirSync(home)
    const root = join(scratch, 'My Repo_1')
    initRepository(root)
    const rt = runtimeWith(root, { HOME: home })
    const found = findRepository(rt, root)
    assert.ok(found.ok)
    const key = `my-repo-1-${sha256Prefix(commonDirPrinted(root))}`
    assert.deepEqual(workingCopyPath(found.value, 'fix-login'), {
      ok: true,
      value: join(home, '.logbook', key, 'fix-login.md')
    })
    assert.deepEqual(holdPath(found.value, 'fix-login'), {
      ok: true,
      value: join(realpathSync(root), '.git', 'logbook', 'holds', 'fix-login.json')
    })
  })
})

test('store.paths-from-a-subdirectory', async () => {
  const { findRepository, workingCopyPath, holdPath } = await import('../../src/thread/paths.ts')
  withTempDir('logbook-thread-paths', (scratch) => {
    const home = join(scratch, 'home')
    mkdirSync(home)
    const root = join(scratch, 'My Repo_1')
    initRepository(root)
    const deep = join(root, 'src', 'deep')
    mkdirSync(deep, { recursive: true })
    const rt = runtimeWith(root, { HOME: home })
    const fromRoot = findRepository(rt, root)
    const fromDeep = findRepository(rt, deep)
    assert.ok(fromRoot.ok)
    assert.ok(fromDeep.ok)
    assert.deepEqual(fromDeep.value, fromRoot.value)
    const key = `my-repo-1-${sha256Prefix(commonDirPrinted(root))}`
    assert.deepEqual(workingCopyPath(fromDeep.value, 'fix-login'), {
      ok: true,
      value: join(home, '.logbook', key, 'fix-login.md')
    })
    assert.deepEqual(holdPath(fromDeep.value, 'fix-login'), {
      ok: true,
      value: join(realpathSync(root), '.git', 'logbook', 'holds', 'fix-login.json')
    })
  })
})

test('store.paths-from-a-linked-worktree', async () => {
  const { findRepository, workingCopyPath, holdPath, handoverPath } = await import('../../src/thread/paths.ts')
  withTempDir('logbook-thread-paths', (scratch) => {
    const home = join(scratch, 'home')
    mkdirSync(home)
    const root = join(scratch, 'My Repo_1')
    initRepository(root)
    const linked = join(scratch, 'linked')
    mustGit(root, ['worktree', 'add', '-b', 'side', linked])
    const rt = runtimeWith(root, { HOME: home })
    const fromMain = findRepository(rt, root)
    const fromLinked = findRepository(rt, linked)
    assert.ok(fromMain.ok)
    assert.ok(fromLinked.ok)
    assert.equal(fromLinked.value.root, realpathSync(linked))
    assert.equal(fromLinked.value.commonDir, fromMain.value.commonDir)
    assert.equal(fromLinked.value.logbookDir, fromMain.value.logbookDir)
    assert.equal(fromLinked.value.workingDir, fromMain.value.workingDir)
    assert.deepEqual(workingCopyPath(fromLinked.value, 'fix-login'), workingCopyPath(fromMain.value, 'fix-login'))
    assert.deepEqual(holdPath(fromLinked.value, 'fix-login'), {
      ok: true,
      value: join(realpathSync(root), '.git', 'logbook', 'holds', 'fix-login.json')
    })
    const sessionId = randomUUID()
    assert.deepEqual(handoverPath(fromLinked.value, sessionId), handoverPath(fromMain.value, sessionId))
  })
})

test('store.refuses-outside-a-repository', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  withTempDir('logbook-thread-outside', (dir) => {
    const result = findRepository(runtimeWith(dir, { HOME: dir }), dir)
    assert.ok(!result.ok)
    assert.equal(result.field, 'cwd')
    assert.equal(result.accepted, 'a directory inside a git repository with a working tree')
    assert.equal(result.message, `logbook needs a git repository with a working tree; ${dir} is not inside one`)
  })
})

test('store.refuses-a-bare-repository', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  withTempDir('logbook-thread-bare', (scratch) => {
    const bare = join(scratch, 'remote.git')
    mustGit(scratch, ['init', '--bare', bare])
    const result = findRepository(runtimeWith(scratch, { HOME: scratch }), bare)
    assert.ok(!result.ok)
    assert.equal(result.field, 'cwd')
    assert.equal(result.message, `logbook needs a git repository with a working tree; ${bare} is not inside one`)
  })
})

test('store.project-dir-wins-over-the-start-directory', async () => {
  const { findRepository, holdPath, startDirectory } = await import('../../src/thread/paths.ts')
  withRepo((root) =>
    withTempDir('logbook-thread-home', (home) => {
      const sub = join(root, 'sub')
      mkdirSync(sub)
      mustGit(sub, ['init', '--initial-branch=main'])
      const rt = runtimeWith(sub, { HOME: home, CLAUDE_PROJECT_DIR: root })
      const found = findRepository(rt, startDirectory(rt, sub))
      assert.ok(found.ok)
      assert.deepEqual(holdPath(found.value, 'fix-login'), {
        ok: true,
        value: join(realpathSync(root), '.git', 'logbook', 'holds', 'fix-login.json')
      })
      assert.notEqual(found.value.commonDir, join(realpathSync(sub), '.git'))
    })
  )
})

test('store.start-directory-used-without-a-project-dir', async () => {
  const { findRepository, holdPath, startDirectory } = await import('../../src/thread/paths.ts')
  withRepo((root) =>
    withTempDir('logbook-thread-home', (home) => {
      const sub = join(root, 'sub')
      mkdirSync(sub)
      mustGit(sub, ['init', '--initial-branch=main'])
      const expected = join(realpathSync(sub), '.git', 'logbook', 'holds', 'fix-login.json')
      for (const env of [{ HOME: home }, { HOME: home, CLAUDE_PROJECT_DIR: '' }]) {
        const rt = runtimeWith(sub, env)
        const found = findRepository(rt, startDirectory(rt, sub))
        assert.ok(found.ok)
        assert.deepEqual(holdPath(found.value, 'fix-login'), { ok: true, value: expected })
      }
    })
  )
})

test('store.refuses-without-home', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  withRepo((repo) => {
    for (const env of [{}, { HOME: '' }]) {
      const result = findRepository(runtimeWith(repo, env), repo)
      assert.ok(!result.ok)
      assert.equal(result.field, 'HOME')
      assert.equal(result.accepted, 'the absolute path of the home folder')
      assert.equal(result.message, 'logbook needs HOME to place the working copies')
    }
  })
})

test('store.accepts-a-slug', async () => {
  const { findRepository, workingCopyPath, holdPath, inflightDir, markerPath, convertedPath, checkSlug } =
    await import('../../src/thread/paths.ts')
  withStore(findRepository, ({ paths }) => {
    const longSlug = `a${'-b'.repeat(31)}c`
    assert.equal(longSlug.length, 64)
    const toolUseId = `toolu_${randomUUID().replaceAll('-', '')}`
    for (const slug of ['state-document-2', longSlug]) {
      assert.equal(checkSlug('slug', slug), null)
      assert.deepEqual(workingCopyPath(paths, slug), { ok: true, value: join(paths.workingDir, `${slug}.md`) })
      assert.deepEqual(holdPath(paths, slug), { ok: true, value: join(paths.logbookDir, 'holds', `${slug}.json`) })
      assert.deepEqual(inflightDir(paths, slug), { ok: true, value: join(paths.logbookDir, 'inflight', slug) })
      assert.deepEqual(markerPath(paths, slug, toolUseId), {
        ok: true,
        value: join(paths.logbookDir, 'inflight', slug, `${toolUseId}.json`)
      })
      assert.deepEqual(convertedPath(paths, slug), { ok: true, value: join(paths.logbookDir, 'converted', slug) })
    }
  })
})

test('store.refuses-a-slug-that-could-leave-the-folder', async () => {
  const { findRepository, workingCopyPath, holdPath, inflightDir, markerPath, convertedPath, checkSlug } =
    await import('../../src/thread/paths.ts')
  withStore(findRepository, ({ paths, home }) => {
    const toolUseId = `toolu_${randomUUID().replaceAll('-', '')}`
    for (const slug of ['../x', 'a/b', 'Fix', '', '-x']) {
      const results = [
        workingCopyPath(paths, slug),
        holdPath(paths, slug),
        inflightDir(paths, slug),
        markerPath(paths, slug, toolUseId),
        convertedPath(paths, slug)
      ]
      for (const result of results) {
        assert.ok(!result.ok, `${JSON.stringify(slug)} was accepted`)
        assert.equal(result.field, 'slug')
        assert.ok(result.accepted.includes(SLUG_PATTERN_TEXT))
        assert.ok(result.message.includes(SLUG_PATTERN_TEXT))
      }
      const named = checkSlug('thread_slug', slug)
      assert.ok(named !== null)
      assert.equal(named.field, 'thread_slug')
    }
    assert.equal(existsSync(paths.logbookDir), false)
    assert.equal(existsSync(join(home, '.logbook')), false)
  })
})

test('store.refuses-a-slug-longer-than-64', async () => {
  const { findRepository, workingCopyPath, holdPath, inflightDir, convertedPath } = await import(
    '../../src/thread/paths.ts'
  )
  withStore(findRepository, ({ paths, home }) => {
    const slug = 'a'.repeat(65)
    for (const result of [
      workingCopyPath(paths, slug),
      holdPath(paths, slug),
      inflightDir(paths, slug),
      convertedPath(paths, slug)
    ]) {
      assert.ok(!result.ok)
      assert.equal(result.field, 'slug')
      assert.ok(result.accepted.includes(SLUG_PATTERN_TEXT))
      assert.ok(result.message.includes(SLUG_PATTERN_TEXT))
    }
    assert.equal(existsSync(paths.logbookDir), false)
    assert.equal(existsSync(join(home, '.logbook')), false)
  })
})

test('store.session-paths-accept-only-safe-ids', async () => {
  const { findRepository, handoverPath, redirectPath, markerPath, checkSessionId } = await import(
    '../../src/thread/paths.ts'
  )
  withStore(findRepository, ({ repo, paths }) => {
    const sessionId = randomUUID()
    const logbookDir = join(realpathSync(repo), '.git', 'logbook')
    assert.deepEqual(redirectPath(paths, sessionId), { ok: true, value: join(logbookDir, 'sessions', `${sessionId}.json`) })
    assert.deepEqual(handoverPath(paths, sessionId), { ok: true, value: join(logbookDir, 'handover', `${sessionId}.json`) })
    for (const bad of ['../x', '', 'a'.repeat(129)]) {
      for (const result of [redirectPath(paths, bad), handoverPath(paths, bad)]) {
        assert.ok(!result.ok)
        assert.equal(result.field, 'session_id')
      }
      const marker = markerPath(paths, 'fix-login', bad)
      assert.ok(!marker.ok)
      assert.equal(marker.field, 'tool_use_id')
      assert.equal(checkSessionId('session_id', bad)?.field, 'session_id')
    }
    assert.equal(checkSessionId('session_id', sessionId), null)
    assert.equal(existsSync(paths.logbookDir), false)
  })
})

test('store.first-commit-creates-the-ref', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    assert.notEqual(rawGit(repo, ['rev-parse', '--verify', '--quiet', 'refs/logbook/threads']).status, 0)
    const text = '# Fix login\n\nStatus: active\n'
    const result = commitDocuments(rt, paths, {
      changes: [{ slug: 'fix-login', text, expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(result.ok)
    const tip = tipOf(repo)
    assert.equal(result.value.commit, tip)
    assert.deepEqual(parentsOf(repo, tip), [])
    assert.deepEqual(namesAt(repo, tip), ['fix-login.md'])
    assert.equal(textAt(repo, tip, 'fix-login.md'), text)
    assert.equal(mustGit(repo, ['log', '-1', '--format=%B', tip]).trim(), 'open_thread fix-login: opened')
  })
})

test('store.commit-keeps-other-threads', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments, readDocument } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    const first = commitDocuments(rt, paths, {
      changes: [
        { slug: 'a', text: '# A\n\nfirst\n', expectedBlob: null },
        { slug: 'b', text: '# B\n\nfirst\n', expectedBlob: null }
      ],
      message: 'seed a and b'
    })
    assert.ok(first.ok)
    const oldTip = tipOf(repo)
    const oldB = blobAt(repo, oldTip, 'b.md')
    const readA = readDocument(rt, paths, 'a')
    assert.ok(readA !== null)
    assert.equal(readA.text, '# A\n\nfirst\n')
    const second = commitDocuments(rt, paths, {
      changes: [{ slug: 'a', text: '# A\n\nsecond\n', expectedBlob: readA.blob }],
      message: 'update a'
    })
    assert.ok(second.ok)
    const newTip = tipOf(repo)
    assert.deepEqual(parentsOf(repo, newTip), [oldTip])
    assert.deepEqual(namesAt(repo, newTip), ['a.md', 'b.md'])
    assert.equal(textAt(repo, newTip, 'a.md'), '# A\n\nsecond\n')
    assert.equal(blobAt(repo, newTip, 'b.md'), oldB)
  })
})

test('store.commit-retries-when-another-thread-moved-the-ref', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments, readDocument } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    assert.ok(commitDocuments(rt, paths, { changes: [{ slug: 'a', text: 'a one\n', expectedBlob: null }], message: 'a one' }).ok)
    const readA = readDocument(rt, paths, 'a')
    assert.ok(readA !== null)
    const other: { commit: string | null } = { commit: null }
    const result = commitDocuments(rt, paths, {
      changes: [{ slug: 'a', text: 'a two\n', expectedBlob: readA.blob }],
      message: 'a two',
      beforeCas: () => {
        if (other.commit !== null) return
        const moved = commitDocuments(rt, paths, {
          changes: [{ slug: 'b', text: 'b one\n', expectedBlob: null }],
          message: 'b one'
        })
        assert.ok(moved.ok)
        other.commit = moved.value.commit
      }
    })
    assert.ok(result.ok)
    assert.ok(other.commit !== null)
    const tip = tipOf(repo)
    assert.equal(result.value.commit, tip)
    assert.deepEqual(parentsOf(repo, tip), [other.commit])
    assert.deepEqual(namesAt(repo, tip), ['a.md', 'b.md'])
    assert.equal(textAt(repo, tip, 'a.md'), 'a two\n')
    assert.equal(textAt(repo, tip, 'b.md'), 'b one\n')
  })
})

test('store.commit-stops-when-the-same-thread-moved', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments, readDocument } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    assert.ok(commitDocuments(rt, paths, { changes: [{ slug: 'a', text: 'a one\n', expectedBlob: null }], message: 'a one' }).ok)
    const readA = readDocument(rt, paths, 'a')
    assert.ok(readA !== null)
    const other: { commit: string | null } = { commit: null }
    const result = commitDocuments(rt, paths, {
      changes: [{ slug: 'a', text: 'a from the first read\n', expectedBlob: readA.blob }],
      message: 'a from the first read',
      beforeCas: () => {
        if (other.commit !== null) return
        const moved = commitDocuments(rt, paths, {
          changes: [{ slug: 'a', text: 'a from another writer\n', expectedBlob: readA.blob }],
          message: 'a from another writer'
        })
        assert.ok(moved.ok)
        other.commit = moved.value.commit
      }
    })
    assert.deepEqual(result, { ok: false, cause: 'thread-moved', slug: 'a' })
    assert.equal(tipOf(repo), other.commit)
    assert.equal(textAt(repo, tipOf(repo), 'a.md'), 'a from another writer\n')
  })
})

test('store.commit-refuses-when-the-ref-keeps-moving', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments, readDocument } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    assert.ok(commitDocuments(rt, paths, { changes: [{ slug: 'a', text: 'a one\n', expectedBlob: null }], message: 'a one' }).ok)
    const readA = readDocument(rt, paths, 'a')
    assert.ok(readA !== null)
    const moves: { count: number } = { count: 0 }
    const result = commitDocuments(rt, paths, {
      changes: [{ slug: 'a', text: 'a two\n', expectedBlob: readA.blob }],
      message: 'a two',
      beforeCas: () => {
        moves.count += 1
        const moved = commitDocuments(rt, paths, {
          changes: [{ slug: 'b', text: `b ${moves.count}\n`, expectedBlob: readDocument(rt, paths, 'b')?.blob ?? null }],
          message: `b ${moves.count}`
        })
        assert.ok(moved.ok)
      }
    })
    assert.ok(!result.ok)
    assert.ok('field' in result)
    assert.equal(result.field, 'refs/logbook/threads')
    assert.ok(result.message.includes('refs/logbook/threads kept moving'))
    assert.equal(moves.count, 11)
    assert.equal(textAt(repo, tipOf(repo), 'a.md'), 'a one\n')
  })
})

test('store.commit-without-identity-refuses', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments } = await import('../../src/thread/store.ts')
  withRepoNoIdentity((repo) =>
    withTempDir('logbook-thread-home', (home) => {
      const rt = runtimeWith(repo, { HOME: home })
      const found = findRepository(rt, repo)
      assert.ok(found.ok)
      const result = commitDocuments(rt, found.value, {
        changes: [{ slug: 'fix-login', text: '# Fix login\n', expectedBlob: null }],
        message: 'open_thread fix-login: opened'
      })
      assert.ok(!result.ok)
      assert.ok('example' in result)
      assert.equal(result.example, 'git config user.name "<name>" && git config user.email "<email>"')
      assert.notEqual(rawGit(repo, ['rev-parse', '--verify', '--quiet', 'refs/logbook/threads']).status, 0)
    })
  )
})

test('store.commit-uses-the-repository-identity', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { commitDocuments } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    mustGit(repo, ['config', 'user.name', 'Thread Store Author'])
    mustGit(repo, ['config', 'user.email', 'author@logbook.test'])
    const result = commitDocuments(rt, paths, {
      changes: [{ slug: 'fix-login', text: '# Fix login\n', expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(result.ok)
    assert.deepEqual(mustGit(repo, ['log', '-1', '--format=%an%n%ae%n%cn%n%ce', tipOf(repo)]).trim().split('\n'), [
      'Thread Store Author',
      'author@logbook.test',
      'Thread Store Author',
      'author@logbook.test'
    ])
  })
})

test('store.listing-skips-names-that-are-not-slugs', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { listSlugs } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    seedThreads(repo, {
      'fix-login.md': '# Fix login\n',
      'aliases.json': '{}\n',
      'Bad.md': '# Bad\n',
      'notes.txt': 'notes\n'
    })
    assert.deepEqual(listSlugs(rt, paths), ['fix-login'])
  })
})

test('store.resolves-a-slug', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    seedThreads(repo, { 'fix-login.md': '# Fix login\n' })
    assert.deepEqual(resolveThreadId(rt, paths, 'fix-login'), { ok: true, value: 'fix-login' })
  })
})

test('store.refuses-a-slug-without-a-document', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    seedThreads(repo, { 'fix-login.md': '# Fix login\n' })
    const result = resolveThreadId(rt, paths, 'fix-logout')
    assert.ok(!result.ok)
    assert.equal(result.field, 'thread_id')
    assert.equal(result.accepted, 'the slug of a thread, or an old thread id listed in aliases.json')
    assert.ok(result.message.includes('list_threads'))
  })
})

test('store.resolves-an-old-id-through-the-aliases', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId, readAliases } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    const oldId = ulid()
    seedThreads(repo, { 'fix-login.md': '# Fix login\n', 'aliases.json': JSON.stringify({ [oldId]: 'fix-login' }) })
    assert.deepEqual(readAliases(rt, paths), { [oldId]: 'fix-login' })
    assert.deepEqual(resolveThreadId(rt, paths, oldId), { ok: true, value: 'fix-login' })
  })
})

test('store.refuses-an-old-id-not-in-the-aliases', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    const listedId = ulid()
    const absentId = ulid()
    seedThreads(repo, { 'fix-login.md': '# Fix login\n', 'aliases.json': JSON.stringify({ [listedId]: 'fix-login' }) })
    const result = resolveThreadId(rt, paths, absentId)
    assert.ok(!result.ok)
    assert.equal(result.field, 'thread_id')
  })
})

test('store.refuses-other-text', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    seedThreads(repo, { 'fix-login.md': '# Fix login\n' })
    for (const threadId of ['Fix Login', '../fix']) {
      const result = resolveThreadId(rt, paths, threadId)
      assert.ok(!result.ok)
      assert.equal(result.field, 'thread_id')
    }
  })
})

test('store.reads-a-missing-aliases-file-as-empty', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId, readAliases } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    seedThreads(repo, { 'fix-login.md': '# Fix login\n' })
    assert.deepEqual(readAliases(rt, paths), {})
    const result = resolveThreadId(rt, paths, ulid())
    assert.ok(!result.ok)
    assert.equal(result.field, 'thread_id')
  })
})

test('store.reads-a-broken-aliases-file-as-empty', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId, readAliases } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    for (const aliases of ['not json', '[1,2]']) {
      seedThreads(repo, { 'fix-login.md': '# Fix login\n', 'aliases.json': aliases })
      assert.deepEqual(readAliases(rt, paths), {})
      const result = resolveThreadId(rt, paths, ulid())
      assert.ok(!result.ok)
      assert.equal(result.field, 'thread_id')
    }
  })
})

test('store.ignores-alias-entries-that-are-not-valid', async () => {
  const { findRepository } = await import('../../src/thread/paths.ts')
  const { resolveThreadId, readAliases } = await import('../../src/thread/store.ts')
  withStore(findRepository, ({ repo, rt, paths }) => {
    const oldId = ulid()
    seedThreads(repo, {
      'fix-login.md': '# Fix login\n',
      'aliases.json': JSON.stringify({ x: 'fix-login', [oldId]: '../etc' })
    })
    assert.deepEqual(readAliases(rt, paths), {})
    for (const threadId of ['x', oldId]) {
      const result = resolveThreadId(rt, paths, threadId)
      assert.ok(!result.ok)
      assert.equal(result.field, 'thread_id')
    }
  })
})
