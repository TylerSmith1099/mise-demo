// Apply every migration in migrations/ in numeric order. Reusable as a module
// (runMigrations) and as a CLI: `node scripts/migrate.js`.

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

// Numeric prefix MUST be unique across the directory. A duplicate number is
// silently dangerous: any runner that keys applied-state on the number records
// one as applied and SKIPS the other, leaving the data layer half-migrated with
// no error (see MIS-72/MIS-91/MIS-94). Fail fast — a hard error is far better
// than a silent half-migration. Exported so the test suite can gate PRs on it.
export function assertUniqueMigrationNumbers(files) {
  const seen = new Map();
  const dupes = [];
  for (const f of files) {
    const num = f.match(/^(\d+)_/)[1];
    if (seen.has(num)) dupes.push(`${num}: ${seen.get(num)} <-> ${f}`);
    else seen.set(num, f);
  }
  if (dupes.length) {
    throw new Error(
      `duplicate migration number(s):\n  ${dupes.join('\n  ')}\n` +
        'Renumber one so every NNN_ prefix is unique.',
    );
  }
}

export async function migrationFiles() {
  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => /^\d+_.*\.sql$/.test(f))
    // zero-padded 3-digit prefixes sort identically lexicographically and by
    // version; localeCompare with numeric keeps it correct if width ever grows.
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  assertUniqueMigrationNumbers(files);
  return files;
}

export async function runMigrations(connectionString) {
  const files = await migrationFiles();
  // Match initDb: TLS (verify off) for public managed Postgres, plaintext for
  // internal/local hosts. Keeps `migrate` working against a Render external URL.
  const needsSsl =
    process.env.DB_SSL === 'require' || /[@.][^/@]*\.render\.com/.test(connectionString || '');
  const client = new pg.Client({
    connectionString,
    ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  await client.connect();
  try {
    for (const file of files) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
  return files;
}

// CLI entry
if (import.meta.url === `file://${process.argv[1]}`) {
  const cs = process.env.DB_CONNECTION_STRING;
  if (!cs) {
    console.error('DB_CONNECTION_STRING is required');
    process.exit(1);
  }
  runMigrations(cs)
    .then((files) => console.log(`applied ${files.length} migrations`))
    .catch((err) => {
      console.error('migration failed:', err.message);
      process.exit(1);
    });
}
