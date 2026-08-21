/**
 * Apply migrations.
 *
 * Runs over the direct connection: Supabase's transaction pooler cannot run DDL reliably.
 * Extensions are ensured first because drizzle-kit does not generate CREATE EXTENSION,
 * and enabling pgvector later means a migration against a populated database.
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../supabase/migrations',
);

async function main(): Promise<void> {
  const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DIRECT_DATABASE_URL (preferred) or DATABASE_URL must be set to run migrations.',
    );
  }

  const client = postgres(connectionString, { max: 1, prepare: false });

  try {
    // Phase 3 needs pgvector for clustering. Enabling it now costs nothing; enabling it
    // later is a migration against a live table.
    await client`CREATE EXTENSION IF NOT EXISTS vector`;
    console.log('extensions ready (vector)');

    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS_FOLDER });
    console.log(`migrations applied from ${MIGRATIONS_FOLDER}`);
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('migration failed:', error);
  process.exitCode = 1;
});
