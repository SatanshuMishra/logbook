#!/usr/bin/env node
'use strict';

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const REPO_ROOT = process.cwd();
const SOURCE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts'];
const TEST_INFIXES = ['.test', '.spec'];
const TEST_DIRECTORY_NAMES = new Set(['test', 'tests', '__tests__']);
const DEGRADE_MESSAGE = 'dependents not computed';
const MAX_BUFFER = 256 * 1024 * 1024;

function toPosix(value) {
  return value.split(path.sep).join('/');
}

function hasSourceExtension(posixPath) {
  return SOURCE_EXTENSIONS.includes(path.posix.extname(posixPath));
}

function isLocalModule(posixPath) {
  if (!posixPath) return false;
  if (posixPath.startsWith('node_modules/')) return false;
  if (posixPath.includes('/node_modules/')) return false;
  if (posixPath.startsWith('../') || posixPath.startsWith('/')) return false;
  return hasSourceExtension(posixPath);
}

function parseArgs(argv) {
  const result = { base: null, head: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    for (const key of ['base', 'head']) {
      const flag = `--${key}`;
      if (token === flag) {
        result[key] = argv[i + 1] !== undefined ? argv[i + 1] : null;
        i += 1;
      } else if (token.startsWith(`${flag}=`)) {
        result[key] = token.slice(flag.length + 1);
      }
    }
  }
  return result;
}

function git(args) {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: MAX_BUFFER }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch (error) {
    return null;
  }
}

function resolveMergeBase(base, head) {
  const mergeBase = tryGit(['merge-base', base, head]);
  return mergeBase && mergeBase.length > 0 ? mergeBase : base;
}

function changedSourceFiles(fromRef, toRef) {
  const raw = tryGit(['diff', '--name-only', fromRef, toRef]);
  if (raw === null) return [];
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map(toPosix)
    .filter(hasSourceExtension);
}

function findGrapher() {
  const binDir = path.join(REPO_ROOT, 'node_modules', '.bin');
  const candidates = [
    { name: 'dependency-cruiser', bin: path.join(binDir, 'depcruise') },
    { name: 'madge', bin: path.join(binDir, 'madge') },
  ];
  return candidates.find((candidate) => fs.existsSync(candidate.bin)) || null;
}

function normalizeDependencyCruiser(json) {
  const graph = new Map();
  const modules = Array.isArray(json.modules) ? json.modules : [];
  for (const mod of modules) {
    const source = mod && typeof mod.source === 'string' ? toPosix(mod.source) : null;
    if (!source || !isLocalModule(source)) continue;
    const dependencies = Array.isArray(mod.dependencies) ? mod.dependencies : [];
    const resolved = new Set();
    for (const dependency of dependencies) {
      const target = dependency && typeof dependency.resolved === 'string' ? toPosix(dependency.resolved) : null;
      if (target && isLocalModule(target)) resolved.add(target);
    }
    graph.set(source, resolved);
  }
  return graph;
}

function normalizeMadge(json) {
  const graph = new Map();
  const entries = json && typeof json === 'object' ? Object.entries(json) : [];
  for (const [rawSource, rawDeps] of entries) {
    const source = toPosix(rawSource);
    if (!isLocalModule(source)) continue;
    const resolved = new Set();
    const deps = Array.isArray(rawDeps) ? rawDeps : [];
    for (const rawDep of deps) {
      const target = toPosix(rawDep);
      if (isLocalModule(target)) resolved.add(target);
    }
    graph.set(source, resolved);
  }
  return graph;
}

function runGrapher(grapher, targetDir) {
  try {
    if (grapher.name === 'dependency-cruiser') {
      const output = execFileSync(
        grapher.bin,
        ['--no-config', '--output-type', 'json', '--exclude', 'node_modules|\\.git', '.'],
        { cwd: targetDir, encoding: 'utf8', maxBuffer: MAX_BUFFER },
      );
      return normalizeDependencyCruiser(JSON.parse(output));
    }
    const output = execFileSync(grapher.bin, ['--json', '.'], {
      cwd: targetDir,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    });
    return normalizeMadge(JSON.parse(output));
  } catch (error) {
    return null;
  }
}

function buildReverseGraph(forward) {
  const reverse = new Map();
  for (const [source, deps] of forward) {
    for (const dep of deps) {
      if (!reverse.has(dep)) reverse.set(dep, new Set());
      reverse.get(dep).add(source);
    }
  }
  return reverse;
}

function transitiveDependents(reverse, seeds) {
  const dependents = new Set();
  const visited = new Set(seeds);
  const queue = [...seeds];
  while (queue.length > 0) {
    const current = queue.shift();
    const importers = reverse.get(current);
    if (!importers) continue;
    for (const importer of importers) {
      dependents.add(importer);
      if (!visited.has(importer)) {
        visited.add(importer);
        queue.push(importer);
      }
    }
  }
  for (const seed of seeds) dependents.delete(seed);
  return dependents;
}

function computeBaseDependents(grapher, mergeBaseRef, changed) {
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'd6-base-'));
  let worktreeAdded = false;
  try {
    git(['worktree', 'add', '--detach', '--force', worktree, mergeBaseRef]);
    worktreeAdded = true;
    const forward = runGrapher(grapher, worktree);
    if (!forward) return null;
    const reverse = buildReverseGraph(forward);
    return transitiveDependents(reverse, new Set(changed));
  } catch (error) {
    return null;
  } finally {
    if (worktreeAdded) {
      try {
        git(['worktree', 'remove', '--force', worktree]);
      } catch (error) {
        /* handled by best-effort cleanup below */
      }
    }
    try {
      fs.rmSync(worktree, { recursive: true, force: true });
    } catch (error) {
      /* nothing further can be done for a stale temp dir */
    }
  }
}

function isTestFile(posixPath) {
  const segments = posixPath.split('/');
  if (segments.some((segment) => TEST_DIRECTORY_NAMES.has(segment))) return true;
  const base = segments[segments.length - 1];
  return TEST_INFIXES.some((infix) => base.includes(`${infix}.`));
}

function existsInRepo(posixPath) {
  return fs.existsSync(path.join(REPO_ROOT, posixPath));
}

function candidateTests(posixPath) {
  const directory = path.posix.dirname(posixPath);
  const extension = path.posix.extname(posixPath);
  const stem = path.posix.basename(posixPath, extension);
  const searchDirs = new Set([
    directory,
    path.posix.join(directory, '__tests__'),
    'test',
    'tests',
    '__tests__',
  ]);
  const candidates = new Set();
  for (const searchDir of searchDirs) {
    for (const infix of TEST_INFIXES) {
      for (const ext of SOURCE_EXTENSIONS) {
        candidates.add(path.posix.normalize(path.posix.join(searchDir, `${stem}${infix}${ext}`)));
      }
    }
  }
  return [...candidates];
}

function testsForDependent(posixPath) {
  if (isTestFile(posixPath)) return existsInRepo(posixPath) ? [posixPath] : [];
  return candidateTests(posixPath).filter(existsInRepo);
}

function runTests(testFiles) {
  const result = spawnSync('node', ['--test', ...testFiles], { cwd: REPO_ROOT, stdio: 'inherit' });
  if (result.error) return false;
  return result.status === 0;
}

function degrade(reason) {
  console.log(`d6-check: ${DEGRADE_MESSAGE} (${reason})`);
  process.exit(0);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.base || !args.head) {
    console.error('d6-check: --base and --head are required');
    process.exit(2);
    return;
  }

  if (tryGit(['rev-parse', '--is-inside-work-tree']) !== 'true') {
    degrade('not a git work tree');
    return;
  }

  const mergeBase = resolveMergeBase(args.base, args.head);
  const changed = changedSourceFiles(mergeBase, args.head);
  if (changed.length === 0) {
    degrade('no changed source files between base and head');
    return;
  }

  const grapher = findGrapher();
  if (!grapher) {
    degrade('no import grapher (dependency-cruiser or madge) available');
    return;
  }

  const headForward = runGrapher(grapher, REPO_ROOT);
  if (!headForward) {
    degrade(`import graph unavailable via ${grapher.name}`);
    return;
  }

  const headReverse = buildReverseGraph(headForward);
  const headDependents = transitiveDependents(headReverse, new Set(changed));
  if (headDependents.size === 0) {
    degrade('no dependents of changed files');
    return;
  }

  const baseDependents = computeBaseDependents(grapher, mergeBase, changed);
  if (baseDependents === null) {
    console.log('d6-check: base dependency graph unavailable; treating all current dependents as new (conservative)');
  }

  const newDependents = [...headDependents]
    .filter((dependent) => baseDependents === null || !baseDependents.has(dependent))
    .sort();

  if (newDependents.length === 0) {
    degrade('no new dependents introduced by this change');
    return;
  }

  console.log(`d6-check: ${newDependents.length} new dependent(s) to verify via ${grapher.name}`);

  let blocked = false;
  for (const dependent of newDependents) {
    const tests = testsForDependent(dependent);
    if (tests.length === 0) {
      console.log(`d6-check: WARN new dependent has no test: ${dependent}`);
      continue;
    }
    console.log(`d6-check: running tests for new dependent ${dependent}: ${tests.join(', ')}`);
    if (!runTests(tests)) {
      console.error(`d6-check: BLOCK tests failed for new dependent ${dependent}`);
      blocked = true;
    }
  }

  process.exit(blocked ? 1 : 0);
}

try {
  main();
} catch (error) {
  const message = error && error.message ? error.message : String(error);
  console.error(`d6-check: unexpected error: ${message}`);
  process.exit(1);
}
