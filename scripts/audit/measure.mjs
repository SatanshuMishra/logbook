import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { buildContext, callTool, commitAndReindex } = await import(`${REPO}/src/tools/index.mjs`);
const { rebuildIndex } = await import(`${REPO}/src/index/rebuild-index.mjs`);

const bytes = (v) => Buffer.byteLength(JSON.stringify(v), 'utf8');
const pad = (base, n) => (base.repeat(Math.ceil(n / base.length))).slice(0, n);

function ulidFor(n) {
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let s = '';
  for (let i = 0; i < 26; i += 1) s += alphabet[(n * 7 + i * 13) % 32];
  return s;
}

function makeThread(n, iso) {
  const criteria = Array.from({ length: 8 }, (_, i) => ({
    id: `c${i + 1}`,
    text: pad(`land the ${i + 1}th acceptance criterion for this thread and prove it with a test `, 74),
    done: i < 3,
    kind: i < 6 ? 'planned' : 'detour',
    struck_by: null,
  }));
  const risks = Array.from({ length: 6 }, (_, i) => ({
    text: pad(`hold the ${i + 1}th constraint — because the alternative silently loses data on the write path `, 190),
    scope: i < 4 ? `c${i + 1}` : 'thread',
    refs: [pad(`src/tools/some-tool-${i}.mjs:${i * 7 + 11} `, 45), pad(`docs/audits/2026-08-04-mcp-audit.json#f${i} `, 45)],
  }));
  const decisions = Array.from({ length: 9 }, (_, i) => ({
    ref: `${String(i + 1).padStart(4, '0')}-decision-slug-${i}`,
    title: pad(`the ${i + 1}th locked decision and the reason it was locked `, 55),
    scope: i < 5 ? `c${i + 1}` : 'thread',
  }));
  const outOfScope = Array.from({ length: 12 }, (_, i) => pad(
    `explicitly out of scope: the ${i + 1}th thing this thread will not do and why it will not `,
    107,
  ));
  return {
    schema_version: 2,
    id: ulidFor(n),
    slug: `measurement-thread-${n}`,
    title: pad('a realistic thread title carried by every mutating return ', 58),
    status: 'active',
    parent_id: null,
    predecessor_id: null,
    completion_criteria: criteria,
    vcs_ref: null,
    external_refs: [],
    blocked_by: null,
    abandoned_reason: null,
    closure_statement: null,
    spine: {
      active_goal: pad('drive the current acceptance criterion to green and record the decision ', 200),
      next_step: pad('read the failing assertion, then narrow the guard that produced it ', 500),
      last_session: pad('closed two criteria, opened one detour, recorded one decision ', 300),
      open_risks: risks,
      key_decisions: decisions,
      out_of_scope: outOfScope,
    },
    created_at: iso,
    updated_at: iso,
  };
}

async function gitRepo(dir) {
  await mkdir(dir, { recursive: true });
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const run = (args) => execFileSync('git', args, { cwd: dir, env, stdio: 'ignore' });
  run(['init', '-q', '-b', 'main']);
  run(['config', 'user.email', 'measure@invalid']);
  run(['config', 'user.name', 'measure']);
  run(['commit', '--allow-empty', '-q', '-m', 'root']);
  return dir;
}

const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

async function timeIt(fn, reps) {
  const samples = [];
  for (let i = 0; i < reps; i += 1) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
  }
  return Math.round(median(samples) * 10) / 10;
}

async function measure(label, projectDir, threadCount) {
  const iso = '2026-08-04T12:00:00Z';
  const ctx = await buildContext({ projectDir, now: () => '2026-08-04T12:34:56Z' });
  const isGit = ctx.driver.isGit();

  const threads = [];
  for (let n = 0; n < threadCount; n += 1) {
    const t = makeThread(n, iso);
    await ctx.driver.writeThread(t);
    threads.push(t);
  }

  const target = threads[0];
  const updateResult = await callTool(
    'update_thread',
    { thread_id: target.id, spine: { next_step: pad('re-read the guard at the call site and narrow it ', 43) } },
    ctx,
  );
  const updateBytes = bytes(updateResult);
  const wire = bytes({ content: [{ type: 'text', text: JSON.stringify(updateResult) }] });

  const sectionBytes = {
    completion_criteria: bytes(updateResult.thread.completion_criteria),
    open_risks: bytes(updateResult.thread.spine.open_risks),
    key_decisions: bytes(updateResult.thread.spine.key_decisions),
    out_of_scope: bytes(updateResult.thread.spine.out_of_scope),
  };

  await rebuildIndex(ctx.driver);
  const resumable = await ctx.driver.readIndexFile('resumable');
  const rosterBytes = bytes(resumable);
  const bySlugBytes = bytes(await ctx.driver.readIndexFile('by-slug'));

  const rebuildMs = await timeIt(() => rebuildIndex(ctx.driver), 5);
  const reindexCommitMs = await timeIt(
    () => commitAndReindex(ctx.driver, 'chore(ledger): measurement'),
    5,
  );

  return {
    label,
    driver: ctx.driver.constructor.name,
    is_git: isGit,
    threads: threadCount,
    update_thread_result_bytes: updateBytes,
    update_thread_wire_bytes: wire,
    update_thread_sections: sectionBytes,
    roster_resumable_bytes: rosterBytes,
    roster_entries: Array.isArray(resumable) ? resumable.length : null,
    by_slug_bytes: bySlugBytes,
    rebuild_index_ms_median: rebuildMs,
    commit_and_reindex_ms_median: reindexCommitMs,
  };
}

const root = await mkdtemp(join(tmpdir(), 'msp0b-measure-'));
process.env.CLAUDE_PLUGIN_DATA = join(root, 'data');
await mkdir(process.env.CLAUDE_PLUGIN_DATA, { recursive: true });

const out = [];
for (const threadCount of [1, 17]) {
  const plain = join(root, `plain-${threadCount}`);
  await mkdir(plain, { recursive: true });
  out.push(await measure(`LocalDriver n=${threadCount}`, plain, threadCount));

  const repo = await gitRepo(join(root, `repo-${threadCount}`));
  out.push(await measure(`GitRefDriver n=${threadCount}`, repo, threadCount));
}

process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
await rm(root, { recursive: true, force: true });
