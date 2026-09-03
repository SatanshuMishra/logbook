import { test } from 'node:test'
import assert from 'node:assert/strict'
import { guardDecision } from '../../src/hooklib/guard.ts'
import type { GuardVerdict } from '../../src/hooklib/guard.ts'
import { layoutFor, createStoreDirectories } from '../../src/store/layout.ts'
import { LEDGER_REF } from '../../src/store/ref.ts'
import { testRuntime } from '../support/runtime.ts'
import { freshPluginDataDir, freshTmpDir } from './hook-process.ts'
import type { Runtime } from '../../src/runtime/runtime.ts'

type Fixture = { rt: Runtime; projectRoot: string; storeRoot: string }

const fixture = (label: string): Fixture => {
  const projectRoot = freshTmpDir(`logbook-guard-read-${label}-project-`)
  const pluginDataRoot = freshPluginDataDir(`logbook-guard-read-${label}-plugin-data-`).root
  const rt = testRuntime({ env: { CLAUDE_PLUGIN_DATA: pluginDataRoot }, cwd: projectRoot })
  const layout = layoutFor(rt, projectRoot)
  assert.equal(layout.ok, true, 'expected layoutFor to resolve for a real temp directory')
  if (!layout.ok) throw new Error('unreachable')
  createStoreDirectories(layout.value)
  return { rt, projectRoot, storeRoot: layout.value.root }
}

const bashVerdict = (fix: Fixture, command: string): GuardVerdict =>
  guardDecision(fix.rt, { tool_name: 'Bash', tool_input: { command }, cwd: fix.projectRoot })

const NODE_CONSUMER = "node -e 'process.stdin.pipe(process.stdout)'"

const pureReadCommands = (storeRoot: string): readonly string[] => [
  `git show ${LEDGER_REF}:threads/x.json`,
  `git show ${LEDGER_REF}:threads/x.json | ${NODE_CONSUMER}`,
  `git show ${LEDGER_REF}:threads/x.json | tee /tmp/logbook-guard-read-sink`,
  `git ls-tree --name-only ${LEDGER_REF}:threads`,
  `git cat-file -p ${LEDGER_REF}`,
  `git rev-parse ${LEDGER_REF}`,
  `git log --oneline ${LEDGER_REF}`,
  `git for-each-ref ${LEDGER_REF}`,
  `cat ${storeRoot}/records/x.json`,
  `jq .spine ${storeRoot}/records/x.json`,
  `ls -la ${storeRoot}/records`,
  `head -5 ${storeRoot}/records/x.json`,
  `tail -5 ${storeRoot}/records/x.json`,
  `wc -l ${storeRoot}/records/x.json`,
  `grep -r focus ${storeRoot}/records`,
  `diff ${storeRoot}/a.json ${storeRoot}/b.json`,
  `stat ${storeRoot}/records`,
  `od -c ${storeRoot}/records/x.json`,
  `git -C ${storeRoot} log --oneline`,
  `git --no-pager show ${LEDGER_REF}:threads/x.json`,
  `git show ${LEDGER_REF}:threads/x.json 2>/dev/null`,
  `git show ${LEDGER_REF}:threads/x.json 2>&1`,
  `cat ${storeRoot}/records/x.json | jq .thread`,
  `git rev-parse ${LEDGER_REF} && git log --oneline ${LEDGER_REF}`,
  `git rev-parse ${LEDGER_REF}\ngit log --oneline ${LEDGER_REF}`,
  `git show "${LEDGER_REF}:threads/x.json"`
]

const stillAskingCommands = (storeRoot: string): readonly string[] => [
  `git update-ref ${LEDGER_REF} deadbeef`,
  `git -C ${storeRoot} commit-tree deadbeef`,
  `git hash-object -w ${storeRoot}/records/x.json`,
  `git push origin ${LEDGER_REF}`,
  `git -C ${storeRoot} gc`,
  `git -C ${storeRoot} prune`,
  `git reflog delete ${LEDGER_REF}`,
  `rm -rf ${storeRoot}`,
  `mv ${storeRoot}/a ${storeRoot}/b`,
  `cp seed.json ${storeRoot}/y`,
  `truncate -s 0 ${storeRoot}/x`,
  `tee ${storeRoot}/x`,
  `dd if=seed.json ${storeRoot}/x`,
  `chmod 700 ${storeRoot}`,
  `chown me ${storeRoot}`,
  `ln -s seed.json ${storeRoot}/y`,
  `mkdir ${storeRoot}/z`,
  `touch ${storeRoot}/z`,
  `sed -i s/a/b/ ${storeRoot}/x`,
  `cat ${storeRoot}/records/x.json > /tmp/out`,
  `cat ${storeRoot}/records/x.json >> /tmp/out`,
  `git $x show ${LEDGER_REF}`,
  `git $(echo show) ${LEDGER_REF}`,
  'git `echo show` ' + LEDGER_REF,
  `eval "git show ${LEDGER_REF}"`,
  `git --weird-flag show ${LEDGER_REF}`,
  `/bin/cat ${storeRoot}/records/x.json`,
  `git show ${LEDGER_REF}:threads/x.json && rm -rf ${storeRoot}`,
  `rm -rf ${storeRoot} && git show ${LEDGER_REF}:threads/x.json`,
  `node -e 'writeFileSync("${storeRoot}/x", "")'`,
  `ls ${storeRoot}/records/threads/*.json | xargs rm`,
  `grep -l focus ${storeRoot}/records/threads/*.json | xargs rm`,
  `ls ${storeRoot}/records/threads/*.json | xargs -n1 truncate -s0`,
  `git ls-tree --name-only ${LEDGER_REF} | xargs rm -rf`,
  `git show ${LEDGER_REF}:threads/x.json | sh`,
  `git show ${LEDGER_REF}:threads/x.json | bash`,
  `cat ${storeRoot}/records/x.json | node`,
  `cat ${storeRoot}/records/x.json | python3 -`,
  `cat ${storeRoot}/records/x.json && rm -rf ~/Library/x/logbook`,
  `git show ${LEDGER_REF}:threads/x.json | sh -c 'rm -rf ~/Library/x/logbook'`,
  `git show ${LEDGER_REF}:threads/x.json | sh -c 'rm -rf /Users/*/Library/x/logbook'`,
  `cat ${storeRoot}/records/x.json | tee ~/Library/x/logbook/records/y.json`,
  `git show --output=${storeRoot}/records/x.json ${LEDGER_REF}`,
  `git show --output ${storeRoot}/records/x.json ${LEDGER_REF}`,
  `git log -p --ext-diff ${LEDGER_REF}`,
  `git show --textconv ${LEDGER_REF}:threads/x.json`,
  `git -c "diff.external=sh -c touch" log -p --ext-diff ${LEDGER_REF}`,
  `git -c core.pager=cat show ${LEDGER_REF}`,
  `git --config-env=diff.external=EVIL log -p --ext-diff ${LEDGER_REF}`,
  `git --exec-path=/tmp/evil show ${LEDGER_REF}`,
  `GIT_EXTERNAL_DIFF=/tmp/evil git log -p --ext-diff ${LEDGER_REF}`,
  `GIT_PAGER='rm -rf ${storeRoot}' git show ${LEDGER_REF}`,
  `LC_ALL=C git show ${LEDGER_REF}:threads/x.json`,
  `xxd ${storeRoot}/records/x.json ${storeRoot}/records/y.json`,
  `file -C -m ${storeRoot}/records/x.json`,
  `file ${storeRoot}/records/x.json`
]

test('hook.guard.read-classifier.a-pure-read-of-the-store-passes-without-a-prompt', () => {
  const fix = fixture('reads')
  const commands = pureReadCommands(fix.storeRoot)
  assert.ok(commands.length > 0, 'expected a non-empty population of read commands to drive this assertion')

  for (const command of commands) {
    const verdict = bashVerdict(fix, command)
    assert.equal(
      verdict.kind,
      'silent',
      `expected the pure store read ${JSON.stringify(command)} to pass without a prompt, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.read-classifier.every-listed-command-that-is-not-confidently-a-read-still-asks', () => {
  const fix = fixture('writes')
  const commands = stillAskingCommands(fix.storeRoot)
  assert.ok(commands.length > 0, 'expected a non-empty population of non-read commands to drive this assertion')

  for (const command of commands) {
    const verdict = bashVerdict(fix, command)
    assert.equal(
      verdict.kind,
      'ask',
      `expected ${JSON.stringify(command)} to keep prompting, got ${JSON.stringify(verdict)}`
    )
  }
})

test('hook.guard.read-classifier.a-command-the-guard-cannot-read-as-a-string-still-asks', () => {
  const fix = fixture('unreadable')
  const verdict = guardDecision(fix.rt, {
    tool_name: 'Bash',
    tool_input: { command: 42 },
    cwd: fix.projectRoot
  })
  assert.equal(
    verdict.kind,
    'ask',
    `expected a Bash command the guard cannot read as a string to keep prompting, got ${JSON.stringify(verdict)}`
  )
})
