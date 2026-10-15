import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Runtime } from '../../src/runtime/runtime.ts'
import { readHold, setNudged, takeHold } from '../../src/thread/holds.ts'
import { writeMarker } from '../../src/thread/inflight.ts'
import { findRepository, markerPath, workingCopyPath, type RepoPaths } from '../../src/thread/paths.ts'
import { commitDocuments } from '../../src/thread/store.ts'
import { rawGit } from '../support/git-fixture.ts'
import type { HookProcessResult } from '../support/run-hook.ts'
import { testRuntime } from '../support/runtime.ts'

type Fixture = { repo: string; home: string; paths: RepoPaths; rt: Runtime; workingCopy: string }

type FixtureOptions = { held?: boolean; risks?: string[] }

const STORED_AT = new Date(Date.UTC(2026, 9, 14, 9, 0)).toISOString()

const C1_OPEN = '- [ ] c1 The login page loads'
const C1_TICKED = '- [x] c1 The login page loads evidence: test login.loads passed'
const C2_OPEN = '- [ ] c2 Errors show under the form'
const R1 = '- R1 The staging database may be stale'

const UPDATE_OPENING = 'logbook: update the state document at '

type DocParts = { criteria?: string[]; risks?: string[]; nextIds?: string; tail?: string[] }

const fixLogin = (parts: DocParts = {}): string => {
  const risks = parts.risks ?? [R1]
  const lines = [
    '# fix-login: Fix the login page',
    'Status: active',
    `Updated: ${STORED_AT}`,
    `Next ids: ${parts.nextIds ?? 'c3 D2 R2 S1'}`,
    '',
    '## Goal',
    '',
    'Users can log in again.',
    '',
    '## Done when',
    '',
    ...(parts.criteria ?? [C1_OPEN, C2_OPEN]),
    '',
    '## Where things stand',
    '',
    'The form renders but submitting it fails.',
    '',
    '## Next step',
    '',
    'Fix the submit handler.',
    '',
    '## Decisions in force',
    '',
    '- D1 Keep the session cookie: the mobile app reads it',
    '',
    '## Open risks',
    '',
    ...(risks.length === 0 ? [] : [...risks, '']),
    '## Settled, do not reopen',
    '',
    '## Where the details live',
    '',
    '- Spec: docs/specs/login.md',
    ...(parts.tail ?? [])
  ]
  return `${lines.join('\n')}\n`
}

const mustGit = (repo: string, args: string[]): string => {
  const result = rawGit(repo, args)
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout
}

const tipOf = (repo: string): string => mustGit(repo, ['rev-parse', 'refs/logbook/threads']).trim()

const parentOf = (repo: string, commit: string): string => mustGit(repo, ['rev-parse', `${commit}^`]).trim()

const initRepo = (repo: string): void => {
  mustGit(repo, ['init', '--initial-branch=main'])
  mustGit(repo, ['config', 'user.name', 'Logbook Fixture'])
  mustGit(repo, ['config', 'user.email', 'fixture@logbook.test'])
  writeFileSync(join(repo, 'README.md'), 'logbook fixture repository\n')
  mustGit(repo, ['add', 'README.md'])
  mustGit(repo, ['commit', '-m', 'fixture: initial commit'])
}

const withThread = async (options: FixtureOptions, fn: (fixture: Fixture) => Promise<void>): Promise<void> => {
  const repo = mkdtempSync(join(tmpdir(), 'logbook-post-tool-use-repo-'))
  const home = mkdtempSync(join(tmpdir(), 'logbook-post-tool-use-home-'))
  try {
    initRepo(repo)
    const rt = testRuntime({ cwd: repo, env: { PATH: process.env.PATH, HOME: home }, sessionId: 's1' })
    const found = findRepository(rt, repo)
    assert.ok(found.ok, 'the test repository must be found')
    const seeded = commitDocuments(rt, found.value, {
      changes: [{ slug: 'fix-login', text: fixLogin({ risks: options.risks ?? [R1] }), expectedBlob: null }],
      message: 'open_thread fix-login: opened'
    })
    assert.ok(seeded.ok, 'the stored document must be seeded')
    if (options.held ?? true) takeHold(rt, found.value, 'fix-login', 's1', null)
    const workingCopy = workingCopyPath(found.value, 'fix-login')
    assert.ok(workingCopy.ok, 'the working copy path must be built')
    await fn({ repo, home, paths: found.value, rt, workingCopy: workingCopy.value })
  } finally {
    rmSync(repo, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}

const writeFile = (file: string, text: string): void => {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

const postEvent = (fixture: Fixture, fields: Record<string, unknown>): Record<string, unknown> => ({
  session_id: 's1',
  transcript_path: join(fixture.home, 'transcripts', 's1.jsonl'),
  cwd: fixture.repo,
  prompt_id: 'p0',
  hook_event_name: 'PostToolUse',
  tool_use_id: 'toolu_00',
  ...fields
})

const editEvent = (fixture: Fixture, file: string, fields: Record<string, unknown> = {}): Record<string, unknown> =>
  postEvent(fixture, {
    tool_name: 'Edit',
    tool_input: { file_path: file, old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false },
    tool_response: { filePath: file },
    ...fields
  })

const bashEvent = (
  fixture: Fixture,
  command: string,
  promptId: string,
  fields: Record<string, unknown> = {}
): Record<string, unknown> =>
  postEvent(fixture, {
    tool_name: 'Bash',
    tool_input: { command, description: 'run a command' },
    tool_response: { stdout: '', stderr: '', interrupted: false },
    prompt_id: promptId,
    ...fields
  })

const runPost = async (fixture: Fixture, event: Record<string, unknown>): Promise<HookProcessResult> => {
  const { runHookProcess } = await import('../support/run-hook.ts')
  const run = await runHookProcess({ hook: 'post-tool-use', event, env: { HOME: fixture.home } })
  assert.equal(run.code, 0, run.stderr)
  return run
}

const contextOf = (run: HookProcessResult): string => {
  const output = JSON.parse(run.stdout)
  assert.equal(output.hookSpecificOutput?.hookEventName, 'PostToolUse', `stdout was ${run.stdout}`)
  const context = output.hookSpecificOutput.additionalContext
  assert.equal(typeof context, 'string')
  return context
}

const nudgedOf = (fixture: Fixture): string | null => {
  const hold = readHold(fixture.paths, 'fix-login')
  assert.ok(hold !== null, 'the hold must exist')
  return hold.nudged_prompt_id
}

const assertUpdateRequest = (fixture: Fixture, run: HookProcessResult, reason: string): void => {
  const context = contextOf(run)
  assert.ok(context.startsWith(`${UPDATE_OPENING}${fixture.workingCopy}.`), context)
  assert.ok(context.includes(`Reason: a milestone finished: ${reason}.`), context)
  assert.ok(context.includes('Edit tool'), context)
}

const ACCEPTED_OPENING = 'logbook: accepted the update to fix-login (commit '

const VALID_EDIT = fixLogin({ criteria: [C1_TICKED, C2_OPEN] })

test('post-tool-use.accepts-a-working-copy-edit', async () => {
  await withThread({}, async (fixture) => {
    writeFile(fixture.workingCopy, VALID_EDIT)
    const before = tipOf(fixture.repo)
    const run = await runPost(fixture, editEvent(fixture, fixture.workingCopy))
    assert.ok(contextOf(run).startsWith(ACCEPTED_OPENING), run.stdout)
    const after = tipOf(fixture.repo)
    assert.notEqual(after, before)
    assert.equal(parentOf(fixture.repo, after), before)
  })
})

test('post-tool-use.refuses-a-bad-edit', async () => {
  await withThread({}, async (fixture) => {
    writeFile(fixture.workingCopy, fixLogin({ risks: [] }))
    const before = tipOf(fixture.repo)
    const run = await runPost(
      fixture,
      postEvent(fixture, {
        tool_name: 'Write',
        tool_input: { file_path: fixture.workingCopy, content: fixLogin({ risks: [] }) },
        tool_response: { type: 'update', filePath: fixture.workingCopy }
      })
    )
    const context = contextOf(run)
    assert.ok(context.startsWith(`logbook: the edit to ${fixture.workingCopy} was not committed.`), context)
    const lines = context.split('\n')
    assert.ok(
      lines.slice(1).some((line) => line.startsWith('- ') && line.includes('R1')),
      context
    )
    assert.equal(tipOf(fixture.repo), before)
  })
})

test('post-tool-use.matches-the-working-copy-by-real-path', async () => {
  await withThread({}, async (fixture) => {
    writeFile(fixture.workingCopy, VALID_EDIT)
    const link = join(fixture.home, 'linked-folder')
    symlinkSync(dirname(fixture.workingCopy), link)
    const before = tipOf(fixture.repo)
    const run = await runPost(fixture, editEvent(fixture, join(link, 'fix-login.md')))
    assert.ok(contextOf(run).startsWith(ACCEPTED_OPENING), run.stdout)
    const after = tipOf(fixture.repo)
    assert.notEqual(after, before)
    assert.equal(parentOf(fixture.repo, after), before)
  })
})

test('post-tool-use.accepts-an-edit-made-inside-a-subagent', async () => {
  await withThread({}, async (fixture) => {
    writeFile(fixture.workingCopy, VALID_EDIT)
    const before = tipOf(fixture.repo)
    const run = await runPost(
      fixture,
      editEvent(fixture, fixture.workingCopy, { agent_id: 'a1', agent_type: 'general-purpose' })
    )
    assert.ok(contextOf(run).startsWith(ACCEPTED_OPENING), run.stdout)
    const after = tipOf(fixture.repo)
    assert.notEqual(after, before)
    assert.equal(parentOf(fixture.repo, after), before)
  })
})

test('post-tool-use.ignores-the-working-copy-of-another-repository', async () => {
  await withThread({}, async (fixture) => {
    const other = join(fixture.home, '.logbook', 'other-0123456789ab', 'fix-login.md')
    assert.notEqual(basename(dirname(fixture.workingCopy)), 'other-0123456789ab')
    writeFile(other, VALID_EDIT)
    writeFile(fixture.workingCopy, VALID_EDIT)
    const before = tipOf(fixture.repo)
    const run = await runPost(fixture, editEvent(fixture, other))
    assert.equal(run.stdout, '{}')
    assert.equal(tipOf(fixture.repo), before)
  })
})

test('post-tool-use.ignores-a-project-file', async () => {
  await withThread({ held: false }, async (fixture) => {
    const project = join(fixture.repo, 'src', 'a.ts')
    writeFile(project, 'export const a = 1\n')
    writeFile(fixture.workingCopy, VALID_EDIT)
    const before = tipOf(fixture.repo)
    const run = await runPost(fixture, editEvent(fixture, project))
    assert.equal(run.stdout, '{}')
    assert.equal(tipOf(fixture.repo), before)
  })
})

test('post-tool-use.ignores-an-input-without-a-path', async () => {
  await withThread({}, async (fixture) => {
    writeFile(fixture.workingCopy, VALID_EDIT)
    const before = tipOf(fixture.repo)
    const run = await runPost(
      fixture,
      postEvent(fixture, {
        tool_name: 'Edit',
        tool_input: { old_string: '- [ ] c1', new_string: '- [x] c1', replace_all: false },
        tool_response: {}
      })
    )
    assert.equal(run.stdout, '{}')
    assert.equal(tipOf(fixture.repo), before)
  })
})

test('post-tool-use.keeps-refusal-context-under-the-ceiling', async () => {
  const risks = Array.from({ length: 400 }, (_, index) => `- R${index + 1} Risk number ${index + 1} of the login work`)
  await withThread({ risks }, async (fixture) => {
    writeFile(fixture.workingCopy, fixLogin({ risks: [], nextIds: 'c3 D2 R401 S1' }))
    const before = tipOf(fixture.repo)
    const run = await runPost(fixture, editEvent(fixture, fixture.workingCopy))
    const context = contextOf(run)
    assert.ok(context.length <= 9500, `the context was ${context.length} characters`)
    const lines = context.split('\n')
    assert.equal(
      lines[0],
      `logbook: the edit to ${fixture.workingCopy} was not committed. Fix these and edit the file again:`
    )
    assert.ok(lines[1]?.startsWith('- ') && lines[1].includes('R1 was removed'), lines[1])
    const last = lines.at(-1) ?? ''
    const more = /^- and (\d+) more violations$/.exec(last)
    assert.ok(more !== null, `the last line was ${JSON.stringify(last)}`)
    const shown = lines.slice(1, -1)
    assert.ok(shown.length >= 1)
    assert.ok(shown.every((line) => line.startsWith('- ') && line.includes(' was removed')))
    assert.equal(Number(more[1]), 400 - shown.length)
    assert.equal(tipOf(fixture.repo), before)
  })
})

test('post-tool-use.cuts-a-long-violation-line', async () => {
  await withThread({}, async (fixture) => {
    const heading = `## ${'Z'.repeat(19997)}`
    assert.equal(heading.length, 20000)
    writeFile(fixture.workingCopy, fixLogin({ tail: ['', heading, '', 'An extra paragraph.'] }))
    const run = await runPost(fixture, editEvent(fixture, fixture.workingCopy))
    const context = contextOf(run)
    assert.ok(context.length <= 9500, `the context was ${context.length} characters`)
    const line = context.split('\n').find((candidate) => candidate.startsWith('- ') && candidate.includes('"## ZZZZ'))
    assert.ok(line !== undefined, context.slice(0, 2000))
    assert.equal(line.length, 1000)
    assert.ok(line.endsWith('...'))
  })
})

test('post-tool-use.nudges-after-an-agent-call', async () => {
  await withThread({}, async (fixture) => {
    const run = await runPost(
      fixture,
      postEvent(fixture, {
        tool_name: 'Agent',
        tool_input: { description: 'Explore the login flow', prompt: 'Find the submit handler', subagent_type: 'Explore' },
        tool_response: { status: 'completed', content: [{ type: 'text', text: 'The handler is in src/login.ts' }] },
        prompt_id: 'p1'
      })
    )
    const context = contextOf(run)
    assert.ok(context.includes('a milestone finished: Agent'), context)
    assert.ok(context.includes(fixture.workingCopy), context)
    assert.ok(context.includes('Edit tool'), context)
    assert.equal(nudgedOf(fixture), 'p1')
  })
})

test('post-tool-use.nudges-after-a-task-call', async () => {
  await withThread({}, async (fixture) => {
    setNudged(fixture.rt, fixture.paths, 'fix-login', 'p1')
    const run = await runPost(
      fixture,
      postEvent(fixture, {
        tool_name: 'Task',
        tool_input: { description: 'Check the form', prompt: 'Check the form errors', subagent_type: 'general-purpose' },
        tool_response: { content: [{ type: 'text', text: 'The errors render' }] },
        prompt_id: 'p2'
      })
    )
    assertUpdateRequest(fixture, run, 'Task: Check the form - The errors render')
    assert.equal(nudgedOf(fixture), 'p2')
  })
})

test('post-tool-use.nudges-after-git-commit-push-and-merge', async () => {
  await withThread({}, async (fixture) => {
    const cases: [string, string, string][] = [
      ["git commit -m \"$(cat <<'EOF'\nfix\nEOF\n)\"", 'p11', "Bash: git commit -m \"$(cat <<'EOF'"],
      ['cd x && git -C /repo push origin main', 'p12', 'Bash: cd x && git -C /repo push origin main'],
      ['git merge feature', 'p13', 'Bash: git merge feature'],
      ['FOO=1 git -c core.editor=true commit --amend', 'p14', 'Bash: FOO=1 git -c core.editor=true commit --amend']
    ]
    for (const [command, promptId, reason] of cases) {
      const run = await runPost(fixture, bashEvent(fixture, command, promptId))
      assertUpdateRequest(fixture, run, reason)
      assert.equal(nudgedOf(fixture), promptId)
    }
  })
})

test('post-tool-use.nudges-after-pull-request-calls', async () => {
  await withThread({}, async (fixture) => {
    const bashCases: [string, string][] = [
      ['gh pr create --draft --title x', 'p21'],
      ['gh pr merge 3', 'p22']
    ]
    for (const [command, promptId] of bashCases) {
      const run = await runPost(fixture, bashEvent(fixture, command, promptId))
      assertUpdateRequest(fixture, run, `Bash: ${command}`)
    }
    const toolCases: [string, Record<string, unknown>, string][] = [
      ['mcp__github__create_pull_request', { owner: 'o', repo: 'r', title: 'x', head: 'feature', base: 'main' }, 'p23'],
      ['mcp__github__merge_pull_request', { owner: 'o', repo: 'r', pullNumber: 3 }, 'p24']
    ]
    for (const [tool, input, promptId] of toolCases) {
      const run = await runPost(
        fixture,
        postEvent(fixture, { tool_name: tool, tool_input: input, tool_response: { ok: true }, prompt_id: promptId })
      )
      assertUpdateRequest(fixture, run, tool)
    }
  })
})

test('post-tool-use.does-not-nudge-twice-in-a-prompt', async () => {
  await withThread({}, async (fixture) => {
    const first = await runPost(fixture, bashEvent(fixture, 'git commit -m first', 'p30'))
    assertUpdateRequest(fixture, first, 'Bash: git commit -m first')
    const second = await runPost(fixture, bashEvent(fixture, 'git commit -m second', 'p30'))
    assert.equal(second.stdout, '{}')
    assert.equal(nudgedOf(fixture), 'p30')
  })
})

test('post-tool-use.does-not-nudge-other-calls', async () => {
  await withThread({}, async (fixture) => {
    const events: Record<string, unknown>[] = [
      postEvent(fixture, {
        tool_name: 'Skill',
        tool_input: { skill: 'logbook:debrief' },
        tool_response: { success: true },
        prompt_id: 'p41'
      }),
      bashEvent(fixture, 'git status', 'p42'),
      bashEvent(fixture, 'git log --grep merge', 'p43'),
      bashEvent(fixture, 'npm test', 'p44'),
      postEvent(fixture, { tool_name: 'Bash', tool_input: { description: 'no command' }, prompt_id: 'p45' }),
      postEvent(fixture, {
        tool_name: 'Read',
        tool_input: { file_path: join(fixture.repo, 'README.md') },
        tool_response: { type: 'text' },
        prompt_id: 'p46'
      })
    ]
    for (const event of events) {
      const run = await runPost(fixture, event)
      assert.equal(run.stdout, '{}', `${JSON.stringify(event.tool_name)} gave ${run.stdout}`)
    }
    assert.equal(nudgedOf(fixture), null)
  })
})

test('post-tool-use.does-not-nudge-inside-a-subagent', async () => {
  await withThread({}, async (fixture) => {
    const inside = await runPost(
      fixture,
      bashEvent(fixture, 'git commit -m x', 'p5', { agent_id: 'a1', agent_type: 'general-purpose' })
    )
    assert.equal(inside.stdout, '{}')
    assert.equal(nudgedOf(fixture), null)
    const outside = await runPost(fixture, bashEvent(fixture, 'git commit -m x', 'p5'))
    assertUpdateRequest(fixture, outside, 'Bash: git commit -m x')
  })
})

test('post-tool-use.does-not-nudge-without-a-hold', async () => {
  await withThread({ held: false }, async (fixture) => {
    const run = await runPost(fixture, bashEvent(fixture, 'git commit -m x', 'p6'))
    assert.equal(run.stdout, '{}')
    assert.equal(readHold(fixture.paths, 'fix-login'), null)
  })
})

test('markers.post-tool-use-clears-the-marker', async () => {
  await withThread({}, async (fixture) => {
    const written = writeMarker(fixture.rt, fixture.paths, 'fix-login', {
      toolUseId: 'toolu_01',
      tool: 'Bash',
      toolInput: { command: 'npm test' },
      session: 's1'
    })
    assert.equal(written, true)
    const marker = markerPath(fixture.paths, 'fix-login', 'toolu_01')
    assert.ok(marker.ok)
    assert.ok(existsSync(marker.value))
    await runPost(fixture, bashEvent(fixture, 'npm test', 'p7', { tool_use_id: 'toolu_01' }))
    assert.equal(existsSync(marker.value), false)
  })
})

test('markers.failure-clears-the-marker', async () => {
  await withThread({}, async (fixture) => {
    const written = writeMarker(fixture.rt, fixture.paths, 'fix-login', {
      toolUseId: 'toolu_03',
      tool: 'Bash',
      toolInput: { command: 'git commit -m x' },
      session: 's1'
    })
    assert.equal(written, true)
    const marker = markerPath(fixture.paths, 'fix-login', 'toolu_03')
    assert.ok(marker.ok)
    assert.ok(existsSync(marker.value))
    const run = await runPost(fixture, {
      session_id: 's1',
      transcript_path: join(fixture.home, 'transcripts', 's1.jsonl'),
      cwd: fixture.repo,
      prompt_id: 'p8',
      hook_event_name: 'PostToolUseFailure',
      tool_name: 'Bash',
      tool_input: { command: 'git commit -m x' },
      tool_use_id: 'toolu_03',
      error: 'Exit code 1'
    })
    assert.equal(existsSync(marker.value), false)
    assert.equal(run.stdout, '{}')
    assert.equal(nudgedOf(fixture), null)
  })
})
