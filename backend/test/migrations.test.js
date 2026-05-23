// Migration-directory invariants. Pure filesystem checks — no DB required, so
// this gates every PR fast (`npm test`). Born out of MIS-72/MIS-91/MIS-94: a
// concurrently-landed migration claimed an already-used number TWICE. A
// number-keyed runner silently skips the second file, half-migrating the data
// layer with no error. This test makes a third collision impossible to merge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertUniqueMigrationNumbers, migrationFiles } from '../scripts/migrate.js';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

test('every migration NNN_ prefix is unique', async () => {
  const files = (await readdir(MIGRATIONS_DIR)).filter((f) => /^\d+_.*\.sql$/.test(f));
  assert.doesNotThrow(() => assertUniqueMigrationNumbers(files));
});

test('assertUniqueMigrationNumbers rejects a duplicate number', () => {
  assert.throws(
    () => assertUniqueMigrationNumbers(['011_a.sql', '011_b.sql', '012_c.sql']),
    /duplicate migration number/,
  );
});

test('migrationFiles applies in contiguous, gap-free numeric order', async () => {
  const files = await migrationFiles(); // throws on duplicate
  const nums = files.map((f) => Number(f.match(/^(\d+)_/)[1]));
  for (let i = 1; i < nums.length; i++) {
    assert.equal(nums[i], nums[i - 1] + 1, `gap or disorder near ${files[i]}`);
  }
});
