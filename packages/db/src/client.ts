import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = ReturnType<typeof createDb>;

export interface CreateDbOptions {
  connectionString?: string;
  /** Connection pool size. Migrations and one-shot scripts should use 1. */
  max?: number;
}

function resolveConnectionString(explicit?: string): string {
  const url = explicit ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env and fill in your Supabase connection string.',
    );
  }
  return url;
}

export function createDb(options: CreateDbOptions = {}) {
  const client = postgres(resolveConnectionString(options.connectionString), {
    max: options.max ?? 10,
    // Supabase's transaction pooler does not support prepared statements.
    prepare: false,
  });
  return drizzle(client, { schema });
}

let cached: Database | undefined;

/**
 * Process-wide database handle.
 *
 * Cached because Next.js dev reloads modules on every edit — creating a fresh pool each
 * time exhausts Supabase connections within a few saves.
 */
export function getDb(): Database {
  cached ??= createDb();
  return cached;
}
