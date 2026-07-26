import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyBashCommand } from '../../../hooks/lib/pre-tool-use.mjs';

const ROOTS = Object.freeze(['/data/-proj/ledger']);
const BASE = '/proj';
const R = ROOTS[0];

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
  { id: 'FP1', command: `find ${R} \\( -name a -o -name b \\)`, why: 'accepted over-block: bare paren grouping residue is indistinguishable from a subshell' },
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
].map(caseOf('deny')));

export const ASK_CORPUS = Object.freeze([
  { id: 'X2', command: `cat ${R}/f | xargs rm -rf`, why: 'overlay O1 store read feeds an xargs sink' },
  { id: 'O2OV', command: `D=${R}; rm -rf "$D"`, why: 'overlay O2 store root assigned to a variable consumed by a sink' },
  { id: 'HEREDOC1', command: `cat ${R}/f && python3 - <<'EOT'\nprint(1)\nEOT`, why: 'overlay O1 store read feeds a python3 sink' },
  { id: 'AWKPIPE', command: `grep -c . ${R}/f | awk '{print $1}'`, why: 'overlay O1 store read feeds an awk sink' },
  { id: 'SUBST', command: `cat "$(ls ${R}/threads | head -1)"`, why: 'command substitution residue around a store path' },
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
  { id: 'SED_READ', command: `sed -n 1,20p ${R}/f`, why: 'sed without in place rewrite is read only' },
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
  readHead('yq', `yq '.a' ${R}/f`),
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
  { id: 'BOUND1', command: 'npm test', why: 'bounding guarantee command never names the store' },
  { id: 'BOUND2', command: 'rm -rf /tmp/scratch', why: 'bounding guarantee destructive command outside the store' },
  { id: 'BOUND3', command: 'echo hi', why: 'bounding guarantee command never names the store' },
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
