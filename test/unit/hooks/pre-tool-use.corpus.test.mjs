import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBashCommand } from '../../../hooks/lib/pre-tool-use.mjs';

const ROOTS = Object.freeze(['/data/-proj/ledger']);
const BASE = '/proj';
const R = ROOTS[0];
const AMP_ROOT = '/data/a&b/ledger';
const DEEP_OPENERS_DENY_COMMAND = `${'('.repeat(16000)}rm -rf ${R}`;
const DEEP_OPENERS_ALLOW_COMMAND = `${'('.repeat(16000)}rm -rf /tmp/x`;
const OVERSIZE_NOROOT_COMMAND = `echo ${'x'.repeat(16400)}`;

const caseOf = (expect) => ({ id, command, roots = ROOTS, baseDir = BASE, why }) => Object.freeze({
  id,
  command,
  roots,
  baseDir,
  expect,
  why,
});

const readHead = (name, command) => ({
  id: `HEAD_${name}`,
  command,
  why: `read-only allowlist head ${name}`,
});

const gitRead = (sub, tail = '') => ({
  id: `GITREAD_${sub}`,
  command: `git -C ${R} ${sub}${tail}`,
  why: `git read subcommand ${sub}`,
});

export const DENY_CORPUS = Object.freeze([
  { id: 'G1', command: `( rm -rf ${R} )`, why: 'subshell grouping residue hides the destructive head' },
  { id: 'G2', command: `{ rm -rf ${R}; }`, why: 'brace group residue hides the destructive head' },
  { id: 'G3', command: `true & rm -rf ${R}`, why: 'background ampersand is not a tokenizer separator' },
  { id: 'E1', command: `(rm -rf ${R})`, why: 'glued open paren fuses into the head token' },
  { id: 'E2', command: `(rm -rf ${R}/threads)`, why: 'glued open paren fuses into the head token on a subpath' },
  { id: 'E4', command: `ls ${R} & rm -rf ${R}`, why: 'read head masks a backgrounded destructive tail' },
  { id: 'E5', command: `ls ${R}&rm -rf ${R}`, why: 'glued ampersand welds two commands into one token stream' },
  { id: 'P1', command: `sudo rm -rf ${R}`, why: 'privilege prefix displaces the destructive head' },
  { id: 'P2', command: `FOO=bar rm -rf ${R}`, why: 'assignment prefix displaces the destructive head' },
  { id: 'P3', command: `env -i rm -rf ${R}`, why: 'env prefix displaces the destructive head' },
  { id: 'E18', command: `exec rm -rf ${R}`, why: 'exec prefix displaces the destructive head' },
  { id: 'E20', command: `nohup rm -rf ${R}`, why: 'nohup prefix displaces the destructive head' },
  { id: 'E21', command: `! rm -rf ${R}`, why: 'negation prefix displaces the destructive head' },
  { id: 'S1', command: `sh -c 'rm -rf ${R}'`, why: 'interpreter swallows the destructive command as one opaque token' },
  { id: 'S2', command: `bash -c "rm -rf ${R}"`, why: 'interpreter swallows the destructive command as one opaque token' },
  { id: 'F1', command: `find ${R} -delete`, why: 'find action flag deletes without a destructive head' },
  { id: 'F2', command: `find ${R} -type f -exec rm {} \\;`, why: 'find exec action runs a destructive command' },
  { id: 'GIT1', command: `git -C ${R} clean -fdx`, why: 'git write subcommand destroys the store' },
  { id: 'GIT2', command: `git -C ${R} reset --hard`, why: 'git write subcommand destroys the store' },
  { id: 'E8', command: `git --git-dir=${R}/.git gc --prune=now`, why: 'git reaches the store through git-dir rather than dash C' },
  { id: 'E9', command: `git -c core.x=1 -C ${R} clean -fdx`, why: 'git config flag shifts the dash C position' },
  { id: 'X1', command: `xargs rm -rf < ${R}/list`, why: 'xargs sink runs a destructive command from a store list' },
  { id: 'A1', command: `$'rm' -rf ${R}`, why: 'dollar single quote head evades an exact head match' },
  { id: 'E3', command: `rm -rf $'${R}'`, why: 'dollar single quote argument evades path resolution' },
  { id: 'E6', command: `rm -rf $(echo ${R})`, why: 'command substitution argument evades path resolution' },
  { id: 'B4', command: `/bin/rm -rf ${R}`, why: 'absolute path head evades an exact head match' },
  { id: 'O1', command: `dd if=/dev/zero of=${R}/f bs=1 count=1`, why: 'dd of= operand evades positional argument resolution' },
  { id: 'O2', command: `cp --target-directory=${R} /tmp/x`, why: 'cp target-directory flag evades positional argument resolution' },
  { id: 'N2', command: `echo x | tee -a ${R}/f`, why: 'tee appends into the store through a pipeline sink' },
  { id: 'N3', command: `cat > ${R}/f <<'EOT'\nline one\nEOT`, why: 'heredoc writes into the store through a redirect' },
  { id: 'E16', command: `rm -rf ${R}/../../etc`, why: 'traversal residue names the store while resolving outside it' },
  { id: 'E17', command: `rm -rf ${R}/`, why: 'trailing slash form of the store root' },
  { id: 'E22', command: `for f in ${R}/*; do rm -f "$f"; done`, why: 'loop body hides the destructive head behind do' },
  { id: 'E23', command: `./cat ${R}/f`, why: 'relative path head impersonates an allowlisted read head' },
  { id: 'FP1', command: `find ${R} \\( -name a -o -name b \\)`, why: 'accepted over-block: the split -name fragment is not itself a cleared head; it denies via scope inheritance from the preceding find ${R} unit in the same segment, not from the control split alone' },
  { id: 'J1', command: `jq '{a:.b}' ${R}/f`, why: 'accepted over-block: leading brace object construction is indistinguishable from a brace group' },
  { id: 'OB1', command: `echo "before && rm -rf ${R}"`, why: 'accepted over-block: echo is not an allowlisted read head' },
  { id: 'OB2', command: `echo 'x | rm -rf ${R}'`, why: 'accepted over-block: echo is not an allowlisted read head' },
  { id: 'OB3', command: `awk '$1 > 5' ${R}/threads/a.json`, why: 'accepted over-block: awk is a programmable sink naming the store' },
  { id: 'OB4', command: `python3 -m json.tool ${R}/f`, why: 'accepted over-block: python3 is a programmable sink naming the store' },
  { id: 'OB5', command: `cd ${R} && rm -rf "$D"`, why: 'destructive head runs with the tracked cwd inside the store' },
  { id: 'OB6', command: `less ${R}/f`, why: 'accepted over-block: pager can shell out and is not allowlisted' },
  { id: 'OB7', command: `tar -tf ${R}/x.tar`, why: 'accepted over-block: tar is not an allowlisted read head' },
  { id: 'OB8', command: `open ${R}`, why: 'accepted over-block: open is not an allowlisted read head' },
  { id: 'OB9', command: `~/bin/jq ${R}/f`, why: 'accepted over-block: untrusted bin dir head is not an allowlisted read head' },
  { id: 'OB10', command: `sed -i '' s/x/y/ "${R}/f"`, why: 'in place sed rewrites a store file' },
  { id: 'OB11', command: `git -C ${R} gc`, why: 'git gc is not a read subcommand' },
  { id: 'OB12', command: `git -C ${R} commit -m "fix ledger at ${R}"`, why: 'git commit is not a read subcommand' },
  { id: 'SORT_O', command: `sort -o ${R}/f /etc/passwd`, why: 'sort is an unconditional read allow head; the -o flag writes its output into the named path with no output-flag check' },
  { id: 'SORT_LONG', command: `sort --output=${R}/f /etc/passwd`, why: 'sort is an unconditional read allow head; --output= writes into the named path with no output-flag check' },
  { id: 'UNIQ_OUT', command: `uniq /etc/passwd ${R}/f`, why: 'uniq is an unconditional read allow head; its second operand is the output file and is never distinguished from an input operand' },
  { id: 'XXD_OUT', command: `xxd /etc/passwd ${R}/f`, why: 'xxd is an unconditional read allow head; its second operand is the output file and is never distinguished from an input operand' },
  { id: 'TREE_O', command: `tree -o ${R}/f /etc`, why: 'tree is an unconditional read allow head; the -o flag writes its listing into the named path with no output-flag check' },
  { id: 'FILE_COMPILE', command: `file -C -m ${R}/magic`, why: 'file is an unconditional read allow head; its -C compile flag writes a pre-parsed magic.mgc output file derived from the named path' },
  { id: 'RG_PRE', command: `rg --pre=rm x ${R}`, why: 'rg is an unconditional read allow head; its --pre flag spawns the given command once per searched path, running an arbitrary program against every file under the store' },
  { id: 'SED_W', command: `sed -n 'w ${R}/f' /etc/passwd`, why: 'sedAllows only inspects CLI flags for in place rewrite; the scripts own w command writes matched lines into the named path and is invisible to it' },
  { id: 'SED_SW', command: `sed 's/a/b/w ${R}/f' /etc/passwd`, why: 'sedAllows only inspects CLI flags for in place rewrite; the s///w suffix in the script body writes substituted lines into the named path and is invisible to it' },
  { id: 'SED_E', command: `sed '1e rm -rf ${R}/sessions' /etc/passwd`, why: 'sedAllows only inspects CLI flags for in place rewrite; the scripts e command executes an arbitrary shell command and is invisible to it' },
  { id: 'GIT_OUTPUT', command: `git diff --output=${R}/f`, why: 'git clearance resolves the subcommand as diff and stops; it never inspects trailing subcommand flags like --output= that redirect gits own output into the named path' },
  { id: 'GIT_PAGER', command: `git -p -c core.pager='rm -rf ${R}/sessions' log`, why: 'resolveGitSubcommand walks past the valued -c global to reach the log subcommand; it never evaluates the -c value, which sets core.pager to a shell command git executes when paging output' },
  { id: 'GIT_EXECPATH', command: `git --exec-path=/tmp/evil log`, why: 'resolveGitSubcommand walks past the valued --exec-path= global to reach the log subcommand and never evaluates it; the command also names no ledger root so the guard never engages, leaving a global flag that can redirect internal git helper binaries completely unchecked' },
  { id: 'GIT_GREP_PAGER', command: `git grep -O'rm -rf ${R}/sessions' foo ${R}`, why: 'git clearance resolves the subcommand as grep and stops; it never inspects the -O flag that follows, which opens each match in an arbitrary pager or command' },
  { id: 'GIT_CFG_PAGER', command: `git -c core.pager='rm -rf /tmp/x' log`, why: 'a -c config assignment naming an executing key sets core.pager to a shell command git runs when paging; the command names no root at all, so the scope gate never engages and only an unbounded verdict can catch it' },
  { id: 'GIT_CFG_EDITOR', command: `git -c sequence.editor='rm -rf /tmp/x' rebase -i`, why: 'a -c config assignment naming an executing key sets sequence.editor to a shell command git runs during an interactive rebase; the command names no root at all, so the scope gate never engages' },
  { id: 'GIT_CFG_SSHCOMMAND', command: `git -c core.sshCommand='rm -rf /tmp/x' fetch`, why: 'a -c config assignment naming an executing key sets core.sshCommand to a shell command git runs for every transport connection; the command names no root at all, so the scope gate never engages' },
  { id: 'GIT_CFG_EXTERNAL', command: `git -c diff.external='rm -rf /tmp/x' diff`, why: 'a -c config assignment naming an executing key sets diff.external to a shell command git runs per diffed path; the command names no root at all, so the scope gate never engages' },
  { id: 'GIT_CFG_ENV_GLUED', command: 'git --config-env=core.pager=EVIL log', why: 'the glued --config-env= form assigns an executing key from an environment variable, reaching the same pager execution as -c while carrying no root anywhere in the command' },
  { id: 'GIT_CFG_ENV_SPACED', command: 'git --config-env core.editor=EVIL commit', why: 'git accepts a spaced --config-env value even though its usage string documents only the glued form, so the spaced spelling assigns the same executing key while carrying no root anywhere in the command' },
  { id: 'PREFIX_UNTRUSTED', command: `./env cat ${R}/f`, why: 'prefix word matching keys off basename alone; ./env matches the trusted env prefix by name and is stripped without checking its own path is trusted, exposing cat as the head' },
  { id: 'PREFIX_ABS_UNTRUSTED', command: `/tmp/evil/sudo cat ${R}/f`, why: 'prefix word matching keys off basename alone; an attacker binary at /tmp/evil/sudo matches the trusted sudo prefix by name and is stripped without checking its own directory is trusted, exposing cat as the head' },
  { id: 'AMP_ROOT_QUOTED', command: `rm -rf "${AMP_ROOT}"`, roots: [AMP_ROOT], why: 'a literal & inside a properly double-quoted root path survives tokenizing as plain text, but splitControl still shreds the word on that & into /data/a and b/ledger, so neither fragment matches or resolves to the configured root' },
  { id: 'AMP_ROOT_ESCAPED', command: 'rm -rf /data/a\\&b/ledger', roots: [AMP_ROOT], why: 'a backslash-escaped & in a bare argument is reduced to a literal & before splitControl ever sees it, and splitControl still shreds the word on that & into /data/a and b/ledger, so neither fragment matches or resolves to the configured root' },
  { id: 'INHERIT_EVASION', command: `ls ${R} & rm -rf "$D"`, why: 'already denied today: the backgrounded rm names no root and carries only an unresolvable $D, but scope inheritance from the preceding ls ${R} unit in the same segment puts it in scope and its head is not cleared' },
  { id: 'INHERIT_OVERBLOCK', command: `ls ${R} & npm test`, why: 'already denied today: npm test names no root, but scope inheritance from the preceding ls ${R} unit in the same segment puts it in scope and npm is not a cleared head; accepted over-block bought by the same inheritance that catches INHERIT_EVASION' },
  { id: 'DEEP_OPENERS', command: DEEP_OPENERS_DENY_COMMAND, why: 'splitControl recurses once per leading ( character; 16000 glued opens overflow the call stack before the trailing rm -rf reaches the root, so the guard throws instead of returning a verdict' },
  { id: 'YQ_READ', command: `yq '.a' ${R}/f`, why: 'yq is a full expression language capable of arbitrary transforms and side effects; it must not carry unconditional read clearance the way jq does' },
  { id: 'SED_READ', command: `sed -n 1,20p ${R}/f`, why: 'sed no longer carries conditional read clearance; sedAllows only rules out in place rewrite flags and cannot prove any given sed invocation is read only given the w and e script commands' },
  { id: 'CD_FAILED', command: `cd ledger && cd /nonexistent-xyz; rm -rf .`, roots: ['/proj/ledger'], baseDir: '/proj', why: 'nextCwd advances the tracked cwd on every cd regardless of success; a real shell cd to a nonexistent directory fails and stays inside the ledger root, so the trailing rm -rf . truly runs there, but the guard tracks the cwd as having left the root; today it lands on ask only via an unrelated overlay match between the earlier cleared cd and the later rm sink, not because the destructive unit is recognized as in scope' },
  { id: 'CD_SUBSHELL', command: `cd ledger && (cd /tmp) && rm -rf .`, roots: ['/proj/ledger'], baseDir: '/proj', why: 'nextCwd advances the tracked cwd through a parenthesized cd as if it were not a subshell; a real shell running cd inside ( ) does not change the cwd of the parent shell, so the trailing rm -rf . truly runs inside the ledger root, but the guard tracks the cwd as having moved to /tmp; today it lands on ask only via the same unrelated cleared-cd-plus-sink overlay as CD_FAILED, not because the destructive unit is recognized as in scope' },
].map(caseOf('deny')));

export const ASK_CORPUS = Object.freeze([
  { id: 'X2', command: `cat ${R}/f | xargs rm -rf`, why: 'overlay O1 store read feeds an xargs sink' },
  { id: 'O2OV', command: `D=${R}; rm -rf "$D"`, why: 'overlay O2 store root assigned to a variable consumed by a sink' },
  { id: 'HEREDOC1', command: `cat ${R}/f && python3 - <<'EOT'\nprint(1)\nEOT`, why: 'overlay O1 store read feeds a python3 sink' },
  { id: 'AWKPIPE', command: `grep -c . ${R}/f | awk '{print $1}'`, why: 'overlay O1 store read feeds an awk sink' },
  { id: 'SUBST', command: `cat "$(ls ${R}/threads | head -1)"`, why: 'command substitution residue around a store path' },
  { id: 'OVERSIZE_NOROOT', command: OVERSIZE_NOROOT_COMMAND, why: 'the oversize gate returns allow whenever no root string appears in an over-cap command; an unscannable oversized command is not provably read-only and must ask instead of falling open' },
].map(caseOf('ask')));

export const ALLOW_CORPUS = Object.freeze([
  { id: 'FP_CANON', command: `L=${R}/threads; cat "$L/x.json" 2>/dev/null | python3 -m json.tool`, why: 'canonical live false positive must stay allowed' },
  { id: 'B1', command: `cat ${R}/x 2>/dev/null`, why: 'redirect target is outside the store' },
  { id: 'R1', command: `ls -la ${R} 2>&1 | head -12`, why: 'duplicating redirect is not a store write' },
  { id: 'R2', command: `cat ${R}/f 1>&2 2>&1`, why: 'paired duplicating redirects are not store writes' },
  { id: 'J2', command: `jq -r '.[] | select(.x)' ${R}/f`, why: 'mid token paren must not split or trip grouping residue' },
  { id: 'E12', command: `diff <(cat ${R}/a) <(cat ${R}/b)`, why: 'process substitution wraps allowlisted read heads' },
  { id: 'E19', command: `timeout 5 cat ${R}/f`, why: 'benign prefix in front of an allowlisted read head' },
  { id: 'E7', command: 'rm -rf `echo X`', why: 'bounding guarantee no store root is named anywhere' },
  { id: 'E7B', command: 'rm -rf "$(cat target.txt)"', why: 'bounding guarantee no store root is named anywhere' },
  { id: 'CD1', command: `cd ${R} && ls -la threads`, why: 'tracked cwd inside the store with an allowlisted read head' },
  { id: 'BIN1', command: `/usr/bin/cat ${R}/f`, why: 'trusted bin dir head resolves to an allowlisted read head' },
  { id: 'SUDO_READ', command: `sudo cat ${R}/f`, why: 'privilege prefix strips to an allowlisted read head' },
  { id: 'FIND_READ', command: `find ${R} -name x`, why: 'find without an action flag is read only' },
  readHead('cat', `cat ${R}/f`),
  readHead('head', `head -5 ${R}/f`),
  readHead('tail', `tail -5 ${R}/f`),
  readHead('nl', `nl ${R}/f`),
  readHead('wc', `wc -l ${R}/f`),
  readHead('ls', `ls ${R}`),
  readHead('stat', `stat ${R}/f`),
  readHead('file', `file ${R}/f`),
  readHead('du', `du -sh ${R}`),
  readHead('df', `df ${R}`),
  readHead('tree', `tree ${R}`),
  readHead('realpath', `realpath ${R}/f`),
  readHead('readlink', `readlink -f ${R}/f`),
  readHead('basename', `basename ${R}/f`),
  readHead('dirname', `dirname ${R}/f`),
  readHead('pwd', `cd ${R} && pwd`),
  readHead('grep', `grep -n x ${R}/f`),
  readHead('egrep', `egrep -n x ${R}/f`),
  readHead('fgrep', `fgrep -n x ${R}/f`),
  readHead('rg', `rg x ${R}`),
  readHead('jq', `jq . ${R}/f`),
  readHead('diff', `diff ${R}/a ${R}/b`),
  readHead('cmp', `cmp ${R}/a ${R}/b`),
  readHead('sort', `sort ${R}/f`),
  readHead('uniq', `uniq ${R}/f`),
  readHead('cut', `cut -d, -f1 ${R}/f`),
  readHead('tr', `tr -d x < ${R}/f`),
  readHead('column', `column -t ${R}/f`),
  readHead('paste', `paste ${R}/a ${R}/b`),
  readHead('join', `join ${R}/a ${R}/b`),
  readHead('md5', `md5 ${R}/f`),
  readHead('md5sum', `md5sum ${R}/f`),
  readHead('shasum', `shasum ${R}/f`),
  readHead('sha256sum', `sha256sum ${R}/f`),
  readHead('cksum', `cksum ${R}/f`),
  readHead('od', `od -c ${R}/f`),
  readHead('xxd', `xxd ${R}/f`),
  readHead('strings', `strings ${R}/f`),
  readHead('cd', `cd ${R}`),
  gitRead('log', ' --oneline -5'),
  gitRead('show', ' HEAD --stat'),
  gitRead('status', ' --short'),
  gitRead('diff', ' HEAD~1'),
  gitRead('blame', ' threads/a.json'),
  gitRead('cat-file', ' -p HEAD'),
  gitRead('rev-parse', ' HEAD'),
  gitRead('rev-list', ' --count HEAD'),
  gitRead('ls-files'),
  gitRead('ls-tree', ' HEAD'),
  gitRead('describe', ' --tags'),
  gitRead('shortlog', ' -s'),
  gitRead('grep', ' -n x'),
  gitRead('whatchanged', ' -1'),
  { id: 'GIT_CFG_BENIGN', command: 'git -c color.ui=false log', why: 'an ordinary -c config assignment whose key executes nothing must stay allowed; the unbounded rule is narrow to keys that run a command' },
  { id: 'GIT_CFG_NUMERIC', command: 'git -c core.abbrev=12 log', why: 'an ordinary -c config assignment whose key executes nothing must stay allowed; the unbounded rule is narrow to keys that run a command' },
  { id: 'GIT_CFG_ENV_BENIGN', command: 'git --config-env=color.ui=UIVAR log', why: 'an ordinary --config-env assignment whose key executes nothing must stay allowed; the unbounded rule is narrow to keys that run a command' },
  { id: 'BOUND1', command: 'npm test', why: 'bounding guarantee command never names the store' },
  { id: 'BOUND2', command: 'rm -rf /tmp/scratch', why: 'bounding guarantee destructive command outside the store' },
  { id: 'BOUND3', command: 'echo hi', why: 'bounding guarantee command never names the store' },
  { id: 'AMP_LITERAL', command: `grep -rn "R&D" ${R}/f`, why: 'splitControl shreds the quoted literal R&D on its & into R and D, and the stray D fragment is treated as an uncleared head in scope, denying a fully quoted grep that never leaves the read allowlist' },
  { id: 'READ_THEN_ORIENT', command: `cat ${R}/PROJECT.md; git status`, why: 'overlaysAsk treats git as a sink head anywhere in the command; the cleared cat unit paired with the independently cleared git status unit still trips the sink-elsewhere check and asks instead of allowing' },
  { id: 'READ_THEN_GIT', command: `ls ${R} && git status`, why: 'overlaysAsk treats git as a sink head anywhere in the command; the cleared ls unit paired with the independently cleared git status unit still trips the sink-elsewhere check and asks instead of allowing' },
  { id: 'READ_THEN_FIND', command: `cat ${R}/f && find . -name x`, why: 'overlaysAsk treats find as a sink head anywhere in the command; the cleared cat unit paired with the independently cleared find unit still trips the sink-elsewhere check and asks instead of allowing' },
  { id: 'DEEP_OPENERS_NOROOT', command: DEEP_OPENERS_ALLOW_COMMAND, why: 'splitControl recurses once per leading ( character; 16000 glued opens overflow the call stack before the trailing rm -rf /tmp/x is ever reached, so the guard throws instead of returning a verdict even though the command names no root' },
].map(caseOf(null)));

const runCorpus = (corpus) => {
  for (const { id, command, roots, baseDir, expect, why } of corpus) {
    test(`${id} ${why}`, () => {
      assert.equal(classifyBashCommand(command, roots, baseDir), expect);
    });
  }
};

runCorpus(DENY_CORPUS);
runCorpus(ASK_CORPUS);
runCorpus(ALLOW_CORPUS);

test('DENY_CORPUS holds at least twelve evasion cases', () => {
  assert.ok(DENY_CORPUS.length >= 12);
});

test('ALLOW_CORPUS holds at least forty-one read-only cases', () => {
  assert.ok(ALLOW_CORPUS.length >= 41);
});
