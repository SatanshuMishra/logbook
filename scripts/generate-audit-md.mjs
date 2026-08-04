#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const JSON_REL = 'docs/audits/2026-08-04-mcp-audit.json';
const MD_REL = 'docs/audits/2026-08-04-mcp-audit.md';
const SUPPLEMENT_REL = 'docs/audits/2026-08-04-mcp-audit-supplement.json';

const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low'];
const ANCHOR_RE =
  /(^|[^A-Za-z0-9_./-])([A-Za-z0-9_./-]*[A-Za-z0-9_]\.(?:mjs|js|json|md|yml|yaml|mts|cjs)):([0-9]+(?:[-,:][0-9]+)*)/g;
const LEAD_ANCHOR_RE = /^\s*`?([A-Za-z0-9_./-]*[A-Za-z0-9_]\.[A-Za-z0-9]+):([0-9]+(?:[-,][0-9]+)*)/;
const MISSED_PREFIX_RE = /^\[([a-z][a-z-]*)\]\s+(CRITICAL|HIGH|MEDIUM|LOW)?/;

function fail(message) {
  process.stderr.write(`generate-audit-md: ${message}\n`);
  process.exit(1);
}

function loadAudit(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    fail(`cannot read ${path}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`cannot parse ${path} as JSON: ${error.message}`);
  }
  const result = parsed && parsed.result;
  if (!result || typeof result !== 'object') fail('artifact has no .result object');
  if (!Array.isArray(result.survivors)) fail('.result.survivors is not an array');
  if (!Array.isArray(result.missed)) fail('.result.missed is not an array');
  return result;
}

function loadSupplement(path) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    fail(`cannot read ${path}: ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail(`cannot parse ${path} as JSON: ${error.message}`);
  }
  const result = parsed && parsed.result;
  if (!result || typeof result !== 'object') fail('supplement has no .result object');
  if (!Array.isArray(result.findings)) fail('supplement .result.findings is not an array');
  if (!result.coverage || !Array.isArray(result.coverage.files)) {
    fail('supplement .result.coverage.files is not an array');
  }
  if (!result.measurements || typeof result.measurements !== 'object') {
    fail('supplement .result.measurements is not an object');
  }
  return parsed;
}

function validateSupplementFinding(finding, index) {
  if (!finding || typeof finding !== 'object') fail(`supplement finding ${index} is not an object`);
  for (const key of ['id', 'title', 'severity', 'category', 'confidence']) {
    if (typeof finding[key] !== 'string' || finding[key].length === 0) {
      fail(`supplement finding ${index} has no usable ${key}`);
    }
  }
  if (!finding.id.startsWith('sup-')) {
    fail(`supplement finding ${index} (${finding.id}) does not carry the sup- prefix`);
  }
  if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
    fail(`supplement finding ${index} (${finding.id}) has no evidence array`);
  }
  const verdict = finding.verdict;
  if (!verdict || typeof verdict !== 'object') fail(`supplement finding ${index} (${finding.id}) has no verdict`);
  if (typeof verdict.verdict !== 'string' || verdict.verdict.length === 0) {
    fail(`supplement finding ${index} (${finding.id}) has no verdict.verdict`);
  }
  if (typeof verdict.reasoning !== 'string' || verdict.reasoning.length === 0) {
    fail(`supplement finding ${index} (${finding.id}) has no verdict.reasoning`);
  }
}

function validateSurvivor(survivor, index) {
  if (!survivor || typeof survivor !== 'object') fail(`survivor ${index} is not an object`);
  for (const key of ['id', 'title', 'severity', 'dimension']) {
    if (typeof survivor[key] !== 'string' || survivor[key].length === 0) {
      fail(`survivor ${index} has no usable ${key}`);
    }
  }
  if (!Array.isArray(survivor.evidence) || survivor.evidence.length === 0) {
    fail(`survivor ${index} (${survivor.id}) has no evidence array`);
  }
  const verdict = survivor.verdict;
  if (!verdict || typeof verdict !== 'object') fail(`survivor ${index} (${survivor.id}) has no verdict`);
  if (typeof verdict.verdict !== 'string' || verdict.verdict.length === 0) {
    fail(`survivor ${index} (${survivor.id}) has no verdict.verdict`);
  }
}

function effectiveSeverity(survivor) {
  const corrected = survivor.verdict && survivor.verdict.corrected_severity;
  return typeof corrected === 'string' && corrected.length > 0 ? corrected : survivor.severity;
}

function resolveAnchor(evidence) {
  for (let index = 0; index < evidence.length; index += 1) {
    const entry = evidence[index];
    if (typeof entry !== 'string') continue;
    const match = entry.match(LEAD_ANCHOR_RE);
    if (match) return { anchor: `${match[1]}:${match[2]}`, index };
  }
  return { anchor: null, index: -1 };
}

function collectAnchors(text) {
  const seen = [];
  for (const match of text.matchAll(ANCHOR_RE)) {
    const anchor = `${match[2]}:${match[3]}`;
    if (!seen.includes(anchor)) seen.push(anchor);
  }
  return seen;
}

function cell(value) {
  return String(value).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ').trim();
}

function tally(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const known = SEVERITY_ORDER.filter((key) => counts.has(key)).map((key) => [key, counts.get(key)]);
  const rest = [...counts.keys()].filter((key) => !SEVERITY_ORDER.includes(key)).sort();
  return [...known, ...rest.map((key) => [key, counts.get(key)])];
}

function tallyLine(pairs) {
  return pairs.map(([key, count]) => `${key} ${count}`).join(', ');
}

function missedId(index) {
  return `missed-${String(index + 1).padStart(2, '0')}`;
}

function supplementLines(supplement, takenIds) {
  const { findings, coverage, measurements } = supplement.result;
  findings.forEach(validateSupplementFinding);
  const ids = new Set();
  for (const finding of findings) {
    if (takenIds.has(finding.id)) fail(`supplement id ${finding.id} collides with an original id`);
    if (ids.has(finding.id)) fail(`duplicate supplement id ${finding.id}`);
    ids.add(finding.id);
  }

  const severityTally = tally(findings.map((f) => f.severity));
  const verdictTally = tally(findings.map((f) => f.verdict.verdict));
  const areaTally = tally(findings.map((f) => f.area ?? 'unlabelled'));

  const lines = [];
  lines.push('## Supplement — MSP-0B coverage gap');
  lines.push('');
  lines.push(
    `This section is GENERATED from \`${SUPPLEMENT_REL}\`, a separate artifact. The original`
  );
  lines.push(
    '`docs/audits/2026-08-04-mcp-audit.json` is byte-frozen and was NOT modified: its sha256 is recorded'
  );
  lines.push(
    'in the SPEC as proof that the committed copy is byte-identical to the workflow output, and'
  );
  lines.push('re-serializing it would destroy that provenance.');
  lines.push('');
  if (typeof supplement.why === 'string' && supplement.why.length > 0) {
    lines.push(supplement.why);
    lines.push('');
  }
  lines.push(
    'Supplement ids all carry a `sup-` prefix, so they can never collide with the ids above. Everything'
  );
  lines.push(
    'before this heading is the original 121 defects and is unchanged by the presence of this section.'
  );
  lines.push('');
  lines.push('### Supplement counts');
  lines.push('');
  lines.push('| Population | JSON path | Count |');
  lines.push('| --- | --- | --- |');
  const fullReads = coverage.files.filter((file) => file.read === 'full');
  const coveredLines = coverage.files.reduce((total, file) => total + (Number(file.lines) || 0), 0);
  lines.push(`| Supplement findings | \`.result.findings\` | ${findings.length} |`);
  lines.push(`| Files covered | \`.result.coverage.files\` | ${coverage.files.length} |`);
  lines.push(`| Of those, read in full | \`.result.coverage.files[].read === 'full'\` | ${fullReads.length} |`);
  lines.push(`| Lines under coverage | sum of \`.lines\` | ${coveredLines} |`);
  lines.push('');
  lines.push(`- severity: ${tallyLine(severityTally)}`);
  lines.push(`- verdict: ${tallyLine(verdictTally)}`);
  lines.push(`- area: ${tallyLine(areaTally)}`);
  lines.push('');
  lines.push('### Coverage');
  lines.push('');
  lines.push('| file | lines | read |');
  lines.push('| --- | --- | --- |');
  for (const file of coverage.files) {
    lines.push(`| \`${cell(file.path)}\` | ${cell(file.lines)} | ${cell(file.read)} |`);
  }
  lines.push('');
  if (Array.isArray(coverage.not_read) && coverage.not_read.length > 0) {
    lines.push('Not read, and therefore not covered by this supplement:');
    lines.push('');
    for (const entry of coverage.not_read) lines.push(`- ${entry}`);
    lines.push('');
  }
  lines.push('### Supplement findings');
  lines.push('');
  lines.push('| id | area | severity | verdict | title | anchor |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const finding of findings) {
    const { anchor, index } = resolveAnchor(finding.evidence);
    const anchorCell =
      anchor === null
        ? 'no file:line in evidence — read `evidence[]` in the JSON'
        : index === 0
          ? `\`${anchor}\``
          : `\`${anchor}\` (from evidence[${index}]; evidence[0] carries no file:line)`;
    lines.push(
      `| \`${cell(finding.id)}\` | ${cell(finding.area ?? 'unlabelled')} | ${cell(finding.severity)} | ${cell(finding.verdict.verdict)} | ${cell(finding.title)} | ${anchorCell} |`
    );
  }
  lines.push('');
  lines.push('### Measurements');
  lines.push('');
  lines.push(
    'Every payload figure in the SPEC was measured on `LocalDriver`; the deployed backend is'
  );
  lines.push(
    '`GitRefDriver`. Both figures are recorded here. Measured against temp ledgers, never a real one.'
  );
  lines.push('');
  lines.push('| figure | LocalDriver | GitRefDriver | note |');
  lines.push('| --- | --- | --- | --- |');
  for (const row of measurements.figures ?? []) {
    lines.push(
      `| ${cell(row.figure)} | ${cell(row.local_driver)} | ${cell(row.git_ref_driver)} | ${cell(row.note)} |`
    );
  }
  lines.push('');
  if (typeof measurements.harness === 'string' && measurements.harness.length > 0) {
    lines.push(`Harness: ${measurements.harness}`);
    lines.push('');
  }
  return lines;
}

function build(result, supplement) {
  const { survivors, missed } = result;
  survivors.forEach(validateSurvivor);
  missed.forEach((entry, index) => {
    if (typeof entry !== 'string' || entry.trim().length === 0) {
      fail(`missed[${index}] is not a non-empty string`);
    }
  });

  const ids = new Set();
  for (const survivor of survivors) {
    if (ids.has(survivor.id)) fail(`duplicate survivor id ${survivor.id}`);
    ids.add(survivor.id);
  }
  missed.forEach((_, index) => {
    const id = missedId(index);
    if (ids.has(id)) fail(`missed id ${id} collides with a survivor id`);
    ids.add(id);
  });

  const confirmed = survivors.filter((s) => s.verdict.verdict === 'CONFIRMED').length;
  const overstated = survivors.filter((s) => s.verdict.verdict === 'OVERSTATED').length;
  const otherVerdicts = tally(
    survivors.map((s) => s.verdict.verdict).filter((v) => v !== 'CONFIRMED' && v !== 'OVERSTATED')
  );
  const rawTally = tally(survivors.map((s) => s.severity));
  const effTally = tally(survivors.map(effectiveSeverity));
  const dimensionTally = tally(survivors.map((s) => s.dimension));

  const parsedMissed = missed.map((entry, index) => {
    const match = entry.match(MISSED_PREFIX_RE);
    return {
      id: missedId(index),
      dimension: match ? match[1] : 'unlabelled',
      severity: match && match[2] ? match[2].toLowerCase() : 'unrated',
      prose: entry.trim(),
      anchors: collectAnchors(entry),
    };
  });
  const missedSeverityTally = tally(parsedMissed.map((m) => m.severity));
  const missedDimensionTally = tally(parsedMissed.map((m) => m.dimension));
  const effectiveCritical = survivors.filter((s) => effectiveSeverity(s) === 'critical').length;
  const missedCritical = parsedMissed.filter((m) => m.severity === 'critical').length;

  const lines = [];
  lines.push('# MCP server audit — evidence base');
  lines.push('');
  lines.push('## Provenance');
  lines.push('');
  lines.push(
    'This file is GENERATED from `docs/audits/2026-08-04-mcp-audit.json`. Every row below was emitted'
  );
  lines.push('from that JSON by a script; no defect was retyped by hand.');
  lines.push('');
  lines.push(
    '`docs/audits/2026-08-04-mcp-audit.json` is the authoritative artifact. This markdown is a'
  );
  lines.push(
    'navigation index over it and is lossy by construction: it carries one anchor per survivor, not'
  );
  lines.push(
    'the full `evidence[]`, and it carries no `mechanism`, `model_impact` or `failure_scenario` text.'
  );
  lines.push('');
  lines.push(
    'Do not trust this markdown over the JSON. Before acting on any defect, open the JSON entry with'
  );
  lines.push(
    'the same `id` and read it in full, then open the cited `file:line` yourself. A claim that cannot'
  );
  lines.push('be pinned to a line you personally opened is not made.');
  lines.push('');
  lines.push('## Counts');
  lines.push('');
  lines.push('| Population | JSON path | Count |');
  lines.push('| --- | --- | --- |');
  lines.push(`| Findings that survived adversarial verification | \`.result.survivors\` | ${survivors.length} |`);
  lines.push(`| Defects the verifiers found on their own | \`.result.missed\` | ${missed.length} |`);
  lines.push(`| Total verified defects | both | ${survivors.length + missed.length} |`);
  lines.push('');
  lines.push('### Verdict split (survivors only)');
  lines.push('');
  lines.push(`- CONFIRMED: ${confirmed}`);
  lines.push(`- OVERSTATED: ${overstated}`);
  if (otherVerdicts.length > 0) {
    lines.push(`- other verdict values present: ${tallyLine(otherVerdicts)}`);
  } else {
    lines.push('- no other verdict value appears; zero findings were refuted.');
  }
  lines.push('');
  lines.push('### Severity');
  lines.push('');
  lines.push(
    'EFFECTIVE severity is `verdict.corrected_severity` when present, falling back to `severity`. The'
  );
  lines.push('severity column of the survivor table below is the effective severity.');
  lines.push('');
  lines.push(`- effective severity (survivors): ${tallyLine(effTally)}`);
  lines.push(`- raw \`.severity\` as first claimed (survivors): ${tallyLine(rawTally)}`);
  lines.push(`- verifier-found severity, parsed from the entry prefix: ${tallyLine(missedSeverityTally)}`);
  lines.push('');
  lines.push(
    `Criticals: ${effectiveCritical} survivors at effective critical, plus ${missedCritical} carried only in`
  );
  lines.push(
    `\`.result.missed\`, for ${effectiveCritical + missedCritical} total. The raw \`.severity\` field claims`
  );
  lines.push(`${rawTally.find(([k]) => k === 'critical')?.[1] ?? 0} survivor criticals; the corrected field is the operative one.`);
  lines.push('');
  lines.push('### Dimension');
  lines.push('');
  lines.push(`- survivors: ${tallyLine(dimensionTally)}`);
  lines.push(`- verifier-found: ${tallyLine(missedDimensionTally)}`);
  lines.push('');
  lines.push('## How to read the survivor table');
  lines.push('');
  lines.push(
    '- `id` is the `id` field of the JSON entry and is stable. Cite a defect by this id. Ids are unique'
  );
  lines.push('  across both the survivor table and the verifier-found section.');
  lines.push('- `severity` is the EFFECTIVE severity defined above, not the raw claimed one.');
  lines.push(
    '- `anchor` is the `file:line` of `evidence[0]`, trimmed to path and line. Where `evidence[0]` carries'
  );
  lines.push(
    '  no leading `file:line`, the anchor is taken from the first evidence entry that does and the source'
  );
  lines.push('  index is stated in the cell. The remaining evidence entries live only in the JSON.');
  lines.push(
    '- An OVERSTATED verdict means the finding is real but its first claim was too broad. The verdict cell'
  );
  lines.push(
    '  carries the instruction to read `verdict.reasoning` first, because the narrowed claim is the true one.'
  );
  lines.push('');
  lines.push('## Survivors');
  lines.push('');
  lines.push('| id | dimension | severity | verdict | title | anchor |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const survivor of survivors) {
    const { anchor, index } = resolveAnchor(survivor.evidence);
    const anchorCell =
      anchor === null
        ? 'no file:line in evidence — read `evidence[]` in the JSON'
        : index === 0
          ? `\`${anchor}\``
          : `\`${anchor}\` (from evidence[${index}]; evidence[0] carries no file:line)`;
    const verdictCell =
      survivor.verdict.verdict === 'OVERSTATED'
        ? 'OVERSTATED — read `verdict.reasoning` in the JSON before acting on this row; the narrowed claim is the true one'
        : cell(survivor.verdict.verdict);
    lines.push(
      `| \`${cell(survivor.id)}\` | ${cell(survivor.dimension)} | ${cell(effectiveSeverity(survivor))} | ${verdictCell} | ${cell(survivor.title)} | ${anchorCell} |`
    );
  }
  lines.push('');
  lines.push('## Verifier-found defects');
  lines.push('');
  lines.push(
    `\`.result.missed\` holds ${missed.length} plain strings, not objects, so these carry no \`id\`, no \`verdict\` and no`
  );
  lines.push(
    'structured `evidence[]` in the artifact. The ids below are assigned here by array position'
  );
  lines.push(
    '(`missed-01` is `.result.missed[0]`) and are stable for that reason. Dimension and severity are parsed'
  );
  lines.push(
    'from the leading `[dimension] SEVERITY` prefix; entries whose prefix names no severity are recorded as'
  );
  lines.push(
    '`unrated` rather than assigned one. Each entry is reproduced verbatim; anchors are every `file:line`'
  );
  lines.push('found in its prose, in order of appearance.');
  lines.push('');
  for (const entry of parsedMissed) {
    lines.push(`### ${entry.id}`);
    lines.push('');
    lines.push(`- dimension: ${entry.dimension}`);
    lines.push(`- severity: ${entry.severity}`);
    lines.push(`- source: \`.result.missed[${Number(entry.id.slice(-2)) - 1}]\``);
    lines.push(
      `- anchors: ${entry.anchors.length > 0 ? entry.anchors.map((a) => `\`${a}\``).join(', ') : 'none found in prose'}`
    );
    lines.push('');
    lines.push(entry.prose);
    lines.push('');
  }

  if (supplement !== null) {
    lines.push(...supplementLines(supplement, ids));
  }

  return `${lines.join('\n').replace(/\n+$/, '')}\n`;
}

const jsonPath = resolve(REPO, JSON_REL);
const mdPath = resolve(REPO, MD_REL);
const supplementPath = resolve(REPO, SUPPLEMENT_REL);
const result = loadAudit(jsonPath);
const supplement = loadSupplement(supplementPath);
const markdown = build(result, supplement);
writeFileSync(mdPath, markdown, 'utf8');
const supplementCount = supplement === null ? 0 : supplement.result.findings.length;
process.stdout.write(
  `generate-audit-md: wrote ${mdPath} (${markdown.split('\n').length - 1} lines, ${result.survivors.length} survivors, ${result.missed.length} verifier-found, ${supplementCount} supplement)\n`
);
