import assert from 'node:assert/strict'
import { test } from 'node:test'
import { git, gitBuffer } from '../../src/store/git.ts'
import { testRuntime } from '../support/runtime.ts'
import { withRepo } from '../support/git-fixture.ts'

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
const MISSING_PARENT = '0000000000000000000000000000000000000002'
const COMMIT_ON_A_MISSING_PARENT = ['commit-tree', EMPTY_TREE, '-p', MISSING_PARENT]
const STDIN_PAST_THE_PIPE_BUFFER = 'a'.repeat(1_000_000)

test('git.reports-gits-reason-when-git-exits-before-reading-its-stdin', () => {
  withRepo((repo) => {
    const result = git(testRuntime(), repo, COMMIT_ON_A_MISSING_PARENT, { stdin: STDIN_PAST_THE_PIPE_BUFFER })

    assert.equal(result.ok, false, 'commit-tree naming a parent that does not exist must fail')
    if (result.ok) return
    assert.notEqual(result.code, -1, `the exit status git returned must be kept, got stderr: ${result.stderr}`)
    assert.match(result.stderr, new RegExp(`${MISSING_PARENT} is not a valid object`), `got: ${result.stderr}`)
  })
})

test('git-buffer.reports-gits-reason-when-git-exits-before-reading-its-stdin', () => {
  withRepo((repo) => {
    const result = gitBuffer(testRuntime(), repo, COMMIT_ON_A_MISSING_PARENT, { stdin: STDIN_PAST_THE_PIPE_BUFFER })

    assert.equal(result.ok, false, 'commit-tree naming a parent that does not exist must fail')
    if (result.ok) return
    assert.equal(result.overflow, false)
    if (result.overflow) return
    assert.notEqual(result.code, -1, `the exit status git returned must be kept, got stderr: ${result.stderr}`)
    assert.match(result.stderr, new RegExp(`${MISSING_PARENT} is not a valid object`), `got: ${result.stderr}`)
  })
})
