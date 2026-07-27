import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { loadConfig } from '../config.js';
import { logger } from '../logger.js';
import { DEFAULT_INSTRUCTION_STEPS } from '../llm/systemPrompt.js';

/**
 * Minimal, idempotent migration runner. Applies every `*.sql` file in
 * migrations/ in lexical order, tracking applied files in a schema_migrations
 * table so re-runs are no-ops. The SQL files themselves use
 * `create table if not exists`, so this is safe even without the tracking table.
 */
export async function runMigrations(databaseUrl: string): Promise<string[]> {
  const here = dirname(fileURLToPath(import.meta.url));
  // migrations/ sits at the repo root, two levels up from src/db/.
  const migrationsDir = join(here, '..', '..', 'migrations');

  const sql = postgres(databaseUrl, { max: 1 });
  const applied: string[] = [];
  // Arbitrary but stable lock key for the migration runner. Two instances
  // deploying at once will serialize here: the second blocks until the first
  // finishes, then finds all migrations already applied and does nothing.
  const LOCK_KEY = 918273645;
  try {
    await sql`select pg_advisory_lock(${LOCK_KEY})`;

    await sql`
      create table if not exists schema_migrations (
        filename text primary key,
        applied_at timestamptz default now()
      )`;

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const done = await sql`
        select 1 from schema_migrations where filename = ${file} limit 1`;
      if (done.length > 0) continue;

      const content = await readFile(join(migrationsDir, file), 'utf8');
      await sql.begin(async (tx) => {
        await tx.unsafe(content);
        await tx`insert into schema_migrations (filename) values (${file})`;
      });
      applied.push(file);
      logger.info({ file }, 'migration applied');
    }

    // Seed the first live instruction version FROM CODE (guarantees the DB's
    // steps are byte-identical to DEFAULT_INSTRUCTION_STEPS, so the pipeline
    // reads back exactly today's behavior). Only when the table exists and is
    // empty — idempotent, safe on every boot.
    const tableExists = await sql`
      select 1 from information_schema.tables
      where table_name = 'instruction_versions' limit 1`;
    if (tableExists.length > 0) {
      const seeded = await sql`
        insert into instruction_versions (version, steps, status, note, author, published_at)
        select 1, ${sql.json([...DEFAULT_INSTRUCTION_STEPS])}::jsonb,
               'live', 'Initial version (seeded from code defaults)', 'system', now()
        where not exists (select 1 from instruction_versions)
        returning id`;
      if (seeded.length > 0) logger.info('seeded instruction_versions v1 (live)');
    }

    return applied;
  } finally {
    await sql`select pg_advisory_unlock(${LOCK_KEY})`.catch(() => {});
    await sql.end();
  }
}

// Allow running directly: `node dist/db/migrate.js`
if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  runMigrations(config.DATABASE_URL)
    .then((applied) => {
      logger.info({ count: applied.length }, 'migrations complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'migration failed');
      process.exit(1);
    });
}
