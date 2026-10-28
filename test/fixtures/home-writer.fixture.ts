import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

test('home-writer.fixture writes one file under its HOME', () => {
  const home = process.env.HOME
  assert.ok(home !== undefined && home !== '', 'the fixture needs a HOME to write under')
  writeFileSync(join(home, 'written-by-the-home-writer-fixture.txt'), 'written under HOME\n')
})
