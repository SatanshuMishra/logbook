import { mkdtemp, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const { buildContext } = await import(`${REPO}/src/tools/index.mjs`);

const exists = async (p) => {
  try { await access(p); return true; } catch { return false; }
};

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

const DRIFT = { '01ABCDEFGHJKMNPQRSTVWXYZ00': [{ thread_id: '01ABCDEFGHJKMNPQRSTVWXYZ00', binding_id: 'b1', classification: 'CRITICAL', signals: [] }] };
const PLEDGE = { thread_id: '01ABCDEFGHJKMNPQRSTVWXYZ00', rendered: 'briefing text' };

async function probe(label, projectDir) {
  const first = await buildContext({ projectDir });
  const root = await first.driver.root();

  await first.driver.writeIndexFile('drift', DRIFT);
  await first.driver.writeIndexFile('briefing', PLEDGE);
  await first.driver.writeIndexFile('by-slug', { 'some-slug': '01ABCDEFGHJKMNPQRSTVWXYZ00' });

  const wroteDrift = await first.driver.readIndexFile('drift');
  const driftFileBefore = await exists(join(root, 'index', 'drift.json'));

  const second = await buildContext({ projectDir });
  const afterDrift = await second.driver.readIndexFile('drift');
  const afterPledge = await second.driver.readIndexFile('briefing');
  const afterBySlug = await second.driver.readIndexFile('by-slug');
  const driftFileAfter = await exists(join(root, 'index', 'drift.json'));

  return {
    label,
    driver: first.driver.constructor.name,
    ledger_root: root.replace(/^.*msp0b-durability-[^/]*/, '<tmp>'),
    drift_file_present_before_second_init: driftFileBefore,
    drift_entries_before: Object.keys(wroteDrift).length,
    drift_file_present_after_second_init: driftFileAfter,
    drift_entries_after: Object.keys(afterDrift).length,
    briefing_pledge_survived: afterPledge && afterPledge.thread_id === PLEDGE.thread_id,
    by_slug_survived: Object.keys(afterBySlug).length > 0,
  };
}

const root = await mkdtemp(join(tmpdir(), 'msp0b-durability-'));
process.env.CLAUDE_PLUGIN_DATA = join(root, 'data');
await mkdir(process.env.CLAUDE_PLUGIN_DATA, { recursive: true });

const plain = join(root, 'plain');
await mkdir(plain, { recursive: true });

const results = [
  await probe('LocalDriver: second buildContext in a fresh process-equivalent', plain),
  await probe('GitRefDriver: second buildContext in a fresh process-equivalent', await gitRepo(join(root, 'repo'))),
];

process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
await rm(root, { recursive: true, force: true });
