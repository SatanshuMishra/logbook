import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const LOGBOOK_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const RELEASE = '0.19.0'

type VersionFile = { version?: unknown; packages?: Record<string, { version?: unknown }> }

const readJson = (relative: string): VersionFile => JSON.parse(readFileSync(join(LOGBOOK_ROOT, relative), 'utf8')) as VersionFile

test('release.versions-say-0.19.0', () => {
  const manifest = readJson('package.json')
  const lock = readJson('package-lock.json')
  const plugin = readJson('.claude-plugin/plugin.json')
  assert.equal(manifest.version, RELEASE, 'package.json version')
  assert.equal(lock.version, RELEASE, 'package-lock.json version')
  assert.equal(lock.packages?.['']?.version, RELEASE, "package-lock.json packages[''].version")
  assert.equal(plugin.version, RELEASE, '.claude-plugin/plugin.json version')
})
