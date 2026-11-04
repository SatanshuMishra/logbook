import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import type { RepoPaths } from '../../src/thread/paths.ts'
import type { ToolChange } from '../../src/thread/reconcile.ts'
import { rawGit } from '../support/git-fixture.ts'
import { testRuntime } from '../support/runtime.ts'

const THREADS_REF = 'refs/logbook/threads'
const STORED_AT = '2023-12-31T09:00:00.000Z'
const SESSION_HOLDER = 'session-holder'
const PENDING_RISK = '- R1 Pending risk from the session.'
const PUSH_LIMIT_MS = 120000

type Modules = {
  store: typeof import('../../src/thread/store.ts')
  reconcile: typeof import('../../src/thread/reconcile.ts')
  paths: typeof import('../../src/thread/paths.ts')
  holds: typeof import('../../src/thread/holds.ts')
  render: typeof import('../../src/doc/render.ts')
  roster: typeof import('../../src/thread/roster.ts')
  sync: typeof import('../../src/thread/sync.ts')
}

type CommandRuntime = Runtime & { writer: { kind: string; name: string } }

type Fixture = {
  repo: string
  home: string
  paths: RepoPaths
  session: Runtime
  command: CommandRuntime
  modules: Modules
}

type DocumentParts = { slug?: string; title?: string; stand?: string }

const loadModules = async (): Promise<Modules> => ({
  store: await import('../../src/thread/store.ts'),
  reconcile: await import('../../src/thread/reconcile.ts'),
  paths: await import('../../src/thread/paths.ts'),
  holds: await import('../../src/thread/holds.ts'),
  render: await import('../../src/doc/render.ts'),
  roster: await import('../../src/thread/roster.ts'),
  sync: await import('../../src/thread/sync.ts')
})

const stateDocument = (parts: DocumentParts = {}): string => {
  const slug = parts.slug ?? 'fix-login'
  const lines = [
    `# ${slug}: ${parts.title ?? 'Fix the login page'}`,
    'Status: active',
    `Updated: ${STORED_AT}`,
    'Next ids: c2 D1 R1 S1',
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    '- [ ] c1 The login page loads.',
    '',
    '## Where things stand',
    '',
    parts.stand ?? 'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    'Find the fault.',
    '',
    '## Decisions in force',
    '',
    '## Open risks',
    '',
    '## Settled, do not reopen',
    '',
    '## Where the details live'
  ]
  return `${lines.join('\n')}\n`
}

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const configureIdentity = (repo: string, name: string): void => {
  mustGit(repo, ['config', 'user.name', `Writers Tester ${name}`])
  mustGit(repo, ['config', 'user.email', `${name}@logbook.test`])
}

const initRepository = (repo: string): void => {
  mkdirSync(repo, { recursive: true })
  mustGit(repo, ['init', '--quiet', '--initial-branch=main'])
  configureIdentity(repo, 'local')
  writeFileSync(join(repo, 'README.md'), 'writers test repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '--quiet', '-m', 'initial commit'])
}

const sessionRuntimeFor = (home: string): Runtime =>
  testRuntime({ env: { PATH: process.env.PATH, HOME: home }, sessionId: SESSION_HOLDER })

const commandRuntimeFor = (home: string): CommandRuntime =>
  Object.assign(testRuntime({ env: { PATH: process.env.PATH, HOME: home }, sessionId: SESSION_HOLDER }), {
    writer: { kind: 'command', name: 'run:demo' }
  })

const seedThread = (modules: Modules, rt: Runtime, paths: RepoPaths, parts: DocumentParts = {}): void => {
  const seeded = modules.store.commitDocuments(rt, paths, {
    changes: [{ slug: parts.slug ?? 'fix-login', text: stateDocument(parts), expectedBlob: null }],
    message: `open_thread ${parts.slug ?? 'fix-login'}: opened`
  })
  assert.ok(seeded.ok, `the thread must be seeded: ${describe(seeded)}`)
}

const withFixture = async (fn: (fixture: Fixture) => Promise<void> | void): Promise<void> => {
  const modules = await loadModules()
  const root = mkdtempSync(join(tmpdir(), 'logbook-run-writers-'))
  try {
    const repo = join(root, 'repo')
    const home = join(root, 'home')
    mkdirSync(home)
    initRepository(repo)
    const session = sessionRuntimeFor(home)
    const found = modules.paths.findRepository(session, repo)
    assert.ok(found.ok, 'the scratch repository must be found')
    seedThread(modules, session, found.value)
    await fn({ repo, home, paths: found.value, session, command: commandRuntimeFor(home), modules })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const describe = (value: unknown): string =>
  JSON.stringify(value, (key, field: unknown) => (key === 'push' && field !== null ? 'a push child' : field))

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', THREADS_REF]).trim()

const storedText = (repo: string, slug = 'fix-login'): string =>
  mustGit(repo, ['cat-file', 'blob', `${THREADS_REF}:${slug}.md`])

const messageLines = (repo: string, revision: string): string[] =>
  mustGit(repo, ['log', '-1', '--format=%B', revision]).replace(/\n+$/, '').split('\n')

const sectionBody = (text: string, heading: string): string => {
  const lines = text.split('\n')
  const start = lines.indexOf(`## ${heading}`)
  assert.ok(start >= 0, `the document must have the section ## ${heading}`)
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith('## '))
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim()
}

const withoutUpdatedLine = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.startsWith('Updated: '))
    .join('\n')

const assertWriterTrailer = (lines: readonly string[], writer: string): void => {
  assert.deepEqual(lines.slice(-2), ['', `Writer: ${writer}`], `the commit message must end with the writer: ${lines.join('\n')}`)
}

const nextStepChange =
  (modules: Modules, body: string): ToolChange =>
  (text) => {
    const edited = modules.render.replaceSection(text, 'Next step', [body])
    if (!edited.ok) {
      return {
        ok: false,
        refusal: {
          ok: false,
          field: 'next_step',
          accepted: 'a document with a Next step section',
          example: body,
          retryable: false,
          message: edited.message
        }
      }
    }
    return { ok: true, text: edited.text, summary: 'next step set', details: [], noteLines: [] }
  }

const replaceOnce = (text: string, from: string, to: string): string => {
  assert.ok(text.includes(from), `the document must hold ${JSON.stringify(from)}`)
  return text.replace(from, to)
}

const withPendingRisk = (text: string): string =>
  replaceOnce(
    replaceOnce(text, 'Next ids: c2 D1 R1 S1', 'Next ids: c2 D1 R2 S1'),
    '## Open risks\n\n',
    `## Open risks\n\n${PENDING_RISK}\n\n`
  )

const workingCopyFile = (fixture: Fixture, paths: RepoPaths = fixture.paths): string => {
  const file = fixture.modules.paths.workingCopyPath(paths, 'fix-login')
  assert.ok(file.ok, 'the working copy path must resolve')
  return file.value
}

const holdFile = (fixture: Fixture): string => {
  const file = fixture.modules.paths.holdPath(fixture.paths, 'fix-login')
  assert.ok(file.ok, 'the hold path must resolve')
  return file.value
}

const materialise = (modules: Modules, rt: Runtime, paths: RepoPaths): void => {
  const result = modules.reconcile.reconcileThread(rt, paths, 'fix-login')
  assert.ok('kind' in result && result.kind === 'materialised', describe(result))
}

const editCopy = (file: string, edit: (text: string) => string): Buffer => {
  writeFileSync(file, edit(readFileSync(file, 'utf8')))
  return readFileSync(file)
}

const logbookFolder = (repo: string): string =>
  join(mustGit(repo, ['rev-parse', '--path-format=absolute', '--git-common-dir']).trim(), 'logbook')

const snapshotFolder = (folder: string): Record<string, string> => {
  if (!existsSync(folder)) return {}
  const files = readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .sort()
  return Object.fromEntries(files.map((file) => [file, readFileSync(file).toString('base64')]))
}

const exitOf = async (child: ChildProcess): Promise<number | null> => {
  const exited = new Promise<number | null>((resolve, reject) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode)
      return
    }
    child.once('exit', (code) => resolve(code))
    child.once('error', reject)
  })
  let limitTimer: ReturnType<typeof setTimeout> | undefined
  const limit = new Promise<'timeout'>((resolve) => {
    limitTimer = setTimeout(() => resolve('timeout'), PUSH_LIMIT_MS)
  })
  try {
    const outcome = await Promise.race([exited, limit])
    if (outcome === 'timeout') {
      child.kill('SIGKILL')
      assert.fail(`the push child did not exit within ${PUSH_LIMIT_MS} ms`)
    }
    return outcome
  } finally {
    clearTimeout(limitTimer)
  }
}

const waitForPush = async (push: ChildProcess | null): Promise<void> => {
  if (push !== null) await exitOf(push)
}

test('writers.command-write-leaves-a-pending-edit-uncommitted-and-untouched', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    materialise(modules, fixture.session, fixture.paths)
    const copy = workingCopyFile(fixture)
    const copyBefore = editCopy(copy, withPendingRisk)
    const folderBefore = snapshotFolder(logbookFolder(fixture.repo))
    const result = modules.reconcile.applyToolChange(fixture.command, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(result.ok, describe(result))
    const stored = storedText(fixture.repo)
    assert.equal(sectionBody(stored, 'Next step'), 'Ship the fix.')
    assert.ok(!stored.includes('Pending risk from the session.'), stored)
    assert.deepEqual(readFileSync(copy), copyBefore)
    assert.deepEqual(snapshotFolder(logbookFolder(fixture.repo)), folderBefore)
  })
})

test('writers.command-write-is-not-blocked-by-a-refused-edit', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    materialise(modules, fixture.session, fixture.paths)
    const copy = workingCopyFile(fixture)
    const copyBefore = editCopy(copy, (text) => replaceOnce(text, '## Goal\n', ''))
    const result = modules.reconcile.applyToolChange(fixture.command, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(result.ok, describe(result))
    const stored = storedText(fixture.repo)
    assert.equal(sectionBody(stored, 'Next step'), 'Ship the fix.')
    assert.ok(stored.split('\n').includes('## Goal'), stored)
    assert.deepEqual(readFileSync(copy), copyBefore)
  })
})

test('writers.command-write-leaves-the-hold-and-a-missing-copy-alone', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    modules.holds.takeHold(fixture.session, fixture.paths, 'fix-login', SESSION_HOLDER, null)
    const holdBefore = readFileSync(holdFile(fixture))
    const copy = workingCopyFile(fixture)
    assert.equal(existsSync(copy), false)
    const result = modules.reconcile.applyToolChange(fixture.command, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(result.ok, describe(result))
    assert.equal(sectionBody(storedText(fixture.repo), 'Next step'), 'Ship the fix.')
    assert.equal(existsSync(copy), false)
    assert.deepEqual(readFileSync(holdFile(fixture)), holdBefore)
  })
})

test('writers.session-settle-keeps-both-the-command-write-and-the-pending-edit', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    materialise(modules, fixture.session, fixture.paths)
    const copy = workingCopyFile(fixture)
    editCopy(copy, withPendingRisk)
    const written = modules.reconcile.applyToolChange(fixture.command, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(written.ok, describe(written))
    const settled = modules.reconcile.reconcileThread(fixture.session, fixture.paths, 'fix-login')
    assert.ok('kind' in settled && settled.kind === 'accepted', describe(settled))
    const stored = storedText(fixture.repo)
    assert.equal(sectionBody(stored, 'Next step'), 'Ship the fix.')
    assert.ok(stored.split('\n').includes(PENDING_RISK), stored)
    assert.equal(withoutUpdatedLine(readFileSync(copy, 'utf8')), withoutUpdatedLine(stored))
  })
})

test('writers.unedited-stale-copy-is-refreshed-without-a-commit', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    materialise(modules, fixture.session, fixture.paths)
    const copy = workingCopyFile(fixture)
    const written = modules.reconcile.applyToolChange(fixture.command, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(written.ok, describe(written))
    const roster = modules.roster.listRoster(fixture.session, fixture.paths, { includeClosed: false })
    const entry = roster.threads.find((thread) => thread.slug === 'fix-login')
    assert.ok(entry !== undefined, 'the roster must list fix-login')
    assert.equal(entry.difference, null)
    const before = tipOf(fixture.repo)
    const settled = modules.reconcile.reconcileThread(fixture.session, fixture.paths, 'fix-login')
    assert.ok('kind' in settled && settled.kind === 'materialised', describe(settled))
    assert.equal(tipOf(fixture.repo), before)
    assert.equal(readFileSync(copy, 'utf8'), storedText(fixture.repo))
  })
})

test('writers.conflicting-edits-leave-markers-and-keep-the-command-write', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    materialise(modules, fixture.session, fixture.paths)
    const copy = workingCopyFile(fixture)
    editCopy(copy, (text) => replaceOnce(text, '## Next step\n\nFind the fault.\n', '## Next step\n\nSession step.\n'))
    const written = modules.reconcile.applyToolChange(fixture.command, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Command step.')
    })
    assert.ok(written.ok, describe(written))
    const before = tipOf(fixture.repo)
    const settled = modules.reconcile.reconcileThread(fixture.session, fixture.paths, 'fix-login')
    assert.ok('kind' in settled && settled.kind === 'refused', describe(settled))
    assert.ok(
      settled.violations.some((violation) => violation.rule === 'conflict'),
      JSON.stringify(settled.violations)
    )
    assert.equal(sectionBody(storedText(fixture.repo), 'Next step'), 'Command step.')
    assert.equal(tipOf(fixture.repo), before)
    const lines = readFileSync(copy, 'utf8').split('\n')
    assert.ok(lines.some((line) => line.startsWith('<<<<<<<')), lines.join('\n'))
    assert.ok(lines.includes('Session step.'), lines.join('\n'))
    assert.ok(lines.includes('Command step.'), lines.join('\n'))
  })
})

type Clone = { repo: string; paths: RepoPaths; session: Runtime; command: CommandRuntime }

const cloneFor = (modules: Modules, root: string, origin: string, name: string): Clone => {
  mustGit(root, ['clone', '--quiet', origin, name])
  const repo = join(root, name)
  configureIdentity(repo, name)
  const home = join(root, `home-${name}`)
  mkdirSync(home)
  const session = sessionRuntimeFor(home)
  const found = modules.paths.findRepository(session, repo)
  assert.ok(found.ok, `clone ${name} must be found`)
  return { repo, paths: found.value, session, command: commandRuntimeFor(home) }
}

test('writers.sync-carries-a-copy-from-its-own-base', async () => {
  const modules = await loadModules()
  const root = mkdtempSync(join(tmpdir(), 'logbook-run-writers-sync-'))
  try {
    const origin = join(root, 'origin.git')
    mustGit(root, ['init', '--quiet', '--bare', '--initial-branch=main', origin])
    const a = cloneFor(modules, root, origin, 'a')
    mustGit(a.repo, ['symbolic-ref', 'HEAD', 'refs/heads/main'])
    writeFileSync(join(a.repo, 'README.md'), 'writers sync repository\n')
    mustGit(a.repo, ['add', 'README.md'])
    mustGit(a.repo, ['commit', '--quiet', '-m', 'initial commit'])
    mustGit(a.repo, ['push', '--quiet', 'origin', 'main'])
    seedThread(modules, a.session, a.paths)
    mustGit(a.repo, ['push', '--quiet', 'origin', `${THREADS_REF}:${THREADS_REF}`])
    const b = cloneFor(modules, root, origin, 'b')
    mustGit(b.repo, ['fetch', '--quiet', 'origin', `${THREADS_REF}:${THREADS_REF}`])
    const fromB = modules.reconcile.applyToolChange(b.session, b.paths, 'fix-login', {
      tool: 'update_thread',
      change: (text) => ({
        ok: true,
        text: replaceOnce(
          replaceOnce(text, 'Next ids: c2 D1 R1 S1', 'Next ids: c3 D1 R1 S1'),
          '- [ ] c1 The login page loads.\n',
          '- [ ] c1 The login page loads.\n- [ ] c2 Sign-up still works.\n'
        ),
        summary: 'added c2',
        details: [],
        noteLines: []
      })
    })
    assert.ok(fromB.ok, describe(fromB))
    await waitForPush(fromB.value.push)
    mustGit(b.repo, ['push', '--quiet', 'origin', `${THREADS_REF}:${THREADS_REF}`])
    materialise(modules, a.session, a.paths)
    const copy = modules.paths.workingCopyPath(a.paths, 'fix-login')
    assert.ok(copy.ok, 'the working copy path must resolve')
    const copyBefore = editCopy(copy.value, withPendingRisk)
    const fromA = modules.reconcile.applyToolChange(a.command, a.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(fromA.ok, describe(fromA))
    await waitForPush(fromA.value.push)
    assert.deepEqual(readFileSync(copy.value), copyBefore)
    await modules.sync.syncThreads(a.session, a.paths)
    modules.reconcile.reconcileThread(a.session, a.paths, 'fix-login')
    const stored = storedText(a.repo)
    assert.equal(sectionBody(stored, 'Next step'), 'Ship the fix.')
    assert.ok(stored.split('\n').includes('- [ ] c2 Sign-up still works.'), stored)
    assert.ok(stored.split('\n').includes(PENDING_RISK), stored)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('writers.commit-lands-after-another-thread-moves-the-ref-25-times', async () => {
  await withFixture((fixture) => {
    const { modules, session, paths } = fixture
    seedThread(modules, session, paths, { slug: 'beta', title: 'The beta thread' })
    const current = modules.store.readDocument(session, paths, 'fix-login')
    assert.ok(current !== null, 'fix-login must be stored')
    const changed = replaceOnce(current.text, 'Find the fault.', 'Ship the fix.')
    let calls = 0
    const result = modules.store.commitDocuments(session, paths, {
      changes: [{ slug: 'fix-login', text: changed, expectedBlob: current.blob }],
      message: 'update fix-login: next step set',
      beforeCas: () => {
        calls += 1
        if (calls > 25) return
        const beta = modules.store.readDocument(session, paths, 'beta')
        assert.ok(beta !== null, 'beta must be stored')
        const moved = modules.store.commitDocuments(session, paths, {
          changes: [
            {
              slug: 'beta',
              text: stateDocument({ slug: 'beta', title: 'The beta thread', stand: `Beta moved ${calls} times.` }),
              expectedBlob: beta.blob
            }
          ],
          message: `update beta: moved ${calls}`
        })
        assert.ok(moved.ok, describe(moved))
      }
    })
    assert.ok(result.ok, describe(result))
    const history = mustGit(fixture.repo, ['rev-list', '--first-parent', THREADS_REF]).trim().split('\n')
    const changedFiles = (commit: string): string[] =>
      mustGit(fixture.repo, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).trim().split('\n')
    assert.deepEqual(changedFiles(history[0] ?? ''), ['fix-login.md'])
    const betaCommits = history.slice(1, 26)
    assert.equal(betaCommits.length, 25)
    for (const commit of betaCommits) assert.deepEqual(changedFiles(commit), ['beta.md'])
    assert.equal(storedText(fixture.repo), changed)
  })
})

test('writers.tool-change-lands-after-the-same-thread-moves-5-times', async () => {
  await withFixture((fixture) => {
    const { modules, session, paths } = fixture
    let calls = 0
    const result = modules.reconcile.applyToolChange(fixture.command, paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.'),
      beforeCas: () => {
        calls += 1
        if (calls > 5) return
        const tip = modules.store.readDocument(session, paths, 'fix-login')
        assert.ok(tip !== null, 'fix-login must be stored')
        const added = modules.render.addItem(tip.text, 'R', `Other writer ${calls}.`)
        assert.ok(added.ok, describe(added))
        assert.equal(added.id, `R${calls}`)
        const moved = modules.store.commitDocuments(session, paths, {
          changes: [{ slug: 'fix-login', text: added.text, expectedBlob: tip.blob }],
          message: `update fix-login: added R${calls}`
        })
        assert.ok(moved.ok, describe(moved))
      }
    })
    assert.ok(result.ok, describe(result))
    const stored = storedText(fixture.repo)
    assert.equal(sectionBody(stored, 'Next step'), 'Ship the fix.')
    const lines = stored.split('\n')
    for (const k of [1, 2, 3, 4, 5]) assert.ok(lines.includes(`- R${k} Other writer ${k}.`), stored)
  })
})

test('writers.session-tool-commit-names-the-session-id', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    const result = modules.reconcile.applyToolChange(fixture.session, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(result.ok, describe(result))
    assertWriterTrailer(messageLines(fixture.repo, THREADS_REF), SESSION_HOLDER)
  })
})

test('writers.session-edit-commit-names-the-session-id', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    materialise(modules, fixture.session, fixture.paths)
    editCopy(workingCopyFile(fixture), (text) =>
      replaceOnce(
        text,
        '- [ ] c1 The login page loads.',
        '- [x] c1 The login page loads. evidence: the page test passed'
      )
    )
    const result = modules.reconcile.reconcileThread(fixture.session, fixture.paths, 'fix-login')
    assert.ok('kind' in result && result.kind === 'accepted', describe(result))
    assertWriterTrailer(messageLines(fixture.repo, result.commit), SESSION_HOLDER)
  })
})

test('writers.command-tool-commit-names-the-run-writer', async () => {
  await withFixture((fixture) => {
    const { modules } = fixture
    const result = modules.reconcile.applyToolChange(fixture.command, fixture.paths, 'fix-login', {
      tool: 'update_thread',
      change: nextStepChange(modules, 'Ship the fix.')
    })
    assert.ok(result.ok, describe(result))
    assertWriterTrailer(messageLines(fixture.repo, result.value.commit), 'run:demo')
  })
})
