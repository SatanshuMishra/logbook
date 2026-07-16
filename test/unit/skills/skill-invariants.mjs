import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SKILLS_ROOT = new URL('../../../skills/', import.meta.url);
const FRONTMATTER = /^---\n([\s\S]*?)\n---\n/;
const EMOJI = /\p{Extended_Pictographic}/u;

export const FORBIDDEN_SUBSTRINGS = [
  'ALLOWED_TRANSITIONS',
  'additionalProperties',
  '80 lines',
  'active -> paused',
  'schema_version',
];

export function readSkill(slug) {
  return readFileSync(fileURLToPath(new URL(`${slug}/SKILL.md`, SKILLS_ROOT)), 'utf8');
}

export function parseFrontmatter(text) {
  const match = text.match(FRONTMATTER);
  if (!match) throw new Error('SKILL.md is missing a frontmatter block');
  const fields = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) fields[m[1]] = m[2].trim();
  }
  return fields;
}

export function allowedTools(frontmatter) {
  return (frontmatter['allowed-tools'] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function skillBody(text) {
  return text.replace(FRONTMATTER, '');
}

export function hasEmoji(text) {
  return EMOJI.test(text);
}
